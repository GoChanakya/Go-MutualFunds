// Shape of /api/me (shared with the browser). Usage counts are deliberately not included: limits are enforced
// on the server and the UI only reacts when one is reached.
export type MeResponse = {
  signed_in: boolean;
  phone: string | null; // masked
  plan: "free" | "pro";
  plan_expires_at: string | null;
  pro_interest: boolean;
};

export const ANON_ME: MeResponse = { signed_in: false, phone: null, plan: "free", plan_expires_at: null, pro_interest: false };
