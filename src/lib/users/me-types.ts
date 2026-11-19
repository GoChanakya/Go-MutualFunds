// Shape of /api/me and /api/session responses (shared with the browser).
export type MeResponse = {
  phone: string; // masked
  plan: "free" | "pro";
  plan_expires_at: string | null;
  limits: { chat: number; screener: number };
  used: { chat: number; screener: number };
};
