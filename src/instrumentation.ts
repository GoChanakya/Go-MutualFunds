// Runs once when the server starts. Next.js compiles this file for both the Node.js and edge runtimes,
// so Node-only code (DuckDB) must sit behind this exact NEXT_RUNTIME check in a separate file;
// webpack then drops it from the edge/browser bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
