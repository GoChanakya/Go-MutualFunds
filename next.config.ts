import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Next.js needs inline scripts for hydration; dev mode also needs eval for hot reload.
// Razorpay Checkout loads its script and resources from Razorpay-owned hosts.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://checkout.razorpay.com https://cdn.razorpay.com",
  "font-src 'self' data:",
  `connect-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://lumberjack.razorpay.com${isDev ? " ws: wss:" : ""}`,
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // a stray package-lock.json in the user folder made Next pick the wrong workspace root
  outputFileTracingRoot: process.cwd(),
  // native DuckDB bindings must not be bundled
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API answers are per user: never cached by Firebase Hosting's CDN or any proxy
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
