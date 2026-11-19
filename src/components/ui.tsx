"use client";

// Small shared UI pieces for chat and screener.

export const r0 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : String(Math.round(v)));
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
export const cr = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `₹${v.toLocaleString("en-IN")} Cr`);

export type Tone = "good" | "mid" | "weak" | "none";
export const scoreTone = (v: number | null | undefined): Tone => (v === null || v === undefined ? "none" : v >= 65 ? "good" : v >= 45 ? "mid" : "weak");
export const toneWord: Record<Tone, string> = { good: "strong", mid: "average", weak: "weak", none: "not scored" };

// Inline score: number + small tone marker (colour is never the only signal; the title says it in words).
export function Score({ value, size = "md" }: { value: number | null | undefined; size?: "sm" | "md" }) {
  const t = scoreTone(value);
  return (
    <span className={`score ${t} ${size}`} title={`Score ${r0(value)} of 100 (${toneWord[t]}) vs category`}>
      <i aria-hidden />
      {r0(value)}
    </span>
  );
}

// Big editorial score figure with a thin progress rule under it.
export function ScoreRing({ value, label = "Score" }: { value: number | null | undefined; label?: string; size?: number }) {
  const t = scoreTone(value);
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={`figure ${t}`} title={`${label} ${r0(value)} of 100 (${toneWord[t]}) vs category`}>
      <span className="figure-label">{label}</span>
      <span className="figure-num">
        {r0(value)}
        <small>/100</small>
      </span>
      <span className="figure-rule" aria-hidden>
        <i style={{ width: `${v}%` }} />
      </span>
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

// Five thin rules, one per pillar (0-100 vs category).
export function PillarBars({ pillars, compact = false }: { pillars: Record<string, number | null>; compact?: boolean }) {
  return (
    <div className={`pillars${compact ? " compact" : ""}`}>
      {PILLAR_LABELS.map(([k, label]) => {
        const v = pillars[k];
        return (
          <div className="pillar" key={k} title={`${label}: ${r0(v)} of 100 vs category`}>
            <div className="pillar-head">
              <span>{compact ? label.slice(0, 3) : label}</span>
              <b>{r0(v)}</b>
            </div>
            <div className="pillar-track">
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
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}

// 12 ticks: months the fund beat its category (batting average).
export function BattingDots({ beat, of }: { beat: number; of: number }) {
  return (
    <span className="ticks" title={`Beat its category in ${beat} of ${of} months`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < beat ? "on" : ""} />
      ))}
    </span>
  );
}

// Typographic mark: "g" set in Syne on the accent.
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <span className="mark" style={{ width: size, height: size, fontSize: size * 0.72 }} aria-hidden>
      g
    </span>
  );
}

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
