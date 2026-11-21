import { NextResponse } from "next/server";
import { z } from "zod";
import { ANON_QUESTIONS_PER_IP_PER_DAY, REQUESTS_PER_IP_PER_DAY, TRIAL_QUESTIONS } from "@/lib/config/plans";
import { getStore } from "@/lib/data/store";
import { execute } from "@/lib/engine/handlers";
import { readJson } from "@/lib/http";
import { parse } from "@/lib/intent";
import { IntentSchema } from "@/lib/intent/schema";
import type { ChatContext, ChatResponse } from "@/lib/types";
import { clientIp, identify, withAnonCookie } from "@/lib/users/auth";
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

  // Who is asking (signed-in user or visitor), and what their plan allows. Enforced here, not in the UI.
  const id = await identify();
  const { plan } = id;
  const store = users();
  const ip = clientIp(req);
  const reply = (body: unknown, status = 200) => withAnonCookie(NextResponse.json(body, { status }), id);

  if (!(await store.ipGuard(ip, "requests", REQUESTS_PER_IP_PER_DAY))) return reply({ error: "Too many requests from this network today." }, 429);

  if (plan.id === "pro") {
    const q = await store.consume(id.key, "chat", plan.chatPerDay);
    if (!q.allowed) return reply({ error: "daily_limit", message: `You've reached today's limit of ${q.limit} questions. It resets at midnight.` }, 429);
  } else {
    // Free: TRIAL_QUESTIONS in total. Visitors are also capped per network per day (new browsers don't get more).
    if (id.kind === "anon") {
      const used = await store.trialUsed(id.key);
      if (used >= TRIAL_QUESTIONS) return reply({ error: "signup_required", reason: "trial" }, 402);
      if (!(await store.ipGuard(ip, "anon_questions", ANON_QUESTIONS_PER_IP_PER_DAY))) return reply({ error: "signup_required", reason: "network" }, 402);
    }
    const q = await store.consumeTrial(id.key, TRIAL_QUESTIONS);
    if (!q.allowed) return reply({ error: id.kind === "anon" ? "signup_required" : "upgrade_required", reason: "trial" }, 402);
  }

  const ctx: ChatContext = { ...(context ?? {}), history: [...(context?.history ?? []), message].slice(-4) };

  try {
    const data = await getStore();
    const { intent, route, model } = await parse(message, ctx);
    const result = await execute(intent, ctx, { maxRankRows: plan.chatRankRows, planId: plan.id });
    const body: ChatResponse = {
      blocks: result.blocks,
      context: result.context,
      meta: { route, intent: intent.intent, as_of: data.asOf.nav, plan: plan.id },
    };

    const event = { kind: "chat", question: redact(message), intent: intent.intent, route, llm_model: model ?? null, funds_shown: result.context.last_results ?? [] };
    // History for signed-in users (not awaited: never slows the answer). Answers aren't stored.
    if (id.kind === "user") store.logEvent(id.key, event).catch((e) => console.error(JSON.stringify({ type: "history_write_failed", error: String(e).slice(0, 200) })));
    // Analytics: one structured log line per question -> Cloud Logging -> BigQuery sink.
    console.log(JSON.stringify({ type: "mf_event", who: id.kind, key: id.key, plan: plan.id, ...event, intent_json: intent, answered: route !== "fallback", latency_ms: Date.now() - t0 }));
    return reply(body);
  } catch (e) {
    console.error(JSON.stringify({ type: "chat_error", error: String(e).slice(0, 500) }));
    return reply({ error: "Something went wrong. Please try again." }, 500);
  }
}
