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
    { type: "overlap", a: names[0], b: names[1], overlap_pct: pct, rows: sectors.slice(0, 12), period },
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
