import "server-only";
import { DEFAULT_EQUITY_GROUPS, DEFAULT_PASSIVE_GROUPS, GROUP_BY_CODE, THEME_SECTOR_PATTERNS, expandGroups, groupName } from "@/lib/config/groups";
import { METRICS } from "@/lib/config/metrics";
import { LENS_LABEL, LENS_WEIGHTS, MAX_ROWS, MIN_AGE_YEARS, PILLARS, PILLAR_LABEL, PILLAR_SOURCE, type Lens, type Pillar } from "@/lib/config/score";
import { resolveOne } from "@/lib/data/resolve";
import { getStore, query } from "@/lib/data/store";
import type { FundMetric, Intent, RankIntent } from "@/lib/intent/schema";
import type { Block, ChatContext, Fact, FundRow, ShiftRow } from "@/lib/types";
import { fmtCr, fmtInr, fmtMonths, fmtPct, fmtScore, fmtYears, num } from "./format";
import { catStats, compareInsights, profileInsights, rankInsights, returnBars } from "./insights";
import { monthLabel, monthlyBars, monthlyView } from "./monthly";
import { sectorOverlapBlocks } from "./overlap";

// Executes a validated intent against our data and builds the answer blocks.
// Every number and every sentence here comes from our code - never from the LLM.

export type Result = { blocks: Block[]; context: ChatContext };

type Row = Record<string, unknown>;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const CODE_RE = /^[0-9A-Za-z_-]{1,20}$/;
const inList = (codes: string[]) => codes.filter((c) => CODE_RE.test(c)).map(q).join(", ") || "''";

const scoreCol = (lens: Lens) => `score_${lens}`;

const SORT_SQL: Record<RankIntent["sort_by"], (lens: Lens) => string> = {
  score: (l) => scoreCol(l),
  resilience: () => "p_resilience",
  consistency: () => "p_consistency",
  momentum: () => "p_momentum",
  returns: () => "p_returns",
  track_record: () => "p_track_record",
  ret_1y: () => "ret_1y_pct",
  ret_3m: () => "ret_3m_pct",
  aum: () => "aum_lakhs",
  age: () => "fund_age_years",
};

const SORT_LABEL: Record<RankIntent["sort_by"], string> = {
  score: "our 5-pillar score",
  ...(Object.fromEntries(PILLARS.map((p) => [p, PILLAR_LABEL[p]])) as Record<Pillar, string>),
  ret_1y: "1-year return",
  ret_3m: "3-month return",
  aum: "fund size (AUM)",
  age: "fund age",
};

function toFundRow(r: Row, lens: Lens = "balanced"): FundRow {
  return {
    code: String(r.scheme_code),
    name: String(r.name),
    group: groupName(String(r.grp)),
    score: num(r[scoreCol(lens)]),
    pillars: {
      resilience: num(r.p_resilience),
      consistency: num(r.p_consistency),
      momentum: num(r.p_momentum),
      returns: num(r.p_returns),
      track_record: num(r.p_track_record),
    },
    ret_1y: num(r.ret_1y_pct),
    aum_cr: num(r.aum_lakhs) === null ? null : Math.round(Number(r.aum_lakhs) / 100),
    age_years: num(r.fund_age_years),
  };
}

const pillarsOf = (f: FundRow) => PILLARS.map((p) => [p, f.pillars[p]] as const);
const strongPillars = (f: FundRow, min = 75) => pillarsOf(f).filter(([, v]) => v !== null && v >= min).map(([p]) => p);
const weakPillars = (f: FundRow, max = 30) => pillarsOf(f).filter(([, v]) => v !== null && v <= max).map(([p]) => p);
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// One sentence per pillar, with the real number behind it.
function pillarEvidence(p: Pillar, r: Row): string {
  switch (p) {
    case "resilience":
      if (num(r.resilience_score) !== null)
        return `has a resilience score of ${Math.round(Number(r.resilience_score))}/100 in our stress tests${
          num(r.resilience_worst_fall_pct) !== null ? ` (worst fall ${Math.abs(Number(r.resilience_worst_fall_pct)).toFixed(1)}%)` : ""
        }`;
      return num(r.typical_recovery_months) !== null
        ? `typically recovers from falls in ${fmtMonths(r.typical_recovery_months)} (category: ${fmtMonths(r.category_typical_recovery_months)})`
        : "holds up well in market falls";
    case "consistency":
      return num(r.batting_months) ? `beat its category average in ${r.months_beat} of the last ${r.batting_months} months` : "beats its category consistently";
    case "momentum":
      return num(r.rank_now) ? `ranks ${r.rank_now} of ${r.rank_total_now} in its category on recent performance` : "has strong recent momentum";
    case "returns":
      return `1-year return of ${fmtPct(r.ret_1y_pct)}`;
    case "track_record":
      return `${fmtCr(r.aum_lakhs)} in assets and ${fmtYears(r.fund_age_years)} of history`;
  }
}

const SELECT_FUNDS = `SELECT * FROM universe`;

async function fundsByCodes(codes: string[]): Promise<Row[]> {
  if (!codes.length) return [];
  const rows = await query<Row>(`${SELECT_FUNDS} WHERE scheme_code IN (${inList(codes)})`);
  const byCode = new Map(rows.map((r) => [String(r.scheme_code), r]));
  return codes.map((c) => byCode.get(c)).filter(Boolean) as Row[];
}

// "result:2" -> code from previous answer; otherwise fuzzy-resolve the name.
async function resolveRef(ref: string, ctx: ChatContext): Promise<{ code?: string; candidates?: string[] }> {
  const m = ref.match(/^result:(\d+)$/);
  if (m) {
    const code = ctx.last_results?.[Number(m[1]) - 1];
    return code ? { code } : { candidates: [] };
  }
  // "group:EQS-LRG:2" = 2nd best fund in that category by the balanced score
  const g = ref.match(/^group:([A-Z-]+):([1-9])$/);
  if (g && GROUP_BY_CODE.has(g[1])) {
    const [row] = await query<Row>(
      `SELECT scheme_code FROM universe WHERE grp IN (${inList(expandGroups([g[1]]))}) AND eligible AND score_balanced IS NOT NULL
       ORDER BY score_balanced DESC LIMIT 1 OFFSET ${Number(g[2]) - 1}`,
    );
    return row ? { code: String(row.scheme_code) } : { candidates: [] };
  }
  const r = await resolveOne(ref);
  if (r.fund) return { code: r.fund.code };
  return { candidates: r.candidates.map((c) => c.name) };
}

// ---------------- rank_funds ----------------

async function rankFunds(it: RankIntent, ctx: ChatContext, exec: ExecOptions): Promise<Result> {
  let codes = it.groups;
  let defaultSet: "passive" | "equity" | null = null;
  if (!codes.length) {
    defaultSet = it.passive === "passive" ? "passive" : "equity";
    codes = defaultSet === "passive" ? DEFAULT_PASSIVE_GROUPS : DEFAULT_EQUITY_GROUPS;
  }
  const groups = expandGroups(codes);
  const sortCol = SORT_SQL[it.sort_by](it.lens);
  const limit = Math.min(it.limit, MAX_ROWS, exec.maxRankRows);
  const where = [
    `grp IN (${inList(groups)})`,
    it.passive === "passive" ? `active_passive = 'Passive'` : it.passive === "active" || defaultSet === "equity" ? `active_passive = 'Active'` : "TRUE",
    it.min_age_years ? `fund_age_years >= ${Number(it.min_age_years)}` : "TRUE",
  ].join(" AND ");

  const rows = await query<Row>(`${SELECT_FUNDS} WHERE ${where} AND eligible AND ${sortCol} IS NOT NULL ORDER BY ${sortCol} DESC, aum_lakhs DESC NULLS LAST LIMIT ${limit}`);
  const [{ total }] = await query<{ total: number }>(`SELECT count(*)::INT AS total FROM universe WHERE ${where}`);

  const label =
    defaultSet === "passive" ? "equity index funds & ETFs" : defaultSet === "equity" ? "diversified equity funds" : `${listJoin(codes.map(groupName))} funds`;
  if (!rows.length)
    return { blocks: [{ type: "text", text: `I don't have enough data to rank ${label} by ${SORT_LABEL[it.sort_by]} yet.` }], context: ctx };

  const funds = rows.map((r) => toFundRow(r, it.lens));
  const blocks: Block[] = [];
  const how = it.sort_by === "score" ? `${SORT_LABEL.score} (${LENS_LABEL[it.lens]})` : SORT_LABEL[it.sort_by];
  blocks.push({ type: "text", text: `Top ${funds.length} ${label}, ranked by ${how}.` });
  blocks.push({ type: "fund_table", title: `${label} · ${how}`, rows: funds });

  // Analysis from our own rules: why #1 leads, standouts, trade-offs, category context.
  blocks.push(...(await rankInsights(rows, funds, groups)));
  if (exec.planId === "free" && it.limit > rows.length && total > rows.length)
    blocks.push({ type: "note", text: `Free plan shows the top ${rows.length}. Upgrade to see up to ${MAX_ROWS} funds per list and every data point.` });

  const kinds = new Set(groups.map((g) => GROUP_BY_CODE.get(g)?.kind));
  if (kinds.has("sector"))
    blocks.push({ type: "note", text: "Sector and thematic funds are concentrated bets. They can swing much more than diversified funds." });
  if (groups.includes("EQS-SMC") || groups.includes("EQS-MID"))
    blocks.push({ type: "note", text: `${groups.includes("EQS-SMC") ? "Small" : "Mid"} cap funds can fall 30-40% in a crash. They suit money you won't need for 7+ years.` });
  if (kinds.has("passive") || it.passive === "passive")
    blocks.push({ type: "note", text: "For index funds and ETFs, low cost and low tracking error matter most. Scores here compare them only within their own group." });
  if (defaultSet === "passive") blocks.push({ type: "note", text: "Showing equity index funds and ETFs. Ask for gold, debt or international passive funds separately." });
  if (defaultSet === "equity")
    blocks.push({ type: "note", text: "Showing diversified equity funds across categories (large, mid, small, flexi cap and more). Name a category for a like-for-like list." });
  const [{ unscored }] = await query<{ unscored: number }>(`SELECT count(*)::INT AS unscored FROM universe WHERE ${where} AND NOT eligible`);
  if (unscored)
    blocks.push({ type: "note", text: `${unscored} of ${total} funds here are not ranked because they have under ${MIN_AGE_YEARS} years of history or too little data.` });

  const opts = ["Compare the top 2", "Tell me more about the first one"];
  if (it.sort_by !== "resilience") opts.push("Sort by resilience");
  if (it.lens !== "safety") opts.push("Show the safest ones");
  const theme = codes.find((c) => THEME_SECTOR_PATTERNS[c]);
  if (theme) opts.push(`Sector shifts in ${groupName(theme)}`);
  blocks.push({ type: "choices", text: "", options: opts });

  return { blocks, context: { ...ctx, last_intent: it, last_results: funds.map((f) => f.code) } };
}

// ---------------- fund_profile ----------------

async function fundProfile(ref: string, ctx: ChatContext): Promise<Result> {
  const r = await resolveRef(ref, ctx);
  if (!r.code) return notFound(r.candidates, ctx);
  const [row] = await fundsByCodes([r.code]);
  if (!row) return notFound([], ctx);
  const fund = toFundRow(row);
  const [cat] = await query<Row>(`SELECT median(ret_1y_pct) AS med_1y FROM universe WHERE grp = ${q(String(row.grp))}`);

  const facts: Fact[] = [
    { label: "1-year return", value: fmtPct(row.ret_1y_pct), hint: `category median ${fmtPct(cat?.med_1y)}` },
    { label: "Consistency", value: num(row.batting_months) ? `beat category ${row.months_beat} of ${row.batting_months} months` : "-" },
    {
      label: "Momentum",
      value: num(row.rank_now) ? `rank ${row.rank_now} of ${row.rank_total_now}` : "-",
      hint: num(row.places_climbed_6m) ? `${Number(row.places_climbed_6m) >= 0 ? "climbed" : "slipped"} ${Math.abs(Number(row.places_climbed_6m))} place${Math.abs(Number(row.places_climbed_6m)) === 1 ? "" : "s"} in 6 months` : undefined,
    },
    { label: "Typical recovery after falls", value: fmtMonths(row.typical_recovery_months), hint: `category ${fmtMonths(row.category_typical_recovery_months)}` },
    { label: "Fund size", value: fmtCr(row.aum_lakhs) },
    { label: "Fund age", value: fmtYears(row.fund_age_years) },
  ];
  const more: Fact[] = [
    {
      label: "Covid 2020 crash",
      value: num(row.covid_2020_fall_pct) !== null ? `fell ${Number(row.covid_2020_fall_pct).toFixed(1)}%` : "-",
      hint: num(row.covid_2020_recovery_months) !== null ? `recovered in ${fmtMonths(row.covid_2020_recovery_months)}` : undefined,
    },
    { label: "₹5,000/month SIP for 3 years", value: num(row.sip_value) ? `${fmtInr(row.sip_invested)} → ${fmtInr(row.sip_value)}` : "-" },
    { label: "3-month / 6-month return", value: `${fmtPct(row.ret_3m_pct)} / ${fmtPct(row.ret_6m_pct)}` },
    { label: "Type", value: `${String(row.active_passive ?? "-")} · ${row.n_peers} funds in category` },
    { label: "NAV", value: num(row.nav) !== null ? `₹${Number(row.nav).toFixed(2)}` : "-", hint: row.nav_date ? `as of ${row.nav_date}` : undefined },
  ];

  const strengths = strongPillars(fund, 70).map((p) => `${PILLAR_LABEL[p]}: ${pillarEvidence(p, row)}`);
  const watch = weakPillars(fund, 30).map((p) => `${PILLAR_LABEL[p]}: ${pillarEvidence(p, row)}`);
  if ((num(row.places_climbed_6m) ?? 0) <= -5) watch.push(`Momentum slipping: down ${Math.abs(Number(row.places_climbed_6m))} places in its category over 6 months`);
  if ((fund.age_years ?? 99) < 3) watch.push("Young fund: less than 3 years of history, so scores are less reliable");

  const [leader] = await query<Row>(
    `SELECT name FROM universe WHERE grp = ${q(String(row.grp))} AND scheme_code <> ${q(fund.code)} AND score_balanced IS NOT NULL ORDER BY score_balanced DESC LIMIT 1`,
  );
  const opts = [`Best ${groupName(String(row.grp))} funds`];
  if (leader) opts.push(`Compare ${fund.name} vs ${leader.name}`);
  opts.push(`Where does ${fund.name} invest?`);
  const ins = await profileInsights(row, fund);
  const blocks: Block[] = [
    ...(ins.verdict ? [ins.verdict] : []),
    { type: "fund_card", fund, facts, more, strengths: [], watch },
    ...ins.analysis,
    ...ins.peers,
    { type: "choices", text: "", options: opts },
  ];
  return { blocks, context: { ...ctx, last_intent: { intent: "fund_profile", fund: "result:1" }, last_results: [fund.code] } };
}

// ---------------- fund_metric ----------------

const standing = (p: number | null) =>
  p === null
    ? null
    : p >= 75
      ? "among the strongest in its category"
      : p >= 50
        ? "above the middle of its category"
        : p >= 25
          ? "below the middle of its category"
          : "among the weakest in its category";

const METRIC_LABEL: Record<FundMetric, string> = {
  score: "overall score",
  consistency: "consistency",
  returns: "returns",
  ret_1m: "1-month return",
  ret_3m: "3-month return",
  ret_6m: "6-month return",
  ret_1y: "1-year return",
  ret_3y: "3-year return",
  sip: "SIP returns",
  resilience: "resilience",
  momentum: "momentum",
  aum: "fund size",
  age: "fund age",
  nav: "NAV",
  allocation: "sector allocation",
};

// metric -> rank_funds sort key for the "best funds by this" suggestion
const METRIC_SORT: Partial<Record<FundMetric, RankIntent["sort_by"]>> = {
  score: "score",
  consistency: "consistency",
  returns: "returns",
  ret_1y: "ret_1y",
  ret_3m: "ret_3m",
  resilience: "resilience",
  momentum: "momentum",
  aum: "aum",
};

async function fundMetric(ref: string, metric: FundMetric, ctx: ChatContext, exec: ExecOptions): Promise<Result> {
  const r = await resolveRef(ref, ctx);
  if (!r.code) return notFound(r.candidates, ctx);
  const [row] = await fundsByCodes([r.code]);
  if (!row) return notFound([], ctx);
  const f = toFundRow(row);
  const cat = groupName(String(row.grp));
  const [m] = await query<Row>(`
    SELECT median(ret_3m_pct) AS r3, median(ret_6m_pct) AS r6, median(ret_1y_pct) AS r1, median(months_beat) AS beat,
           median(sip_3y_gain_pct) AS sip, median(typical_recovery_months) AS rec
    FROM universe WHERE grp = ${q(String(row.grp))}`);
  const name = `**${f.name}**`;
  const vs = (v: unknown, med: unknown) => `${fmtPct(v)} (${cat} median ${fmtPct(med)})`;
  let text = "";
  let facts: Fact[] = [];
  let returnBlocks: Block[] | null = null; // monthly-data returns view, when available

  switch (metric) {
    case "allocation": {
      const alloc = await query<Row>(
        `SELECT dimension, label, pct, delta_pct, period, base_period FROM alloc WHERE scheme_code = ${q(f.code)} AND pct > 0 ORDER BY pct DESC`,
      );
      if (!alloc.length) {
        text = `${name} has no portfolio disclosure in our data yet.`;
        break;
      }
      const sectors = alloc.filter((a) => a.dimension === "sector");
      const free = exec.planId === "free";
      const shown = sectors.slice(0, free ? 3 : 10);
      const period = alloc[0].base_period && alloc[0].period ? ` (${alloc[0].base_period} → ${alloc[0].period})` : "";
      const fmtA = (a: Row) =>
        `${Number(a.pct).toFixed(1)}%${Math.abs(num(a.delta_pct) ?? 0) >= 0.05 ? ` · ${Number(a.delta_pct) > 0 ? "+" : ""}${Number(a.delta_pct).toFixed(1)} pts` : ""}`;
      // Some AMCs report holdings without sector names (only stock codes), which we can't classify.
      const coverage = (dim: string) => alloc.filter((a) => a.dimension === dim).reduce((s2, a) => s2 + Number(a.pct), 0);
      if (sectors.length) {
        const top3 = sectors.slice(0, 3).reduce((s2, a) => s2 + Number(a.pct), 0);
        const up = sectors.filter((a) => (num(a.delta_pct) ?? 0) > 0).sort((a, b) => Number(b.delta_pct) - Number(a.delta_pct))[0];
        const down = sectors.filter((a) => (num(a.delta_pct) ?? 0) < 0).sort((a, b) => Number(a.delta_pct) - Number(b.delta_pct))[0];
        text = `${name} has **${top3.toFixed(0)}%** of its portfolio in its top 3 sectors: ${sectors
          .slice(0, 3)
          .map((a) => `${a.label} (${Number(a.pct).toFixed(1)}%)`)
          .join(", ")}.`;
        if (!free && up) text += ` Biggest increase${period}: ${up.label} (+${Number(up.delta_pct).toFixed(1)} pts).`;
        if (!free && down) text += ` Biggest cut: ${down.label} (${Number(down.delta_pct).toFixed(1)} pts).`;
        const cov = coverage("sector");
        if (cov < 80)
          text += ` Note: this fund's disclosure names sectors for only ${cov.toFixed(0)}% of its portfolio, so these figures understate its real sector weights.`;
        facts = shown.map((a) => ({ label: String(a.label), value: fmtA(a) }));
      }
      // asset mix and credit ratings (mainly debt and hybrid funds): paid detail
      if (!free) {
        for (const dim of ["asset_class", "rating"]) {
          const rows = alloc.filter((a) => a.dimension === dim).slice(0, 6);
          if (rows.length) facts.push(...rows.map((a) => ({ label: `${dim === "rating" ? "Rating" : "Asset"}: ${a.label}`, value: fmtA(a) })));
        }
        if (!sectors.length) {
          text = `${name}'s portfolio mix${period}:`;
          const cov = coverage("rating");
          if (cov > 0 && cov < 80) text += ` Credit ratings are disclosed for ${cov.toFixed(0)}% of the portfolio.`;
        }
      } else {
        if (!sectors.length) text = `${name}'s asset and credit-rating mix is available on Pro.`;
        facts.push({ label: "More on Pro", value: "full sector list, monthly changes, asset mix and credit ratings" });
      }
      break;
    }
    case "consistency": {
      if (!num(row.batting_months)) {
        text = `I don't have a batting average for ${name} yet.`;
        break;
      }
      const beat = Number(row.months_beat);
      const med = num(m?.beat);
      const verdict =
        med === null ? "" : beat >= med + 2 ? " That's better than most of its peers." : beat <= med - 2 ? " That's weaker than most of its peers." : " That's about average for its category.";
      text = `${name} beat its category average in **${beat} of the last ${row.batting_months} months**${med !== null ? ` (${cat} median: ${Math.round(med)} of 12)` : ""}.${verdict}`;
      facts = [
        { label: "Months beating category", value: `${beat} of ${row.batting_months}` },
        { label: `${cat} median`, value: med !== null ? `${Math.round(med)} of 12` : "-" },
        { label: "Consistency pillar", value: `${fmtScore(f.pillars.consistency)}/100`, hint: "percentile vs category" },
      ];
      break;
    }
    case "ret_1m":
    case "ret_3y":
    case "ret_3m":
    case "ret_6m":
    case "ret_1y":
    case "returns": {
      const mv = await monthlyView(f.code);
      if (mv) {
        const key = ({ ret_1m: "1m", ret_3m: "3m", ret_6m: "6m", ret_1y: "1y", ret_3y: "3y", returns: "1y" } as const)[metric];
        const p = mv.periods.find((x) => x.key === key)!;
        const vsCat = p.cat !== null ? `, against a category average of ${fmtPct(p.cat)}` : "";
        if (p.fund === null)
          text = `${name} doesn't have ${key === "3y" ? "3 years" : p.label} of monthly history yet. Here is what it has, to ${mv.latestLabel}:`;
        else if (key === "1m") text = `${name} returned **${fmtPct(p.fund)}** in ${mv.latestLabel}${vsCat}.`;
        else if (key === "3y") text = `${name} returned **${fmtPct(p.fund)} a year** over the 3 years to ${mv.latestLabel}${vsCat}.`;
        else text = `${name} returned **${fmtPct(p.fund)}** over the ${p.label} to ${mv.latestLabel}${vsCat}.`;
        if (p.fund !== null && p.cat !== null) {
          const d = p.fund - p.cat;
          text += Math.abs(d) < 0.25 ? " That's in line with its category." : d > 0 ? ` That's ${d.toFixed(1)} pts ahead of its category.` : ` That's ${Math.abs(d).toFixed(1)} pts behind its category.`;
        }
        facts = mv.periods.map((x) => ({ label: x.label, value: fmtPct(x.fund), hint: x.cat !== null ? `category ${fmtPct(x.cat)}` : undefined }));
        returnBlocks = [monthlyBars(mv)];
        if (mv.beat36 !== null && mv.comparable36)
          returnBlocks.push({ type: "note", text: `Beat its category average in ${mv.beat36} of the last ${mv.comparable36} months. Returns are month-end to month-end, to ${mv.latestLabel}.` });
        break;
      }
      // fallback when a fund has no monthly history: trailing returns from fund cards
      const col = {
        ret_1m: ["ret_3m_pct", "r3", "3 months"],
        ret_3m: ["ret_3m_pct", "r3", "3 months"],
        ret_6m: ["ret_6m_pct", "r6", "6 months"],
        ret_1y: ["ret_1y_pct", "r1", "1 year"],
        ret_3y: ["ret_1y_pct", "r1", "1 year"],
        returns: ["ret_1y_pct", "r1", "1 year"],
      }[metric];
      text = `${name} returned **${fmtPct(row[col[0]])}** over ${col[2]}, against a ${cat} median of ${fmtPct(m?.[col[1]])}.`;
      if (metric === "returns" && standing(f.pillars.returns)) text += ` On returns it is ${standing(f.pillars.returns)}.`;
      facts = [
        { label: "3 months", value: fmtPct(row.ret_3m_pct), hint: `median ${fmtPct(m?.r3)}` },
        { label: "6 months", value: fmtPct(row.ret_6m_pct), hint: `median ${fmtPct(m?.r6)}` },
        { label: "1 year", value: fmtPct(row.ret_1y_pct), hint: `median ${fmtPct(m?.r1)}` },
      ];
      if (num(row.sip_value)) facts.push({ label: "₹5,000/month SIP, 3 yrs", value: fmtInr(row.sip_value), hint: `invested ${fmtInr(row.sip_invested)}` });
      break;
    }
    case "sip":
      text = num(row.sip_value)
        ? `A ₹5,000 monthly SIP in ${name} for the last 3 years: invested **${fmtInr(row.sip_invested)}**, now worth **${fmtInr(row.sip_value)}** (${vs(row.sip_3y_gain_pct, m?.sip)}).`
        : `${name} doesn't have 3 years of SIP history yet.`;
      break;
    case "resilience":
      text = `${name} is ${standing(f.pillars.resilience) ?? "not yet rated"} on resilience${f.pillars.resilience !== null ? ` (${fmtScore(f.pillars.resilience)}/100)` : ""}.`;
      facts = [
        { label: "Typical recovery after falls", value: fmtMonths(row.typical_recovery_months), hint: `${cat} median ${fmtMonths(m?.rec)}` },
        { label: "Covid 2020 crash", value: num(row.covid_2020_fall_pct) !== null ? `fell ${Number(row.covid_2020_fall_pct).toFixed(1)}%` : "-", hint: num(row.covid_2020_recovery_months) !== null ? `recovered in ${fmtMonths(row.covid_2020_recovery_months)}` : undefined },
        { label: "Worst fall (stress tests)", value: num(row.resilience_worst_fall_pct) !== null ? `${Math.abs(Number(row.resilience_worst_fall_pct)).toFixed(1)}%` : "-" },
      ];
      break;
    case "momentum":
      text = num(row.rank_now)
        ? `${name} ranks **${row.rank_now} of ${row.rank_total_now}** in ${cat} on recent (6-month) performance${
            num(row.places_climbed_6m) ? `, ${Number(row.places_climbed_6m) >= 0 ? "up" : "down"} ${Math.abs(Number(row.places_climbed_6m))} places over 6 months` : ""
          }.`
        : `I don't have a momentum rank for ${name}.`;
      break;
    case "aum":
      text = `${name} manages **${fmtCr(row.aum_lakhs)}**.`;
      break;
    case "age":
      text = `${name} has **${fmtYears(row.fund_age_years)}** of history.`;
      break;
    case "nav":
      text = `${name}'s NAV is **₹${Number(row.nav).toFixed(2)}** (as of ${row.nav_date}).`;
      break;
    case "score": {
      const ps = PILLARS.filter((p) => f.pillars[p] !== null).sort((a, b) => (f.pillars[b] ?? 0) - (f.pillars[a] ?? 0));
      text =
        f.score === null
          ? `${name} isn't scored yet (it needs ${MIN_AGE_YEARS}+ years of history).`
          : `${name} scores **${fmtScore(f.score)}/100** against ${row.n_peers} ${cat} funds. Strongest: ${PILLAR_LABEL[ps[0]].toLowerCase()} (${fmtScore(f.pillars[ps[0]])}). Weakest: ${PILLAR_LABEL[ps[ps.length - 1]].toLowerCase()} (${fmtScore(f.pillars[ps[ps.length - 1]])}).`;
      facts = PILLARS.map((p) => ({ label: PILLAR_LABEL[p], value: fmtScore(f.pillars[p]), hint: standing(f.pillars[p]) ?? undefined }));
      break;
    }
  }

  const blocks: Block[] = [{ type: "text", text }];
  if (returnBlocks) {
    // monthly data: period returns as tiles, then the 12-month chart
    if (facts.length) blocks.push({ type: "facts", facts });
    blocks.push(...returnBlocks);
    facts = [];
  } else if (metric === "returns" || metric.startsWith("ret_")) {
    // no monthly history: a small chart vs the category median, then the SIP line
    const bars = returnBars(row, await catStats([String(row.grp)]));
    if (bars) blocks.push(bars);
    facts = facts.filter((x) => x.label.includes("SIP"));
  }
  if (facts.length) blocks.push({ type: "facts", facts });
  const opts = [`Full profile of ${f.name}`];
  const sort = METRIC_SORT[metric];
  if (sort) opts.push(`Best ${cat} funds by ${METRIC_LABEL[metric]}`);
  else opts.push(`Best ${cat} funds`);
  if (metric !== "returns") opts.push("What are its returns?");
  blocks.push({ type: "choices", text: "", options: opts });
  return { blocks, context: { ...ctx, last_intent: { intent: "fund_metric", fund: "result:1", metric }, last_results: [f.code] } };
}

// ---------------- sector_exposure ----------------

async function sectorExposure(theme: string, limit: number, ctx: ChatContext, exec: ExecOptions): Promise<Result> {
  const pattern = THEME_SECTOR_PATTERNS[theme];
  if (!pattern)
    return { blocks: [{ type: "text", text: "I can show sector exposure for technology, banking, pharma, consumption, infrastructure, energy, auto and defence." }], context: ctx };
  const n = Math.min(limit, MAX_ROWS, exec.maxRankRows);
  // diversified active equity funds only: sector funds would trivially top the list
  const re = pattern.source.replace(/'/g, "''");
  const where = `u.active_passive = 'Active' AND u.grp IN (${inList(DEFAULT_EQUITY_GROUPS)})`;
  const exposureSql = `SELECT scheme_code, sum(pct) AS exposure FROM alloc WHERE dimension = 'sector' AND regexp_matches(lower(label), '${re}') GROUP BY scheme_code`;
  const rows = await query<Row>(`SELECT u.*, e.exposure FROM (${exposureSql}) e JOIN universe u USING (scheme_code) WHERE ${where} ORDER BY e.exposure DESC LIMIT ${n}`);
  if (!rows.length) return { blocks: [{ type: "text", text: `No diversified funds hold ${groupName(theme)} sectors right now.` }], context: ctx };
  const funds = rows.map((r) => toFundRow(r));
  const [{ med }] = await query<{ med: number }>(`SELECT median(e.exposure) AS med FROM (${exposureSql}) e JOIN universe u USING (scheme_code) WHERE ${where}`);
  const blocks: Block[] = [
    {
      type: "text",
      text: `Diversified equity funds with the most **${groupName(theme)}** exposure (share of portfolio in those sectors; the typical fund holds ${Number(med).toFixed(1)}%):`,
    },
    { type: "bullets", items: rows.map((r, i) => `**${i + 1}. ${r.name}**: ${Number(r.exposure).toFixed(1)}% · ${groupName(String(r.grp))} · score ${fmtScore(r.score_balanced)}`) },
    { type: "fund_table", title: `${groupName(theme)} exposure`, rows: funds },
    {
      type: "note",
      text: `Dedicated ${groupName(theme)} sector funds are left out; ask "best ${groupName(theme).toLowerCase()} funds" for those. Based on holdings disclosed with sector names; a few AMCs report some holdings without them.`,
    },
  ];
  if (exec.planId === "free" && limit > rows.length) blocks.push({ type: "note", text: `Free plan shows the top ${rows.length}. Upgrade to see up to ${MAX_ROWS}.` });
  blocks.push({ type: "choices", text: "", options: ["Compare the top 2", "Tell me more about the first one", `Best ${groupName(theme)} funds`] });
  return { blocks, context: { ...ctx, last_intent: { intent: "sector_exposure", theme, limit }, last_results: funds.map((f) => f.code) } };
}

// ---------------- similar_funds ----------------

async function similarFunds(ref: string, ctx: ChatContext, exec: ExecOptions): Promise<Result> {
  const r = await resolveRef(ref, ctx);
  if (!r.code) return notFound(r.candidates, ctx);
  const [row] = await fundsByCodes([r.code]);
  if (!row) return notFound([], ctx);
  const base = toFundRow(row);
  const n = Math.min(5, exec.maxRankRows);
  const better = await query<Row>(
    `SELECT * FROM universe WHERE grp = ${q(String(row.grp))} AND scheme_code <> ${q(base.code)} AND eligible AND score_balanced IS NOT NULL
     ${base.score !== null ? `AND score_balanced > ${Number(base.score)}` : ""}
     ORDER BY score_balanced DESC LIMIT ${n}`,
  );
  const cat = groupName(String(row.grp));
  if (!better.length)
    return {
      blocks: [{ type: "text", text: `**${base.name}** is already the top-scored ${cat} fund (score ${fmtScore(base.score)}), so no fund in the category scores higher.` }],
      context: { ...ctx, last_intent: { intent: "fund_profile", fund: "result:1" }, last_results: [base.code] },
    };
  const funds = better.map((x) => toFundRow(x));
  const blocks: Block[] = [
    { type: "text", text: `${cat} funds scoring higher than **${base.name}** (score ${fmtScore(base.score)}):` },
    { type: "fund_table", title: `Alternatives in ${cat}`, rows: funds },
    ...(await rankInsights(better, funds, [String(row.grp)])),
    { type: "note", text: "Switching funds can trigger exit loads and capital-gains tax. Check both before moving money." },
    { type: "choices", text: "", options: [`Compare ${base.name} vs ${funds[0].name}`, "Tell me more about the first one"] },
  ];
  return { blocks, context: { ...ctx, last_intent: { intent: "similar_funds", fund: ref }, last_results: funds.map((f) => f.code) } };
}

function notFound(candidates: string[] | undefined, ctx: ChatContext): Result {
  if (candidates?.length) return { blocks: [{ type: "choices", text: "Which fund do you mean?", options: candidates.slice(0, 4) }], context: ctx };
  return { blocks: [{ type: "text", text: "I couldn't find that fund. Try its full name, for example \"Parag Parikh Flexi Cap\"." }], context: ctx };
}

// ---------------- compare ----------------

async function compare(refs: string[], ctx: ChatContext): Promise<Result> {
  // "compare it with the category leader"
  const codes: string[] = [];
  for (const ref of refs) {
    const r = await resolveRef(ref, ctx);
    if (!r.code) return notFound(r.candidates, ctx);
    if (!codes.includes(r.code)) codes.push(r.code);
  }
  if (codes.length < 2) return { blocks: [{ type: "text", text: "Tell me at least two different funds to compare." }], context: ctx };
  const rows = await fundsByCodes(codes);
  const funds = rows.map((r) => toFundRow(r));

  type Spec = { label: string; get: (r: Row, f: FundRow) => number | null; fmt: (v: number | null) => string; better: "high" | "low" | null };
  const specs: Spec[] = [
    { label: "Overall score", get: (_, f) => f.score, fmt: fmtScore, better: "high" },
    ...PILLARS.map((p): Spec => ({ label: PILLAR_LABEL[p], get: (_, f) => f.pillars[p], fmt: fmtScore, better: "high" })),
    { label: "1-year return", get: (r) => num(r.ret_1y_pct), fmt: (v) => fmtPct(v), better: "high" },
    { label: "Months beating category", get: (r) => (num(r.batting_months) ? Number(r.months_beat) : null), fmt: (v) => (v === null ? "-" : `${v} of 12`), better: "high" },
    { label: "Typical recovery", get: (r) => num(r.typical_recovery_months), fmt: fmtMonths, better: "low" },
    { label: "Covid 2020 fall", get: (r) => num(r.covid_2020_fall_pct), fmt: (v) => (v === null ? "-" : `${v.toFixed(1)}%`), better: "low" },
    { label: "Fund size", get: (r) => num(r.aum_lakhs), fmt: fmtCr, better: null },
    { label: "Fund age", get: (r) => num(r.fund_age_years), fmt: fmtYears, better: null },
  ];
  const table = specs.map((s) => {
    const vals = rows.map((r, i) => s.get(r, funds[i]));
    let best: number | undefined;
    if (s.better && vals.filter((v) => v !== null).length >= 2) {
      const pick = s.better === "high" ? Math.max(...(vals.filter((v) => v !== null) as number[])) : Math.min(...(vals.filter((v) => v !== null) as number[]));
      best = vals.filter((v) => v === pick).length === 1 ? vals.indexOf(pick) : undefined; // no highlight on ties
    }
    return { label: s.label, values: vals.map(s.fmt), best };
  });

  const blocks: Block[] = [
    { type: "compare", funds, rows: table },
    ...(await compareInsights(rows, funds)),
    { type: "heading", text: "Sector overlap" },
    ...(await sectorOverlapBlocks(codes, funds.map((f) => f.name))),
  ];
  if (new Set(rows.map((r) => r.grp)).size > 1)
    blocks.push({ type: "note", text: "These funds are in different categories. Pillar scores compare each fund with its own category, so compare them with care." });
  return {
    blocks,
    context: { ...ctx, last_intent: { intent: "compare", funds: codes.map((_, i) => `result:${i + 1}`) }, last_results: codes },
  };
}

// ---------------- explain_metric ----------------

function explain(key: string, ctx: ChatContext): Result {
  const m = METRICS.find((x) => x.key === key) ?? METRICS.find((x) => x.syn.some((s) => key.toLowerCase().includes(s)));
  if (!m) return { blocks: [{ type: "text", text: "I can explain: " + METRICS.map((x) => x.name).join(", ") + "." }], context: ctx };
  const blocks: Block[] = [
    { type: "text", text: `**${m.name}.** ${m.what}` },
    { type: "text", text: `**Why it matters:** ${m.why}` },
    { type: "note", text: `Limits: ${m.limits}` },
  ];
  if (m.key === "score") {
    const w = LENS_WEIGHTS.balanced;
    blocks.splice(1, 0, { type: "text", text: PILLARS.map((p) => `• **${PILLAR_LABEL[p]}** (${w[p]}%): ${PILLAR_SOURCE[p]}`).join("\n") });
  }
  blocks.push({ type: "choices", text: "", options: ["Best flexi cap funds", "Most resilient small cap funds", "What is consistency?"] });
  return { blocks, context: { ...ctx, last_intent: { intent: "explain_metric", metric: m.key } } };
}

// ---------------- sector_shifts ----------------

async function sectorShifts(theme: string | undefined, ctx: ChatContext): Promise<Result> {
  const store = await getStore();
  const rows = await query<Row>(`
    WITH s AS (
      SELECT skey, sum(mv) AS mv, sum(prev_mv) AS pmv,
        count(*) FILTER (WHERE action IN ('increased', 'new'))::INT AS add_n,
        count(*) FILTER (WHERE action IN ('decreased', 'exited'))::INT AS cut_n
      FROM sector_clean WHERE active_passive = 'Active' AND grp LIKE 'EQS%' GROUP BY skey),
    t AS (SELECT sum(mv) AS tm, sum(pmv) AS tp FROM s)
    SELECT n.label AS sector, 100 * s.mv / t.tm AS share_now, 100 * (s.mv / t.tm - s.pmv / t.tp) AS change_pp, add_n, cut_n
    FROM s CROSS JOIN t JOIN sector_names n USING (skey)
    WHERE s.mv / t.tm > 0.003 OR s.pmv / t.tp > 0.003
    ORDER BY change_pp DESC`);
  let all: ShiftRow[] = rows.map((r) => ({
    sector: String(r.sector),
    share_now: Number(Number(r.share_now).toFixed(2)),
    change_pp: Number(Number(r.change_pp).toFixed(2)),
    funds_adding: Number(r.add_n),
    funds_cutting: Number(r.cut_n),
  }));
  const pattern = theme ? THEME_SECTOR_PATTERNS[theme] : undefined;
  if (pattern) all = all.filter((r) => pattern.test(r.sector));
  const up = all.filter((r) => r.change_pp > 0).slice(0, pattern ? 8 : 6);
  const down = all.filter((r) => r.change_pp < 0).reverse().slice(0, pattern ? 8 : 6);
  const period = `${store.asOf.sectorBase ?? "previous"} → ${store.asOf.sectorPeriod ?? "latest"}`;
  const title = pattern ? `Where active equity funds moved money in ${groupName(theme!)}` : "Where active equity funds moved money";

  const blocks: Block[] = [
    { type: "text", text: `${title} (${period}), as a share of all active equity fund holdings.` },
    { type: "sector_shifts", title, period, up, down },
  ];
  if (up[0]) blocks.push({ type: "text", text: `Biggest increase: ${up[0].sector} (${fmtPct(up[0].change_pp, 2).replace("%", " pts")}). Biggest cut: ${down[0]?.sector ?? "-"}.` });
  blocks.push({ type: "note", text: "Weight changes include price moves as well as buying and selling. Portfolio disclosures lag the market." });
  blocks.push({ type: "choices", text: "", options: theme ? [`Best ${groupName(theme)} funds`] : ["Best technology funds", "Best banking funds", "Best infrastructure funds"] });
  return { blocks, context: { ...ctx, last_intent: { intent: "sector_shifts", ...(theme ? { theme } : {}) } } };
}

// ---------------- simple intents ----------------

const OOS: Record<string, string> = {
  advice: "I can't tell you to buy or sell a specific fund, because that would be personal investment advice. I can show you how funds score on our data, compare them, and explain what each number means.",
  prediction: "I don't predict markets or future returns. I can show how funds have behaved in past falls and recoveries, which says a lot about the ride to expect.",
  news: "I don't cover market news yet. I can show how a category has performed and where fund managers have been moving money.",
  non_mf: "I only cover Indian mutual funds.",
  no_data:
    "isn't in our data yet. For any fund I can show returns (3 months, 6 months, 1 year), the 3-year SIP result, batting average, momentum, resilience in crashes, fund size, age and sector allocation.",
};

const HELP_OPTIONS = [
  "Best small cap funds",
  "Compare Parag Parikh Flexi Cap and HDFC Flexi Cap",
  "Where does HDFC Flexi Cap invest?",
  "Funds with most IT exposure",
  "Last month return of Parag Parikh Flexi Cap",
  "What is your 5-pillar score?",
];

export type ExecOptions = { maxRankRows: number; planId: "free" | "pro" };

export async function execute(intent: Intent, ctx: ChatContext, opts: ExecOptions = { maxRankRows: MAX_ROWS, planId: "pro" }): Promise<Result> {
  switch (intent.intent) {
    case "rank_funds":
      return rankFunds(intent, ctx, opts);
    case "fund_profile":
      return fundProfile(intent.fund, ctx);
    case "fund_metric":
      return fundMetric(intent.fund, intent.metric, ctx, opts);
    case "sector_exposure":
      return sectorExposure(intent.theme, intent.limit, ctx, opts);
    case "similar_funds":
      return similarFunds(intent.fund, ctx, opts);
    case "compare":
      return compare(intent.funds, ctx);
    case "explain_metric":
      return explain(intent.metric, ctx);
    case "sector_shifts":
      return sectorShifts(intent.theme, ctx);
    case "clarify":
      return { blocks: [{ type: "choices", text: intent.question, options: intent.options }], context: ctx };
    case "out_of_scope":
      return {
        blocks: [
          {
            type: "text",
            text: intent.reason === "no_data" ? `${intent.topic ? `**${intent.topic[0].toUpperCase()}${intent.topic.slice(1)}**` : "That"} ${OOS.no_data}` : OOS[intent.reason],
          },
          { type: "choices", text: "", options: HELP_OPTIONS.slice(0, 3) },
        ],
        context: ctx,
      };
    case "help":
      return {
        blocks: [{ type: "choices", text: "I can rank funds by our 5-pillar score, show any fund's details, compare funds, explain our metrics and show sector shifts. Try:", options: HELP_OPTIONS }],
        context: ctx,
      };
  }
}
