import "server-only";
import crypto from "node:crypto";
import { OTP } from "@/lib/config/plans";
import { uidForPhone } from "./session";
import { users, type OtpRecord } from "./store";

// WhatsApp OTP sign-in, ported from the GoWealthy service's phone login (reference/email-service):
// the server creates the OTP, sends it on WhatsApp (BubbleWhats), stores only a peppered hash, and checks it.
// Records live in OUR Firestore (otp_codes/{uid}); limits: resend cooldown, sends per hour, wrong attempts.

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const PHONE_RE = /^[6-9]\d{9}$/; // 10 digits, no country code

function pepper(): string {
  const p = process.env.OTP_PEPPER;
  if (p && p.length >= 32) return p;
  if (process.env.NODE_ENV === "production") throw new Error("OTP_PEPPER (32+ chars) must be set in production");
  return "dev-only-otp-pepper-dev-only-otp-pepper";
}

const hashOtp = (phone: string, otp: string) => crypto.createHmac("sha256", pepper()).update(`${phone}:${otp}`).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const recordKey = (phone: string) => uidForPhone(`+91${phone}`);

const UNAVAILABLE = "Could not send the OTP on WhatsApp right now. Please try again shortly.";

async function sendWhatsApp(phone: string, otp: string): Promise<void> {
  const url = process.env.WHATSAPP_OTP_URL;
  const token = process.env.WHATSAPP_OTP_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production") throw new AuthError("OTP service is not configured.", 503);
    // Local development without WhatsApp credentials: show the code in the dev-server terminal only.
    console.log(`\n[dev] WhatsApp OTP for ******${phone.slice(-4)}: ${otp}\n`);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({
        jid: `91${phone}`,
        message: `Your OTP is ${otp} for GoMutualFunds. Please do not share it with anyone. Valid for 5 minutes.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ type: "otp_gateway_error", status: res.status, phone: `******${phone.slice(-4)}` }));
      throw new AuthError(UNAVAILABLE, 502);
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    console.error(JSON.stringify({ type: "otp_gateway_unreachable", error: String(e).slice(0, 120) }));
    throw new AuthError(UNAVAILABLE, 502);
  }
}

export async function sendOtp(phone: string): Promise<void> {
  if (!PHONE_RE.test(phone)) throw new AuthError("Enter a valid 10-digit mobile number.");
  const store = users();
  const key = recordKey(phone);
  const t = Date.now();
  const rec = await store.otpGet(key);
  if (rec?.sentAt && t - rec.sentAt < OTP.resendCooldownMs) {
    const wait = Math.ceil((OTP.resendCooldownMs - (t - rec.sentAt)) / 1000);
    throw new AuthError(`Please wait ${wait} seconds before requesting a new OTP.`, 429);
  }
  const inWindow = Boolean(rec?.windowStart && t - rec.windowStart < 3_600_000);
  const sends = inWindow ? (rec?.sends ?? 0) : 0;
  if (sends >= OTP.maxSendsPerHour) throw new AuthError("Too many OTP requests. Please try again in an hour.", 429);

  const otp = crypto.randomInt(100000, 1000000).toString();
  await sendWhatsApp(phone, otp); // only a delivered OTP counts towards the limits
  await store.otpSet(key, {
    hash: hashOtp(phone, otp),
    expiresAt: t + OTP.ttlMs,
    attempts: 0,
    sentAt: t,
    windowStart: inWindow ? rec!.windowStart : t,
    sends: sends + 1,
  });
}

export async function verifyOtp(phone: string, otp: string): Promise<void> {
  if (!PHONE_RE.test(phone) || !/^\d{6}$/.test(otp)) throw new AuthError("Enter the 6-digit OTP.");
  const store = users();
  const key = recordKey(phone);
  const rec = await store.otpGet(key);
  if (!rec?.hash) throw new AuthError("OTP not found. Please request a new one.");
  if (Date.now() > rec.expiresAt) {
    await store.otpSet(key, { ...rec, hash: null });
    throw new AuthError("OTP has expired. Please request a new one.");
  }
  if (rec.attempts >= OTP.maxAttempts) {
    await store.otpSet(key, { ...rec, hash: null });
    throw new AuthError("Too many wrong attempts. Please request a new OTP.", 429);
  }
  if (!sameHash(rec.hash, hashOtp(phone, otp))) {
    const attempts = rec.attempts + 1;
    await store.otpSet(key, { ...rec, attempts } as OtpRecord);
    const left = OTP.maxAttempts - attempts;
    throw new AuthError(left > 0 ? `Incorrect OTP. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Please request a new OTP.");
  }
  // used: clear the hash but keep the send counters, so verifying doesn't reset the rate limit
  await store.otpSet(key, { ...rec, hash: null, attempts: 0 });
}

// "+91 98765-43210" / "09876543210" / "9876543210" -> "9876543210"
export const tenDigits = (input: string) => String(input ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
