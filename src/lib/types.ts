// Shared between API and UI.
import type { Intent } from "@/lib/intent/schema";

export type PillarScores = {
  resilience: number | null;
  consistency: number | null;
  momentum: number | null;
  returns: number | null;
  track_record: number | null;
};

export type FundRow = {
  code: string;
  name: string;
  group: string;
  score: number | null;
  pillars: PillarScores;
  ret_1y: number | null;
  aum_cr: number | null;
  age_years: number | null;
};

export type Fact = { label: string; value: string; hint?: string };

export type Block =
  | { type: "text"; text: string }
  | { type: "fund_table"; title: string; rows: FundRow[] }
  | { type: "fund_card"; fund: FundRow; facts: Fact[]; more: Fact[]; strengths: string[]; watch: string[] }
  | { type: "facts"; facts: Fact[] }
  | { type: "heading"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "verdict"; tone: "good" | "neutral" | "weak"; label: string; text: string }
  // fund value vs category median, e.g. returns over 3m/6m/1y
  | { type: "bars"; title: string; unit: "%"; series: [string, string]; rows: { label: string; value: number | null; ref: number | null }[] }
  | { type: "compare"; funds: FundRow[]; rows: { label: string; values: string[]; best?: number }[] }
  // sector overlap of two funds: per sector, the common part (min) is shaded, the rest belongs to the bigger side
  | { type: "overlap"; a: string; b: string; overlap_pct: number; rows: { label: string; a: number; b: number }[]; period: string | null }
  | { type: "sector_shifts"; title: string; period: string; up: ShiftRow[]; down: ShiftRow[] }
  | { type: "choices"; text: string; options: string[] }
  | { type: "note"; text: string };

export type ShiftRow = { sector: string; share_now: number; change_pp: number; funds_adding: number; funds_cutting: number };

// Conversation state kept in the browser and sent back with each message.
export type ChatContext = {
  last_intent?: Intent | null;
  last_results?: string[]; // scheme codes shown last, in order
  history?: string[]; // last few user messages
};

export type ChatResponse = {
  blocks: Block[];
  context: ChatContext;
  meta: { route: "rules" | "llm" | "fallback"; intent: string; as_of: string | null; plan: "free" | "pro"; usage: { used: number; limit: number } };
};
