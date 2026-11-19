"use client";

import { Fragment } from "react";
import type { Block, Fact, FundRow } from "@/lib/types";
import { Delta, PillarBars, Score, ScoreRing, cr, pct, r0 } from "./ui";

// **bold** only; everything else is plain text.
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

// Stat tiles: label on top, value below, optional hint.
function Tiles({ facts }: { facts: Fact[] }) {
  return (
    <div className="tiles">
      {facts.map((f, k) => (
        <div className="tile" key={k}>
          <span className="tile-l">{f.label}</span>
          <span className="tile-v">{f.value}</span>
          {f.hint && <span className="tile-h">{f.hint}</span>}
        </div>
      ))}
    </div>
  );
}

// Fund vs category median, drawn as bars around a zero line (handles negative returns).
function Bars({ block }: { block: Extract<Block, { type: "bars" }> }) {
  const vals = block.rows.flatMap((r) => [r.value, r.ref]).filter((v): v is number => v !== null);
  const max = Math.max(1, ...vals.map(Math.abs));
  const bar = (v: number | null, cls: string) => {
    if (v === null) return <div className="bar-track" />;
    const w = (Math.abs(v) / max) * 50;
    return (
      <div className="bar-track">
        <i className={`${cls} ${v < 0 ? "neg" : ""}`} style={v >= 0 ? { left: "50%", width: `${w}%` } : { left: `${50 - w}%`, width: `${w}%` }} />
      </div>
    );
  };
  return (
    <div className="panel bars">
      <div className="bars-head">
        <b>{block.title}</b>
        <span className="legend">
          <i className="sw fund" /> {block.series[0]} <i className="sw ref" /> {block.series[1]}
        </span>
      </div>
      {block.rows.map((r, k) => (
        <div className="bars-row" key={k}>
          <span className="bars-label">{r.label}</span>
          <div className="bars-pair">
            {bar(r.value, "fund")}
            {bar(r.ref, "ref")}
          </div>
          <span className="bars-val">
            <Delta value={r.value} />
            <small> vs {pct(r.ref)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function FundList({ rows, onAsk }: { rows: FundRow[]; onAsk: (q: string) => void }) {
  return (
    <div className="panel fund-list">
      <div className="fl-head">
        <span>Fund</span>
        <span className="hide-sm">Pillars (0–100 vs category)</span>
        <span className="num">1Y</span>
        <span className="num hide-sm">AUM</span>
        <span className="num">Score</span>
      </div>
      {rows.map((f, i) => (
        <div className="fl-row" key={f.code}>
          <div className="fl-name">
            <span className="rank">{i + 1}</span>
            <div>
              <button className="link" onClick={() => onAsk(`Tell me about ${f.name}`)}>
                {f.name}
              </button>
              <div className="sub">{f.group}</div>
            </div>
          </div>
          <div className="hide-sm">
            <PillarBars pillars={f.pillars} compact />
          </div>
          <div className="num">
            <Delta value={f.ret_1y} />
          </div>
          <div className="num hide-sm sub">{cr(f.aum_cr)}</div>
          <div className="num">
            <Score value={f.score} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Blocks({ blocks, onAsk, showFollowups }: { blocks: Block[]; onAsk: (q: string) => void; showFollowups: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "text":
            return (
              <p key={i}>
                <Rich text={b.text} />
              </p>
            );
          case "note":
            return (
              <p key={i} className="note">
                {b.text}
              </p>
            );
          case "fund_table":
            return <FundList key={i} rows={b.rows} onAsk={onAsk} />;
          case "facts":
            return <Tiles key={i} facts={b.facts} />;
          case "heading":
            return (
              <h4 key={i} className="section">
                {b.text}
              </h4>
            );
          case "bullets":
            return (
              <ul key={i} className="analysis">
                {b.items.map((t, k) => (
                  <li key={k}>
                    <Rich text={t} />
                  </li>
                ))}
              </ul>
            );
          case "verdict":
            return (
              <div key={i} className={`verdict ${b.tone}`}>
                <span className="v-icon" aria-hidden>
                  {b.tone === "good" ? "▲" : b.tone === "weak" ? "▼" : "●"}
                </span>
                <div>
                  <b>{b.label}</b>
                  <div>
                    <Rich text={b.text} />
                  </div>
                </div>
              </div>
            );
          case "bars":
            return <Bars key={i} block={b} />;
          case "fund_card":
            return (
              <div key={i} className="panel fund-head">
                <div className="fh-top">
                  <div>
                    <h3>{b.fund.name}</h3>
                    <div className="chips">
                      <span className="chip">{b.fund.group}</span>
                      {b.fund.aum_cr !== null && <span className="chip">{cr(b.fund.aum_cr)}</span>}
                      {b.fund.age_years !== null && <span className="chip">{b.fund.age_years.toFixed(1)} yrs</span>}
                    </div>
                  </div>
                  <ScoreRing value={b.fund.score} />
                </div>
                <PillarBars pillars={b.fund.pillars} />
                <Tiles facts={b.facts} />
                {b.strengths.length > 0 && (
                  <ul className="marks good">
                    {b.strengths.map((s, k) => (
                      <li key={k}>{s}</li>
                    ))}
                  </ul>
                )}
                {b.watch.length > 0 && (
                  <div>
                    <div className="mini-title">Watch out</div>
                    <ul className="marks warn">
                      {b.watch.map((s, k) => (
                        <li key={k}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {b.more.length > 0 && (
                  <details className="more">
                    <summary>More details</summary>
                    <Tiles facts={b.more} />
                  </details>
                )}
              </div>
            );
          case "compare":
            return (
              <div key={i} className="panel table-wrap">
                <table className="cmp">
                  <thead>
                    <tr>
                      <th></th>
                      {b.funds.map((f, k) => (
                        <th key={k} className="num">
                          <div className="cmp-name">{f.name}</div>
                          <Score value={f.score} size="sm" />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, k) => (
                      <tr key={k}>
                        <td>{r.label}</td>
                        {r.values.map((v, j) => (
                          <td key={j} className={`num${r.best === j ? " best" : ""}`}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "sector_shifts": {
            const max = Math.max(0.01, ...[...b.up, ...b.down].map((r) => Math.abs(r.change_pp)));
            const row = (r: (typeof b.up)[number], k: number, cls: "pos" | "neg") => (
              <div className="shift" key={k} title={`${r.funds_adding} funds adding, ${r.funds_cutting} cutting · now ${r.share_now}% of holdings`}>
                <span>{r.sector}</span>
                <div className="shift-track">
                  <i className={cls} style={{ width: `${(Math.abs(r.change_pp) / max) * 100}%` }} />
                </div>
                <span className={`num ${cls}`}>
                  {r.change_pp > 0 ? "+" : ""}
                  {r.change_pp.toFixed(2)}
                </span>
              </div>
            );
            return (
              <div key={i} className="panel cols">
                <div>
                  <div className="mini-title">Adding (pts of holdings)</div>
                  {b.up.map((r, k) => row(r, k, "pos"))}
                </div>
                <div>
                  <div className="mini-title">Cutting</div>
                  {b.down.map((r, k) => row(r, k, "neg"))}
                </div>
              </div>
            );
          }
          case "choices":
            // a question back to the user always shows its options; plain follow-ups only under the latest answer
            if (!b.text && !showFollowups) return null;
            return (
              <div key={i}>
                {b.text && <p style={{ marginBottom: 10 }}>{b.text}</p>}
                <div className="followups">
                  {b.options.slice(0, b.text ? 6 : 3).map((o, k) => (
                    <button key={k} className="pill" onClick={() => onAsk(o)}>
                      {o} <span aria-hidden>↗</span>
                    </button>
                  ))}
                </div>
              </div>
            );
        }
      })}
    </>
  );
}

