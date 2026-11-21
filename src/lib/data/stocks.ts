import "server-only";
import Fuse from "fuse.js";
import { getStore, query, type Store } from "@/lib/data/store";

// Stock name -> ISIN, over the stocks that appear in fund holdings. Word matching first (all your words must appear
// in the stock's name), widely held stocks win ties, fuzzy matching only for typos. Common short forms are expanded.

type Entry = { isin: string; name: string; clean: string; funds: number };

const ALIASES: Record<string, string> = {
  sbi: "state bank of india",
  "l&t": "larsen toubro",
  lt: "larsen toubro",
  lnt: "larsen toubro",
  tcs: "tata consultancy services",
  ril: "reliance industries",
  hul: "hindustan unilever",
  "m&m": "mahindra mahindra",
  airtel: "bharti airtel",
  infy: "infosys",
  zomato: "eternal",
  "kotak bank": "kotak mahindra bank",
  sbin: "state bank of india",
};

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(limited|ltd|the|co|company|corporation|corp|inc|plc|india ltd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

let cache: { store: Store; entries: Entry[]; fuse: Fuse<Entry> } | null = null;

async function index() {
  const store = await getStore();
  if (cache?.store === store) return cache;
  const rows = await query<{ isin: string; name: string; funds: number }>(
    `SELECT isin, mode(name) AS name, count(DISTINCT scheme_code)::INT AS funds FROM holdings WHERE is_equity GROUP BY isin`,
  );
  const entries = rows.map((r) => ({ isin: String(r.isin), name: String(r.name), clean: clean(String(r.name)), funds: Number(r.funds) }));
  cache = { store, entries, fuse: new Fuse(entries, { keys: ["clean"], includeScore: true, threshold: 0.35, ignoreLocation: true }) };
  return cache;
}

const hit = (q: string, n: string) => n === q || (q.length >= 3 && n.startsWith(q));

export async function resolveStock(text: string): Promise<{ isin: string; name: string; funds: number } | null> {
  const { entries, fuse } = await index();
  const raw = text.toLowerCase().trim();
  const q = clean(ALIASES[raw] ?? raw);
  if (!q) return null;
  const qt = q.split(" ");
  const matches = entries
    .filter((e) => {
      const nt = e.clean.split(" ");
      return qt.every((w) => nt.some((n) => hit(w, n)));
    })
    .sort((a, b) => b.funds - a.funds);
  if (matches.length) return matches[0];
  const f = fuse.search(q, { limit: 3 });
  return f.length && (f[0].score ?? 1) < 0.3 ? f[0].item : null;
}
