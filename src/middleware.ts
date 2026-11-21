import { NextResponse, type NextRequest } from "next/server";

// API writes (POST/DELETE) must come from our own pages. Browsers always send Origin on cross-site requests,
// so a request from another website is rejected here. (The session cookie is also SameSite=Lax.)
// Our own hosts: the host this request arrived on (Cloud Run sets it; Firebase Hosting passes the custom domain in
// X-Forwarded-Host), plus ALLOWED_HOSTS, e.g. "gomutualfunds.com,www.gomutualfunds.com", for when a proxy rewrites Host.
const allowed = (process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

export function middleware(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();
  const origin = req.headers.get("origin");
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    const ours = new Set([req.headers.get("x-forwarded-host"), req.headers.get("host"), ...allowed].filter(Boolean).map((h) => h!.toLowerCase()));
    if (!host || !ours.has(host.toLowerCase())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
