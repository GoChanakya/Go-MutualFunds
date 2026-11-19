// Freemium plans. Limits are enforced on the server; the UI only displays them.

export type PlanId = "free" | "pro";

export type Plan = {
  id: PlanId;
  chatPerDay: number;
  screenerPerDay: number;
  chatRankRows: number; // max funds in a chat ranking
  screenerRows: number; // results returned per screener search (free: only the top N, no paging)
  screenerPaging: boolean;
  fullData: boolean; // all data points, sector allocation, analysis, fund details
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", chatPerDay: 10, screenerPerDay: 30, chatRankRows: 3, screenerRows: 3, screenerPaging: false, fullData: false },
  pro: { id: "pro", chatPerDay: 200, screenerPerDay: 500, chatRankRows: 10, screenerRows: 20, screenerPaging: true, fullData: true },
};

// Data points a free user sees on a screener card (besides name, category, type, AUM, age):
// 1Y return (easy to verify -> trust), batting average (our metric, easy to grasp), overall score (the hook).
export const FREE_FIELDS = ["score", "ret_1y", "batting"] as const;

// Abuse guard while phone numbers are unverified: one person could type many numbers.
export const NEW_USERS_PER_IP_PER_DAY = Number(process.env.NEW_USERS_PER_IP_PER_DAY ?? 5);
export const REQUESTS_PER_IP_PER_DAY = Number(process.env.REQUESTS_PER_IP_PER_DAY ?? 300);
