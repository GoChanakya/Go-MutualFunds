import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { z } from "zod";
import { NEW_USERS_PER_IP_PER_DAY } from "@/lib/config/plans";
import { clientIp } from "@/lib/users/auth";
import { SESSION_COOKIE, SESSION_DAYS, createSessionToken, normalizePhone, uidForPhone } from "@/lib/users/session";
import { users } from "@/lib/users/store";
import { meBody } from "@/lib/users/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phone step (no OTP yet): creates or finds the user and sets a signed session cookie.
const Body = z.object({ phone: z.string().max(20), consent: z.literal(true) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "Enter your mobile number and accept the terms." }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "Enter a valid 10-digit Indian mobile number." }, { status: 400 });

  const ip = clientIp(req);
  const store = users();
  // While numbers are unverified, cap how many NEW accounts one IP can create per day (stops limit-dodging).
  const existing = await store.get(uidForPhone(phone));
  if (!existing && !(await store.ipGuard(ip, "new_users", NEW_USERS_PER_IP_PER_DAY)))
    return NextResponse.json({ error: "Too many new sign-ups from this network today. Try again tomorrow." }, { status: 429 });

  const { user, created } = await store.upsertByPhone(phone, ip);
  console.log(JSON.stringify({ type: "session_start", uid: user.uid, created }));

  const res = NextResponse.json(await meBody(user));
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.uid), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
