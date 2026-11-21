"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Blocks } from "@/components/Blocks";
import { Header, Upgrade } from "@/components/Header";
import { SiteFooter } from "@/components/Footer";
import { AuthModal } from "@/components/SignIn";
import { RISK_LINE, SOURCE_LINE } from "@/lib/config/company";
import { Arrow, BattingDots, Delta, LockIcon, PillarBars, ScoreRing, cr } from "@/components/ui";
import { useMe } from "@/components/useMe";
import type { AllocRow, FundDetail, ScreenerCard, ScreenerResult } from "@/lib/screener-types";

type Filters = {
  categories: string[];
  type: "any" | "active" | "passive";
  aum: ("small" | "mid" | "large")[];
  min_age: 0 | 3 | 5 | 10;
  min_score: number;
  min_batting: number;
  beat_category_1y: boolean;
  q: string;
  sort: string;
};

const DEFAULTS: Filters = { categories: [], type: "any", aum: [], min_age: 0, min_score: 0, min_batting: 0, beat_category_1y: false, q: "", sort: "score" };

const KIND_LABEL: Record<string, string> = {
  equity: "Equity",
  sector: "Sectoral & thematic",
  hybrid: "Hybrid",
  debt: "Debt",
  passive: "Index funds & ETFs",
  commodity: "Gold & commodities",
  solution: "Retirement & children",
  fof: "Fund of funds",
};
const OPEN_KINDS = new Set(["equity"]);
const AUM_LABEL = { small: "Under ₹1,000 Cr", mid: "₹1,000–10,000 Cr", large: "Over ₹10,000 Cr" } as const;

const SORTS: [string, string][] = [
  ["score", "Our score"],
  ["ret_1y", "1-year return"],
  ["batting", "Batting average"],
  ["resilience", "Resilience"],
  ["consistency", "Consistency"],
  ["momentum", "Momentum"],
  ["returns", "Returns pillar"],
  ["aum", "Fund size"],
  ["age", "Fund age"],
];

function toggle<T>(xs: T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

type Res = ScreenerResult & { plan: string; as_of: string };

export default function ScreenerPage() {
  const { me, setMe, refresh, signOut } = useMe();
  const [authOpen, setAuthOpen] = useState(false);
  const router = useRouter();
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [res, setRes] = useState<Res | null>(null);
  const [cards, setCards] = useState<ScreenerCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [details, setDetails] = useState<Record<string, FundDetail | "loading" | "error">>({});
  const [picked, setPicked] = useState<ScreenerCard[]>([]);
  const seq = useRef(0);

  const search = useCallback(
    async (filters: Filters, page = 0) => {
      const id = ++seq.current;
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch("/api/screener", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...filters, page }) });
        const data = await r.json();
        if (id !== seq.current) return; // a newer search started
        if (!r.ok) return setErr(data.message ?? data.error ?? "Search failed");
        setRes(data);
        setCards((prev) => (page === 0 ? data.cards : [...prev, ...data.cards]));
      } catch {
        if (id === seq.current) setErr("Search failed. Check your connection.");
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [],
  );

  // re-run (debounced) when filters change
  const plan = me?.plan;
  useEffect(() => {
    if (!plan) return;
    const t = setTimeout(() => search(f, 0), f.q ? 400 : 150);
    return () => clearTimeout(t);
  }, [f, plan, search]);

  async function loadDetail(code: string) {
    if (details[code] || me?.plan !== "pro") return;
    setDetails((d) => ({ ...d, [code]: "loading" }));
    try {
      const r = await fetch(`/api/fund/${encodeURIComponent(code)}`);
      const data = r.ok ? ((await r.json()) as FundDetail) : "error";
      setDetails((d) => ({ ...d, [code]: data }));
    } catch {
      setDetails((d) => ({ ...d, [code]: "error" }));
    }
  }

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const header = <Header me={me} onSignIn={() => setAuthOpen(true)} onSignOut={signOut} />;
  if (me === undefined) return <div className="app">{header}</div>;

  const pro = me.plan === "pro";
  const kinds = res ? [...new Set(res.facets.map((x) => x.kind))] : [];
  const catName = (code: string) => res?.facets.find((x) => x.code === code)?.name ?? code;

  // active filter chips (each removable)
  const active: { label: string; clear: () => void }[] = [
    ...f.categories.map((c) => ({ label: catName(c), clear: () => set("categories", f.categories.filter((x) => x !== c)) })),
    ...(f.type !== "any" ? [{ label: f.type === "active" ? "Active" : "Passive", clear: () => set("type", "any") }] : []),
    ...f.aum.map((a) => ({ label: AUM_LABEL[a], clear: () => set("aum", f.aum.filter((x) => x !== a)) })),
    ...(f.min_age ? [{ label: `${f.min_age}+ yrs`, clear: () => set("min_age", 0) }] : []),
    ...(f.min_score ? [{ label: `Score ≥ ${f.min_score}`, clear: () => set("min_score", 0) }] : []),
    ...(f.min_batting ? [{ label: `Beat category ${f.min_batting}+/12`, clear: () => set("min_batting", 0) }] : []),
    ...(f.beat_category_1y ? [{ label: "1Y above category", clear: () => set("beat_category_1y", false) }] : []),
    ...(f.q ? [{ label: `“${f.q}”`, clear: () => set("q", "") }] : []),
  ];

  const seg = <T extends string | number>(value: T, options: [T, string][], onPick: (v: T) => void) => (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );

  const filterPanel = (
    <aside className={`filters${sheet ? " open" : ""}`} aria-label="Filters">
      <div className="filters-head">
        <b>Filters</b>
        <button className="ghost" onClick={() => setF({ ...DEFAULTS, sort: f.sort })}>
          Reset
        </button>
      </div>

      <div className="fgroup">
        <input className="search" placeholder="Search fund name" value={f.q} onChange={(e) => set("q", e.target.value)} maxLength={60} />
      </div>

      <div className="fgroup">
        <div className="flabel">Type</div>
        {seg(f.type, [["any", "All"], ["active", "Active"], ["passive", "Passive"]], (v) => set("type", v))}
      </div>

      <div className="fgroup">
        <div className="flabel">Fund size (AUM)</div>
        {(["small", "mid", "large"] as const).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={f.aum.includes(k)} onChange={() => set("aum", toggle(f.aum, k))} /> {AUM_LABEL[k]}
          </label>
        ))}
      </div>

      <div className="fgroup">
        <div className="flabel">Fund age</div>
        {seg(f.min_age, [[0, "Any"], [3, "3+ yrs"], [5, "5+ yrs"], [10, "10+ yrs"]], (v) => set("min_age", v))}
      </div>

      <div className="fgroup">
        <div className="flabel">Our score at least</div>
        {seg(f.min_score, [[0, "Any"], [50, "50"], [60, "60"], [70, "70"], [80, "80"]], (v) => set("min_score", v))}
      </div>

      <div className="fgroup">
        <div className="flabel">Beat category (batting average)</div>
        {seg(f.min_batting, [[0, "Any"], [6, "6+/12"], [8, "8+/12"], [10, "10+/12"]], (v) => set("min_batting", v))}
        <label className="check">
          <input type="checkbox" checked={f.beat_category_1y} onChange={(e) => set("beat_category_1y", e.target.checked)} /> 1-year return above category median
        </label>
      </div>

      <div className="fgroup">
        <div className="flabel">Category</div>
        {kinds.map((k) => (
          <details key={k} className="cat-group" open={OPEN_KINDS.has(k) || res!.facets.some((x) => x.kind === k && f.categories.includes(x.code))}>
            <summary>{KIND_LABEL[k] ?? k}</summary>
            {res!.facets
              .filter((x) => x.kind === k)
              .map((x) => (
                <label key={x.code} className="check">
                  <input type="checkbox" checked={f.categories.includes(x.code)} onChange={() => set("categories", toggle(f.categories, x.code))} />
                  <span className="grow">{x.name}</span>
                  <span className="count">{x.count}</span>
                </label>
              ))}
          </details>
        ))}
      </div>

      <p className="filters-note">{RISK_LINE}</p>
      <button className="primary sheet-done" onClick={() => setSheet(false)}>
        Show {res ? res.total.toLocaleString("en-IN") : ""} funds
      </button>
    </aside>
  );

  const pick = (c: ScreenerCard) =>
    setPicked((p) => (p.some((x) => x.code === c.code) ? p.filter((x) => x.code !== c.code) : p.length >= 3 ? p : [...p, c]));

  return (
    <div className="app">
      {header}
      <div className="screener">
        {filterPanel}
        <main className="results">
          <div className="page-head">
            <span className="eyebrow">Screener</span>
            <h1>
              {res ? res.total.toLocaleString("en-IN") : "—"} <span>funds</span>
            </h1>
          </div>
          <div className="toolbar">
            <button className="textbtn show-sm" onClick={() => setSheet(true)}>
              Filters{active.length ? ` (${active.length})` : ""}
            </button>
            <div className="count-line sub">{loading ? "Updating…" : res?.locked ? "Free plan: top 3 shown" : "Sorted and scored against category peers"}</div>
            <label className="sort">
              <span className="sub">Sort by</span>
              <select value={f.sort} onChange={(e) => set("sort", e.target.value)}>
                {SORTS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {active.length > 0 && (
            <div className="active-chips">
              {active.map((a, k) => (
                <button key={k} className="chip removable" onClick={a.clear} aria-label={`Remove filter ${a.label}`}>
                  {a.label} <span aria-hidden>×</span>
                </button>
              ))}
              <button className="ghost" onClick={() => setF({ ...DEFAULTS, sort: f.sort })}>
                Clear all
              </button>
            </div>
          )}

          {err && <p className="error">{err}</p>}
          {res && res.total === 0 && (
            <div className="empty-state">
              <b>No funds match these filters.</b>
              <span className="sub">Try removing a filter.</span>
            </div>
          )}

          {!cards.length && loading && [0, 1, 2].map((k) => <div key={k} className="fcard skeleton" />)}

          {cards.map((c, i) => (
            <FundCard
              key={c.code}
              rank={i + 1}
              card={c}
              pro={pro}
              detail={details[c.code]}
              picked={picked.some((x) => x.code === c.code)}
              canPick={picked.length < 3}
              onPick={() => pick(c)}
              onOpen={() => loadDetail(c.code)}
              onAsk={() => router.push(`/?q=${encodeURIComponent(`Tell me about ${c.name}`)}`)}
            />
          ))}

          {res?.locked && res.total > res.shown && <Upgrade text={`${(res.total - res.shown).toLocaleString("en-IN")} more funds match your filters.`} />}
          {res?.has_more && (
            <button className="textbtn strong load-more" disabled={loading} onClick={() => search(f, res.page + 1)}>
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
          {res && <p className="disclaimer">Scores compare each fund with its own category. {SOURCE_LINE}</p>}
          <SiteFooter />
        </main>
      </div>

      {picked.length > 0 && (
        <div className="compare-tray">
          <span>
            <b>{picked.length}</b> selected{picked.length < 2 ? " · pick one more to compare" : ""}
          </span>
          <button className="ghost" onClick={() => setPicked([])}>
            Clear
          </button>
          <button
            className="primary"
            disabled={picked.length < 2}
            onClick={() => router.push(`/?q=${encodeURIComponent(`Compare ${picked.map((p) => p.name).join(" vs ")}`)}`)}
          >
            Compare in chat
          </button>
        </div>
      )}
      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onSignedIn={(m) => {
            setMe(m);
            setAuthOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function FundCard({
  rank,
  card: c,
  pro,
  detail,
  picked,
  canPick,
  onPick,
  onOpen,
  onAsk,
}: {
  rank: number;
  card: ScreenerCard;
  pro: boolean;
  detail: FundDetail | "loading" | "error" | undefined;
  picked: boolean;
  canPick: boolean;
  onPick: () => void;
  onOpen: () => void;
  onAsk: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"analysis" | "portfolio" | "details">("analysis");
  const loaded = detail && detail !== "loading" && detail !== "error" ? detail : null;

  return (
    <article className={`fcard${picked ? " picked" : ""}`}>
      <div className="fcard-head">
        <div className="fcard-title">
          <span className="rank">{rank}</span>
          <div>
            <div className="fcard-name">{c.name}</div>
            <div className="chips">
              <span className="chip">{c.category}</span>
              <span className="chip">{c.type}</span>
              <span className="chip">{cr(c.aum_cr)}</span>
              {c.age_years !== null && <span className="chip">{c.age_years} yrs</span>}
            </div>
          </div>
        </div>
        <ScoreRing value={c.score} size={58} />
      </div>

      <div className="stats">
        <div className="stat">
          <span className="tile-l">1-year return</span>
          <span className="tile-v">
            <Delta value={c.ret_1y} />
          </span>
        </div>
        <div className="stat">
          <span className="tile-l">Batting average</span>
          <span className="tile-v">{c.batting ? `${c.batting.beat}/${c.batting.of} months` : "–"}</span>
          {c.batting && <BattingDots beat={c.batting.beat} of={c.batting.of} />}
        </div>
        {pro && (
          <>
            <div className="stat">
              <span className="tile-l">Momentum</span>
              <span className="tile-v">{c.momentum ? `#${c.momentum.rank} of ${c.momentum.of}` : "–"}</span>
              {c.momentum?.climbed_6m ? (
                <span className={`tile-h ${c.momentum.climbed_6m > 0 ? "pos" : "neg"}`}>
                  {c.momentum.climbed_6m > 0 ? "▲" : "▼"} {Math.abs(c.momentum.climbed_6m)} in 6 mo
                </span>
              ) : null}
            </div>
            <div className="stat">
              <span className="tile-l">Recovery after falls</span>
              <span className="tile-v">{c.recovery_months == null ? "–" : `${c.recovery_months.toFixed(1)} mo`}</span>
              {c.category_recovery_months != null && <span className="tile-h">category {c.category_recovery_months.toFixed(1)} mo</span>}
            </div>
            <div className="stat">
              <span className="tile-l">Covid 2020 fall</span>
              <span className="tile-v">{c.covid_fall_pct == null ? "–" : `${c.covid_fall_pct.toFixed(1)}%`}</span>
            </div>
            <div className="stat">
              <span className="tile-l">3-year SIP gain</span>
              <span className="tile-v">
                <Delta value={c.sip_3y_gain_pct} />
              </span>
            </div>
          </>
        )}
      </div>

      {pro && c.pillars && <PillarBars pillars={c.pillars} compact />}

      <div className="fcard-actions">
        <button
          className="textbtn strong"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
            if (!open) onOpen();
          }}
        >
          {open ? "Hide analysis" : "View analysis"} <Arrow />
        </button>
        <button className="textbtn" onClick={onAsk}>
          Ask about this fund
        </button>
        <label className={`check pick${!canPick && !picked ? " disabled" : ""}`}>
          <input type="checkbox" checked={picked} disabled={!canPick && !picked} onChange={onPick} /> Compare
        </label>
      </div>

      {open && (
        <div className="fcard-panel">
          {!pro ? (
            <div className="locked">
              <div className="locked-preview" aria-hidden>
                {[72, 45, 88, 60, 30].map((w, k) => (
                  <i key={k} style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="locked-msg">
                <b>
                  <LockIcon /> Pro analysis
                </b>
                <span>Category comparison, crash behaviour, sector allocation, rating mix and fund details.</span>
              </div>
            </div>
          ) : (
            <>
              <div className="tabbar" role="tablist">
                {(
                  [
                    ["analysis", "Analysis"],
                    ["portfolio", "Portfolio"],
                    ["details", "Details"],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                    {label}
                  </button>
                ))}
              </div>
              {detail === "loading" && <div className="skeleton-lines" />}
              {detail === "error" && <p className="error">Could not load. Try again.</p>}
              {loaded && tab === "analysis" && (
                <div className="bot">
                  <Blocks blocks={loaded.analysis} onAsk={() => {}} showFollowups={false} />
                </div>
              )}
              {loaded && tab === "portfolio" && <Allocation a={loaded.allocation} />}
              {loaded && tab === "details" && (
                <div className="tiles">
                  {loaded.details.map((d, k) => (
                    <div className="tile" key={k}>
                      <span className="tile-l">{d.label}</span>
                      <span className="tile-v">{d.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function AllocTable({ title, rows }: { title: string; rows: AllocRow[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="alloc">
      <div className="mini-title">{title}</div>
      {rows.map((r, k) => (
        <div className="alloc-row" key={k}>
          <span className="alloc-label">{r.label}</span>
          <div className="alloc-track">
            <i style={{ width: `${(r.pct / max) * 100}%` }} />
          </div>
          <span className="num">{r.pct.toFixed(1)}%</span>
          <span className={`num small ${r.change === null || Math.abs(r.change) < 0.05 ? "" : r.change > 0 ? "pos" : "neg"}`}>
            {r.change === null || Math.abs(r.change) < 0.05 ? "" : `${r.change > 0 ? "+" : ""}${r.change.toFixed(1)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function Allocation({ a }: { a: FundDetail["allocation"] }) {
  if (!a.sectors.length && !a.asset_class.length && !a.rating.length && !a.top_holdings.length) return <p className="sub">No portfolio disclosure available.</p>;
  const covered = a.sectors.reduce((s, r) => s + r.pct, 0);
  return (
    <div className="alloc-wrap">
      {a.period && <p className="sub">Share of portfolio, and change in points ({a.period})</p>}
      <AllocTable title="Top 10 holdings" rows={a.top_holdings} />
      <AllocTable title="Sectors" rows={a.sectors} />
      {a.sectors.length > 0 && covered < 60 && <p className="note">Sector names are disclosed for only part of this portfolio, so these weights understate it.</p>}
      <AllocTable title="Asset class" rows={a.asset_class} />
      <AllocTable title="Credit rating" rows={a.rating} />
    </div>
  );
}
