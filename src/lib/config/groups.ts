// Peer-group catalog. `code` matches the `group` / goc_short_code values in backend_main_kartik.
// `syn` are phrases the rule parser looks for (lowercase). Longest match wins.

export type GroupDef = {
  code: string;
  name: string;
  syn: string[];
  kind: "equity" | "sector" | "hybrid" | "debt" | "passive" | "commodity" | "solution" | "fof" | "other";
};

export const GROUPS: GroupDef[] = [
  // Equity - diversified
  { code: "EQS-LRG", name: "Large Cap", kind: "equity", syn: ["large cap", "largecap", "large-cap", "bluechip", "blue chip"] },
  { code: "EQS-MID", name: "Mid Cap", kind: "equity", syn: ["mid cap", "midcap", "mid-cap"] },
  { code: "EQS-SMC", name: "Small Cap", kind: "equity", syn: ["small cap", "smallcap", "small-cap"] },
  { code: "EQS-LMF", name: "Large & Mid Cap", kind: "equity", syn: ["large and mid cap", "large & mid cap", "large and midcap", "large & midcap", "large mid cap"] },
  { code: "EQS-FLX", name: "Flexi Cap", kind: "equity", syn: ["flexi cap", "flexicap", "flexi-cap"] },
  { code: "EQS-MUC", name: "Multi Cap", kind: "equity", syn: ["multi cap", "multicap", "multi-cap"] },
  { code: "EQS-FOC", name: "Focused", kind: "equity", syn: ["focused fund", "focused funds", "focused"] },
  { code: "EQS-VAL", name: "Value", kind: "equity", syn: ["value fund", "value funds", "value investing"] },
  { code: "EQS-CTR", name: "Contra", kind: "equity", syn: ["contra"] },
  { code: "EQS-DYF", name: "Dividend Yield", kind: "equity", syn: ["dividend yield"] },
  { code: "EQS-ELS", name: "ELSS (Tax Saver)", kind: "equity", syn: ["elss", "tax saver", "tax saving", "tax-saving", "save tax", "saving tax", "80c"] },

  // Equity - sectoral / thematic
  { code: "EQS-SCT-DIG", name: "Technology", kind: "sector", syn: ["technology", "tech", "it sector", "it fund", "it funds", "digital", "software"] },
  { code: "EQS-SCT-BFI", name: "Banking & Financial Services", kind: "sector", syn: ["banking", "bank", "financial services", "bfsi", "finance sector", "financials"] },
  { code: "EQS-SCT-HLT", name: "Healthcare & Pharma", kind: "sector", syn: ["healthcare", "health care", "pharma", "pharmaceutical"] },
  { code: "EQS-SCT-CON", name: "Consumption & FMCG", kind: "sector", syn: ["consumption", "fmcg", "consumer"] },
  { code: "EQS-SCT-INF", name: "Infrastructure & Power", kind: "sector", syn: ["infrastructure", "infra", "power"] },
  { code: "EQS-SCT-MNF", name: "Manufacturing", kind: "sector", syn: ["manufacturing"] },
  { code: "EQS-SCT-ENR", name: "Energy & Natural Resources", kind: "sector", syn: ["energy", "natural resources", "oil and gas"] },
  { code: "EQS-SCT-PSU", name: "PSU", kind: "sector", syn: ["psu", "public sector"] },
  { code: "EQS-SCT-DEF", name: "Defence", kind: "sector", syn: ["defence", "defense"] },
  { code: "EQS-SCT-TRN", name: "Transportation & Logistics", kind: "sector", syn: ["transportation", "logistics", "transport"] },
  { code: "EQS-SCT-MNC", name: "MNC", kind: "sector", syn: ["mnc", "multinational"] },
  { code: "EQS-SCT-ESG", name: "ESG", kind: "sector", syn: ["esg", "sustainable"] },
  { code: "EQS-SCT-QNT", name: "Quant", kind: "sector", syn: ["quant fund", "quant funds", "quantitative"] },
  { code: "EQS-SCT-INN", name: "Innovation", kind: "sector", syn: ["innovation"] },
  { code: "EQS-SCT-CYC", name: "Business Cycle", kind: "sector", syn: ["business cycle"] },
  { code: "EQS-SCT-HSG", name: "Housing", kind: "sector", syn: ["housing", "real estate"] },
  { code: "EQS-SCT-SBT", name: "Smart Beta / Factor", kind: "sector", syn: ["smart beta", "factor", "low volatility", "minimum variance"] },
  { code: "EQS-SCT-SSC", name: "Special Situations", kind: "sector", syn: ["special situation", "special opportunities"] },
  { code: "EQS-SCT-ETH", name: "Ethical / Shariah", kind: "sector", syn: ["ethical", "shariah"] },
  { code: "EQS-SCT-CGL", name: "Conglomerate", kind: "sector", syn: ["conglomerate"] },
  { code: "EQS-SCT", name: "Other Thematic", kind: "sector", syn: ["thematic"] },

  // Hybrid
  { code: "HYB-AHF", name: "Aggressive Hybrid", kind: "hybrid", syn: ["aggressive hybrid"] },
  { code: "HYB-BAF", name: "Balanced Advantage / Dynamic Asset Allocation", kind: "hybrid", syn: ["balanced advantage", "dynamic asset allocation", "baf"] },
  { code: "HYB-MAA", name: "Multi Asset Allocation", kind: "hybrid", syn: ["multi asset", "multi-asset"] },
  { code: "HYB-ARB", name: "Arbitrage", kind: "hybrid", syn: ["arbitrage"] },
  { code: "HYB-EQS", name: "Equity Savings", kind: "hybrid", syn: ["equity savings"] },
  { code: "HYB-CHB", name: "Conservative Hybrid", kind: "hybrid", syn: ["conservative hybrid"] },
  { code: "HYB-BHF", name: "Balanced Hybrid", kind: "hybrid", syn: ["balanced hybrid"] },

  // Debt
  { code: "DES-LIQ", name: "Liquid", kind: "debt", syn: ["liquid fund", "liquid funds", "liquid"] },
  { code: "DES-ONF", name: "Overnight", kind: "debt", syn: ["overnight"] },
  { code: "DES-MMF", name: "Money Market", kind: "debt", syn: ["money market"] },
  { code: "DES-USD", name: "Ultra Short Duration", kind: "debt", syn: ["ultra short"] },
  { code: "DES-SDF", name: "Short Duration", kind: "debt", syn: ["short duration", "short term debt", "short term fund"] },
  { code: "DES-MDF", name: "Medium Duration", kind: "debt", syn: ["medium duration"] },
  { code: "DES-MLD", name: "Medium to Long Duration", kind: "debt", syn: ["medium to long"] },
  { code: "DES-LGD", name: "Long Duration", kind: "debt", syn: ["long duration"] },
  { code: "DES-CRB", name: "Corporate Bond", kind: "debt", syn: ["corporate bond"] },
  { code: "DES-BPF", name: "Banking & PSU Debt", kind: "debt", syn: ["banking and psu", "banking & psu", "psu debt"] },
  { code: "DES-GLT", name: "Gilt", kind: "debt", syn: ["gilt"] },
  { code: "DES-GCD", name: "10-yr Constant Maturity Gilt", kind: "debt", syn: ["constant maturity"] },
  { code: "DES-DTF", name: "Dynamic Bond", kind: "debt", syn: ["dynamic bond", "dynamic debt"] },
  { code: "DES-CRF", name: "Credit Risk", kind: "debt", syn: ["credit risk"] },
  { code: "DES-FLT", name: "Floater", kind: "debt", syn: ["floater", "floating rate"] },

  // Passive
  { code: "EQS-IXF", name: "Equity Index Funds", kind: "passive", syn: ["index fund", "index funds", "nifty 50 index", "sensex index"] },
  { code: "ETF-EQE", name: "Equity ETFs", kind: "passive", syn: ["equity etf", "etf", "etfs"] },
  { code: "EQS-OTH", name: "Other Equity ETFs", kind: "passive", syn: [] },
  { code: "OTH-EQS", name: "Equity Index Funds (Other)", kind: "passive", syn: [] },
  { code: "DES-IXF", name: "Debt Index Funds", kind: "passive", syn: ["debt index", "target maturity"] },
  { code: "ETF-DET", name: "Debt ETFs", kind: "passive", syn: ["debt etf"] },

  // Commodity
  { code: "ETF-GLD", name: "Gold ETFs", kind: "commodity", syn: ["gold etfs", "gold etf", "gold"] },
  { code: "COM-GLD", name: "Gold ETFs (Other)", kind: "commodity", syn: [] },
  { code: "COM-FFD", name: "Gold / Silver FoFs", kind: "commodity", syn: ["gold fund", "gold fof", "silver fund"] },
  { code: "COM-OTH", name: "Silver & Other Commodity ETFs", kind: "commodity", syn: ["silver"] },

  // Solution oriented & FoF
  { code: "SOS-RTF", name: "Retirement", kind: "solution", syn: ["retirement"] },
  { code: "SOS-CHF", name: "Children's", kind: "solution", syn: ["children", "child"] },
  { code: "EQS-FFO", name: "International Equity FoFs", kind: "fof", syn: ["international", "global", "overseas", "us stocks", "nasdaq"] },
  { code: "OTH-FFO", name: "International FoFs (Other)", kind: "fof", syn: [] },
  { code: "OTH-FFD", name: "Domestic FoFs", kind: "fof", syn: ["fund of funds", "fof"] },
];

// Some intents should search more than one code.
export const GROUP_EXPAND: Record<string, string[]> = {
  "EQS-ELS": ["EQS-ELS", "ELS"],
  "EQS-IXF": ["EQS-IXF", "OTH-EQS"],
  "ETF-EQE": ["ETF-EQE", "EQS-OTH"],
  "ETF-GLD": ["ETF-GLD", "COM-GLD"],
  "EQS-FFO": ["EQS-FFO", "OTH-FFO", "ETF-INT"],
};

// Default set when a question names no category: diversified active equity.
export const DEFAULT_EQUITY_GROUPS = ["EQS-LRG", "EQS-MID", "EQS-SMC", "EQS-LMF", "EQS-FLX", "EQS-MUC", "EQS-FOC", "EQS-VAL", "EQS-CTR", "EQS-DYF", "EQS-ELS"];

// Default set for "best passive funds" with no category: equity index funds + ETFs.
export const DEFAULT_PASSIVE_GROUPS = ["EQS-IXF", "OTH-EQS", "ETF-EQE", "EQS-OTH"];

export const GROUP_BY_CODE = new Map(GROUPS.map((g) => [g.code, g]));

export function groupName(code: string): string {
  return GROUP_BY_CODE.get(code)?.name ?? code;
}

export function expandGroups(codes: string[]): string[] {
  return [...new Set(codes.flatMap((c) => GROUP_EXPAND[c] ?? [c]))];
}

// Sector-holding labels (from sector_rotation) that belong to each sectoral theme.
export const THEME_SECTOR_PATTERNS: Record<string, RegExp> = {
  "EQS-SCT-DIG": /\b(it|software|technology|internet|semiconductor|telecom|computer|data processing)\b/i,
  "EQS-SCT-BFI": /\b(bank|banks|finance|financial|insurance|capital markets|fintech|nbfc)\b/i,
  "EQS-SCT-HLT": /\b(pharma|pharmaceuticals|health|healthcare|biotechnology|hospital|life sciences)\b/i,
  "EQS-SCT-CON": /\b(fmcg|consumer|food|beverages|retail|personal products|household|leisure)\b/i,
  "EQS-SCT-INF": /\b(power|construction|cement|infrastructure|electrical|industrial|utilities|capital goods)\b/i,
  "EQS-SCT-ENR": /\b(oil|gas|petroleum|energy|consumable fuels|coal|metals|mining)\b/i,
  "EQS-SCT-DEF": /\b(aerospace|defense|defence)\b/i,
  "EQS-SCT-TRN": /\b(automobiles?|auto components|transport|logistics|airlines)\b/i,
  "EQS-SCT-HSG": /\b(realty|real estate|cement|construction|housing)\b/i,
  "EQS-SCT-MNF": /\b(industrial|manufacturing|electrical|auto components|chemicals)\b/i,
};
