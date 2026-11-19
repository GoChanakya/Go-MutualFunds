// Usage report from the live app's logs: which questions our rules answered, which went to Gemini (and which model),
// which nobody understood, plus screener and sign-up counts.
// Usage (uses your gcloud login; read-only):
//   npx tsx scripts/usage-report.ts            # last 7 days
//   npx tsx scripts/usage-report.ts 30         # last 30 days
import { execFileSync } from "node:child_process";

const DAYS = Number(process.argv[2] ?? 7);
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gochanakya-main";
const SERVICE = process.env.SERVICE ?? "gomf-app";

type Entry = { jsonPayload?: Record<string, unknown> };

const token = execFileSync(process.platform === "win32" ? "gcloud.cmd" : "gcloud", ["auth", "print-access-token"], {
  encoding: "utf8",
  shell: process.platform === "win32", // .cmd needs a shell on Windows; these args have no spaces
}).trim();
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

// Cloud Logging REST API (entries:list), paged. Read-only.
async function read(filter: string): Promise<Entry[]> {
  const out: Entry[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch("https://logging.googleapis.com/v2/entries:list", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        resourceNames: [`projects/${PROJECT}`],
        filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}" AND timestamp>="${since}" AND (${filter})`,
        pageSize: 1000,
        pageToken,
      }),
    });
    if (!res.ok) throw new Error(`Logging API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { entries?: Entry[]; nextPageToken?: string };
    out.push(...(data.entries ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < 50_000);
  return out;
}

const count = <T>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : "-");

async function main() {
const chats = (await read('jsonPayload.type="mf_event"')).map((e) => e.jsonPayload!);
const llm = (await read('jsonPayload.type="llm_call" OR jsonPayload.type="llm_retry" OR jsonPayload.type="llm_error"')).map((e) => e.jsonPayload!);
const screens = (await read('jsonPayload.type="screener_event"')).map((e) => e.jsonPayload!);
const sessions = (await read('jsonPayload.type="session_start"')).map((e) => e.jsonPayload!);

const total = chats.length;
const byRoute = count(chats.map((c) => String(c.route)));
console.log(`\n=== Chat, last ${DAYS} days: ${total} questions ===`);
for (const [route, n] of byRoute) console.log(`  ${route.padEnd(9)} ${String(n).padStart(6)}  ${pct(n, total)}   ${route === "rules" ? "our code, ₹0" : route === "llm" ? "Gemini parsed it" : "not understood"}`);

const calls = llm.filter((x) => x.type === "llm_call");
console.log(`\n=== Gemini: ${calls.length} calls ===`);
for (const [model, n] of count(calls.map((c) => String(c.model ?? "unknown")))) console.log(`  ${model.padEnd(28)} ${n}`);
const retries = llm.filter((x) => x.type === "llm_retry");
if (retries.length) console.log(`  fell back from Flash-Lite (slow/busy): ${retries.length}`);
const errors = llm.filter((x) => x.type === "llm_error").length;
if (errors) console.log(`  failed completely: ${errors}`);
const ms = calls.map((c) => Number(c.ms)).sort((a, b) => a - b);
if (ms.length) console.log(`  latency: median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms[ms.length - 1]} ms`);

console.log(`\n=== Questions sent to Gemini (candidates for new rules) ===`);
for (const [q, n] of count(chats.filter((c) => c.route === "llm").map((c) => String(c.question))).slice(0, 25)) console.log(`  ${String(n).padStart(3)}×  ${q}`);

console.log(`\n=== Not understood (add rules or intents for these) ===`);
for (const [q, n] of count(chats.filter((c) => c.route === "fallback").map((c) => String(c.question))).slice(0, 25)) console.log(`  ${String(n).padStart(3)}×  ${q}`);

console.log(`\n=== What people ask about ===`);
for (const [i, n] of count(chats.map((c) => String(c.intent)))) console.log(`  ${i.padEnd(16)} ${n}`);

console.log(`\n=== Screener: ${screens.length} searches · Sign-ins: ${sessions.length} (${sessions.filter((s) => s.created).length} new users) ===`);
console.log(`  by plan: ${count(screens.map((s) => String(s.plan))).map(([p, n]) => `${p} ${n}`).join(", ") || "-"}\n`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
