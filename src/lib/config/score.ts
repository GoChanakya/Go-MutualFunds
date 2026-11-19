// GoChanakya 5-pillar score.
// Every pillar is a 0-100 percentile WITHIN the fund's peer group (small caps vs small caps, etc.).
// The overall score is a weighted average of the pillars a fund has data for (needs at least MIN_PILLARS).
// Weights are the business decision - tune them here.

export const PILLARS = ["resilience", "consistency", "momentum", "returns", "track_record"] as const;
export type Pillar = (typeof PILLARS)[number];

export const PILLAR_LABEL: Record<Pillar, string> = {
  resilience: "Resilience",
  consistency: "Consistency",
  momentum: "Momentum",
  returns: "Returns",
  track_record: "Track record",
};

// How each pillar is built from backend_main_kartik data (documentation for humans; SQL in data/store.ts).
export const PILLAR_SOURCE: Record<Pillar, string> = {
  resilience: "resilience_score (recovery_speed); falls back to typical recovery months after market falls",
  consistency: "batting average: months the fund beat its category average / months measured",
  momentum: "current rank in its peer group by 6-month return (rank_momentum)",
  returns: "1-year return and 3-year SIP return",
  track_record: "fund size (AUM) and fund age",
};

export const LENSES = ["balanced", "safety", "growth"] as const;
export type Lens = (typeof LENSES)[number];

export const LENS_WEIGHTS: Record<Lens, Record<Pillar, number>> = {
  balanced: { resilience: 20, consistency: 20, momentum: 20, returns: 20, track_record: 20 },
  safety: { resilience: 35, consistency: 30, momentum: 5, returns: 10, track_record: 20 },
  growth: { resilience: 10, consistency: 20, momentum: 30, returns: 35, track_record: 5 },
};

export const LENS_LABEL: Record<Lens, string> = {
  balanced: "balanced view",
  safety: "safety-first view",
  growth: "growth-first view",
};

// A fund gets a score only with enough history: young funds with 2-3 pillars would otherwise float to the top.
export const MIN_PILLARS = 4;
export const MIN_AGE_YEARS = 3;
export const MIN_PEERS = 3; // smaller peer groups get no percentile
export const MAX_ROWS = 10; // anti-scraping row cap per answer
