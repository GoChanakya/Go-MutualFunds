import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { Storage } from "@google-cloud/storage";
import { LENS_WEIGHTS, LENSES, MIN_AGE_YEARS, MIN_PEERS, MIN_PILLARS, PILLARS, type Lens } from "@/lib/config/score";

// Files we read from gs://<bucket>/<prefix>/<name>/latest/<name>.parquet
const FILES = ["fund_cards", "category", "recovery_speed", "sector_rotation", "aum"] as const;

const BUCKET = process.env.DATA_BUCKET ?? "mf-data-public";
const PREFIX = process.env.DATA_PREFIX ?? "backend_main_kartik";
// Local folder with the parquet files (dev). If unset, files are downloaded from GCS into the OS temp dir.
const LOCAL_DIR = process.env.DATA_DIR;
const CACHE_DIR = process.env.DATA_CACHE_DIR ?? path.join(os.tmpdir(), "mf-data-cache");
const REFRESH_HOURS = Number(process.env.DATA_REFRESH_HOURS ?? 12);

export type Store = {
  conn: DuckDBConnection;
  loadedAt: number;
  asOf: { nav: string | null; sectorPeriod: string | null; sectorBase: string | null };
  funds: { code: string; name: string; grp: string }[];
};

let current: Promise<Store> | null = null;
let refreshing = false;

export async function getStore(): Promise<Store> {
  if (!current) {
    current = build().catch((e) => {
      current = null;
      throw e;
    });
    return current;
  }
  const s = await current;
  if (!refreshing && Date.now() - s.loadedAt > REFRESH_HOURS * 3600_000) {
    refreshing = true;
    build()
      .then((fresh) => {
        current = Promise.resolve(fresh);
        s.conn.closeSync?.();
      })
      .catch((e) => console.error(JSON.stringify({ type: "data_refresh_failed", error: String(e) })))
      .finally(() => (refreshing = false));
  }
  return s;
}

export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { conn } = await getStore();
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as unknown as T[];
}

async function fetchFiles(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (LOCAL_DIR) {
    for (const f of FILES) out[f] = path.join(LOCAL_DIR, `${f}.parquet`);
    return out;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const bucket = new Storage().bucket(BUCKET);
  await Promise.all(
    FILES.map(async (f) => {
      const dest = path.join(CACHE_DIR, `${f}.parquet`);
      const fresh = fs.existsSync(dest) && Date.now() - fs.statSync(dest).mtimeMs < REFRESH_HOURS * 3600_000;
      if (!fresh) {
        const tmp = `${dest}.part`;
        await bucket.file(`${PREFIX}/${f}/latest/${f}.parquet`).download({ destination: tmp });
        fs.renameSync(tmp, dest);
      }
      out[f] = dest;
    }),
  );
  return out;
}

const sqlPath = (p: string) => `'${p.replace(/\\/g, "/").replace(/'/g, "''")}'`;

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

async function build(): Promise<Store> {
  const t0 = Date.now();
  const files = await fetchFiles();
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  const run = (sql: string) => conn.run(sql);

  for (const f of FILES) await run(`CREATE TABLE raw_${f} AS SELECT * FROM read_parquet(${sqlPath(files[f])})`);

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
      f.iran_2026_fall_pct, f.iran_2026_recovery_months
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
      AND NOT regexp_matches(lower(s.label),
        'mutual fund|etf|notional|futures|options|^index|percentage|instrument|reit|invit|alternative|units|foreign|overseas|^nil$|not applicable|^others?$|miscellaneous|^sov$|cdmdf|^floating$|unrated|^aif$|fund - direct|fund-direct')
  `);
  await run(`CREATE TABLE sector_names AS SELECT skey, mode(label) AS label FROM sector_clean GROUP BY skey`);

  const meta = await conn.runAndReadAll(`
    SELECT (SELECT CAST(max(nav_date) AS VARCHAR) FROM universe) AS nav,
           (SELECT mode(period) FROM sector_clean) AS sp,
           (SELECT mode(base_period) FROM sector_clean) AS sb
  `);
  const m = meta.getRowObjectsJson()[0] as Record<string, string | null>;
  const funds = (await conn.runAndReadAll(`SELECT scheme_code AS code, name, grp FROM universe`)).getRowObjectsJson() as unknown as Store["funds"];

  console.log(JSON.stringify({ type: "data_loaded", funds: funds.length, ms: Date.now() - t0, nav_as_of: m.nav }));
  return { conn, loadedAt: Date.now(), asOf: { nav: m.nav, sectorPeriod: m.sp, sectorBase: m.sb }, funds };
}
