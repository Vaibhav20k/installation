/**
 * Handover due flag. Overdue is a red stamp with a text label and the due date, plus a slow, gentle pulse
 * where motion is allowed (static under reduced motion). Colour is never the only signal.
 */
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { HandoverState } from "@/domain/handover";
import { shortDate } from "@/domain/install-schedule";

export function HandoverFlag({ state, compact }: { state: HandoverState; compact?: boolean }) {
  if (state.kind === "overdue") {
    return (
      <span className="handover-flag" data-state="overdue">
        <WarningCircle size={16} weight="fill" aria-hidden />
        Overdue handover · due {shortDate(state.due)}{!compact && ` · ${state.days} day${state.days === 1 ? "" : "s"} late`}
      </span>
    );
  }
  if (state.kind === "not_set") return <span className="handover-flag" data-state="not_set">Handover date not set</span>;
  if (state.kind === "due" && !compact) return <span className="handover-flag" data-state="due">Handover due {shortDate(state.due)}</span>;
  return null;
}
