import "server-only";
import type { ChatContext } from "@/lib/types";
import { redact } from "@/lib/users/redact";
import { llmParse } from "./llm";
import { rulesParse } from "./rules";
import type { Intent } from "./schema";

export type Parsed = { intent: Intent; route: "rules" | "llm" | "fallback"; model?: string };

export async function parse(question: string, ctx: ChatContext): Promise<Parsed> {
  const r = await rulesParse(question, ctx);
  if (r) return { intent: r, route: "rules" };
  const l = await llmParse(redact(question), { ...ctx, history: ctx.history?.map(redact) });
  if (l) return { intent: l.intent, route: "llm", model: l.model };
  return { intent: { intent: "help" }, route: "fallback" };
}
