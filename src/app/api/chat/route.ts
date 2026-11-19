import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/data/store";
import { execute } from "@/lib/engine/handlers";
import { parse } from "@/lib/intent";
import { IntentSchema } from "@/lib/intent/schema";
import type { ChatContext, ChatResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().trim().min(1).max(500),
  session_id: z.string().max(64).optional(),
  context: z
    .object({
      last_intent: IntentSchema.nullable().optional(),
      last_results: z.array(z.string().max(20)).max(10).optional(),
      history: z.array(z.string().max(500)).max(6).optional(),
    })
    .optional(),
});

// Simple per-instance daily limits (no login in the MVP).
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT_PER_IP ?? 60);
const hits = new Map<string, { day: string; n: number }>();
function allowed(key: string) {
  const day = new Date().toISOString().slice(0, 10);
  const h = hits.get(key);
  if (!h || h.day !== day) {
    if (hits.size > 50_000) hits.clear();
    hits.set(key, { day, n: 1 });
    return true;
  }
  return ++h.n <= DAILY_LIMIT;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const parsedBody = Body.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { message, session_id, context } = parsedBody.data;

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!allowed(ip) || (session_id && !allowed(`s:${session_id}`)))
    return NextResponse.json({ error: "Daily question limit reached. Please come back tomorrow." }, { status: 429 });

  const ctx: ChatContext = { ...(context ?? {}), history: [...(context?.history ?? []), message].slice(-4) };

  try {
    const store = await getStore();
    const { intent, route } = await parse(message, ctx);
    const result = await execute(intent, ctx);
    // (the disclaimer + data date are shown once in the UI footer, not on every message)
    const body: ChatResponse = { blocks: result.blocks, context: result.context, meta: { route, intent: intent.intent, as_of: store.asOf.nav } };

    // One structured log line per question -> Cloud Logging -> BigQuery sink (analytics).
    console.log(
      JSON.stringify({
        type: "mf_event",
        session_id: session_id ?? null,
        question: message,
        route,
        intent,
        funds_shown: result.context.last_results ?? [],
        answered: route !== "fallback",
        latency_ms: Date.now() - t0,
      }),
    );
    return NextResponse.json(body);
  } catch (e) {
    console.error(JSON.stringify({ type: "chat_error", error: String(e).slice(0, 500) }));
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
