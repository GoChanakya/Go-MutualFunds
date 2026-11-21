// Only a newly successful charge may extend a subscription's paid access.
// Razorpay can move current_end forward while a renewal is pending or halted.
export function paidThrough(previousCount: number, previousThrough: number, paidCount: number, currentEndSeconds: number | null): number {
  const currentEnd = Math.max(0, Number(currentEndSeconds ?? 0)) * 1000;
  const newlyPaid = paidCount > previousCount || (paidCount > 0 && previousThrough === 0);
  return newlyPaid && Number.isFinite(currentEnd) ? Math.max(previousThrough, currentEnd) : previousThrough;
}
