"use client";

// Small shared UI pieces for chat and screener.

export const r0 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : String(Math.round(v)));
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
export const cr = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `₹${v.toLocaleString("en-IN")} Cr`);

export type Tone = "good" | "mid" | "weak" | "none";
export const scoreTone = (v: number | null | undefined): Tone => (v === null || v === undefined ? "none" : v >= 65 ? "good" : v >= 45 ? "mid" : "weak");
export const toneWord: Record<Tone, string> = { good: "strong", mid: "average", weak: "weak", none: "not scored" };

// Coloured score number with an accessible label (colour is never the only signal).
export function Score({ value, size = "md" }: { value: number | null | undefined; size?: "sm" | "md" }) {
  const t = scoreTone(value);
  return (
    <span className={`score-badge ${t} ${size}`} title={`Score ${r0(value)} (${toneWord[t]}) vs category`}>
      {r0(value)}
    </span>
  );
}

// Ring showing a 0-100 score.
export function ScoreRing({ value, label = "score", size = 64 }: { value: number | null | undefined; label?: string; size?: number }) {
  const t = scoreTone(value);
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={`ring ${t}`} style={{ width: size, height: size }} title={`${label} ${r0(value)} (${toneWord[t]})`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-val" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-text">
        <b>{r0(value)}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

const PILLAR_LABELS: [string, string][] = [
  ["resilience", "Resilience"],
  ["consistency", "Consistency"],
  ["momentum", "Momentum"],
  ["returns", "Returns"],
  ["track_record", "Track record"],
];

// Five small bars, one per pillar (0-100 vs category).
export function PillarBars({ pillars, compact = false }: { pillars: Record<string, number | null>; compact?: boolean }) {
  return (
    <div className={`pillar-bars${compact ? " compact" : ""}`}>
      {PILLAR_LABELS.map(([k, label]) => {
        const v = pillars[k];
        return (
          <div className="pb" key={k} title={`${label}: ${r0(v)} / 100 vs category`}>
            <div className="pb-head">
              <span>{compact ? label.split(" ")[0].slice(0, 5) : label}</span>
              <b>{r0(v)}</b>
            </div>
            <div className="pb-track">
              <i className={scoreTone(v)} style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Delta({ value, suffix = "%" }: { value: number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined) return <span className="muted-num">–</span>;
  return (
    <span className={value > 0 ? "pos" : value < 0 ? "neg" : ""}>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

// 12 dots: months the fund beat its category (batting average).
export function BattingDots({ beat, of }: { beat: number; of: number }) {
  return (
    <span className="dots12" title={`Beat its category in ${beat} of ${of} months`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < beat ? "on" : ""} />
      ))}
    </span>
  );
}

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17l5-5 4 4 7-8" />
        <path d="M15 8h5v5" />
      </svg>
    </span>
  );
}
