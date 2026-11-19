import "server-only";
import type { ChatContext } from "@/lib/types";
import { llmParse } from "./llm";
import { rulesParse } from "./rules";
import type { Intent } from "./schema";

export type Parsed = { intent: Intent; route: "rules" | "llm" | "fallback" };

export async function parse(question: string, ctx: ChatContext): Promise<Parsed> {
  const r = await rulesParse(question, ctx);
  if (r) return { intent: r, route: "rules" };
  const l = await llmParse(question, ctx);
  if (l) return { intent: l, route: "llm" };
  return { intent: { intent: "help" }, route: "fallback" };
}
