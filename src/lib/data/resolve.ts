import "server-only";
import Fuse from "fuse.js";
import { getStore, type Store } from "@/lib/data/store";

// Turns "parag parikh flexi" into a scheme code. Fuzzy match over fund names (rapidfuzz-style, in-process).

type Entry = { code: string; name: string; clean: string };

let cache: { store: Store; fuse: Fuse<Entry>; brands: Set<string>; entries: Entry[]; vocab: string[] } | null = null;

const GENERIC = new Set(["bank", "the", "fund", "india", "old", "trust", "union", "choice", "nifty", "quantum", "unifi"]);

export const cleanName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\b(fund|scheme|plan|regular|growth|direct|option|the|mf)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function index() {
  const store = await getStore();
  if (cache?.store === store) return cache;
  const entries: Entry[] = store.funds.map((f) => ({ ...f, clean: cleanName(f.name) }));
  const fuse = new Fuse(entries, { keys: ["clean"], includeScore: true, threshold: 0.4, ignoreLocation: true });
  // First word of fund names = AMC brand ("hdfc", "sbi", "parag", "nippon"...). Used to tell fund names from categories.
  const counts = new Map<string, number>();
  for (const e of entries) {
    const w = e.clean.split(" ")[0];
    if (w && w.length > 1) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const brands = new Set([...counts].filter(([w, n]) => n >= 2 && !GENERIC.has(w)).map(([w]) => w));
  const vocab = [...new Set(entries.flatMap((e) => e.clean.split(" ")))];
  cache = { store, fuse, brands, entries, vocab };
  return cache;
}

export async function mentionsBrand(text: string): Promise<boolean> {
  const { brands } = await index();
  return cleanName(text)
    .split(" ")
    .some((w) => brands.has(w));
}

export type Resolved = { code: string; name: string; score: number };

// prefixes need 4+ letters so "cap" doesn't match "capital"/"capitalmind"
const tokenHit = (q: string, n: string) => n === q || (q.length >= 4 && n.startsWith(q)) || (n.length >= 4 && q.startsWith(n) && q.length - n.length <= 4);

// Token match: how many of the user's words appear in the fund name (prefixes allowed: "flexi" ~ "flexicap").
// Score 0 = perfect (same convention as Fuse). Ties broken by how much of the name was covered.
function tokenSearch(entries: Entry[], vocab: string[], q: string, limit: number): Resolved[] {
  // ignore words that appear in no fund name at all ("if", "kya", "according"...)
  const qt = q.split(" ").filter((w) => w && vocab.some((n) => tokenHit(w, n)));
  if (!qt.length) return [];
  const scored = entries.map((e) => {
    const nt = e.clean.split(" ");
    const hitQ = qt.filter((w) => nt.some((n) => tokenHit(w, n))).length;
    const hitN = nt.filter((n) => qt.some((w) => tokenHit(w, n))).length;
    return { e, recall: hitQ / qt.length, cover: hitN / nt.length };
  });
  return scored
    .filter((s) => s.recall > 0)
    .sort((a, b) => b.recall - a.recall || b.cover - a.cover)
    .slice(0, limit)
    .map((s) => ({ code: s.e.code, name: s.e.name, score: Number((1 - s.recall + (1 - s.cover) * 0.1).toFixed(4)) }));
}

export async function resolveFund(text: string, limit = 3): Promise<Resolved[]> {
  const { fuse, entries, vocab } = await index();
  const q = cleanName(text);
  if (!q) return [];
  const tok = tokenSearch(entries, vocab, q, limit);
  if (tok.length && tok[0].score < 0.1) return tok; // every word matched
  // typos ("parikh flexy") -> fuzzy
  return fuse.search(q, { limit }).map((r) => ({ code: r.item.code, name: r.item.name, score: r.score ?? 1 }));
}

// Does the text clearly name ONE fund? All the user's (fund-name) words match AND they cover most of that fund's
// name. "bank of india small cap" -> yes; "best small cap" -> no (covers only 2 of ~3-4 words of any fund).
export async function strongFundMatch(text: string): Promise<Resolved | null> {
  const { entries, vocab } = await index();
  const q = cleanName(text);
  if (!q) return null;
  const qt = q.split(" ").filter((w) => w && vocab.some((n) => tokenHit(w, n)));
  if (qt.length < 2) return null;
  let best: { e: Entry; cover: number } | null = null;
  let tie = false;
  for (const e of entries) {
    const nt = e.clean.split(" ");
    // the fund house (first word of the name) must be mentioned: "best flexi cap" never names "capitalmind"
    if (!qt.some((w) => tokenHit(w, nt[0]))) continue;
    if (!qt.every((w) => nt.some((n) => tokenHit(w, n)))) continue;
    const cover = nt.filter((n) => qt.some((w) => tokenHit(w, n))).length / nt.length;
    if (!best || cover > best.cover) (best = { e, cover }), (tie = false);
    else if (cover === best.cover) tie = true;
  }
  if (!best || tie || best.cover < 0.75) return null;
  return { code: best.e.code, name: best.e.name, score: 0 };
}

// Pick one fund, or report ambiguity.
export async function resolveOne(text: string): Promise<{ fund?: Resolved; candidates: Resolved[] }> {
  const c = await resolveFund(text, 4);
  if (!c.length || c[0].score > 0.35) return { candidates: c };
  const close = c.filter((x) => Math.abs(x.score - c[0].score) < 0.005);
  if (close.length > 1) return { candidates: close };
  return { fund: c[0], candidates: c };
}
