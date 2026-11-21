import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { anonIdFromCookie, clientIp, cookieOpts } from "@/lib/users/auth";
import { meBody } from "@/lib/users/me";
import { AuthError, tenDigits, verifyOtp } from "@/lib/users/otp";
import { ANON_COOKIE, SESSION_COOKIE, SESSION_DAYS, createSessionToken } from "@/lib/users/session";
import { users } from "@/lib/users/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { phone, otp, consent: true } -> verifies the OTP, signs the user in, carries their free-question count over
export async function POST(req: Request) {
  const body = (await readJson(req, 1024)) as { phone?: unknown; otp?: unknown; consent?: unknown } | null;
  if (body?.consent !== true) return NextResponse.json({ error: "Please accept the terms to continue." }, { status: 400 });
  const phone = tenDigits(String(body?.phone ?? ""));
  try {
    await verifyOtp(phone, String(body?.otp ?? "").trim());
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(JSON.stringify({ type: "otp_verify_error", error: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const store = users();
  const { user, created } = await store.upsertByPhone(`+91${phone}`, clientIp(req));
  // the visitor's free questions move to the account: signing up never resets the count
  const anonId = await anonIdFromCookie();
  if (anonId) await store.mergeTrial(anonId, user.uid);
  console.log(JSON.stringify({ type: "signed_in", uid: user.uid, created, carried_trial_from: anonId ?? null }));

  const res = NextResponse.json(meBody(user));
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.uid), cookieOpts(SESSION_DAYS));
  res.cookies.set(ANON_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
