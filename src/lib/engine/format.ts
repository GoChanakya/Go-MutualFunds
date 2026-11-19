export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export const fmtPct = (v: unknown, digits = 1) => {
  const n = num(v);
  return n === null ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
};

export const fmtCr = (lakhs: unknown) => {
  const n = num(lakhs);
  return n === null ? "-" : `₹${Math.round(n / 100).toLocaleString("en-IN")} Cr`;
};

export const fmtInr = (v: unknown) => {
  const n = num(v);
  return n === null ? "-" : `₹${Math.round(n).toLocaleString("en-IN")}`;
};

export const fmtYears = (v: unknown) => {
  const n = num(v);
  return n === null ? "-" : `${n.toFixed(1)} yrs`;
};

export const fmtMonths = (v: unknown) => {
  const n = num(v);
  return n === null ? "-" : `${n.toFixed(1)} months`;
};

export const fmtScore = (v: unknown) => {
  const n = num(v);
  return n === null ? "-" : String(Math.round(n));
};
