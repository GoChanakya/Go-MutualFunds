// Runs test conversations through parser + engine and prints what happened.
// Usage: npx tsx --conditions=react-server scripts/eval.ts      (PARSER=off to test rules only)

import { execute } from "@/lib/engine/handlers";
import { parse } from "@/lib/intent";
import type { Block, ChatContext } from "@/lib/types";

// Each inner array is one conversation (follow-ups depend on earlier turns).
const CONVERSATIONS: string[][] = [
  // stock holdings (Nov 21)
  [
    "top holdings of parag parikh flexi cap",
    "compare parag parikh flexi cap vs hdfc flexi cap",
    "which funds hold HDFC Bank",
    "funds holding reliance",
    "who owns sbi",
    "what stocks does hdfc mid cap hold",
    "Tell me about HDFC Small Cap Fund",
    "its top 5 holdings",
    "where does hdfc flexi cap invest",
  ],
  // monthly returns, sector overlap, holdings prompts (Nov 21)
  [
    "returns of parag parikh flexi cap",
    "last month return of hdfc flexi cap",
    "what is its 3 year return?",
    "1 month return of sbi small cap",
    "3 year cagr of hdfc mid cap",
    "overlap between parag parikh flexi cap and hdfc flexi cap",
    "compare top 3 large cap",
    "Where does HDFC Flexi Cap invest?",
  ],
  // new question types (Nov): portfolio, sector exposure, alternatives, data we don't have
  [
    "parag parikh flexi cap sector allocation",
    "where does hdfc flexi cap invest",
    "funds with most IT exposure",
    "which funds invest heavily in banks",
    "alternatives to hdfc small cap",
    "Tell me about HDFC Small Cap Fund",
    "show me something better than this",
    "expense ratio of hdfc flexi cap",
    "who is the fund manager of parag parikh flexi cap",
    "5 year cagr of sbi small cap",
    "credit rating of hdfc corporate bond fund",
  ],
  // user's real session #2 (2 Nov): fund names containing category words; compare by category
  [
    "best small cap fund?",
    "Tell me about BANK OF INDIA SMALL CAP FUND",
    "Tell me about Union Small Cap Fund",
    "compare top 2 large cap",
    "compare top 3 flexi cap",
    "best large cap vs best mid cap",
    "compare bank of india small cap vs dsp small cap",
    "Tell me about Invesco India Financial Services Fund",
    "bank of india small cap batting avg",
    "best banking funds",
    "Tell me about SBI Banking & Financial Services Fund",
  ],
  // user's real session (2 Nov)
  [
    "if parag flexi cap fund good according to batting avg?",
    "whats return of it?",
    "what its return in 6m?",
    "is it good?",
    "Best Flexi Cap funds",
    "Compare the top 2",
    "which is best small cap fund?",
    "Sort by resilience",
    "whats parag flexi cap batting avg?",
    "whats parag flexi cap funds batting avg?",
    "what is batting average?",
  ],
  ["Best small cap funds?", "what about midcap?", "compare the first two", "tell me more about the second one", "is it good for long term?"],
  ["Best passive funds"],
  ["Best mutual funds to consider in technology sector", "sector shifts in technology"],
  ["Most resilient flexi cap funds", "show top 10"],
  ["safest large cap funds"],
  ["Compare Parag Parikh Flexi Cap vs HDFC Flexi Cap"],
  ["is parag parikh flexi cap good?"],
  ["hdfc small cap fund"],
  ["what is batting average?"],
  ["how do you rank funds?"],
  ["Where are fund managers moving money?"],
  ["best elss funds"],
  ["top 3 gold etfs"],
  ["best liquid funds"],
  ["should I buy quant small cap?"],
  ["will nifty crash next month?"],
  ["why did small caps fall last week?"],
  ["hello"],
  // harder ones: expected to need the LLM
  ["funds that didn't fall much in covid but still give good returns"],
  ["good fund for me?"],
  ["i want to save tax and i am a beginner"],
  ["something low risk to park money for 6 months"],
  ["Best aggressive hybrid funds (balanced)"],
  ["which tech funds held up well when markets crashed?"],
  ["compare top 3 midcaps on consistency"],
  ["kya small cap fund abhi lena sahi hai?"],
];

function summarize(b: Block): string {
  switch (b.type) {
    case "text":
      return `  text: ${b.text.slice(0, 160)}`;
    case "note":
      return `  note: ${b.text.slice(0, 120)}`;
    case "fund_table":
      return `  table[${b.title}]:\n` + b.rows.map((r, i) => `    ${i + 1}. ${r.name} | score ${r.score?.toFixed(0)} | ${JSON.stringify(Object.values(r.pillars).map((v) => (v === null ? null : Math.round(v))))}`).join("\n");
    case "fund_card":
      return `  card: ${b.fund.name} score ${b.fund.score?.toFixed(0)}\n` + b.facts.map((f) => `    ${f.label}: ${f.value}${f.hint ? ` (${f.hint})` : ""}`).join("\n") + `\n    + ${b.strengths.join(" | ")}\n    - ${b.watch.join(" | ")}`;
    case "fund_detail": {
      const d = b.d;
      return [
        `  detail: ${d.fund.name} score ${d.fund.score?.toFixed(0)} · ${d.verdict.label}`,
        `    + ${d.standout.good.join(" | ")}`,
        `    - ${d.standout.watch.join(" | ")}`,
        `    returns: ${d.returns.map((r) => `${r.label} ${r.fund?.toFixed(1)} (cat ${r.cat?.toFixed(1)})`).join(", ")}`,
        d.consistency ? `    consistency: ${d.consistency.beat}/${d.consistency.of} ${d.consistency.badge} ${d.consistency.months.map((m) => (m.beat ? "●" : "○")).join("")}` : "    consistency: -",
        d.sip ? `    sip: ${d.sip.invested} -> ${Math.round(d.sip.value)} (${d.sip.gain_pct.toFixed(1)}%) from ${d.sip.started}, ${d.sip.instalments} instalments` : "    sip: -",
        d.rank ? `    rank: #${d.rank.now}/${d.rank.of} ${d.rank.badge}; ${d.rank.history.map((h) => `${h.label} #${h.rank}`).join(" ")}; 3m change ${d.rank.change_3m}` : "    rank: -",
        d.recovery ? `    recovery: ${d.recovery.summary} | ${d.recovery.crashes.map((c) => `${c.name}: ${c.status} ${c.fall ?? ""}/${c.recovered_months ?? ""}`).join("; ")}` : "    recovery: -",
        `    better: ${d.better_peers.map((p) => `${p.name} ${p.score}`).join(", ")}`,
      ].join("\n");
    }
    case "holdings":
      return `  holdings [${b.title}]: ` + b.rows.slice(0, 6).map((r) => `${r.label} ${r.pct}%`).join(", ");
    case "overlap":
      return `  overlap ${b.overlap_pct}% (${b.a} vs ${b.b}): ` + b.rows.slice(0, 6).map((r) => `${r.label} ${r.a}/${r.b}`).join(", ");
    case "compare":
      return `  compare: ${b.funds.map((f) => f.name).join(" vs ")}\n` + b.rows.map((r) => `    ${r.label}: ${r.values.join(" | ")}${r.best !== undefined ? ` (best: ${r.best + 1})` : ""}`).join("\n");
    case "sector_shifts":
      return `  shifts ${b.period}\n    up: ${b.up.map((r) => `${r.sector} ${r.change_pp}`).join(", ")}\n    down: ${b.down.map((r) => `${r.sector} ${r.change_pp}`).join(", ")}`;
    case "heading":
      return `  ## ${b.text}`;
    case "bullets":
      return b.items.map((x) => `   • ${x}`).join("\n");
    case "verdict":
      return `  [${b.tone}] ${b.label}: ${b.text}`;
    case "bars":
      return `  bars ${b.title}: ` + b.rows.map((r) => `${r.label} ${r.value} vs ${r.ref?.toFixed(2)}`).join(" | ");
    case "facts":
      return "  facts: " + b.facts.map((f) => `${f.label}=${f.value}${f.hint ? ` (${f.hint})` : ""}`).join(" | ");
    case "choices":
      return `  choices: ${b.text} [${b.options.join(" / ")}]`;
  }
}

async function main() {
  const only = process.argv[2];
  for (const conv of CONVERSATIONS) {
    if (only && !conv[0].toLowerCase().includes(only.toLowerCase())) continue;
    let ctx: ChatContext = {};
    console.log("\n==========================================");
    for (const q of conv) {
      ctx = { ...ctx, history: [...(ctx.history ?? []), q].slice(-4) };
      const t0 = Date.now();
      const p = await parse(q, ctx);
      const r = await execute(p.intent, ctx);
      ctx = r.context;
      console.log(`\nQ: ${q}\n  [${p.route}] ${JSON.stringify(p.intent)}  (${Date.now() - t0} ms)`);
      for (const b of r.blocks) console.log(summarize(b));
    }
  }
}

main().then(() => setTimeout(() => process.exit(0), 50));
