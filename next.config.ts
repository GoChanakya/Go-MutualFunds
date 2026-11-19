import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // a stray package-lock.json in the user folder made Next pick the wrong workspace root
  outputFileTracingRoot: process.cwd(),
  // native DuckDB bindings must not be bundled
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
};

export default nextConfig;
