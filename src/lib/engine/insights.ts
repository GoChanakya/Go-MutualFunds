import "server-only";
import { groupName } from "@/lib/config/groups";
import { PILLARS, PILLAR_LABEL, type Pillar } from "@/lib/config/score";
import { query } from "@/lib/data/store";
import type { Block, FundRow } from "@/lib/types";
import { fmtCr, fmtMonths, fmtPct, fmtScore, fmtYears, num } from "./format";

// Analysis written by OUR code from OUR data. Every sentence compares a real number with a real benchmark
// (category median, peer rank). Nothing here comes from the LLM.

type Row = Record<string, unknown>;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const CODE_RE = /^[0-9A-Za-z_-]{1,20}$/;
const inList = (codes: string[]) => codes.filter((c) => CODE_RE.test(c)).map(q).join(", ") || "''";
const b = (s: string) => `**${s}**`;
const pts = (d: number) => `${d > 0 ? "+" : ""}${d.toFixed(1)} pts`;
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const SMALL_FUND_LAKHS = 100_000; // ₹1,000 Cr

export type CatStats = {
  n: number;
  r3: number | null;
  r6: number | null;
  r1: number | null;
  beat: number | null;
  rec: number | null;
  covid: number | null;
  sip: number | null;
};

export async function catStats(groups: string[]): Promise<CatStats> {
  const [s] = await query<Row>(`
    SELECT count(*)::INT AS n, median(ret_3m_pct) AS r3, median(ret_6m_pct) AS r6, median(ret_1y_pct) AS r1,
           median(months_beat) AS beat, median(typical_recovery_months) AS rec,
           median(covid_2020_fall_pct) AS covid, median(sip_3y_gain_pct) AS sip
    FROM universe WHERE grp IN (${inList(groups)})`);
  return { n: Number(s.n), r3: num(s.r3), r6: num(s.r6), r1: num(s.r1), beat: num(s.beat), rec: num(s.rec), covid: num(s.covid), sip: num(s.sip) };
}

// Where a fund ranks by overall score among scored funds of its category.
async function scoreRank(grp: string, score: number | null): Promise<{ rank: number; n: number } | null> {
  if (score === null) return null;
  const [r] = await query<Row>(`
    SELECT count(*) FILTER (WHERE score_balanced > ${Number(score)})::INT + 1 AS rank, count(*)::INT AS n
    FROM universe WHERE grp = ${q(grp)} AND eligible AND score_balanced IS NOT NULL`);
  return { rank: Number(r.rank), n: Number(r.n) };
}

// ---- small sentence builders ----

function returnsTrend(row: Row, s: CatStats): string | null {
  const d = (v: unknown, m: number | null) => (num(v) === null || m === null ? null : Number(v) - m);
  const d3 = d(row.ret_3m_pct, s.r3);
  const d6 = d(row.ret_6m_pct, s.r6);
  const d1 = d(row.ret_1y_pct, s.r1);
  if (d1 === null || d3 === null) return null;
  const parts = `(1 year ${pts(d1)}, 6 months ${d6 === null ? "-" : pts(d6)}, 3 months ${pts(d3)} vs category median)`;
  if (d1 > 0.5 && d3 > 0.5 && (d6 ?? 1) > 0) return `${b("Returns:")} ahead of the category median over every period ${parts}, a steady edge rather than one good spell.`;
  if (d1 < -0.5 && d3 < -0.5 && (d6 ?? -1) < 0) return `${b("Returns:")} behind the category median over every period ${parts}.`;
  if (d1 < 0 && d3 > 0) return `${b("Returns:")} behind over 1 year but ahead over the last 3 months ${parts}. Recent performance has improved.`;
  if (d1 > 0 && d3 < 0) return `${b("Returns:")} ahead over 1 year but behind over the last 3 months ${parts}. Recent performance has cooled.`;
  return `${b("Returns:")} broadly in line with the category ${parts}.`;
}

function consistencyLine(row: Row, s: CatStats): string | null {
  if (!num(row.batting_months)) return null;
  const beat = Number(row.months_beat);
  const med = s.beat;
  const vs = med === null ? "" : beat >= med + 2 ? ", better than most peers" : beat <= med - 2 ? ", weaker than most peers" : ", about average for the category";
  return `${b("Consistency:")} beat the category average in ${beat} of the last ${row.batting_months} months${med !== null ? ` (median ${Math.round(med)})` : ""}${vs}.`;
}

function momentumLine(row: Row): string | null {
  if (!num(row.rank_now)) return null;
  const c = num(row.places_climbed_6m) ?? 0;
  const trend = c >= 5 ? `, climbing ${c} places in 6 months` : c <= -5 ? `, slipping ${Math.abs(c)} places in 6 months` : ", broadly steady over 6 months";
  return `${b("Momentum:")} ranks ${row.rank_now} of ${row.rank_total_now} on recent performance${trend}.`;
}

function downsideLine(row: Row, s: CatStats): string | null {
  const fall = num(row.covid_2020_fall_pct);
  const rec = num(row.typical_recovery_months);
  const bits: string[] = [];
  if (fall !== null && s.covid !== null) {
    const v = fall <= s.covid - 2 ? "held up better than most peers" : fall >= s.covid + 2 ? "fell harder than most peers" : "fell about as much as peers";
    bits.push(`fell ${fall.toFixed(1)}% in the Covid 2020 crash vs a category median of ${s.covid.toFixed(1)}% (${v})`);
  }
  const catRec = num(row.category_typical_recovery_months) ?? s.rec;
  if (rec !== null && catRec !== null) {
    const v = rec <= catRec * 0.8 ? "faster than most peers" : rec >= catRec * 1.25 ? "slower than most peers" : "in line with peers";
    bits.push(`typically recovers from falls in ${fmtMonths(rec)} vs ${fmtMonths(catRec)} for the category (${v})`);
  }
  return bits.length ? `${b("Downside:")} ${bits.join("; ")}.` : null;
}

function sipLine(row: Row, s: CatStats): string | null {
  const g = num(row.sip_3y_gain_pct);
  if (g === null || !num(row.sip_value)) return null;
  const vs = s.sip === null ? "" : ` (category median ${fmtPct(s.sip)})`;
  return `${b("SIP experience:")} ₹5,000 a month for 3 years grew to ₹${Math.round(Number(row.sip_value)).toLocaleString("en-IN")} on ₹${Math.round(Number(row.sip_invested)).toLocaleString("en-IN")} invested, ${fmtPct(g)}${vs}.`;
}

function sizeLine(row: Row): string | null {
  const aum = num(row.aum_lakhs);
  const age = num(row.fund_age_years);
  if (aum === null && age === null) return null;
  let note = "";
  if (aum !== null && aum < SMALL_FUND_LAKHS) note = " It is a small fund, so its numbers can move more from month to month.";
  if (aum !== null && aum > 5_000_000) note = " It is one of the largest funds in the market.";
  return `${b("Size and history:")} ${fmtCr(aum)} in assets, ${fmtYears(age)} old.${note}`;
}

// ---- fund profile ----

export async function profileInsights(row: Row, fund: FundRow): Promise<{ verdict: Block | null; analysis: Block[]; peers: Block[] }> {
  const grp = String(row.grp);
  const cat = groupName(grp);
  const s = await catStats([grp]);
  const rk = await scoreRank(grp, fund.score);

  let verdict: Block | null = null;
  if (fund.score !== null && rk) {
    const tone = fund.score >= 65 ? "good" : fund.score >= 45 ? "neutral" : "weak";
    const label = tone === "good" ? "Strong in its category" : tone === "neutral" ? "Middle of the pack" : "Below most peers";
    const ps = PILLARS.filter((p) => fund.pillars[p] !== null).sort((a, c) => (fund.pillars[c] ?? 0) - (fund.pillars[a] ?? 0));
    verdict = {
      type: "verdict",
      tone,
      label,
      text: `Ranks ${b(`${rk.rank} of ${rk.n}`)} scored ${cat} funds with a score of ${fmtScore(fund.score)}/100. Best on ${PILLAR_LABEL[ps[0]].toLowerCase()} (${fmtScore(fund.pillars[ps[0]])}), weakest on ${PILLAR_LABEL[ps[ps.length - 1]].toLowerCase()} (${fmtScore(fund.pillars[ps[ps.length - 1]])}).`,
    };
  } else {
    verdict = { type: "verdict", tone: "neutral", label: "Not scored yet", text: "This fund doesn't have enough history for a full score. The numbers below still compare it with its category." };
  }

  const analysis: Block[] = [];
  const bars = returnBars(row, s);
  if (bars) analysis.push(bars);
  const lines = [returnsTrend(row, s), consistencyLine(row, s), momentumLine(row), downsideLine(row, s), sipLine(row, s), sizeLine(row)].filter(Boolean) as string[];
  if (lines.length) analysis.push({ type: "heading", text: "What the numbers say" }, { type: "bullets", items: lines });

  const peers: Block[] = [];
  if (fund.score !== null) {
    const better = await query<Row>(`
      SELECT name, score_balanced FROM universe
      WHERE grp = ${q(grp)} AND eligible AND score_balanced > ${Number(fund.score)}
      ORDER BY score_balanced DESC LIMIT 3`);
    if (better.length)
      peers.push({
        type: "text",
        text: `${b(`Higher-scoring ${cat} funds:`)} ${better.map((r) => `${r.name} (${fmtScore(r.score_balanced)})`).join(", ")}.`,
      });
    else peers.push({ type: "text", text: `${b("It is the top-scored")} ${cat} fund right now.` });
  }
  return { verdict, analysis, peers };
}

export function returnBars(row: Row, s: CatStats): Block | null {
  const rows = [
    { label: "3 months", value: num(row.ret_3m_pct), ref: s.r3 },
    { label: "6 months", value: num(row.ret_6m_pct), ref: s.r6 },
    { label: "1 year", value: num(row.ret_1y_pct), ref: s.r1 },
  ];
  if (rows.every((r) => r.value === null)) return null;
  return { type: "bars", title: "Returns vs category median", unit: "%", series: ["This fund", "Category median"], rows };
}

// ---- rankings ----

export async function rankInsights(rows: Row[], funds: FundRow[], groups: string[]): Promise<Block[]> {
  if (!funds.length) return [];
  const s = await catStats(groups);
  const items: string[] = [];
  const top = funds[0];

  // Why #1 leads
  const strong = PILLARS.filter((p) => (top.pillars[p] ?? 0) >= 75);
  if (strong.length) items.push(`${b(top.name)} leads with a score of ${fmtScore(top.score)}, strongest on ${listJoin(strong.map((p) => PILLAR_LABEL[p].toLowerCase()))}.`);

  // Standouts within the shown list (only if it's not the leader)
  const best = (p: Pillar) => funds.reduce((a, f) => ((f.pillars[p] ?? -1) > (a.pillars[p] ?? -1) ? f : a), funds[0]);
  const rowOf = (f: FundRow) => rows[funds.indexOf(f)];
  const res = best("resilience");
  if (res !== top && (res.pillars.resilience ?? 0) >= 60) {
    const fall = num(rowOf(res).covid_2020_fall_pct);
    items.push(
      `${b("Most resilient here:")} ${res.name} (resilience ${fmtScore(res.pillars.resilience)})${
        fall !== null && s.covid !== null ? `. It fell ${fall.toFixed(1)}% in the Covid crash vs a category median of ${s.covid.toFixed(1)}%` : ""
      }.`,
    );
  }
  const con = best("consistency");
  if (con !== top && (con.pillars.consistency ?? 0) >= 60 && num(rowOf(con).batting_months))
    items.push(`${b("Most consistent here:")} ${con.name}, which beat its category in ${rowOf(con).months_beat} of ${rowOf(con).batting_months} months.`);
  const ret = funds.reduce((a, f) => ((f.ret_1y ?? -999) > (a.ret_1y ?? -999) ? f : a), funds[0]);
  if (ret !== top && ret.ret_1y !== null)
    items.push(`${b("Best 1-year return here:")} ${ret.name} at ${fmtPct(ret.ret_1y)}${s.r1 !== null ? ` (category median ${fmtPct(s.r1)})` : ""}.`);

  // The leader's trade-off
  const weakest = PILLARS.filter((p) => top.pillars[p] !== null).sort((a, c) => (top.pillars[a] ?? 0) - (top.pillars[c] ?? 0))[0];
  if (weakest && (top.pillars[weakest] ?? 100) <= 40) {
    const ev =
      weakest === "resilience" && num(rows[0].covid_2020_fall_pct) !== null
        ? `: it fell ${Number(rows[0].covid_2020_fall_pct).toFixed(1)}% in the Covid crash`
        : weakest === "track_record"
          ? `: ${fmtCr(rows[0].aum_lakhs)} in assets, ${fmtYears(rows[0].fund_age_years)} old`
          : "";
    items.push(`${b("Trade-off:")} the leader is weaker on ${PILLAR_LABEL[weakest].toLowerCase()} (${fmtScore(top.pillars[weakest])})${ev}.`);
  }

  // Category context
  if (s.r1 !== null) {
    const beatMed = funds.filter((f) => f.ret_1y !== null && f.ret_1y > s.r1!).length;
    items.push(`${b("Category context:")} the median 1-year return across these ${s.n} funds is ${fmtPct(s.r1)}; ${beatMed} of the ${funds.length} shown beat it.`);
  }

  // Small funds
  const small = rows.filter((r) => (num(r.aum_lakhs) ?? Infinity) < SMALL_FUND_LAKHS).map((r) => String(r.name));
  if (small.length) items.push(`${b("Size check:")} ${listJoin(small)} ${small.length > 1 ? "are" : "is"} under ₹1,000 Cr, so ${small.length > 1 ? "their" : "its"} numbers can swing more.`);

  return items.length ? [{ type: "heading", text: "Key takeaways" }, { type: "bullets", items }] : [];
}

// ---- compare ----

export async function compareInsights(rows: Row[], funds: FundRow[]): Promise<Block[]> {
  const items: string[] = [];
  const names = funds.map((f) => f.name);

  for (const p of PILLARS) {
    const vals = funds.map((f) => f.pillars[p]);
    if (vals.filter((v) => v !== null).length < 2) continue;
    const max = Math.max(...(vals.filter((v) => v !== null) as number[]));
    const min = Math.min(...(vals.filter((v) => v !== null) as number[]));
    const i = vals.indexOf(max);
    if (max - min < 5) items.push(`${b(PILLAR_LABEL[p] + ":")} close (${vals.map(fmtScore).join(" vs ")}).`);
    else items.push(`${b(PILLAR_LABEL[p] + ":")} ${names[i]} leads (${vals.map(fmtScore).join(" vs ")}).`);
  }

  const r1 = rows.map((r) => num(r.ret_1y_pct));
  if (r1.every((v) => v !== null)) {
    const i = r1.indexOf(Math.max(...(r1 as number[])));
    const gap = Math.max(...(r1 as number[])) - Math.min(...(r1 as number[]));
    items.push(`${b("1-year return:")} ${names[i]} is ahead by ${gap.toFixed(1)} pts (${r1.map((v) => fmtPct(v)).join(" vs ")}).`);
  }
  const falls = rows.map((r) => num(r.covid_2020_fall_pct));
  if (falls.every((v) => v !== null)) {
    const i = falls.indexOf(Math.min(...(falls as number[])));
    items.push(`${b("In the Covid 2020 crash:")} ${names[i]} fell the least (${falls.map((v) => `${v!.toFixed(1)}%`).join(" vs ")}).`);
  }
  const rec = rows.map((r) => num(r.typical_recovery_months));
  if (rec.every((v) => v !== null)) {
    const i = rec.indexOf(Math.min(...(rec as number[])));
    items.push(`${b("Recovery after falls:")} ${names[i]} is quickest (${rec.map((v) => fmtMonths(v)).join(" vs ")}).`);
  }
  items.push(`${b("Size and age:")} ${rows.map((r, k) => `${names[k]} ${fmtCr(r.aum_lakhs)}, ${fmtYears(r.fund_age_years)}`).join("; ")}.`);

  // overall summary
  const wins = funds.map((_, k) =>
    PILLARS.filter((p) => {
      const vals = funds.map((f) => f.pillars[p] ?? -1);
      const max = Math.max(...vals);
      return vals[k] === max && max >= 0 && vals.filter((v) => v === max).length === 1; // ties are not wins
    }).length,
  );
  const lead = wins.indexOf(Math.max(...wins));
  const scores = funds.map((f) => f.score);
  const topScore = scores.every((v) => v !== null) ? scores.indexOf(Math.max(...(scores as number[]))) : -1;
  const scoreList = funds.map((f) => `${f.name} ${fmtScore(f.score)}`).join(", ");
  let summary = `${b(names[lead])} leads on ${wins[lead]} of 5 pillars.`;
  if (topScore >= 0) {
    const tied = scores.filter((v) => Math.round(v!) === Math.round(scores[topScore]!)).length > 1;
    summary += tied
      ? ` Overall scores are level (${scoreList}).`
      : topScore === lead
        ? ` It also has the higher overall score (${scoreList}).`
        : ` But ${b(names[topScore])} has the higher overall score (${scoreList}), because pillars carry equal weight and the margins differ.`;
  }

  return [{ type: "text", text: summary }, { type: "heading", text: "Head to head" }, { type: "bullets", items }];
}
