import "server-only";
import { GoogleGenAI, type ThinkingLevel } from "@google/genai";
import { GROUPS } from "@/lib/config/groups";
import { METRICS } from "@/lib/config/metrics";
import { LENSES, PILLARS } from "@/lib/config/score";
import type { ChatContext } from "@/lib/types";
import { FUND_METRICS, IntentSchema, SORT_KEYS, type Intent } from "./schema";

// LLM adapter. The model turns a question into intent JSON. That is all it does.
// PRIVACY: the payload is built ONLY from the user's question, their recent messages and the previous intent JSON.
// No fund data, scores, rankings or formulas are ever included. The group/metric catalog is public category names.

const PARSER = (process.env.PARSER ?? "gemini") as "gemini" | "ollama" | "off";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
// Used only when the primary model is throttled or errors (429/5xx).
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash";
const GCP_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gochanakya-main";
const GCP_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "asia-south1"; // never "global"
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const DAILY_CAP = Number(process.env.LLM_DAILY_CAP ?? 3000);

let day = "";
let used = 0;
function underCap() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) (day = d), (used = 0);
  return used < DAILY_CAP;
}

const SYSTEM = `You convert a user's mutual fund question into ONE JSON object. Output JSON only.
You never answer the question yourself and never invent fund data.

Intents:
- {"intent":"rank_funds","groups":[codes],"passive":"active|passive|any","sort_by":"${SORT_KEYS.join("|")}","lens":"${LENSES.join("|")}","limit":1-10}
  For "best/top/which funds" questions. groups may be [] only when passive is "passive". lens "safety" for safe/low-risk, "growth" for aggressive.
  sort_by pillars: ${PILLARS.join(", ")}. Use "score" unless the user asks for one specific quality.
- {"intent":"fund_profile","fund":"<fund name as the user wrote it>" | "result:N"}
- {"intent":"fund_metric","fund":"<fund name>" | "result:N","metric":"${FUND_METRICS.join("|")}"}
  For ONE specific number about ONE fund (its batting average, its 6-month return, its AUM...). consistency = batting average.
- {"intent":"compare","funds":["<name or result:N>", ...]}  (2-4 funds)
- {"intent":"explain_metric","metric":"${METRICS.map((m) => m.key).join("|")}"}
- {"intent":"sector_shifts","theme":"<optional sector group code>"}
- {"intent":"sector_exposure","theme":"<sector group code>","limit":1-10}  diversified funds with the most money in a sector ("most IT exposure")
- {"intent":"similar_funds","fund":"<fund name>" | "result:N"}  higher-scoring alternatives in the same category
- {"intent":"clarify","question":"<short question back>","options":["..."]}  when the question is too vague
- {"intent":"out_of_scope","reason":"advice|prediction|news|non_mf|no_data","topic":"<optional>"}  buy/sell advice, predictions, news, non-MF topics;
  no_data = data we don't have: expense ratio, exit load, fund manager, stock-level holdings, 3/5/10-year CAGR, alpha/beta/sharpe
- {"intent":"help"}

"result:N" means the Nth fund in the previous answer (use it for "the second one", "first two", "it").
Follow-ups like "what about midcap?" keep the previous intent's other fields.

Group codes:
${GROUPS.map((g) => `${g.code}=${g.name}`).join("; ")}

Examples:
Q: best small cap funds -> {"intent":"rank_funds","groups":["EQS-SMC"],"passive":"any","sort_by":"score","lens":"balanced","limit":5}
Q: tech funds that held up well in crashes -> {"intent":"rank_funds","groups":["EQS-SCT-DIG"],"passive":"any","sort_by":"resilience","lens":"balanced","limit":5}
Q: low risk funds for parking money for 3 months -> {"intent":"rank_funds","groups":["DES-LIQ","DES-MMF"],"passive":"any","sort_by":"score","lens":"safety","limit":5}
Q: i want to save tax -> {"intent":"rank_funds","groups":["EQS-ELS"],"passive":"any","sort_by":"score","lens":"balanced","limit":5}
Q: is ppfas flexi good -> {"intent":"fund_profile","fund":"parag parikh flexi cap"}
Q: how consistent has hdfc flexi been -> {"intent":"fund_metric","fund":"hdfc flexi cap","metric":"consistency"}
Q: (previous answer was about one fund) what did it give in the last 6 months -> {"intent":"fund_metric","fund":"result:1","metric":"ret_6m"}
Q: what sectors does parag parikh flexi cap hold -> {"intent":"fund_metric","fund":"parag parikh flexi cap","metric":"allocation"}
Q: which diversified funds are loaded on banks -> {"intent":"sector_exposure","theme":"EQS-SCT-BFI","limit":5}
Q: something better than axis bluechip -> {"intent":"similar_funds","fund":"axis bluechip"}
Q: expense ratio of hdfc flexi -> {"intent":"out_of_scope","reason":"no_data","topic":"expense ratio"}
Q: compare the first two -> {"intent":"compare","funds":["result:1","result:2"]}
Q: good fund for me? -> {"intent":"clarify","question":"What is your goal and time horizon?","options":["Long-term growth (5+ years)","Tax saving","Low-risk parking (under 1 year)","Regular income"]}
Q: will nifty fall next month -> {"intent":"out_of_scope","reason":"prediction"}`;

function userPayload(question: string, ctx: ChatContext): string {
  return JSON.stringify({
    previous_intent: ctx.last_intent ?? null,
    previous_result_count: ctx.last_results?.length ?? 0,
    recent_user_messages: (ctx.history ?? []).slice(-4),
    question,
  });
}

let gemini: GoogleGenAI | null = null;

async function callGeminiModel(model: string, payload: string, timeoutMs: number): Promise<string> {
  gemini ??= new GoogleGenAI({ vertexai: true, project: GCP_PROJECT, location: GCP_LOCATION });
  const r = await gemini.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: payload }] }],
    config: {
      systemInstruction: SYSTEM,
      temperature: 0,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      // a parse needs no reasoning; MINIMAL keeps latency ~1 s and avoids paying for thought tokens
      thinkingConfig: { thinkingLevel: "MINIMAL" as ThinkingLevel },
      httpOptions: { timeout: timeoutMs },
    },
  });
  return r.text ?? "";
}

const retryable = (e: unknown) => /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|INTERNAL|UNAVAILABLE|timed? ?out|aborted/i.test(String(e));

// Flash-Lite (cheap) gets a short time limit; when Mumbai's shared capacity is busy it is slow or returns 429,
// so we switch to Flash (fast, ~10x the price per call) instead of making the user wait.
const PRIMARY_TIMEOUT_MS = Number(process.env.GEMINI_PRIMARY_TIMEOUT_MS ?? 4000);
const FALLBACK_TIMEOUT_MS = Number(process.env.GEMINI_FALLBACK_TIMEOUT_MS ?? 6000);

async function callGemini(payload: string): Promise<{ text: string; model: string }> {
  const plan: [string, number][] = [
    [GEMINI_MODEL, PRIMARY_TIMEOUT_MS],
    [GEMINI_FALLBACK_MODEL, FALLBACK_TIMEOUT_MS],
  ];
  let last: unknown;
  for (const [model, timeout] of plan) {
    if (!model) continue;
    try {
      return { text: await callGeminiModel(model, payload, timeout), model };
    } catch (e) {
      last = e;
      if (!retryable(e)) throw e;
      console.warn(JSON.stringify({ type: "llm_retry", model, error: String(e).slice(0, 120) }));
    }
  }
  throw last;
}

async function callOllama(payload: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.OLLAMA_TOKEN ? { authorization: `Bearer ${process.env.OLLAMA_TOKEN}` } : {}) },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: "json",
      options: { temperature: 0 },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: payload },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  return ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
}

export type LlmResult = { intent: Intent; model: string };

export async function llmParse(question: string, ctx: ChatContext): Promise<LlmResult | null> {
  if (PARSER === "off" || !underCap()) return null;
  const payload = userPayload(question, ctx);
  used++;
  const t0 = Date.now();
  try {
    const { text, model } = PARSER === "ollama" ? { text: await callOllama(payload), model: `ollama:${OLLAMA_MODEL}` } : await callGemini(payload);
    const json = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim());
    const parsed = IntentSchema.safeParse(json);
    console.log(JSON.stringify({ type: "llm_call", parser: PARSER, model, ok: parsed.success, ms: Date.now() - t0, payload_chars: payload.length }));
    return parsed.success ? { intent: parsed.data, model } : null;
  } catch (e) {
    console.error(JSON.stringify({ type: "llm_error", parser: PARSER, ms: Date.now() - t0, error: String(e).slice(0, 300) }));
    return null;
  }
}
