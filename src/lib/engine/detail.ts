import "server-only";
import { PILLARS, PILLAR_LABEL } from "@/lib/config/score";
import { query } from "@/lib/data/store";
import type { CrashRow, FundDetailView, FundRow } from "@/lib/types";
import { catStats } from "./insights";
import { num } from "./format";

// The rich fund view (chat profile + screener analysis tab). Plain-English sections, each backed by a real number
// compared with similar funds (same category). Nothing here comes from the LLM.

type Row = Record<string, unknown>;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string, withYear = true) => {
  const [y, m] = ym.split("-").map(Number);
  return withYear ? `${MONTHS[m - 1]} '${String(y).slice(2)}` : MONTHS[m - 1];
};
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

// Market falls tracked in our data (same windows as the GoChanakya app).
const CRASHES = [
  { key: "iran_2026", name: "US and Israel attack on Iran", start: "2026-02-25", dates: "25 Feb 2026 – 18 Jul 2026" },
  { key: "fii_2021", name: "Massive FII selloff", start: "2021-10-20", dates: "20 Oct 2021 – 31 Dec 2021" },
  { key: "covid_2020", name: "Covid-19 crisis & lockdown", start: "2020-02-15", dates: "15 Feb 2020 – 10 Apr 2020" },
  { key: "ilfs_2018", name: "IL&FS liquidity crisis", start: "2018-08-15", dates: "15 Aug 2018 – 15 Oct 2018" },
] as const;

export async function fundDetailView(row: Row, fund: FundRow): Promise<FundDetailView> {
  const code = String(row.scheme_code);
  const grp = String(row.grp);
  const s = await catStats([grp]);

  // category context: overall-score rank, larger/older funds, higher-scoring peers
  const [ctx] = await query<Row>(`
    SELECT count(*)::INT AS n,
      quantile_cont(fund_age_years, 0.75) AS age75, quantile_cont(aum_lakhs, 0.75) AS aum75,
      count(*) FILTER (WHERE eligible AND score_balanced IS NOT NULL)::INT AS scored,
      count(*) FILTER (WHERE eligible AND score_balanced > ${fund.score ?? 1e9})::INT + 1 AS score_rank
    FROM universe WHERE grp = ${q(grp)}`);
  const better =
    fund.score === null
      ? []
      : await query<Row>(`SELECT name, score_balanced FROM universe WHERE grp = ${q(grp)} AND eligible AND score_balanced > ${Number(fund.score)} ORDER BY score_balanced DESC LIMIT 3`);

  // last 12 months vs the category average, and the latest month's return
  const months = (
    await query<Row>(`SELECT month, ret_pct, cat_pct, beat FROM monthly WHERE scheme_code = ${q(code)} AND beat IS NOT NULL ORDER BY month DESC LIMIT 12`)
  ).reverse();
  const last = months[months.length - 1];

  // rank among similar funds on 6-month returns, at each of the last 6 month-ends
  const hist = await query<Row>(`
    WITH m AS (SELECT m.scheme_code, m.month, m.ret_pct FROM monthly m JOIN universe u USING (scheme_code) WHERE u.grp = ${q(grp)} AND m.ret_pct IS NOT NULL),
      w AS (SELECT scheme_code, month,
              exp(sum(ln(1 + ret_pct / 100)) OVER (PARTITION BY scheme_code ORDER BY month ROWS 5 PRECEDING)) AS r6,
              count(*) OVER (PARTITION BY scheme_code ORDER BY month ROWS 5 PRECEDING) AS k
            FROM m),
      r AS (SELECT scheme_code, month, rank() OVER (PARTITION BY month ORDER BY r6 DESC)::INT AS rk, count(*) OVER (PARTITION BY month)::INT AS n FROM w WHERE k = 6)
    SELECT month, rk, n FROM r WHERE scheme_code = ${q(code)} ORDER BY month DESC LIMIT 6`);

  // ---- verdict ----
  let verdict: FundDetailView["verdict"];
  if (fund.score !== null) {
    const tone = fund.score >= 65 ? "good" : fund.score >= 45 ? "neutral" : "weak";
    const ps = PILLARS.filter((p) => fund.pillars[p] !== null).sort((a, b) => (fund.pillars[b] ?? 0) - (fund.pillars[a] ?? 0));
    verdict = {
      tone,
      label: tone === "good" ? "Strong in its category" : tone === "neutral" ? "Middle of the pack" : "Below most similar funds",
      text: `Ranks **${ctx.score_rank} of ${ctx.scored}** scored ${fund.group} funds, with an overall score of **${Math.round(fund.score)}/100**. Strongest on ${PILLAR_LABEL[ps[0]].toLowerCase()}, weakest on ${PILLAR_LABEL[ps[ps.length - 1]].toLowerCase()}.`,
    };
  } else {
    verdict = { tone: "neutral", label: "Not scored yet", text: "This fund doesn't have enough history for an overall score yet. The sections below still compare it with similar funds." };
  }

  // ---- consistency ----
  const beat = months.filter((m) => Number(m.beat) === 1).length;
  const consistency: FundDetailView["consistency"] =
    months.length >= 6
      ? {
          beat,
          of: months.length,
          months: months.map((m) => ({ label: monthLabel(String(m.month)), beat: Number(m.beat) === 1 })),
          badge: beat / months.length >= 0.75 ? "Very consistent" : beat / months.length >= 0.55 ? "Fairly consistent" : beat / months.length >= 0.4 ? "Mixed" : "Often behind",
          cat_median: s.beat,
        }
      : null;

  // ---- SIP ----
  const invested = num(row.sip_invested);
  const value = num(row.sip_value);
  const instalments = invested ? Math.round(invested / 5000) : 0;
  const sip: FundDetailView["sip"] =
    invested && value && last
      ? {
          monthly: 5000,
          invested,
          value,
          gain: value - invested,
          gain_pct: ((value - invested) / invested) * 100,
          started: (() => {
            const ym = addMonths(String(last.month), -(instalments - 1));
            return `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
          })(),
          instalments,
          cat_gain_pct: s.sip,
        }
      : null;

  // ---- rank ----
  const now = num(row.rank_now);
  const of = num(row.rank_total_now);
  const climbed = num(row.places_climbed_6m) ?? 0;
  const history = hist
    .slice()
    .reverse()
    .map((h) => ({ label: monthLabel(String(h.month), false), rank: Number(h.rk), of: Number(h.n) }));
  const threeBack = history.length >= 3 ? history[history.length - 3] : null;
  const rank: FundDetailView["rank"] =
    now && of
      ? {
          now,
          of,
          history,
          change_3m: threeBack ? threeBack.rank - now : null,
          badge: climbed >= 3 ? "Moving up" : climbed <= -3 ? "Slipping" : "Steady",
        }
      : null;

  // ---- recovery after market falls ----
  const rec = num(row.typical_recovery_months);
  const catRec = num(row.category_typical_recovery_months) ?? s.rec;
  const navDate = String(row.nav_date ?? "");
  const age = num(row.fund_age_years);
  const launched = age !== null && navDate ? new Date(Date.parse(navDate) - age * 365.25 * 86_400_000) : null;
  const crashes: CrashRow[] = CRASHES.map((c, i) => {
    const fall = num(row[`${c.key}_fall_pct`]);
    const r = num(row[`${c.key}_recovery_months`]);
    let status: CrashRow["status"] = "ok";
    if (fall === null) status = launched && launched > new Date(c.start) ? "launched_after" : "no_data";
    else if (r === null) status = i === 0 ? "not_recovered" : "no_data";
    return { name: c.name, dates: c.dates, fall: fall === null ? null : Math.abs(fall), recovered_months: r, status };
  });
  let summary = "";
  if (rec !== null) {
    const vs = catRec === null ? "" : rec <= catRec * 0.8 ? ", faster than most similar funds" : rec >= catRec * 1.25 ? ", a little slower than most similar funds" : ", about the same as similar funds";
    summary = `After past market falls, it usually recovered within about ${Math.max(1, Math.round(rec))} month${Math.round(rec) === 1 ? "" : "s"}${vs}.`;
  } else if (crashes.some((c) => c.fall !== null)) summary = "How it held up in past market falls:";
  const recovery: FundDetailView["recovery"] = summary ? { months: rec, cat_months: catRec, summary, crashes } : null;

  // ---- returns vs similar funds ----
  const returns = [
    { label: "1 month", fund: last ? num(last.ret_pct) : null, cat: last ? num(last.cat_pct) : null },
    { label: "3 months", fund: num(row.ret_3m_pct), cat: s.r3 },
    { label: "6 months", fund: num(row.ret_6m_pct), cat: s.r6 },
    { label: "1 year", fund: num(row.ret_1y_pct), cat: s.r1 },
  ].filter((r) => r.fund !== null);

  // ---- why it stands out / what to watch ----
  const good: string[] = [];
  const watch: string[] = [];
  if (consistency && s.beat !== null) {
    const exp = (s.beat / 12) * consistency.of; // category median, scaled to the months shown
    if (consistency.beat >= exp + 2) good.push(`Beat similar funds in ${consistency.beat} of the last ${consistency.of} months, more often than most`);
    else if (consistency.beat <= exp - 2) watch.push(`Fell behind similar funds in ${consistency.of - consistency.beat} of the last ${consistency.of} months`);
  }
  const r1 = num(row.ret_1y_pct);
  if (r1 !== null && s.r1 !== null) {
    if (r1 - s.r1 >= 1) good.push(`1-year return of ${pct(r1)}, ahead of similar funds (median ${pct(s.r1)})`);
    else if (r1 - s.r1 <= -1) watch.push(`1-year return of ${pct(r1)} trails similar funds (median ${pct(s.r1)})`);
  }
  if (rec !== null && catRec !== null) {
    if (rec <= catRec * 0.8) good.push("Bounces back from market falls faster than most similar funds");
    else if (rec >= catRec * 1.25) watch.push("Takes longer than most similar funds to recover from market falls");
  }
  if (now && of && now <= Math.ceil(of / 4)) good.push(`In the top quarter of similar funds on recent 6-month returns (#${now} of ${of})`);
  if (climbed <= -5) watch.push(`Slipped ${Math.abs(climbed)} places among similar funds in the last 6 months`);
  if (age !== null && num(ctx.age75) !== null && age >= Number(ctx.age75)) good.push("Longer track record than most of its category");
  if (age !== null && age < 3) watch.push("Young fund: under 3 years of history, so its numbers are less proven");
  const aum = num(row.aum_lakhs);
  if (aum !== null && num(ctx.aum75) !== null && aum >= Number(ctx.aum75)) good.push("One of the larger funds in its category");
  if (aum !== null && aum < 100_000) watch.push("Small fund (under ₹1,000 Cr), so its returns can swing more");

  return {
    fund,
    kind: String(row.active_passive ?? ""),
    peers_n: Number(ctx.n),
    verdict,
    standout: { good: good.slice(0, 4), watch: watch.slice(0, 3) },
    returns,
    consistency,
    sip,
    rank,
    recovery,
    better_peers: better.map((b) => ({ name: String(b.name), score: Math.round(Number(b.score_balanced)) })),
  };
}
