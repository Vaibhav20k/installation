/**
 * Component progress and remaining scope (master prompt sections 5, 6 and 8).
 * Completion is never inferred from hours; reversals reference the event they reverse.
 */
import { Dec, sumDec } from "./decimal";

export interface ProgressEvent { id: string; quantityDelta: string; reversesEventId?: string | null; accepted: boolean }

export function validateProgressEvent(scopedQuantity: string, existing: ProgressEvent[], next: ProgressEvent): string[] {
  const errors: string[] = [];
  const delta = Dec.of(next.quantityDelta);
  if (delta.isZero()) errors.push("A progress event must change the quantity.");
  if (delta.isNegative()) {
    const target = existing.find((e) => e.id === next.reversesEventId);
    if (!next.reversesEventId || !target) errors.push("A negative delta is only allowed as an explicit reversal of an earlier event.");
    else {
      const alreadyReversed = sumDec(existing.filter((e) => e.reversesEventId === target.id).map((e) => e.quantityDelta));
      if (Dec.of(target.quantityDelta).add(alreadyReversed).add(delta).isNegative()) errors.push("The reversal exceeds the quantity of the event it reverses.");
    }
  } else if (next.reversesEventId) errors.push("Only negative deltas can reverse an event.");
  const accepted = acceptedCompleted([...existing, next]);
  if (accepted.isNegative()) errors.push("Accepted quantity cannot become negative.");
  if (accepted.cmp(scopedQuantity) > 0) errors.push("Accepted quantity would exceed approved scope; excess output needs an approved scope change.");
  return errors;
}

export function acceptedCompleted(events: ProgressEvent[]): Dec {
  return sumDec(events.filter((e) => e.accepted).map((e) => e.quantityDelta));
}

/** remainingQuantity = max(0, scopedQuantity - acceptedCompletedQuantity), validated not masked. */
export function remainingQuantity(scopedQuantity: string, acceptedQty: Dec | string): { remaining: string; valid: boolean; problem?: string } {
  const s = Dec.of(scopedQuantity);
  const a = Dec.of(acceptedQty);
  if (a.isNegative()) return { remaining: s.toString(), valid: false, problem: "Accepted quantity is negative" };
  if (a.cmp(s) > 0) return { remaining: "0", valid: false, problem: "Accepted quantity exceeds scope" };
  return { remaining: s.sub(a).max(0).toString(), valid: true };
}

/**
 * Remaining scope available to a new visit: task quantity minus accepted output minus
 * quantity already committed to other active visits (disjoint allocations only).
 */
export function uncommittedQuantity(taskQuantity: string, accepted: Dec | string, activeCommitments: string[]): string {
  const left = Dec.of(taskQuantity).sub(accepted).sub(sumDec(activeCommitments));
  return left.max(0).toString();
}

export function canCommitScope(taskQuantity: string, accepted: Dec | string, activeCommitments: string[], requested: string): { ok: boolean; available: string } {
  const available = uncommittedQuantity(taskQuantity, accepted, activeCommitments);
  const r = Dec.of(requested);
  return { ok: r.isPositive() && r.cmp(available) <= 0, available };
}
