import "server-only";
import { z } from "zod";
import { GROUPS, GROUP_BY_CODE, expandGroups, groupName } from "@/lib/config/groups";
import type { Plan } from "@/lib/config/plans";
import { PILLARS } from "@/lib/config/score";
import { query } from "@/lib/data/store";
import type { AllocRow, FundDetail, ScreenerCard, ScreenerResult } from "@/lib/screener-types";
import { num } from "./format";
import { profileInsights } from "./insights";

// MF screener. Filters are a strict whitelist; SQL is built only from validated values.
// Plan limits are applied HERE: free users get the top N rows and only a few fields. Locked fields are never sent.

const groupCodes = GROUPS.map((g) => g.code) as [string, ...string[]];
export const SCREENER_SORTS = ["score", ...PILLARS, "ret_1y", "ret_3m", "batting", "aum", "age"] as const;

export const ScreenerFilters = z.object({
  categories: z.array(z.enum(groupCodes)).max(30).default([]),
  type: z.enum(["any", "active", "passive"]).default("any"),
  aum: z.array(z.enum(["small", "mid", "large"])).max(3).default([]),
  min_age: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]).default(0),
  min_score: z.number().int().min(0).max(100).default(0),
  min_batting: z.number().int().min(0).max(12).default(0),
  beat_category_1y: z.boolean().default(false),
  q: z.string().max(60).default(""),
  sort: z.enum(SCREENER_SORTS).default("score"),
  page: z.number().int().min(0).max(200).default(0),
});
export type ScreenerFilters = z.infer<typeof ScreenerFilters>;

// AUM buckets in lakhs (₹1,000 Cr = 1,00,000 lakhs)
const AUM_SQL = {
  small: "aum_lakhs < 100000",
  mid: "aum_lakhs >= 100000 AND aum_lakhs < 1000000",
  large: "aum_lakhs >= 1000000",
} as const;

const SORT_SQL: Record<(typeof SCREENER_SORTS)[number], string> = {
  score: "score_balanced",
  resilience: "p_resilience",
  consistency: "p_consistency",
  momentum: "p_momentum",
  returns: "p_returns",
  track_record: "p_track_record",
  ret_1y: "ret_1y_pct",
  ret_3m: "ret_3m_pct",
  batting: "months_beat",
  aum: "aum_lakhs",
  age: "fund_age_years",
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function whereSql(f: ScreenerFilters, opts: { skipCategories?: boolean } = {}): string {
  const w: string[] = ["TRUE"];
  if (!opts.skipCategories && f.categories.length) w.push(`grp IN (${expandGroups(f.categories).map(q).join(", ")})`);
  if (f.type !== "any") w.push(`active_passive = ${f.type === "active" ? "'Active'" : "'Passive'"}`);
  if (f.aum.length) w.push(`(${f.aum.map((a) => AUM_SQL[a]).join(" OR ")})`);
  if (f.min_age) w.push(`fund_age_years >= ${f.min_age}`);
  if (f.min_score) w.push(`score_balanced >= ${f.min_score}`);
  if (f.min_batting) w.push(`months_beat >= ${f.min_batting} AND batting_months >= 12`);
  if (f.beat_category_1y) w.push(`ret_1y_pct > (SELECT median(u2.ret_1y_pct) FROM universe u2 WHERE u2.grp = universe.grp)`);
  const text = f.q.toLowerCase().replace(/[^a-z0-9 &.-]/g, " ").trim();
  if (text) for (const word of text.split(/\s+/).slice(0, 5)) w.push(`lower(name) LIKE ${q(`%${word}%`)}`);
  return w.join(" AND ");
}



type Row = Record<string, unknown>;

function toCard(r: Row, full: boolean): ScreenerCard {
  const card: ScreenerCard = {
    code: String(r.scheme_code),
    name: String(r.name),
    category: groupName(String(r.grp)),
    type: String(r.active_passive ?? "-"),
    aum_cr: num(r.aum_lakhs) === null ? null : Math.round(Number(r.aum_lakhs) / 100),
    age_years: num(r.fund_age_years) === null ? null : Number(Number(r.fund_age_years).toFixed(1)),
    score: num(r.score_balanced),
    ret_1y: num(r.ret_1y_pct),
    batting: num(r.batting_months) ? { beat: Number(r.months_beat), of: Number(r.batting_months) } : null,
  };
  if (!full) return card;
  return {
    ...card,
    pillars: Object.fromEntries(PILLARS.map((p) => [p, num(r[`p_${p}`])])) as NonNullable<ScreenerCard["pillars"]>,
    ret_3m: num(r.ret_3m_pct),
    ret_6m: num(r.ret_6m_pct),
    momentum: num(r.rank_now) ? { rank: Number(r.rank_now), of: Number(r.rank_total_now), climbed_6m: num(r.places_climbed_6m) } : null,
    recovery_months: num(r.typical_recovery_months),
    category_recovery_months: num(r.category_typical_recovery_months),
    covid_fall_pct: num(r.covid_2020_fall_pct),
    sip_3y_gain_pct: num(r.sip_3y_gain_pct),
  };
}

export async function runScreener(f: ScreenerFilters, plan: Plan): Promise<ScreenerResult> {
  const where = whereSql(f);
  const sort = SORT_SQL[f.sort];
  const pageSize = plan.screenerRows;
  const page = plan.screenerPaging ? f.page : 0;
  const [{ total }] = await query<{ total: number }>(`SELECT count(*)::INT AS total FROM universe WHERE ${where}`);
  const rows = await query<Row>(
    `SELECT * FROM universe WHERE ${where}
     ORDER BY ${sort} DESC NULLS LAST, aum_lakhs DESC NULLS LAST
     LIMIT ${pageSize} OFFSET ${page * pageSize}`,
  );
  // counts per category under the other filters, so the filter list can show "(36)"
  const facetRows = await query<{ grp: string; n: number }>(`SELECT grp, count(*)::INT AS n FROM universe WHERE ${whereSql(f, { skipCategories: true })} GROUP BY grp`);
  const byGrp = new Map(facetRows.map((r) => [r.grp, r.n]));
  const facets = GROUPS.map((g) => ({ code: g.code, name: g.name, kind: g.kind, count: expandGroups([g.code]).reduce((s, c) => s + (byGrp.get(c) ?? 0), 0) })).filter((x) => x.count > 0);

  return {
    total,
    shown: rows.length,
    page,
    has_more: plan.screenerPaging && (page + 1) * pageSize < total,
    locked: !plan.fullData,
    cards: rows.map((r) => toCard(r, plan.fullData)),
    facets,
  };
}

// ---- fund detail (paid): analysis, allocation, details ----


const CODE_RE = /^[0-9A-Za-z_-]{1,20}$/;

export async function fundDetail(code: string): Promise<FundDetail | null> {
  if (!CODE_RE.test(code)) return null;
  const [row] = await query<Row>(`SELECT * FROM universe WHERE scheme_code = ${q(code)}`);
  if (!row) return null;
  const card = toCard(row, true);
  const ins = await profileInsights(row, {
    code: card.code,
    name: card.name,
    group: card.category,
    score: card.score,
    pillars: card.pillars!,
    ret_1y: card.ret_1y,
    aum_cr: card.aum_cr,
    age_years: card.age_years,
  });
  const alloc = await query<Row>(`SELECT dimension, label, pct, prev_pct, delta_pct, period, base_period FROM alloc WHERE scheme_code = ${q(code)} ORDER BY pct DESC NULLS LAST`);
  const pick = (dim: string, n: number): AllocRow[] =>
    alloc
      .filter((a) => a.dimension === dim && (num(a.pct) ?? 0) > 0)
      .slice(0, n)
      .map((a) => ({ label: String(a.label), pct: Number(a.pct), change: num(a.delta_pct) }));
  const p = alloc.find((a) => a.period);
  const fmtAmt = (v: unknown) => (num(v) ? `₹${Number(v).toLocaleString("en-IN")}` : "-");
  return {
    code,
    analysis: [...(ins.verdict ? [ins.verdict] : []), ...ins.analysis, ...ins.peers],
    allocation: {
      period: p ? `${p.base_period} → ${p.period}` : null,
      sectors: pick("sector", 12),
      asset_class: pick("asset_class", 6),
      rating: pick("rating", 8),
    },
    details: [
      { label: "Benchmark", value: String(row.benchmark ?? "-") },
      { label: "NAV", value: num(row.nav) ? `₹${Number(row.nav).toFixed(2)} (${row.nav_date})` : "-" },
      { label: "Minimum lumpsum", value: fmtAmt(row.min_lumpsum) },
      { label: "Minimum additional", value: fmtAmt(row.min_additional) },
      { label: "SIP available", value: row.sip_allowed === "Y" ? "Yes" : row.sip_allowed === "N" ? "No" : "-" },
      { label: "Category peers", value: `${row.n_peers} funds in ${groupName(String(row.grp))}` },
      { label: "Plan", value: "Regular · Growth" },
    ],
  };
}

export const categoryKinds = () => [...new Set(GROUPS.map((g) => g.kind))].map((k) => ({ kind: k, groups: GROUPS.filter((g) => g.kind === k && GROUP_BY_CODE.has(g.code)) }));
