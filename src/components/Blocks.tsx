"use client";

import { Fragment } from "react";
import type { Block, Fact, FundRow, PillarScores } from "@/lib/types";

const PILLARS: { key: keyof PillarScores; label: string }[] = [
  { key: "resilience", label: "Resilience" },
  { key: "consistency", label: "Consistency" },
  { key: "momentum", label: "Momentum" },
  { key: "returns", label: "Returns" },
  { key: "track_record", label: "Track record" },
];

const r0 = (v: number | null) => (v === null ? "–" : String(Math.round(v)));
const pct = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

// **bold** only; everything else is plain text.
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function KV({ facts }: { facts: Fact[] }) {
  return (
    <dl className="kv">
      {facts.map((f, k) => (
        <Fragment key={k}>
          <dt>{f.label}</dt>
          <dd>
            {f.value}
            {f.hint && <small> · {f.hint}</small>}
          </dd>
        </Fragment>
      ))}
    </dl>
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
        <i className={cls} style={v >= 0 ? { left: "50%", width: `${w}%` } : { left: `${50 - w}%`, width: `${w}%` }} />
      </div>
    );
  };
  return (
    <div className="bars">
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
            {pct(r.value)}
            <small> vs {pct(r.ref)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function FundTable({ rows, onAsk }: { rows: FundRow[]; onAsk: (q: string) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fund</th>
            <th className="num">Score</th>
            <th className="num hide-sm">1Y return</th>
            <th className="num hide-sm">AUM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => (
            <tr key={f.code}>
              <td>
                {i + 1}.{" "}
                <button className="link" onClick={() => onAsk(`Tell me about ${f.name}`)}>
                  {f.name}
                </button>
                <div className="sub">{PILLARS.map((p) => `${p.label} ${r0(f.pillars[p.key])}`).join(" · ")}</div>
              </td>
              <td className="num">
                <b>{r0(f.score)}</b>
              </td>
              <td className="num hide-sm">{pct(f.ret_1y)}</td>
              <td className="num hide-sm">{f.aum_cr === null ? "–" : `₹${f.aum_cr.toLocaleString("en-IN")} Cr`}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
              <p key={i} className="muted">
                {b.text}
              </p>
            );
          case "fund_table":
            return <FundTable key={i} rows={b.rows} onAsk={onAsk} />;
          case "facts":
            return <KV key={i} facts={b.facts} />;
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
                <b>{b.label}.</b> <Rich text={b.text} />
              </div>
            );
          case "bars":
            return <Bars key={i} block={b} />;
          case "fund_card":
            return (
              <Fragment key={i}>
                <div>
                  <h3>{b.fund.name}</h3>
                  <div className="sub">
                    {b.fund.group} · Score <b>{r0(b.fund.score)}</b>/100 vs category
                  </div>
                </div>
                <KV facts={[...PILLARS.map((p) => ({ label: p.label, value: r0(b.fund.pillars[p.key]) })), ...b.facts]} />
                {b.strengths.length > 0 && (
                  <div>
                    <b>Strengths</b>
                    <ul>{b.strengths.map((s, k) => <li key={k}>{s}</li>)}</ul>
                  </div>
                )}
                {b.watch.length > 0 && (
                  <div>
                    <b>Watch out</b>
                    <ul>{b.watch.map((s, k) => <li key={k}>{s}</li>)}</ul>
                  </div>
                )}
                {b.more.length > 0 && (
                  <details>
                    <summary>More details</summary>
                    <KV facts={b.more} />
                  </details>
                )}
              </Fragment>
            );
          case "compare":
            return (
              <div key={i} className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      {b.funds.map((f, k) => (
                        <th key={k} className="num">
                          {f.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, k) => (
                      <tr key={k}>
                        <td>{r.label}</td>
                        {r.values.map((v, k) => (
                          <td key={k} className={`num${r.best === k ? " best" : ""}`}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "sector_shifts":
            return (
              <div key={i} className="cols">
                <div>
                  <b>Adding</b>
                  <table>
                    <tbody>
                      {b.up.map((r, k) => (
                        <tr key={k}>
                          <td>{r.sector}</td>
                          <td className="num up">+{r.change_pp.toFixed(2)} pts</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <b>Cutting</b>
                  <table>
                    <tbody>
                      {b.down.map((r, k) => (
                        <tr key={k}>
                          <td>{r.sector}</td>
                          <td className="num down">{r.change_pp.toFixed(2)} pts</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          case "choices":
            // a question back to the user always shows its options; plain follow-ups only under the latest answer
            if (!b.text && !showFollowups) return null;
            return (
              <div key={i}>
                {b.text && <p style={{ marginBottom: 10 }}>{b.text}</p>}
                <div className="followups">
                  {b.options.slice(0, b.text ? 6 : 3).map((o, k) => (
                    <button key={k} className="pill" onClick={() => onAsk(o)}>
                      {o}
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
