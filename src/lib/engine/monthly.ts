import "server-only";
import { query } from "@/lib/data/store";
import type { Block } from "@/lib/types";
import { num } from "./format";

// Returns built from month-end NAVs (gs://mf-data-public/monthly_returns): last 36 months, each with the category average.
// Period returns compound the monthly figures; 3 years is annualised.

export type Period = { key: "1m" | "3m" | "6m" | "1y" | "3y"; label: string; fund: number | null; cat: number | null };

export type MonthlyView = {
  latest: string; // "2026-10"
  latestLabel: string; // "Oct 2026"
  months: { month: string; ret: number; cat: number | null; beat: boolean }[]; // newest first
  periods: Period[];
  beat36: number | null;
  comparable36: number | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm) - 1] ?? mm} ${y}`;
};

// Compound the newest n monthly returns (in %). Null unless all n months exist and are consecutive.
function compound(xs: (number | null)[], n: number, annualiseYears?: number): number | null {
  if (xs.length < n) return null;
  const slice = xs.slice(0, n);
  if (slice.some((x) => x === null)) return null;
  const growth = (slice as number[]).reduce((g, r) => g * (1 + r / 100), 1);
  const total = annualiseYears ? Math.pow(growth, 1 / annualiseYears) - 1 : growth - 1;
  return Number((total * 100).toFixed(2));
}

const consecutive = (a: string, b: string) => {
  // a is the month right after b ("2026-10" after "2026-09")
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return ya * 12 + ma - (yb * 12 + mb) === 1;
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function monthlyView(code: string): Promise<MonthlyView | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT month, ret_pct, cat_pct, beat, beat_36, comparable_36 FROM monthly WHERE scheme_code = ${q(code)} ORDER BY month DESC LIMIT 36`,
  );
  if (!rows.length) return null;
  // keep only the unbroken run of months ending at the latest one
  const run: Record<string, unknown>[] = [rows[0]];
  for (let i = 1; i < rows.length && consecutive(String(rows[i - 1].month), String(rows[i].month)); i++) run.push(rows[i]);

  const fund = run.map((r) => num(r.ret_pct));
  const cat = run.map((r) => num(r.cat_pct));
  const P = (key: Period["key"], label: string, n: number, years?: number): Period => ({ key, label, fund: compound(fund, n, years), cat: compound(cat, n, years) });

  return {
    latest: String(run[0].month),
    latestLabel: monthLabel(String(run[0].month)),
    months: run.map((r) => ({ month: String(r.month), ret: Number(r.ret_pct), cat: num(r.cat_pct), beat: Number(r.beat) === 1 })),
    periods: [P("1m", "1 month", 1), P("3m", "3 months", 3), P("6m", "6 months", 6), P("1y", "1 year", 12), P("3y", "3 years (a year)", 36, 3)],
    beat36: num(run[0].beat_36),
    comparable36: num(run[0].comparable_36),
  };
}

// Last 12 months, fund vs category, newest first.
export function monthlyBars(v: MonthlyView): Block {
  return {
    type: "bars",
    title: `Monthly returns vs category average (to ${v.latestLabel})`,
    unit: "%",
    series: ["This fund", "Category average"],
    rows: v.months.slice(0, 12).map((m) => ({ label: monthLabel(m.month), value: m.ret, ref: m.cat })),
  };
}
