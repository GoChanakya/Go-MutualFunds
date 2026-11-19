import "server-only";
import crypto from "node:crypto";

// Signed session cookie: "<uid>.<issuedAt>.<hmac>". The server issues it after the phone step; the client can't forge it.
// TODO when OTP login lands: issue this only after Firebase Phone Auth verifies the number.

export const SESSION_COOKIE = "gomf_session";
export const SESSION_DAYS = 90;

let devSecretWarned = false;
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ chars) must be set in production");
  if (!devSecretWarned) {
    console.warn(JSON.stringify({ type: "session_dev_secret", note: "SESSION_SECRET not set; using a dev-only secret" }));
    devSecretWarned = true;
  }
  return "dev-only-secret-change-me-dev-only-secret";
}

const sign = (data: string) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

export function createSessionToken(uid: string): string {
  const data = `${uid}.${Date.now()}`;
  return `${data}.${sign(data)}`;
}

export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [uid, iat, mac] = parts;
  const expected = sign(`${uid}.${iat}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(iat) > SESSION_DAYS * 86_400_000) return null;
  return /^u_[a-f0-9]{20}$/.test(uid) ? uid : null;
}

// Indian mobile: optional +91 / 91 / 0 prefix, then 10 digits starting 6-9. Returns "+91XXXXXXXXXX" or null.
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[\s\-()]/g, "").replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export const uidForPhone = (phone: string) => `u_${crypto.createHash("sha256").update(phone).digest("hex").slice(0, 20)}`;

export const maskPhone = (phone: string) => `${phone.slice(0, 3)}******${phone.slice(-4)}`;

// India time for daily limits (resets at midnight IST).
export const istDay = (t = Date.now()) => new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10);
