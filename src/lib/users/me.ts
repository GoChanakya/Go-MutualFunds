import "server-only";
import type { MeResponse } from "./me-types";
import { maskPhone } from "./session";
import { effectivePlan, users, type UserDoc } from "./store";

export async function meBody(user: UserDoc): Promise<MeResponse> {
  const plan = effectivePlan(user);
  const used = await users().usage(user.uid);
  return {
    phone: maskPhone(user.phone),
    plan: plan.id,
    plan_expires_at: plan.id === "pro" ? user.plan_expires_at : null,
    limits: { chat: plan.chatPerDay, screener: plan.screenerPerDay },
    used,
  };
}
