import { NextResponse } from "next/server";
import { OTP } from "@/lib/config/plans";
import { readJson } from "@/lib/http";
import { clientIp } from "@/lib/users/auth";
import { AuthError, sendOtp, tenDigits } from "@/lib/users/otp";
import { users } from "@/lib/users/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { phone } -> sends a 6-digit OTP on WhatsApp
export async function POST(req: Request) {
  const body = (await readJson(req, 1024)) as { phone?: unknown } | null;
  const phone = tenDigits(String(body?.phone ?? ""));
  if (!(await users().ipGuard(clientIp(req), "otp_sends", OTP.sendsPerIpPerDay)))
    return NextResponse.json({ error: "Too many OTP requests from this network today. Try again tomorrow." }, { status: 429 });
  try {
    await sendOtp(phone);
    console.log(JSON.stringify({ type: "otp_sent", phone: `******${phone.slice(-4)}` }));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(JSON.stringify({ type: "otp_send_error", error: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
