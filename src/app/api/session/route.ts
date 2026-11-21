import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/users/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Signing in now needs a WhatsApp OTP: see /api/auth/send-otp and /api/auth/verify-otp.
export async function POST() {
  return NextResponse.json({ error: "Sign in with the WhatsApp OTP." }, { status: 410 });
}

// Sign out
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
