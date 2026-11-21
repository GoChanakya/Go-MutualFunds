import "server-only";
import type { MeResponse } from "./me-types";
import { maskPhone } from "./session";
import { effectivePlan, type UserDoc } from "./store";

export function meBody(user: UserDoc): MeResponse {
  const plan = effectivePlan(user);
  return {
    signed_in: true,
    phone: maskPhone(user.phone),
    plan: plan.id,
    plan_expires_at: plan.id === "pro" ? user.plan_expires_at : null,
    pro_interest: Boolean(user.pro_interest_at),
  };
}
