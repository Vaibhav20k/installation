/**
 * Expense math in integer minor currency units (master prompt section 10).
 */
import { Dec } from "./decimal";

export type LineBasis = "per_person_day" | "per_person_night" | "per_team_night" | "per_trip" | "per_unit" | "per_room_night" | "fixed";

export const EXPENSE_CATEGORIES = [
  "meal", "accommodation", "outbound_travel", "return_travel", "local_transport",
  "consumables", "unloading", "additional_manpower", "rework", "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface EstimateLineInput {
  category: ExpenseCategory;
  basis: LineBasis;
  /** Explicit multiplicands, e.g. { people: 3, nights: 2 } or { rooms: 2, nights: 3 }. */
  factors: Record<string, number | string>;
  unitRateMinor: number;
}

/** lineAmount = product(factors) * unitRate, rounded half away from zero to the minor unit once. */
export function lineAmountMinor(line: EstimateLineInput): { amountMinor: number; quantity: string; formula: string } {
  if (!Number.isInteger(line.unitRateMinor) || line.unitRateMinor < 0) throw new Error("Unit rate must be a nonnegative integer in minor units");
  let qty = Dec.of(1);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(line.factors)) {
    const d = Dec.of(v);
    if (d.isNegative()) throw new Error(`Factor ${k} cannot be negative`);
    qty = qty.mul(d);
    parts.push(`${v} ${k}`);
  }
  const amount = qty.mul(line.unitRateMinor).roundToInt();
  return { amountMinor: Number(amount), quantity: qty.toString(), formula: `${parts.join(" x ") || "1"} x ${line.unitRateMinor}` };
}

export function sumMinor(values: number[]): number {
  let t = 0n;
  for (const v of values) {
    if (!Number.isInteger(v)) throw new Error("Money must be integer minor units");
    t += BigInt(v);
  }
  return Number(t);
}

export interface ExpenseRecord { id: string; amountMinor: number; currency: string; state: "submitted" | "approved" | "rejected" }

export function expenseTotals(expenses: ExpenseRecord[], currency: string) {
  const mixed = expenses.some((e) => e.currency !== currency);
  const pick = (s: ExpenseRecord["state"]) => sumMinor(expenses.filter((e) => e.state === s && e.currency === currency).map((e) => e.amountMinor));
  return { currency, submitted: pick("submitted"), approved: pick("approved"), rejected: pick("rejected"), otherCurrencyExcluded: mixed };
}

export function varianceSummary(input: { estimatedTotalMinor: number | null; approvedBudgetMinor: number | null; approvedActualMinor: number }) {
  const { estimatedTotalMinor: est, approvedBudgetMinor: budget, approvedActualMinor: actual } = input;
  const budgetVariance = budget === null ? null : actual - budget;
  return {
    estimateVarianceMinor: est === null ? null : actual - est,
    budgetVarianceMinor: budgetVariance,
    remainingBudgetMinor: budget === null ? null : budget - actual,
    // Missing budgets are not zero budgets; zero/absent yields N/A.
    budgetVariancePercent: budget !== null && budget > 0 && budgetVariance !== null ? Math.round((budgetVariance / budget) * 10000) / 100 : null,
  };
}

/**
 * Splits an amount across weights so parts sum exactly to the source.
 * Largest-remainder rule; ties go to the earlier index (deterministic).
 */
export function allocateMinor(amountMinor: number, weights: number[]): number[] {
  if (!Number.isInteger(amountMinor)) throw new Error("Amount must be integer minor units");
  if (weights.length === 0) throw new Error("At least one allocation target is required");
  if (weights.some((w) => !(w >= 0))) throw new Error("Weights must be nonnegative");
  const W = weights.reduce((a, b) => a + b, 0);
  if (W <= 0) throw new Error("Weights must not all be zero");
  const scaled = weights.map((w) => Dec.of(amountMinor).mul(Dec.of(w)).div(Dec.of(W)));
  const floors = scaled.map((d) => {
    const i = d.roundToInt();
    return d.cmp(Dec.of(i)) < 0 ? i - 1n : i;
  });
  let residual = BigInt(amountMinor) - floors.reduce((a, b) => a + b, 0n);
  const order = scaled
    .map((d, i) => ({ i, frac: d.sub(Dec.of(floors[i]!)) }))
    .sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);
  const out = [...floors];
  for (let k = 0; residual > 0n; k = (k + 1) % order.length, residual--) out[order[k]!.i]! += 1n;
  return out.map(Number);
}

export function formatMoney(minor: number | null, currency = "INR"): string {
  if (minor === null) return "N/A";
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = currency === "INR" ? indianGrouping(major) : major.toLocaleString("en-US");
  return `${neg ? "-" : ""}${currency === "INR" ? "₹" : currency + " "}${grouped}${paise ? "." + String(paise).padStart(2, "0") : ""}`;
}

function indianGrouping(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}
