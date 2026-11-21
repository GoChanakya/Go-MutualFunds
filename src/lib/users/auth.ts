import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { PLANS, type Plan } from "@/lib/config/plans";
import { ANON_COOKIE, ANON_DAYS, SESSION_COOKIE, createAnonToken, newAnonId, verifyAnonToken, verifySessionToken } from "./session";
import { effectivePlan, users, type UserDoc } from "./store";

// Real client IP. On Cloud Run, Google's front end APPENDS the caller's IP to X-Forwarded-For, so the
// rightmost entries are trustworthy and anything to the left may be spoofed by the client.
// XFF_TRUSTED_HOPS = how many entries from the right to skip (0 for Cloud Run direct, 1 behind a load balancer).
export function clientIp(req: Request): string {
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const skip = Number(process.env.XFF_TRUSTED_HOPS ?? 0);
  return xff[xff.length - 1 - skip] ?? "local";
}

// Signed-in user (WhatsApp-verified), or null.
export type Viewer = { user: UserDoc; plan: Plan } | null;

export async function currentViewer(): Promise<Viewer> {
  const uid = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  const user = await users().get(uid);
  return user ? { user, plan: effectivePlan(user) } : null;
}

// Whoever is asking: a signed-in user, or a visitor identified by a signed anonymous cookie.
// `key` is what limits are counted against (uid or anon id). `newAnonToken` is set when the visitor needs a cookie.
export type Identity =
  | { kind: "user"; key: string; user: UserDoc; plan: Plan; newAnonToken: null }
  | { kind: "anon"; key: string; plan: Plan; newAnonToken: string | null };

export async function identify(): Promise<Identity> {
  const viewer = await currentViewer();
  if (viewer) return { kind: "user", key: viewer.user.uid, user: viewer.user, plan: viewer.plan, newAnonToken: null };
  const existing = verifyAnonToken((await cookies()).get(ANON_COOKIE)?.value);
  if (existing) return { kind: "anon", key: existing, plan: PLANS.free, newAnonToken: null };
  const id = newAnonId();
  return { kind: "anon", key: id, plan: PLANS.free, newAnonToken: createAnonToken(id) };
}

// The visitor's anonymous id from the cookie (used at sign-up to carry their question count over).
export async function anonIdFromCookie(): Promise<string | null> {
  return verifyAnonToken((await cookies()).get(ANON_COOKIE)?.value);
}

const cookieOpts = (maxAgeDays: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeDays * 86_400,
});

export function withAnonCookie<T extends NextResponse>(res: T, id: Identity): T {
  if (id.newAnonToken) res.cookies.set(ANON_COOKIE, id.newAnonToken, cookieOpts(ANON_DAYS));
  return res;
}

export { cookieOpts };
