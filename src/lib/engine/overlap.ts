import "server-only";
import { query } from "@/lib/data/store";
import type { Block } from "@/lib/types";

// Sector overlap between funds. For each sector the common part is the smaller of the two weights
// (Fund A Banks 20%, Fund B Banks 32% -> 20% common, 12% extra on B). Overlap % = sum of the common parts.

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const CODE_RE = /^[0-9A-Za-z_-]{1,20}$/;

type Weights = Map<string, number>; // sector -> % of fund

export function overlapPct(a: Weights, b: Weights): number {
  let s = 0;
  for (const [k, v] of a) s += Math.min(v, b.get(k) ?? 0);
  return Number(s.toFixed(1));
}

export async function sectorOverlapBlocks(codes: string[], names: string[]): Promise<Block[]> {
  const ids = codes.filter((c) => CODE_RE.test(c));
  if (ids.length < 2) return [];
  const rows = await query<{ scheme_code: string; label: string; pct: number; period: string | null; base_period: string | null }>(
    `SELECT scheme_code, label, pct, period, base_period FROM alloc WHERE dimension = 'sector' AND pct > 0 AND scheme_code IN (${ids.map(q).join(", ")})`,
  );
  const w = new Map<string, Weights>(ids.map((c) => [c, new Map()]));
  for (const r of rows) {
    const m = w.get(String(r.scheme_code))!;
    m.set(String(r.label), (m.get(String(r.label)) ?? 0) + Number(r.pct));
  }
  const [ca, cb] = ids;
  const A = w.get(ca)!;
  const B = w.get(cb)!;
  if (!A.size || !B.size) {
    const missing = !A.size ? names[0] : names[1];
    return [{ type: "note", text: `Sector overlap isn't available: ${missing} has no sector-wise portfolio in our data (common for debt, index and fund-of-fund schemes).` }];
  }

  const sectors = [...new Set([...A.keys(), ...B.keys()])]
    .map((label) => ({ label, a: Number((A.get(label) ?? 0).toFixed(2)), b: Number((B.get(label) ?? 0).toFixed(2)) }))
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
  const pct = overlapPct(A, B);
  const coverA = [...A.values()].reduce((s, v) => s + v, 0);
  const coverB = [...B.values()].reduce((s, v) => s + v, 0);
  const common = sectors.map((s) => ({ ...s, c: Math.min(s.a, s.b) })).sort((x, y) => y.c - x.c);
  const top = common.filter((s) => s.c >= 1).slice(0, 3);
  const period = rows.find((r) => r.period)?.period ?? null;

  // Some AMCs disclose part of a portfolio without sector names. Below 60% coverage the overlap is clearly understated,
  // so we report it as a minimum and don't call it low/high.
  const lowCover = [
    { name: names[0], cover: coverA },
    { name: names[1], cover: coverB },
  ].filter((x) => x.cover < 60);
  const level = pct >= 70 ? "very high" : pct >= 50 ? "high" : pct >= 30 ? "moderate" : "low";
  const shared = top.length ? ` The largest shared sectors are ${top.map((s) => `${s.label} (${s.c.toFixed(1)}%)`).join(", ")}.` : "";
  const blocks: Block[] = [
    {
      type: "text",
      text: lowCover.length
        ? `**Sector overlap: at least ${pct.toFixed(0)}%.**${shared}`
        : `**Sector overlap: ${pct.toFixed(0)}%** (${level}). That much of each portfolio sits in the same sectors.${shared}`,
    },
    { type: "overlap", kind: "sector", a: names[0], b: names[1], overlap_pct: pct, rows: sectors.slice(0, 12), period },
  ];
  if (lowCover.length)
    blocks.push({
      type: "note",
      text: `${lowCover.map((x) => `${x.name} names sectors for only ${x.cover.toFixed(0)}% of its portfolio`).join("; ")}. The rest is disclosed without sector names, so the real overlap is likely higher.`,
    });
  else if (coverA < 85 || coverB < 85) blocks.push({ type: "note", text: "A small part of one portfolio is disclosed without sector names, so the overlap may be slightly higher." });
  if (!lowCover.length && pct >= 60) blocks.push({ type: "note", text: "High overlap means holding both funds adds little sector diversification." });

  // more than two funds: overlap for every pair
  if (ids.length > 2) {
    const pairs: string[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const wi = w.get(ids[i])!;
        const wj = w.get(ids[j])!;
        if (wi.size && wj.size) pairs.push(`**${names[i]}** × **${names[j]}**: ${overlapPct(wi, wj).toFixed(0)}%`);
      }
    if (pairs.length) blocks.push({ type: "heading", text: "Sector overlap by pair" }, { type: "bullets", items: pairs });
  }
  return blocks;
}

// ---- Stock overlap: top 20 stocks of each fund (gs://amc-csv-data holdings) ----
// Overlap % = sum over stocks in BOTH top-20 lists of the smaller of the two weights.

const TOP_N = 20;

type Stock = { isin: string; name: string; pct: number };

async function topStocks(ids: string[]): Promise<Map<string, Stock[]>> {
  const rows = await query<{ scheme_code: string; isin: string; name: string; pct: number }>(`
    SELECT scheme_code, isin, name, pct FROM (
      SELECT *, row_number() OVER (PARTITION BY scheme_code ORDER BY pct DESC) AS r FROM holdings
      WHERE is_equity AND pct > 0 AND scheme_code IN (${ids.map(q).join(", ")}))
    WHERE r <= ${TOP_N}`);
  const out = new Map<string, Stock[]>(ids.map((c) => [c, []]));
  for (const r of rows) out.get(String(r.scheme_code))?.push({ isin: String(r.isin), name: String(r.name), pct: Number(r.pct) });
  for (const v of out.values()) v.sort((a, b) => b.pct - a.pct);
  return out;
}

function stockPair(A: Stock[], B: Stock[]) {
  const bm = new Map(B.map((x) => [x.isin, x]));
  const common = A.filter((x) => bm.has(x.isin)).map((x) => ({ label: x.name, a: x.pct, b: bm.get(x.isin)!.pct }));
  const pct = Number(common.reduce((s, r) => s + Math.min(r.a, r.b), 0).toFixed(1));
  return { common, pct };
}

export async function stockOverlapBlocks(codes: string[], names: string[]): Promise<Block[]> {
  const ids = codes.filter((c) => CODE_RE.test(c));
  if (ids.length < 2) return [];
  const tops = await topStocks(ids);
  const missing = ids.map((c, i) => (tops.get(c)!.length ? null : names[i])).filter(Boolean) as string[];
  const [A, B] = [tops.get(ids[0])!, tops.get(ids[1])!];
  const [period] = await query<{ period: string | null }>(`SELECT any_value(period) AS period FROM holdings_funds WHERE scheme_code IN (${ids.map(q).join(", ")})`);
  const blocks: Block[] = [];

  if (A.length && B.length) {
    const { common, pct } = stockPair(A, B);
    common.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b));
    // rows: shared stocks first, then each fund's largest stocks the other doesn't hold in its top 20
    const onlyA = A.filter((x) => !B.some((y) => y.isin === x.isin)).slice(0, 4).map((x) => ({ label: x.name, a: x.pct, b: 0 }));
    const onlyB = B.filter((x) => !A.some((y) => y.isin === x.isin)).slice(0, 4).map((x) => ({ label: x.name, a: 0, b: x.pct }));
    const rows = [...common, ...onlyA, ...onlyB].filter((r, i, arr) => arr.findIndex((z) => z.label === r.label) === i).slice(0, 14);
    const level = pct >= 50 ? "very high" : pct >= 30 ? "high" : pct >= 15 ? "moderate" : "low";
    blocks.push({
      type: "text",
      text: common.length
        ? `**Stock overlap: ${pct.toFixed(0)}%** (${level}). They share ${common.length} of their top ${TOP_N} stocks; the largest shared positions are ${common
            .slice(0, 3)
            .map((r) => `${r.label} (${Math.min(r.a, r.b).toFixed(1)}%)`)
            .join(", ")}.`
        : `**Stock overlap: 0%.** None of their top ${TOP_N} stocks are the same.`,
    });
    blocks.push({ type: "overlap", kind: "stock", a: names[0], b: names[1], overlap_pct: pct, rows, period: period?.period ?? null });
    if (pct >= 30) blocks.push({ type: "note", text: "High stock overlap means holding both funds largely doubles up on the same companies." });
  }
  if (missing.length)
    blocks.push({
      type: "note",
      text: `Stock-level holdings aren't available for ${missing.join(" and ")} (not in this month's portfolio disclosures, or not an equity fund).`,
    });

  if (ids.length > 2) {
    const pairs: string[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const x = tops.get(ids[i])!;
        const y = tops.get(ids[j])!;
        if (x.length && y.length) pairs.push(`**${names[i]}** × **${names[j]}**: ${stockPair(x, y).pct.toFixed(0)}%`);
      }
    if (pairs.length) blocks.push({ type: "heading", text: "Stock overlap by pair" }, { type: "bullets", items: pairs });
  }
  return blocks;
}
