// Builds the serving tables from the raw backend_main_kartik parquet files.
// Shared by the daily builder job (scripts/build-serving.ts) and by local dev (store.ts, raw mode).
// No "server-only" import here: the builder runs outside Next.js.
import type { DuckDBConnection } from "@duckdb/node-api";
import { LENS_WEIGHTS, LENSES, MIN_AGE_YEARS, MIN_PEERS, MIN_PILLARS, PILLARS, type Lens } from "@/lib/config/score";

// Raw inputs in the source bucket. Most follow <prefix>/<name>/latest/<name>.parquet; monthly returns has its own path.
export const RAW_FILES = ["fund_cards", "category", "recovery_speed", "sector_rotation", "aum", "monthly_returns"] as const;
export type RawFile = (typeof RAW_FILES)[number];
export const rawObjectPath = (f: RawFile, prefix: string) =>
  f === "monthly_returns" ? "monthly_returns/monthly_returns_latest.parquet" : `${prefix}/${f}/latest/${f}.parquet`;

// What the app needs. Written by the builder to gs://<serving bucket>/serving/<build_id>/<table>.parquet
export const SERVING_TABLES = ["universe", "sector_clean", "sector_names", "alloc", "monthly"] as const;

// Empty-table shapes, used when an older serving build doesn't contain a newer table yet.
export const EMPTY_TABLE_SQL: Partial<Record<(typeof SERVING_TABLES)[number], string>> = {
  monthly: "CREATE TABLE monthly (scheme_code VARCHAR, month VARCHAR, month_end DATE, ret_pct DOUBLE, cat_pct DOUBLE, beat INTEGER, beat_36 INTEGER, comparable_36 INTEGER)",
};

export const sqlPath = (p: string) => `'${p.replace(/\\/g, "/").replace(/'/g, "''")}'`;

// Percentile (0-100) of `expr` within the peer group; higher expr = higher percentile.
// Mid-rank, so ties share the middle percentile. Null if no data, too few peers, or no spread in the group.
const pct = (expr: string) => {
  const part = `PARTITION BY grp, (${expr}) IS NULL`;
  return `CASE WHEN (${expr}) IS NOT NULL
               AND count(${expr}) OVER (PARTITION BY grp) >= ${MIN_PEERS}
               AND stddev_pop(${expr}) OVER (PARTITION BY grp) > 0
          THEN 100.0 * ((rank() OVER (${part} ORDER BY ${expr}) + cume_dist() OVER (${part} ORDER BY ${expr}) * count(*) OVER (${part})) / 2 - 1)
               / nullif(count(*) OVER (${part}) - 1, 0) END`;
};

const avg2 = (a: string, b: string) => `CASE WHEN ${a} IS NULL THEN ${b} WHEN ${b} IS NULL THEN ${a} ELSE (${a} + ${b}) / 2 END`;

const pcol = (p: string) => `p_${p}`;

function scoreExpr(lens: Lens): string {
  const w = LENS_WEIGHTS[lens];
  const num = PILLARS.map((p) => `coalesce(${pcol(p)} * ${w[p]}, 0)`).join(" + ");
  const den = PILLARS.map((p) => `(CASE WHEN ${pcol(p)} IS NOT NULL THEN ${w[p]} ELSE 0 END)`).join(" + ");
  return `CASE WHEN eligible THEN round((${num}) / nullif(${den}, 0), 1) END`;
}

// Labels in the raw holdings that are not real sectors (ISINs, numbers, notes, fund-of-fund units...)
const JUNK_LABEL =
  "mutual fund|etf|notional|futures|options|^index|percentage|instrument|reit|invit|alternative|units|foreign|overseas|^nil$|not applicable|^others?$|miscellaneous|^sov$|cdmdf|^floating$|unrated|^aif$|fund - direct|fund-direct";

export async function buildServingTables(conn: DuckDBConnection, files: Record<RawFile, string>): Promise<void> {
  const run = (sql: string) => conn.run(sql);
  for (const f of RAW_FILES) await run(`CREATE OR REPLACE TABLE raw_${f} AS SELECT * FROM read_parquet(${sqlPath(files[f])})`);

  await run(`
    CREATE TABLE base AS
    SELECT
      f.scheme_code, f.name, f.amc, coalesce(c.goc_short_code, r."group") AS grp,
      c.active_passive, c.sebi_sub_category, c.benchmark,
      f.nav, CAST(f.nav_date AS DATE) AS nav_date,
      f.ret_3m_pct, f.ret_6m_pct, f.ret_1y_pct,
      f.months_beat, f.batting_months,
      CASE WHEN f.batting_months >= 6 THEN f.months_beat / f.batting_months END AS batting_ratio,
      f.rank_now, f.rank_total_now, f.places_climbed_6m,
      CASE WHEN f.rank_total_now > 1 THEN 1 - (f.rank_now - 1) / (f.rank_total_now - 1) END AS momentum_raw,
      coalesce(f.aum_lakhs, a.aum_lakhs) AS aum_lakhs,
      coalesce(f.fund_age_years, a.fund_age_years, date_diff('day', CAST(c.launch_date AS DATE), current_date) / 365.25) AS fund_age_years,
      f.sip_invested, f.sip_value,
      CASE WHEN f.sip_invested > 0 THEN (f.sip_value / f.sip_invested - 1) * 100 END AS sip_3y_gain_pct,
      r.resilience_score, f.typical_recovery_months, f.category_typical_recovery_months,
      r.resilience_worst_fall_pct, r.resilience_median_recovery_months,
      f.covid_2020_fall_pct, f.covid_2020_recovery_months,
      f.ilfs_2018_fall_pct, f.ilfs_2018_recovery_months,
      f.fii_2021_fall_pct, f.fii_2021_recovery_months,
      f.iran_2026_fall_pct, f.iran_2026_recovery_months,
      f.nse_new_purchase_min_amount AS min_lumpsum,
      f.nse_additional_purchase_min_amount AS min_additional,
      f.nse_sip_allowed AS sip_allowed
    FROM raw_fund_cards f
    LEFT JOIN raw_recovery_speed r USING (scheme_code)
    LEFT JOIN raw_category c USING (scheme_code)
    LEFT JOIN (SELECT scheme_code, any_value(aum_lakhs) AS aum_lakhs, any_value(fund_age_years) AS fund_age_years FROM raw_aum GROUP BY scheme_code) a USING (scheme_code)
  `);

  await run(`
    CREATE TABLE pillars AS
    SELECT *,
      coalesce(${pct("resilience_score")}, ${pct("-typical_recovery_months")}) AS p_resilience,
      ${pct("batting_ratio")} AS p_consistency,
      ${pct("momentum_raw")} AS p_momentum,
      ${pct("ret_1y_pct")} AS p_ret1y,
      ${pct("sip_3y_gain_pct")} AS p_sip,
      ${pct("aum_lakhs")} AS p_aum,
      ${pct("fund_age_years")} AS p_age,
      count(*) OVER (PARTITION BY grp) AS n_peers
    FROM base
  `);

  await run(`
    CREATE TABLE universe0 AS
    SELECT * EXCLUDE (p_ret1y, p_sip, p_aum, p_age),
      ${avg2("p_ret1y", "p_sip")} AS p_returns,
      ${avg2("p_aum", "p_age")} AS p_track_record
    FROM pillars
  `);

  const nPillars = PILLARS.map((p) => `(${pcol(p)} IS NOT NULL)::INT`).join(" + ");
  await run(`
    CREATE TABLE universe1 AS
    SELECT *, ${nPillars} AS n_pillars,
      (${nPillars}) >= ${MIN_PILLARS} AND coalesce(fund_age_years, 0) >= ${MIN_AGE_YEARS} AS eligible
    FROM universe0`);
  await run(`
    CREATE TABLE universe AS
    SELECT *, ${LENSES.map((l) => `${scoreExpr(l)} AS score_${l}`).join(", ")}
    FROM universe1
  `);
  await run(`DROP TABLE base; DROP TABLE pillars; DROP TABLE universe0; DROP TABLE universe1;`);

  // Sector holdings, cleaned: real sector names only (the raw labels also contain ISINs, numbers and notes).
  await run(`
    CREATE TABLE sector_clean AS
    SELECT s.amficode AS scheme_code, u.grp, u.active_passive,
      trim(regexp_replace(replace(lower(s.label), '&', 'and'), '\\s+', ' ', 'g')) AS skey,
      s.label, coalesce(s.market_value, 0) AS mv, coalesce(s.prev_market_value, 0) AS prev_mv,
      s.action, s.period, s.base_period
    FROM raw_sector_rotation s
    JOIN universe u ON u.scheme_code = s.amficode
    WHERE s.dimension = 'sector'
      AND regexp_matches(s.label, '[A-Za-z]{3}')
      AND NOT regexp_matches(lower(trim(s.label)), '^in[a-z0-9]{10}$')
      AND NOT regexp_matches(lower(s.label), '${JUNK_LABEL}')
  `);
  await run(`CREATE TABLE sector_names AS SELECT skey, mode(label) AS label FROM sector_clean GROUP BY skey`);

  // Per-fund allocation for the screener: sectors (equity), asset class (all) and credit rating (debt).
  await run(`
    CREATE TABLE alloc AS
    SELECT s.amficode AS scheme_code, s.dimension,
      CASE WHEN s.dimension = 'sector' THEN coalesce(n.label, s.label) ELSE s.label END AS label,
      round(s.pct, 2) AS pct, round(s.prev_pct, 2) AS prev_pct, round(s.delta_pct, 2) AS delta_pct, s.action, s.period, s.base_period
    FROM raw_sector_rotation s
    JOIN universe u ON u.scheme_code = s.amficode
    LEFT JOIN sector_names n ON n.skey = trim(regexp_replace(replace(lower(s.label), '&', 'and'), '\\s+', ' ', 'g'))
    WHERE s.dimension IN ('sector', 'asset_class', 'rating')
      AND (coalesce(s.pct, 0) > 0 OR coalesce(s.prev_pct, 0) > 0)
      AND (s.dimension <> 'sector' OR (
            regexp_matches(s.label, '[A-Za-z]{3}')
            AND NOT regexp_matches(lower(trim(s.label)), '^in[a-z0-9]{10}$')
            AND NOT regexp_matches(lower(s.label), '${JUNK_LABEL}')))
  `);
  // Month-by-month returns (last 36 months) with the category average for each month.
  await run(`
    CREATE TABLE monthly AS
    SELECT CAST(m.amfi_code AS VARCHAR) AS scheme_code, m.return_month AS month, m.month_end_date AS month_end,
      round(m.monthly_return_pct, 4) AS ret_pct, round(m.category_avg_return_pct, 4) AS cat_pct,
      CAST(m.better_than_avg AS INTEGER) AS beat,
      CAST(m.outperformance_count_36 AS INTEGER) AS beat_36, CAST(m.comparable_months_36 AS INTEGER) AS comparable_36
    FROM raw_monthly_returns m
    JOIN universe u ON u.scheme_code = CAST(m.amfi_code AS VARCHAR)
    WHERE m.monthly_return_pct IS NOT NULL
  `);
  for (const f of RAW_FILES) await run(`DROP TABLE raw_${f}`);
}

export type ServingMeta = { nav: string | null; sectorPeriod: string | null; sectorBase: string | null; funds: number };

export async function readMeta(conn: DuckDBConnection): Promise<ServingMeta> {
  const r = await conn.runAndReadAll(`
    SELECT (SELECT CAST(max(nav_date) AS VARCHAR) FROM universe) AS nav,
           (SELECT mode(period) FROM sector_clean) AS sp,
           (SELECT mode(base_period) FROM sector_clean) AS sb,
           (SELECT count(*)::INT FROM universe) AS funds`);
  const m = r.getRowObjectsJson()[0] as Record<string, string | number | null>;
  return { nav: m.nav as string | null, sectorPeriod: m.sp as string | null, sectorBase: m.sb as string | null, funds: Number(m.funds) };
}
