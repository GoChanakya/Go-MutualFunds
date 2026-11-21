import "server-only";
import { GROUPS, THEME_SECTOR_PATTERNS } from "@/lib/config/groups";
import { METRICS } from "@/lib/config/metrics";
import { mentionsBrand, resolveOne, strongFundMatch } from "@/lib/data/resolve";
import type { ChatContext } from "@/lib/types";
import type { FundMetric, Intent, RankIntent } from "./schema";

// Rule parser: handles clear questions with no LLM call. Returns null when not confident.

const has = (t: string, re: RegExp) => re.test(t);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SYNS = GROUPS.flatMap((g) => g.syn.map((s) => ({ code: g.code, s })))
  .sort((a, b) => b.s.length - a.s.length)
  .map((x) => ({ ...x, re: new RegExp(`\\b${esc(x.s)}s?\\b`, "i") })); // optional plural: "midcaps"

// Generic words only count when nothing more specific matched ("gold etfs" = gold, not equity ETFs).
const GENERIC_SYNS = new Set(["etf", "etfs", "index fund", "index funds"]);

// Returns matched groups and the text with category words removed
// (so "aggressive hybrid" doesn't also read as an "aggressive" lens).
export function matchGroups(text: string): { groups: string[]; rest: string } {
  let t = text;
  const found: string[] = [];
  const generic: string[] = [];
  for (const { code, s, re } of SYNS) {
    if (re.test(t)) {
      const into = GENERIC_SYNS.has(s) ? generic : found;
      if (!into.includes(code)) into.push(code);
      if (!GENERIC_SYNS.has(s)) t = t.replace(re, " "); // consume, so "banking and psu" doesn't also match "bank"
    }
  }
  return { groups: found.length ? found : generic, rest: t };
}

export const findGroups = (text: string) => matchGroups(text).groups;

const WORDNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ORD: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5 };

function parseLimit(t: string): number | undefined {
  const m = t.match(/\b(?:top|best|show|list)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/) ?? t.match(/\b(\d{1,2})\s+(?:best|top|good)?\s*funds?\b/);
  if (!m) return undefined;
  const n = Number(m[1]) || WORDNUM[m[1]];
  return n ? Math.min(Math.max(n, 1), 10) : undefined;
}

// "the second one", "#3", "first two", "1 and 3" -> positions in last results
function parseRefs(t: string, ctx: ChatContext): number[] {
  const n = ctx.last_results?.length ?? 0;
  if (!n) return [];
  const m = t.match(/\b(?:first|top)\s+(two|three|four|2|3|4)\b/);
  if (m) return range(Number(m[1]) || WORDNUM[m[1]]).filter((i) => i <= n);
  const out: number[] = [];
  for (const [w, i] of Object.entries(ORD)) if (new RegExp(`\\b${w}\\b`).test(t)) out.push(i);
  for (const x of t.matchAll(/(?:#|number |no\.? ?)(\d{1,2})\b/g)) out.push(Number(x[1]));
  if (/\b(last one|last fund)\b/.test(t)) out.push(n);
  if (!out.length && /\b(\d)\s*(?:and|&|vs|,)\s*(\d)\b/.test(t)) {
    const mm = t.match(/\b(\d)\s*(?:and|&|vs|,)\s*(\d)\b/)!;
    out.push(Number(mm[1]), Number(mm[2]));
  }
  return [...new Set(out)].filter((i) => i >= 1 && i <= n).sort((a, b) => a - b);
}
const range = (k: number) => Array.from({ length: k }, (_, i) => i + 1);

function detectSort(t: string): Partial<RankIntent> {
  const r: Partial<RankIntent> = {};
  if (has(t, /\b(safe|safest|safer|low risk|less risky|conservative|stable|defensive)\b/)) r.lens = "safety";
  if (has(t, /\b(aggressive|high growth|high return|maximum return|wealth creation)\b/)) r.lens = "growth";
  if (has(t, /\b(resilien\w*|recover\w*|crash\w*|downside|held up|hold up)\b/)) r.sort_by = "resilience";
  else if (has(t, /\b(consisten\w*|batting)\b/)) r.sort_by = "consistency";
  else if (has(t, /\b(momentum|trending|in form|rising|improving)\b/)) r.sort_by = "momentum";
  else if (has(t, /\b(1|one)[ -]?(year|yr)\b/)) r.sort_by = "ret_1y";
  else if (has(t, /\b(3|three)[ -]?months?\b/)) r.sort_by = "ret_3m";
  else if (has(t, /\b(returns?|performing|performance|gainers?)\b/)) r.sort_by = "returns";
  else if (has(t, /\b(largest|biggest|aum|size)\b/)) r.sort_by = "aum";
  else if (has(t, /\b(oldest|track record|established)\b/)) r.sort_by = "track_record";
  if (has(t, /\b(passive|index funds?|etfs?)\b/)) r.passive = "passive";
  else if (has(t, /\b(active|actively managed)\b/)) r.passive = "active";
  const lim = parseLimit(t);
  if (lim) r.limit = lim;
  return r;
}

function rank(groups: string[], extra: Partial<RankIntent>, base?: RankIntent): RankIntent {
  return {
    intent: "rank_funds",
    groups,
    passive: extra.passive ?? base?.passive ?? "any",
    sort_by: extra.sort_by ?? (extra.lens ? "score" : base?.sort_by) ?? "score",
    lens: extra.lens ?? base?.lens ?? "balanced",
    limit: extra.limit ?? base?.limit ?? 5,
  };
}

// Which single metric a question about one fund is asking for. Specific periods before generic "returns".
const FUND_METRIC_RES: [FundMetric, RegExp][] = [
  ["allocation", /\b(sectors?|sector allocation|allocation|portfolio|exposure|asset mix|asset allocation|credit (quality|ratings?)|ratings? mix|invest(s|ing)? in|where does)\b/],
  ["consistency", /\b(batting( avg| average)?|consisten\w*|beat (the |its )?(category|peers))\b/],
  ["ret_3y", /\b(3|three) ?(y|yr|yrs|years?)\b|\bcagr\b/],
  ["ret_1m", /\b(1|one) ?(m|mo|mon|month)\b|\b(last|this|previous|past) month\b|\bmonthly\b|\bmonth on month\b/],
  ["ret_6m", /\b(6|six) ?(m|mo|mon|months?)\b/],
  ["ret_3m", /\b(3|three) ?(m|mo|mon|months?)\b/],
  ["ret_1y", /\b(1|one) ?(y|yr|year)\b|\bannual\w*\b|\blast year\b/],
  ["sip", /\bsip\b/],
  ["resilience", /\b(resilien\w*|recover\w*|crash\w*|covid|falls?|fell|downside|drawdown)\b/],
  ["momentum", /\b(momentum|rank|ranking)\b/],
  ["aum", /\b(aum|fund size|size|assets)\b/],
  ["age", /\b(age|how old|launched|launch date|inception)\b/],
  ["nav", /\bnav\b/],
  ["score", /\b(score|rating|rated|pillars?)\b/],
  ["returns", /\b(returns?|perform\w*|gains?)\b/],
];
export function detectFundMetric(t: string): FundMetric | null {
  return FUND_METRIC_RES.find(([, re]) => re.test(t))?.[0] ?? null;
}
const METRIC_WORDS =
  /\b(sectors?|allocation|holdings?|portfolio|exposure|asset|mix|credit|quality|ratings?|invest\w*|where|does|batting|avg|average|consisten\w*|beat|category|peers|returns?|perform\w*|gains?|sip|resilien\w*|recover\w*|crash\w*|covid|falls?|fell|downside|drawdown|momentum|rank\w*|aum|size|assets|age|old|launched|launch|date|inception|nav|score|rating|rated|pillars?|annual\w*|last|this|previous|past|monthly|cagr|year|years|yr|yrs|months?|mon|mo|according|to|by|its|whats|what's|\d+ ?[my])\b/g;

const PRONOUN = /\b(it|its|it's|this fund|this one|that fund|that one|the fund|same fund)\b/;

const FILLER =
  /\b(is|are|was|the|a|an|how|good|bad|fund|funds|scheme|tell|me|about|details?|of|for|long|short|term|investment|invest|in|it|doing|performance|perform|profile|show|give|info|information|on|what|whats|do|you|think|should|i|any|review|analy[sz]e|analysis|please|pls|now|this|that|worth|buying|ok|okay)\b/g;

export async function rulesParse(question: string, ctx: ChatContext): Promise<Intent | null> {
  const t = ` ${question.toLowerCase().replace(/[?!.,;:]/g, " ").replace(/\s+/g, " ").trim()} `;
  const words = t.trim().split(" ").length;
  const last = ctx.last_intent;
  const lastRank = last?.intent === "rank_funds" ? last : undefined;

  if (has(t, /^ (hi|hello|hey|help|namaste|what can you do|who are you)\b/) && words <= 5) return { intent: "help" };

  // Out of scope
  if (
    has(t, /\bshould i (buy|sell|invest|redeem|exit|switch|stop|hold)\b/) ||
    has(t, /\b(lena|lu|lun|kharid\w*|bech\w*|nikal\w*|invest kar\w*) (chahiye|sahi|theek|thik)\b/) // Hinglish "should I buy/sell"
  )
    return { intent: "out_of_scope", reason: "advice" };
  if (has(t, /\b(will|going to|predict\w*|forecast\w*|tomorrow|next (week|month|year))\b/) && has(t, /\b(market|nifty|sensex|crash|go up|rise|fall|nav|returns?)\b/))
    return { intent: "out_of_scope", reason: "prediction" };
  if (has(t, /\bnews\b/) || has(t, /\bwhy (did|is|are|has|have)\b.*\b(fall|fell|falling|drop\w*|crash\w*|ris\w*|rall\w*|down|up)\b/))
    return { intent: "out_of_scope", reason: "news" };

  // Things we don't have data for yet: say so honestly instead of showing the help menu
  const noData = t.match(
    /\b(expense ratio|ter|exit load|fund manager|managed by|(5|10|five|ten)[ -]?(y|yr|years?) (returns?|cagr)|alpha|beta|sharpe|sortino|standard deviation)\b/,
  );
  if (noData) return { intent: "out_of_scope", reason: "no_data", topic: noData[1] };

  // Funds with the most exposure to a sector: "funds with most IT exposure", "which funds invest heavily in banks"
  if (
    has(t, /\b(exposure|exposed|invest(s|ing)? (most|heavily|more|maximum)|most invested|heav(y|ily|iest)|overweight|highest (allocation|weight\w*|holding))\b/) &&
    !(await mentionsBrand(t))
  ) {
    const theme = Object.entries(THEME_SECTOR_PATTERNS).find(([, re]) => re.test(t))?.[0];
    if (theme) return { intent: "sector_exposure", theme, limit: parseLimit(t) ?? 5 };
  }

  // Funds holding a stock: "which funds hold HDFC Bank", "funds with reliance", "who owns infosys"
  const holders = t.match(
    /\b(?:which|what|show|list)?\s*(?:mutual )?(?:funds?|schemes?)\s+(?:hold|holds|holding|own|owns|owning|have|has|having|with|that hold|invested in|investing in|buy|bought)\s+(.+?)\s*$|\bwho (?:holds|owns|has)\s+(.+?)\s*$/,
  );
  if (holders) {
    const stock = (holders[1] ?? holders[2] ?? "").replace(/\b(shares?|stocks?|the|most|maximum|in their portfolio|in portfolio)\b/g, " ").replace(/\s+/g, " ").trim();
    if (stock.length >= 2 && !(await mentionsBrand(stock) && (await strongFundMatch(stock)))) return { intent: "stock_holders", stock, limit: parseLimit(t) ?? 10 };
  }

  // A fund's top holdings: "top holdings of X", "what stocks does X hold", "X's biggest stocks"
  if (has(t, /\b(holdings?|stocks?|shares|companies)\b/) && !has(t, /\b(which|what) (funds?|schemes?)\b/)) {
    const nameText = t
      .replace(/\b(top|biggest|largest|main|key|holdings?|stocks?|shares|companies|does|do|it|its|it's|this|that|fund|funds|hold|holds|own|owns|in|of|what|whats|show|list|me|the|portfolio|\d+)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (nameText && ((await mentionsBrand(nameText)) || (await strongFundMatch(nameText)))) {
      const r = await resolveOne(nameText);
      if (r.fund) return { intent: "top_holdings", fund: nameText, limit: parseLimit(t) ?? 10 };
    } else if (!nameText && (last?.intent === "fund_profile" || last?.intent === "fund_metric") && ctx.last_results?.length === 1)
      return { intent: "top_holdings", fund: "result:1", limit: parseLimit(t) ?? 10 };
  }

  // Alternatives to a fund: "alternatives to HDFC Small Cap", "funds similar to quant small cap"
  if (has(t, /\b(similar to|alternatives?( to| for)?|instead of|better than|replacement for|peers of|switch from)\b/)) {
    const nameText = t
      .replace(/\b(similar to|alternatives?|to|for|instead of|better than|replacement|peers of|switch from|funds?|show|me|some|any|what are|the|give)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if ((await mentionsBrand(nameText)) || (await strongFundMatch(nameText))) {
      const r = await resolveOne(nameText);
      if (r.fund) return { intent: "similar_funds", fund: nameText };
    } else if ((last?.intent === "fund_profile" || last?.intent === "fund_metric") && ctx.last_results?.length === 1)
      return { intent: "similar_funds", fund: "result:1" };
  }

  // One metric of one fund: "parag flexi batting avg", "what's its 6m return", follow-up "and 3 month?"
  const metric = detectFundMetric(t);
  const lastFund = (last?.intent === "fund_profile" || last?.intent === "fund_metric") && ctx.last_results?.length === 1 ? "result:1" : undefined;
  if (metric) {
    const nameText = t.replace(METRIC_WORDS, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();
    if ((await mentionsBrand(t)) || (await strongFundMatch(nameText))) {
      const r = await resolveOne(nameText);
      if (r.fund) return { intent: "fund_metric", fund: nameText, metric };
      if (r.candidates.length > 1)
        return { intent: "clarify", question: "Which fund do you mean?", options: r.candidates.slice(0, 4).map((c) => c.name) };
    } else if (lastFund && (has(t, PRONOUN) || (words <= 6 && !findGroups(t).length && !has(t, /\b(what is|what are|explain|meaning|define)\b/))))
      return { intent: "fund_metric", fund: lastFund, metric };
  }

  // Explain a metric
  if (has(t, /\b(what is|what's|whats|what are|explain|meaning|define|how do you (calculate|rank|score)|how is .* calculated|how does .* work)\b/)) {
    const m = METRICS.flatMap((x) => x.syn.map((s) => ({ key: x.key, s })))
      .sort((a, b) => b.s.length - a.s.length)
      .find((x) => new RegExp(`\\b${esc(x.s)}\\b`).test(t));
    if (m) return { intent: "explain_metric", metric: m.key };
  }

  // Sector shifts
  if (has(t, /\b(sector(al)? (shifts?|rotation|flows?|changes?|allocation)|where (are|is|did) (fund managers|funds|mutual funds|money|mfs?)|which sectors?|sectors? .*(buying|adding|selling|cutting))\b/)) {
    const theme = findGroups(t).find((c) => c.startsWith("EQS-SCT"));
    return { intent: "sector_shifts", ...(theme ? { theme } : {}) };
  }

  const refs = parseRefs(t, ctx);
  const resultCode = (i: number) => `result:${i}`;

  // Compare
  if (has(t, /\b(compare|comparison|vs|versus|difference between|which is better|better between|overlap\w*|common (holdings|sectors))\b/)) {
    const stripped = t.replace(
      /\b(compare|comparison|difference between|which is better|better between|between|funds?|please|(portfolio |sector(al)? |stock )?overlap\w*|common (holdings|sectors)|of|in|what is|whats|the|show)\b/g,
      " ",
    );
    // split on "vs" when present (fund names can contain "and"/"&"), else on and/with/&
    const parts = (has(stripped, /\b(vs|versus)\b/) ? stripped.split(/\bvs\b|\bversus\b/) : stripped.split(/\band\b|\bwith\b|&|\//))
      .map((s) => s.trim())
      .filter((s) => s.length > 2);
    // 1) named funds: "compare HDFC Small Cap vs Bank of India Small Cap"
    if (parts.length >= 2) {
      const ok = await Promise.all(parts.map(async (p) => (await mentionsBrand(p)) || !!(await strongFundMatch(p))));
      if (ok.every(Boolean)) return { intent: "compare", funds: parts.slice(0, 4) };
    }
    // 2) category leaders: "compare top 3 large cap", "best large cap vs best mid cap"
    const cg = findGroups(t);
    if (cg.length === 1) {
      const m = t.match(/\b(?:top|first|best)\s+(2|3|4|two|three|four)\b/);
      const n = m ? Number(m[1]) || WORDNUM[m[1]] : 2;
      return { intent: "compare", funds: range(n).map((i) => `group:${cg[0]}:${i}`) };
    }
    if (cg.length >= 2) return { intent: "compare", funds: cg.slice(0, 4).map((c) => `group:${c}:1`) };
    // 3) positions in the last answer: "compare the first two"
    if (refs.length >= 2) return { intent: "compare", funds: refs.slice(0, 4).map(resultCode) };
    return null;
  }

  // "tell me more about the second one"
  if (refs.length === 1 && !findGroups(t).length) return { intent: "fund_profile", fund: resultCode(refs[0]) };
  // "is it good?" after a fund answer -> its score summary (not the whole card again)
  if (lastFund && has(t, PRONOUN) && words <= 12) return { intent: "fund_metric", fund: lastFund, metric: "score" };

  const { groups, rest } = matchGroups(t);
  const sort = detectSort(rest.replace(/\(.*?\)/g, " "));

  // Goal-based questions that don't name a category
  if (!groups.length) {
    if (has(t, /\b(park\w*|emergency fund|idle money|few (days|weeks|months)|[1-9] months?|(less|under) than (a|one|1) year|short[- ]term need)\b/))
      return rank(["DES-LIQ", "DES-MMF"], { ...sort, lens: "safety" });
    if (has(t, /\b(for me|suit(s|able)? me|where (should|can|do) i invest|which fund should i|what should i invest|i am a beginner|i'm a beginner|first time investor|new to (investing|mutual funds))\b/))
      return {
        intent: "clarify",
        question: "What is the money for? Pick the closest goal:",
        options: ["Best flexi cap funds (long-term growth)", "Best ELSS funds (tax saving)", "Safest large cap funds (lower-risk equity)", "Best aggressive hybrid funds (balanced)", "Best liquid funds (parking money)"],
      };
  }
  // ("good" is not a rank cue: "is HDFC small cap good?" is about one fund)
  const rankCue = has(t, /\b(best|top|highest|lowest|leading|recommend\w*|suggest\w*|which|list|show|find|safest|strongest|worst)\b/);

  // Follow-up like "what about midcap?" keeps the previous sort/lens
  const followUp = lastRank && has(t, /^ (what about|how about|and|now|also|same for|show|only|just)\b/);

  // A full fund name wins over category words inside it ("Bank of India Small Cap Fund" is a fund, not banking + small cap)
  const nameText = t.replace(FILLER, " ").replace(/\b(best|top|show|find|list)\b/g, " ").replace(/\s+/g, " ").trim();
  const strong = await strongFundMatch(nameText);
  if (strong) return { intent: "fund_profile", fund: nameText };

  if (groups.length && (rankCue || followUp || !(await mentionsBrand(t)))) return rank(groups, sort, followUp ? lastRank : undefined);

  // A partial fund name ("parag flexi")
  if (await mentionsBrand(t)) {
    const r = await resolveOne(nameText);
    if (r.fund) return { intent: "fund_profile", fund: nameText };
    if (r.candidates.length > 1)
      return { intent: "clarify", question: "Which fund do you mean?", options: r.candidates.slice(0, 4).map((c) => c.name) };
  }

  // "best passive funds" (no category)
  if (rankCue && sort.passive === "passive") return rank([], sort);

  // Modifier-only follow-up: "sort by resilience", "only passive", "show top 10"
  if (lastRank && Object.keys(sort).length && words <= 8) return rank(lastRank.groups, sort, lastRank);

  return null;
}
