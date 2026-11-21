"use client";

import type { FundDetailView } from "@/lib/types";
import { PillarBars, ScoreRing, cr } from "./ui";

// Rich fund view, modelled on the GoChanakya app: one section per question a first-time investor asks,
// each with a plain-English label, a badge, one big number and a simple picture.

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const signedPct = (v: number | null, d = 1) => (v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
const months = (m: number) => (m < 1 ? "under a month" : `${Math.round(m)} month${Math.round(m) === 1 ? "" : "s"}`);

function Section({ title, badge, tone, children }: { title: string; badge?: string; tone?: "good" | "bad" | "mid" | "accent"; children: React.ReactNode }) {
  return (
    <section className="fd-sec">
      <div className="fd-sec-head">
        <h4>{title}</h4>
        {badge && <span className={`fd-badge ${tone ?? ""}`}>{badge}</span>}
      </div>
      {children}
    </section>
  );
}

function Bold({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}
    </>
  );
}

function RankChart({ points }: { points: { label: string; rank: number; now?: boolean }[] }) {
  const W = 600;
  const H = 120;
  const ranks = points.map((p) => p.rank);
  const lo = Math.min(...ranks);
  const hi = Math.max(...ranks);
  const span = Math.max(hi - lo, 2);
  const x = (i: number) => ((i + 0.5) / points.length) * W; // centre of each label column below
  const y = (r: number) => 22 + ((r - lo) / span) * (H - 44); // rank 1 at the top
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(" ");
  return (
    <div className="fd-chart">
      <div className="fd-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Rank over the last months">
          <line x1="0" x2={W} y1={H * 0.33} y2={H * 0.33} className="grid" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2={W} y1={H * 0.7} y2={H * 0.7} className="grid" vectorEffect="non-scaling-stroke" />
          <path d={path} className="line" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* dots as HTML so they stay round when the chart stretches */}
        {points.map((p, i) => (
          <i key={i} className={`dot${p.now ? " now" : ""}`} style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.rank) / H) * 100}%` }} aria-hidden />
        ))}
      </div>
      <div className="fd-chart-labels" style={{ gridTemplateColumns: `repeat(${points.length}, 1fr)` }}>
        {points.map((p, i) => (
          <span key={i} className={p.now ? "now" : ""}>
            <b>#{p.rank}</b>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FundDetail({ d, onAsk, embedded = false }: { d: FundDetailView; onAsk: (q: string) => void; embedded?: boolean }) {
  const f = d.fund;
  const vTone = d.verdict.tone === "good" ? "good" : d.verdict.tone === "weak" ? "bad" : "mid";
  const fit = d.verdict.tone === "good" ? "Strong" : d.verdict.tone === "weak" ? "Weak" : f.score === null ? "Not scored" : "Fair";
  return (
    <div className={`fd${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <header className="fd-head">
          <div>
            <h3>{f.name}</h3>
            <div className="chips">
              <span className="chip">{f.group}</span>
              {f.aum_cr !== null && <span className="chip">{cr(f.aum_cr)}</span>}
              {f.age_years !== null && <span className="chip">{f.age_years.toFixed(1)} yrs old</span>}
              {d.kind && <span className="chip">{d.kind === "Passive" ? "Index / passive" : "Actively managed"}</span>}
            </div>
          </div>
          <ScoreRing value={f.score} label="Our score" />
        </header>
      )}

      <div className={`fd-verdict ${vTone}`}>
        <b>{d.verdict.label}</b>
        <p>
          <Bold text={d.verdict.text} />
        </p>
      </div>

      {!embedded && f.score !== null && (
        <Section title="Score breakdown">
          <PillarBars pillars={f.pillars} />
          <p className="fd-foot">Each part is scored 0–100 against {d.peers_n} similar funds. 50 is the middle of the group.</p>
        </Section>
      )}

      {(d.standout.good.length > 0 || d.standout.watch.length > 0) && (
        <Section title="Why it stands out" badge={`${fit} fit`} tone="accent">
          <p className="fd-lead">Compared with similar {f.group} funds on returns, consistency, momentum and recovery history.</p>
          {d.standout.good.length > 0 && (
            <ul className="fd-points good">
              {d.standout.good.map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ul>
          )}
          {d.standout.watch.length > 0 && (
            <>
              <div className="fd-sub">Worth watching</div>
              <ul className="fd-points watch">
                {d.standout.watch.map((s, k) => (
                  <li key={k}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {d.returns.length > 0 && (
        <Section title="Returns vs similar funds">
          <div className="fd-returns">
            <span className="h" />
            <span className="h num">This fund</span>
            <span className="h num">Similar funds</span>
            <span className="h num">Difference</span>
            {d.returns.map((r) => {
              const diff = r.fund !== null && r.cat !== null ? r.fund - r.cat : null;
              return (
                <div className="row" key={r.label}>
                  <span>{r.label}</span>
                  <span className={`num ${r.fund !== null && r.fund < 0 ? "neg" : ""}`}>{signedPct(r.fund)}</span>
                  <span className="num muted">{signedPct(r.cat)}</span>
                  <span className={`num ${diff === null ? "" : diff >= 0 ? "pos" : "neg"}`}>{diff === null ? "–" : `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} pts`}</span>
                </div>
              );
            })}
          </div>
          <p className="fd-foot">Similar funds = the median of its category (1 month: category average).</p>
        </Section>
      )}

      {d.consistency && (
        <Section
          title="Consistency"
          badge={d.consistency.badge}
          tone={d.consistency.badge === "Very consistent" || d.consistency.badge === "Fairly consistent" ? "good" : d.consistency.badge === "Mixed" ? "mid" : "bad"}
        >
          <div className="fd-big">
            <span className="fd-num">
              {d.consistency.beat}
              <small>/{d.consistency.of}</small>
            </span>
            <span>months it did better than similar funds</span>
          </div>
          <div className="fd-pills" style={{ gridTemplateColumns: `repeat(${d.consistency.months.length}, 1fr)` }}>
            {d.consistency.months.map((m, k) => (
              <i key={k} className={m.beat ? "on" : ""} title={`${m.label}: ${m.beat ? "beat similar funds" : "fell behind"}`} />
            ))}
          </div>
          <div className="fd-range">
            <span>{d.consistency.months[0].label}</span>
            <span>{d.consistency.months[d.consistency.months.length - 1].label}</span>
          </div>
          <div className="fd-legend">
            <span>
              <i className="on" /> Beat similar funds
            </span>
            <span>
              <i /> Fell behind
            </span>
          </div>
        </Section>
      )}

      {d.sip && (
        <Section title="If you had started a SIP">
          <p className="fd-lead">
            Investing <b>{inr(d.sip.monthly)} every month for the last 3 years</b> in this fund would look like this today:
          </p>
          <div className="fd-sipbar" aria-hidden>
            <i className="inv" style={{ flex: Math.min(d.sip.invested, d.sip.value) }} />
            {d.sip.gain !== 0 && <i className={d.sip.gain > 0 ? "gain" : "loss"} style={{ flex: Math.max(Math.abs(d.sip.gain), d.sip.invested * 0.012) }} />}
          </div>
          <div className="fd-kv">
            <span>
              <i className="sw inv" /> You would have invested
            </span>
            <b>{inr(d.sip.invested)}</b>
          </div>
          <div className="fd-kv">
            <span>
              <i className={`sw ${d.sip.gain >= 0 ? "gain" : "loss"}`} /> {d.sip.gain >= 0 ? "Gain" : "Loss"}
            </span>
            <b className={d.sip.gain >= 0 ? "pos" : "neg"}>
              {d.sip.gain >= 0 ? "+" : "−"}
              {inr(Math.abs(d.sip.gain))} <small>{signedPct(d.sip.gain_pct)}</small>
            </b>
          </div>
          <div className="fd-total">
            <span>Value today</span>
            <b>{inr(d.sip.value)}</b>
          </div>
          <p className="fd-foot">
            Started {d.sip.started} · {d.sip.instalments} monthly instalments
            {d.sip.cat_gain_pct !== null ? ` · similar funds (median) ${signedPct(d.sip.cat_gain_pct)}` : ""}
          </p>
        </Section>
      )}

      {d.rank && (
        <Section title="Rank among similar funds" badge={d.rank.badge} tone={d.rank.badge === "Moving up" ? "good" : d.rank.badge === "Slipping" ? "bad" : "mid"}>
          <div className="fd-big">
            <span className="fd-num">
              #{d.rank.now}
              <small> of {d.rank.of}</small>
            </span>
            {d.rank.change_3m !== null && (
              <span className={d.rank.change_3m > 0 ? "pos" : d.rank.change_3m < 0 ? "neg" : ""}>
                {d.rank.change_3m > 0
                  ? `Up from #${d.rank.now + d.rank.change_3m} 3 months ago`
                  : d.rank.change_3m < 0
                    ? `Down from #${d.rank.now + d.rank.change_3m} 3 months ago`
                    : "Same as 3 months ago"}
              </span>
            )}
          </div>
          {d.rank.history.length >= 2 && <RankChart points={[...d.rank.history, { label: "Now", rank: d.rank.now, now: true }]} />}
          <p className="fd-foot">Ranked by 6-month returns among similar funds. #1 is the best, so higher on the chart means a better rank. Past months are month-end ranks.</p>
        </Section>
      )}

      {d.recovery && (
        <Section title="Recovery after market falls">
          <p className="fd-strong">{d.recovery.summary}</p>
          {d.recovery.months !== null && d.recovery.cat_months !== null && (
            <div className="fd-inset">
              <div className="fd-sub">Typical time to recover</div>
              {(
                [
                  ["This fund", d.recovery.months, "fund"],
                  ["Similar funds", d.recovery.cat_months, "cat"],
                ] as const
              ).map(([label, v, cls]) => (
                <div className="fd-rec" key={label}>
                  <span>{label}</span>
                  <div className="fd-track">
                    <i className={cls} style={{ width: `${(v / Math.max(d.recovery!.months!, d.recovery!.cat_months!, 0.1)) * 100}%` }} />
                  </div>
                  <b className={cls === "fund" ? "acc" : ""}>~{v < 1 ? "<1" : Math.round(v)} mo</b>
                </div>
              ))}
              <div className="fd-foot">Shorter is better</div>
            </div>
          )}
          <div className="fd-sub">How it handled {d.recovery.crashes.length} past market crashes</div>
          <div className="fd-crashes">
            {d.recovery.crashes.map((c) => (
              <div className="fd-crash" key={c.name}>
                <div>
                  <b>{c.name}</b>
                  <span>{c.dates}</span>
                </div>
                <div className="r">
                  {c.status === "launched_after" ? (
                    <span className="muted">Fund launched after this event</span>
                  ) : c.fall === null ? (
                    <span className="muted">No data</span>
                  ) : (
                    <>
                      <span className="neg">Fell {c.fall.toFixed(1)}%</span>
                      {c.recovered_months !== null ? (
                        <span className="pos">Recovered in {months(c.recovered_months)}</span>
                      ) : (
                        <span className="muted">{c.status === "not_recovered" ? "Not fully recovered yet" : "Recovery time not available"}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.better_peers.length > 0 && (
        <Section title="Higher-scoring similar funds">
          <div className="fd-peers">
            {d.better_peers.map((p) => (
              <button key={p.name} className="fd-peer" onClick={() => onAsk(`Tell me about ${p.name}`)}>
                <span>{p.name}</span>
                <b>{p.score}</b>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
