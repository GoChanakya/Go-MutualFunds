import "server-only";
import crypto from "node:crypto";

// Two signed cookies; the client can't forge either.
//   gomf_session = "<uid>.<issuedAt>.<hmac>"  issued only after the WhatsApp OTP verifies the number
//   gomf_anon    = "<anonId>.<issuedAt>.<hmac>"  a visitor without a login, so their free questions are counted on our server
// Each kind is signed with its own prefix, so one can never be passed off as the other.

export const SESSION_COOKIE = "gomf_session";
export const SESSION_DAYS = 90;
export const ANON_COOKIE = "gomf_anon";
export const ANON_DAYS = 365;

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

const sign = (kind: string, data: string) => crypto.createHmac("sha256", secret()).update(`${kind}:${data}`).digest("base64url");

function createToken(kind: "user" | "anon", id: string): string {
  const data = `${id}.${Date.now()}`;
  return `${data}.${sign(kind, data)}`;
}

function verifyToken(kind: "user" | "anon", token: string | undefined | null, idRe: RegExp, days: number): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, iat, mac] = parts;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(kind, `${id}.${iat}`));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(iat) > days * 86_400_000) return null;
  return idRe.test(id) ? id : null;
}

export const createSessionToken = (uid: string) => createToken("user", uid);
export const verifySessionToken = (token: string | undefined | null) => verifyToken("user", token, /^u_[a-f0-9]{20}$/, SESSION_DAYS);

export const newAnonId = () => `a_${crypto.randomBytes(10).toString("hex")}`;
export const createAnonToken = (anonId: string) => createToken("anon", anonId);
export const verifyAnonToken = (token: string | undefined | null) => verifyToken("anon", token, /^a_[a-f0-9]{20}$/, ANON_DAYS);

// Indian mobile: optional +91 / 91 / 0 prefix, then 10 digits starting 6-9. Returns "+91XXXXXXXXXX" or null.
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[\s\-()]/g, "").replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export const uidForPhone = (phone: string) => `u_${crypto.createHash("sha256").update(phone).digest("hex").slice(0, 20)}`;

export const maskPhone = (phone: string) => `${phone.slice(0, 3)}******${phone.slice(-4)}`;

// India time for daily limits (resets at midnight IST).
export const istDay = (t = Date.now()) => new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10);
