import { NextResponse, type NextRequest } from "next/server";

// API writes (POST/DELETE) must come from our own pages. Browsers always send Origin on cross-site requests,
// so a request from another website is rejected here. (The session cookie is also SameSite=Lax.)
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
    const expected = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!host || host !== expected) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
