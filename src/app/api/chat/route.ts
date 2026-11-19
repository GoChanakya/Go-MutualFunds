import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { z } from "zod";
import { REQUESTS_PER_IP_PER_DAY } from "@/lib/config/plans";
import { getStore } from "@/lib/data/store";
import { execute } from "@/lib/engine/handlers";
import { parse } from "@/lib/intent";
import { IntentSchema } from "@/lib/intent/schema";
import type { ChatContext, ChatResponse } from "@/lib/types";
import { clientIp, currentViewer } from "@/lib/users/auth";
import { redact } from "@/lib/users/redact";
import { users } from "@/lib/users/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().trim().min(1).max(500),
  context: z
    .object({
      last_intent: IntentSchema.nullable().optional(),
      last_results: z.array(z.string().max(20)).max(10).optional(),
      history: z.array(z.string().max(500)).max(6).optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const t0 = Date.now();
  const parsedBody = Body.safeParse(await readJson(req));
  if (!parsedBody.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { message, context } = parsedBody.data;

  // Who is asking, and what their plan allows (enforced here, not in the UI).
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "signin_required" }, { status: 401 });
  const { user, plan } = viewer;
  const store = users();
  if (!(await store.ipGuard(clientIp(req), "requests", REQUESTS_PER_IP_PER_DAY)))
    return NextResponse.json({ error: "Too many requests from this network today." }, { status: 429 });
  const quota = await store.consume(user.uid, "chat", plan.chatPerDay);
  if (!quota.allowed)
    return NextResponse.json(
      { error: "limit_reached", message: `You've used all ${quota.limit} questions for today.`, plan: plan.id, usage: { used: quota.used, limit: quota.limit } },
      { status: 429 },
    );

  const ctx: ChatContext = { ...(context ?? {}), history: [...(context?.history ?? []), message].slice(-4) };

  try {
    const data = await getStore();
    const { intent, route, model } = await parse(message, ctx);
    const result = await execute(intent, ctx, { maxRankRows: plan.chatRankRows, planId: plan.id });
    const body: ChatResponse = {
      blocks: result.blocks,
      context: result.context,
      meta: { route, intent: intent.intent, as_of: data.asOf.nav, plan: plan.id, usage: { used: quota.used, limit: quota.limit } },
    };

    const safeQuestion = redact(message);
    const event = { kind: "chat", question: safeQuestion, intent: intent.intent, route, llm_model: model ?? null, funds_shown: result.context.last_results ?? [] };
    // History (not awaited: never slows the answer). Answers aren't stored; they can be regenerated from the data.
    store.logEvent(user.uid, event).catch((e) => console.error(JSON.stringify({ type: "history_write_failed", error: String(e).slice(0, 200) })));
    // Analytics: one structured log line per question -> Cloud Logging -> BigQuery sink.
    console.log(JSON.stringify({ type: "mf_event", uid: user.uid, plan: plan.id, ...event, intent_json: intent, answered: route !== "fallback", latency_ms: Date.now() - t0 }));
    return NextResponse.json(body);
  } catch (e) {
    console.error(JSON.stringify({ type: "chat_error", error: String(e).slice(0, 500) }));
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
