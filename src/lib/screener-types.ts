// Screener types shared by the API (server) and the screener page (browser).
import type { Block } from "@/lib/types";

export type ScreenerCard = {
  code: string;
  name: string;
  category: string;
  type: string;
  aum_cr: number | null;
  age_years: number | null;
  // free data points
  score: number | null;
  ret_1y: number | null;
  batting: { beat: number; of: number } | null;
  // paid-only (absent for free users)
  pillars?: Record<"resilience" | "consistency" | "momentum" | "returns" | "track_record", number | null>;
  ret_3m?: number | null;
  ret_6m?: number | null;
  momentum?: { rank: number; of: number; climbed_6m: number | null } | null;
  recovery_months?: number | null;
  category_recovery_months?: number | null;
  covid_fall_pct?: number | null;
  sip_3y_gain_pct?: number | null;
};

export type ScreenerResult = {
  total: number;
  shown: number;
  page: number;
  has_more: boolean;
  locked: boolean; // true = free plan: rows and fields are cut down
  cards: ScreenerCard[];
  facets: { code: string; name: string; kind: string; count: number }[];
};

export type AllocRow = { label: string; pct: number; change: number | null };
export type FundDetail = {
  code: string;
  analysis: Block[];
  allocation: { period: string | null; sectors: AllocRow[]; asset_class: AllocRow[]; rating: AllocRow[]; top_holdings: AllocRow[] };
  details: { label: string; value: string }[];
};
