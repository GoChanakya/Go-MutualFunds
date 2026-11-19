import { z } from "zod";
import { GROUPS } from "@/lib/config/groups";
import { LENSES, PILLARS } from "@/lib/config/score";

// The ONLY things the parser (rules or LLM) can ask for. Our code validates against this before running anything.

const groupCodes = GROUPS.map((g) => g.code) as [string, ...string[]];
export const SORT_KEYS = ["score", ...PILLARS, "ret_1y", "ret_3m", "aum", "age"] as const;
export const FUND_METRICS = ["allocation", "score", "consistency", "returns", "ret_3m", "ret_6m", "ret_1y", "sip", "resilience", "momentum", "aum", "age", "nav"] as const;
export type FundMetric = (typeof FUND_METRICS)[number];

// A fund is referenced either by name text (resolved by our code) or by position in the last results ("result:2").
const FundRef = z.string().min(1).max(120);

export const IntentSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("rank_funds"),
    groups: z.array(z.enum(groupCodes)).max(4).default([]),
    passive: z.enum(["active", "passive", "any"]).default("any"),
    sort_by: z.enum(SORT_KEYS).default("score"),
    lens: z.enum(LENSES).default("balanced"),
    limit: z.number().int().min(1).max(10).default(5),
    min_age_years: z.number().min(0).max(30).optional(),
  }),
  z.object({ intent: z.literal("fund_profile"), fund: FundRef }),
  // one specific number about one fund: "parag flexi batting average", "its 6 month return"
  z.object({ intent: z.literal("fund_metric"), fund: FundRef, metric: z.enum(FUND_METRICS) }),
  z.object({ intent: z.literal("compare"), funds: z.array(FundRef).min(2).max(4) }),
  z.object({ intent: z.literal("explain_metric"), metric: z.string().max(60) }),
  z.object({ intent: z.literal("sector_shifts"), theme: z.enum(groupCodes).optional() }),
  // funds ranked by how much of their portfolio is in a sector: "funds with most IT exposure"
  z.object({ intent: z.literal("sector_exposure"), theme: z.enum(groupCodes), limit: z.number().int().min(1).max(10).default(5) }),
  // higher-scoring funds in the same category: "alternatives to HDFC Small Cap"
  z.object({ intent: z.literal("similar_funds"), fund: FundRef }),
  z.object({ intent: z.literal("clarify"), question: z.string().max(200), options: z.array(z.string().max(60)).max(5).default([]) }),
  z.object({ intent: z.literal("out_of_scope"), reason: z.enum(["advice", "prediction", "news", "non_mf", "no_data"]), topic: z.string().max(40).optional() }),
  z.object({ intent: z.literal("help") }),
]);

export type Intent = z.infer<typeof IntentSchema>;
export type RankIntent = Extract<Intent, { intent: "rank_funds" }>;
