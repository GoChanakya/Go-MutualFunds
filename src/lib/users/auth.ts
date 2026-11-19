import "server-only";
import { cookies } from "next/headers";
import { type Plan } from "@/lib/config/plans";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { effectivePlan, users, type UserDoc } from "./store";

// Real client IP. On Cloud Run, Google's front end APPENDS the caller's IP to X-Forwarded-For, so the
// rightmost entries are trustworthy and anything to the left may be spoofed by the client.
// XFF_TRUSTED_HOPS = how many entries from the right to skip (0 for Cloud Run direct, 1 behind a load balancer).
export function clientIp(req: Request): string {
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const skip = Number(process.env.XFF_TRUSTED_HOPS ?? 0);
  return xff[xff.length - 1 - skip] ?? "local";
}

export type Viewer = { user: UserDoc; plan: Plan } | null;

export async function currentViewer(): Promise<Viewer> {
  const uid = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  const user = await users().get(uid);
  return user ? { user, plan: effectivePlan(user) } : null;
}
