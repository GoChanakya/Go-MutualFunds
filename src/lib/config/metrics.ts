// Metric guide used by explain_metric. Plain text, written by us; GoChanakya should review the wording.

export type MetricGuide = { key: string; name: string; syn: string[]; what: string; why: string; limits: string };

export const METRICS: MetricGuide[] = [
  {
    key: "score",
    name: "GoChanakya 5-pillar score",
    syn: ["5 point score", "5-point score", "five point", "5 pillar", "five pillar", "overall score", "your score", "rank funds", "ranking", "how do you rank", "score"],
    what: "One number from 0 to 100 that combines five pillars: Resilience, Consistency, Momentum, Returns and Track record. Each pillar compares a fund only with funds in the same category (small caps with small caps, and so on).",
    why: "No single number tells the full story. A fund with great returns but poor consistency or slow recovery after crashes is riskier than it looks.",
    limits: "It is based on past data and does not predict future returns. Scores for categories with very few funds are less meaningful.",
  },
  {
    key: "resilience",
    name: "Resilience",
    syn: ["resilience", "resilient", "recovery", "recovery speed", "downside", "crash"],
    what: "How well a fund holds up in market falls and how quickly it gets back to its previous high, measured over past stress events such as Covid 2020 and IL&FS 2018.",
    why: "Fast recovery means less time waiting underwater and a smoother experience for investors.",
    limits: "Past crashes differ from future ones. Newer funds have been through fewer stress events.",
  },
  {
    key: "consistency",
    name: "Consistency (batting average)",
    syn: ["consistency", "consistent", "batting average", "batting"],
    what: "Out of the last 12 months, in how many months the fund beat its category average.",
    why: "A fund that beats peers most months is less dependent on one lucky period.",
    limits: "It counts wins, not the size of wins or losses.",
  },
  {
    key: "momentum",
    name: "Momentum",
    syn: ["momentum", "momentum rank", "trending", "rank momentum"],
    what: "The fund's current rank within its category by recent (6-month) performance, and how many places it has climbed or slipped over the last 6 months.",
    why: "Shows which funds are improving or losing ground right now.",
    limits: "Momentum can reverse quickly. It should not be used alone.",
  },
  {
    key: "returns",
    name: "Returns",
    syn: ["returns", "return", "performance", "sip return"],
    what: "The fund's 1-year return and the result of a 3-year monthly SIP, compared with its category.",
    why: "What an investor actually earned.",
    limits: "Past returns do not guarantee future returns. Short periods can be noisy.",
  },
  {
    key: "track_record",
    name: "Track record",
    syn: ["track record", "aum", "fund size", "fund age", "age", "assets under management"],
    what: "Fund size (assets under management) and how long the fund has existed, compared with its category.",
    why: "Larger, older funds have been tested across more market cycles and are trusted by more investors.",
    limits: "Very large funds can find it harder to stay nimble, especially in small caps.",
  },
  {
    key: "passive",
    name: "Active vs passive funds",
    syn: ["passive", "active vs passive", "index fund", "what is an etf", "etf"],
    what: "Active funds have a manager choosing stocks to beat a benchmark. Passive funds (index funds and ETFs) simply copy an index such as the Nifty 50.",
    why: "Passive funds are usually cheaper and predictable. Active funds can beat the index but may also lag it.",
    limits: "For passive funds, cost and tracking error matter most; our pillars compare them within their own group.",
  },
  {
    key: "sector_shift",
    name: "Sector shifts",
    syn: ["sector shift", "sector rotation", "sectoral shift"],
    what: "How mutual funds changed their sector weights between two portfolio disclosures, for example more IT and less banking.",
    why: "Shows where fund managers, as a group, are adding or cutting exposure.",
    limits: "Changes can come from price moves as well as buying and selling. Disclosures are monthly and lag the market.",
  },
];
