"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Blocks } from "@/components/Blocks";
import { Header, Upgrade } from "@/components/Header";
import { SignIn } from "@/components/SignIn";
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
const OPEN_KINDS = new Set(["equity", "passive"]);

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

const r0 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : String(Math.round(v)));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const cr = (v: number | null) => (v === null ? "–" : `₹${v.toLocaleString("en-IN")} Cr`);

function toggle<T>(xs: T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

export default function ScreenerPage() {
  const { me, setMe, signIn, signOut } = useMe();
  const router = useRouter();
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [res, setRes] = useState<(ScreenerResult & { plan: string; as_of: string }) | null>(null);
  const [cards, setCards] = useState<ScreenerCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [details, setDetails] = useState<Record<string, FundDetail | "loading" | "error">>({});
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
        if (r.status === 401) return setMe(null);
        if (!r.ok) return setErr(data.message ?? data.error ?? "Search failed");
        setRes(data);
        setCards((prev) => (page === 0 ? data.cards : [...prev, ...data.cards]));
        if (me) setMe({ ...me, used: { ...me.used, screener: me.used.screener + 1 } });
      } catch {
        if (id === seq.current) setErr("Search failed");
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.plan],
  );

  // re-run (debounced) when filters change
  useEffect(() => {
    if (!me) return;
    const t = setTimeout(() => search(f, 0), f.q ? 400 : 150);
    return () => clearTimeout(t);
  }, [f, me?.plan, search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(code: string) {
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
  const header = <Header me={me} onSignOut={signOut} usageKind="screener" />;
  if (me === undefined) return <div className="app">{header}</div>;
  if (me === null)
    return (
      <div className="app">
        {header}
        <SignIn onSignIn={signIn} />
      </div>
    );

  const kinds = res ? [...new Set(res.facets.map((x) => x.kind))] : [];
  const pro = me.plan === "pro";

  const filterPanel = (
    <aside className={`filters${showFilters ? " open" : ""}`}>
      <div className="filters-head">
        <b>Filters</b>
        <button className="link sub" onClick={() => setF({ ...DEFAULTS, sort: f.sort })}>
          Reset
        </button>
      </div>

      <div className="fgroup">
        <input className="search" placeholder="Search fund name" value={f.q} onChange={(e) => set("q", e.target.value)} maxLength={60} />
      </div>

      <div className="fgroup">
        <div className="flabel">Type</div>
        <div className="seg">
          {(["any", "active", "passive"] as const).map((t) => (
            <button key={t} className={f.type === t ? "on" : ""} onClick={() => set("type", t)}>
              {t === "any" ? "All" : t === "active" ? "Active" : "Passive"}
            </button>
          ))}
        </div>
      </div>

      <div className="fgroup">
        <div className="flabel">Fund size (AUM)</div>
        {(
          [
            ["small", "Under ₹1,000 Cr"],
            ["mid", "₹1,000–10,000 Cr"],
            ["large", "Over ₹10,000 Cr"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={f.aum.includes(k)} onChange={() => set("aum", toggle(f.aum, k))} /> {label}
          </label>
        ))}
      </div>

      <div className="fgroup">
        <div className="flabel">Fund age</div>
        <div className="seg">
          {([0, 3, 5, 10] as const).map((a) => (
            <button key={a} className={f.min_age === a ? "on" : ""} onClick={() => set("min_age", a)}>
              {a === 0 ? "Any" : `${a}+ yrs`}
            </button>
          ))}
        </div>
      </div>

      <div className="fgroup">
        <div className="flabel">Our score at least</div>
        <div className="seg">
          {[0, 50, 60, 70, 80].map((s) => (
            <button key={s} className={f.min_score === s ? "on" : ""} onClick={() => set("min_score", s)}>
              {s === 0 ? "Any" : s}
            </button>
          ))}
        </div>
      </div>

      <div className="fgroup">
        <div className="flabel">Beat category (batting average)</div>
        <div className="seg">
          {[0, 6, 8, 10].map((s) => (
            <button key={s} className={f.min_batting === s ? "on" : ""} onClick={() => set("min_batting", s)}>
              {s === 0 ? "Any" : `${s}+/12`}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={f.beat_category_1y} onChange={(e) => set("beat_category_1y", e.target.checked)} /> 1-year return above category median
        </label>
      </div>

      <div className="fgroup">
        <div className="flabel">Category</div>
        {kinds.map((k) => (
          <details key={k} open={OPEN_KINDS.has(k) || res!.facets.some((x) => x.kind === k && f.categories.includes(x.code))}>
            <summary>{KIND_LABEL[k] ?? k}</summary>
            {res!.facets
              .filter((x) => x.kind === k)
              .map((x) => (
                <label key={x.code} className="check">
                  <input type="checkbox" checked={f.categories.includes(x.code)} onChange={() => set("categories", toggle(f.categories, x.code))} /> {x.name}{" "}
                  <span className="sub">({x.count})</span>
                </label>
              ))}
          </details>
        ))}
      </div>
    </aside>
  );

  return (
    <div className="app">
      {header}
      <div className="screener">
        {filterPanel}
        <main className="results">
          <div className="results-head">
            <button className="pill show-sm" onClick={() => setShowFilters((s) => !s)}>
              {showFilters ? "Hide filters" : "Filters"}
            </button>
            <span>
              <b>{res ? res.total.toLocaleString("en-IN") : "…"}</b> funds
              {loading && <span className="sub"> · updating</span>}
            </span>
            <label className="sub">
              Sort{" "}
              <select value={f.sort} onChange={(e) => set("sort", e.target.value)}>
                {SORTS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {err && <p className="error">{err}</p>}
          {res && res.total === 0 && <p className="sub">No funds match these filters. Try removing one.</p>}

          {cards.map((c, i) => (
            <FundCard
              key={c.code}
              rank={i + 1}
              card={c}
              pro={pro}
              detail={details[c.code]}
              onOpen={() => openDetail(c.code)}
              onAsk={() => router.push(`/?q=${encodeURIComponent(`Tell me about ${c.name}`)}`)}
            />
          ))}

          {res?.locked && res.total > res.shown && <Upgrade text={`${(res.total - res.shown).toLocaleString("en-IN")} more funds match your filters.`} />}
          {res?.has_more && (
            <button className="pill" disabled={loading} onClick={() => search(f, res.page + 1)}>
              Load more
            </button>
          )}
          {res && <p className="disclaimer">Data as of {res.as_of}. Scores compare each fund with its own category. Not investment advice.</p>}
        </main>
      </div>
    </div>
  );
}

function FundCard({
  rank,
  card: c,
  pro,
  detail,
  onOpen,
  onAsk,
}: {
  rank: number;
  card: ScreenerCard;
  pro: boolean;
  detail: FundDetail | "loading" | "error" | undefined;
  onOpen: () => void;
  onAsk: () => void;
}) {
  const locked = <p className="sub">🔒 Available on Pro: full analysis, sector allocation and fund details.</p>;
  const loaded = detail && detail !== "loading" && detail !== "error" ? detail : null;
  const pending = detail === "loading" ? <p className="sub">Loading…</p> : detail === "error" ? <p className="error">Could not load.</p> : null;

  return (
    <article className="fcard">
      <div className="fcard-head">
        <div>
          <div className="fcard-name">
            <span className="sub">{rank}.</span> {c.name}
          </div>
          <div className="sub">
            {c.category} · {c.type} · {cr(c.aum_cr)} · {c.age_years === null ? "–" : `${c.age_years} yrs`}
          </div>
        </div>
        <div className="fcard-score" title="Our 5-pillar score vs category peers (0-100)">
          <b>{r0(c.score)}</b>
          <span className="sub">score</span>
        </div>
      </div>

      <div className="stats">
        <div>
          <span className="sub">1Y return</span>
          <b>{pct(c.ret_1y)}</b>
        </div>
        <div>
          <span className="sub">Batting average</span>
          <b>{c.batting ? `${c.batting.beat}/${c.batting.of} months` : "–"}</b>
        </div>
        {pro && (
          <>
            <div>
              <span className="sub">Momentum</span>
              <b>{c.momentum ? `#${c.momentum.rank} of ${c.momentum.of}` : "–"}</b>
            </div>
            <div>
              <span className="sub">Recovery after falls</span>
              <b>{c.recovery_months === null || c.recovery_months === undefined ? "–" : `${c.recovery_months.toFixed(1)} mo`}</b>
            </div>
            <div>
              <span className="sub">Covid 2020 fall</span>
              <b>{c.covid_fall_pct === null || c.covid_fall_pct === undefined ? "–" : `${c.covid_fall_pct.toFixed(1)}%`}</b>
            </div>
            <div>
              <span className="sub">3Y SIP gain</span>
              <b>{pct(c.sip_3y_gain_pct)}</b>
            </div>
          </>
        )}
      </div>
      {pro && c.pillars && (
        <div className="sub">
          Resilience {r0(c.pillars.resilience)} · Consistency {r0(c.pillars.consistency)} · Momentum {r0(c.pillars.momentum)} · Returns {r0(c.pillars.returns)} · Track record{" "}
          {r0(c.pillars.track_record)}
        </div>
      )}

      <details onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && onOpen()}>
        <summary>Our analysis</summary>
        {!pro ? locked : pending ?? (loaded && <div className="bot">{<Blocks blocks={loaded.analysis} onAsk={() => {}} showFollowups={false} />}</div>)}
      </details>
      <details onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && onOpen()}>
        <summary>Sector & portfolio allocation</summary>
        {!pro ? locked : pending ?? (loaded && <Allocation a={loaded.allocation} />)}
      </details>
      <details onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && onOpen()}>
        <summary>Fund details</summary>
        {!pro
          ? locked
          : pending ??
            (loaded && (
              <dl className="kv">
                {loaded.details.map((d, k) => (
                  <span key={k} style={{ display: "contents" }}>
                    <dt>{d.label}</dt>
                    <dd>{d.value}</dd>
                  </span>
                ))}
              </dl>
            ))}
      </details>

      <div className="followups">
        <button className="pill" onClick={onAsk}>
          Ask about this fund
        </button>
      </div>
    </article>
  );
}

function AllocTable({ title, rows }: { title: string; rows: AllocRow[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="alloc">
      <b>{title}</b>
      {rows.map((r, k) => (
        <div className="alloc-row" key={k}>
          <span>{r.label}</span>
          <div className="bar-track solo">
            <i className="fund" style={{ left: 0, width: `${(r.pct / max) * 100}%` }} />
          </div>
          <span className="num">{r.pct.toFixed(1)}%</span>
          <span className={`num ${r.change === null ? "" : r.change > 0 ? "up" : r.change < 0 ? "down" : ""}`}>
            {r.change === null ? "" : `${r.change > 0 ? "+" : ""}${r.change.toFixed(1)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function Allocation({ a }: { a: FundDetail["allocation"] }) {
  if (!a.sectors.length && !a.asset_class.length && !a.rating.length) return <p className="sub">No portfolio disclosure available.</p>;
  return (
    <div className="alloc-wrap">
      {a.period && <p className="sub">Share of portfolio · change in points ({a.period})</p>}
      <AllocTable title="Sectors" rows={a.sectors} />
      <AllocTable title="Asset class" rows={a.asset_class} />
      <AllocTable title="Credit rating" rows={a.rating} />
    </div>
  );
}
