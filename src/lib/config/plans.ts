// Freemium plans. Limits are enforced on the server; the UI never shows the counts.
//
//   Visitor (no login)  -> up to TRIAL_QUESTIONS chat questions in total (per browser), capped per network per day
//   Signed in (free)    -> the SAME total of TRIAL_QUESTIONS; the visitor's count carries over at sign-up
//   Pro (₹400/month)    -> chatPerDay questions a day, all data

export type PlanId = "free" | "pro";

export type Plan = {
  id: PlanId;
  chatPerDay: number; // Pro only; free users have the lifetime trial below
  screenerPerDay: number;
  chatRankRows: number; // max funds in a chat ranking
  screenerRows: number; // results returned per screener search (free: only the top N, no paging)
  screenerPaging: boolean;
  fullData: boolean; // all data points, sector allocation, analysis, fund details
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", chatPerDay: 0, screenerPerDay: 30, chatRankRows: 3, screenerRows: 3, screenerPaging: false, fullData: false },
  pro: { id: "pro", chatPerDay: 200, screenerPerDay: 500, chatRankRows: 10, screenerRows: 20, screenerPaging: true, fullData: true },
};

export const PRO_PRICE_INR = 400;

// Free chat questions in total (lifetime) per browser, and per verified number after sign-up.
export const TRIAL_QUESTIONS = Number(process.env.TRIAL_QUESTIONS ?? 10);

// Visitors without a login, per network (IP) per day, across all browsers. Kept per DAY: Indian mobile networks
// share IPs between many users, so a lifetime cap would eventually block everyone on that address.
export const ANON_QUESTIONS_PER_IP_PER_DAY = Number(process.env.ANON_QUESTIONS_PER_IP_PER_DAY ?? 20);

// Data points a free user sees on a screener card (besides name, category, type, AUM, age):
// 1Y return (easy to verify -> trust), batting average (our metric, easy to grasp), overall score (the hook).
export const FREE_FIELDS = ["score", "ret_1y", "batting"] as const;

// WhatsApp OTP sign-in
export const OTP = {
  ttlMs: 5 * 60_000,
  resendCooldownMs: 30_000,
  maxSendsPerHour: 5, // per phone number
  maxAttempts: 5, // wrong codes before the OTP is burned
  sendsPerIpPerDay: Number(process.env.OTP_SENDS_PER_IP_PER_DAY ?? 20),
};

export const REQUESTS_PER_IP_PER_DAY = Number(process.env.REQUESTS_PER_IP_PER_DAY ?? 300);
