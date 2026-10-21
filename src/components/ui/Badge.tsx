/** Status badge: colour is always paired with a symbol and a text label. */
import { LABEL } from "@/domain/lifecycle";

type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "accent";

const TONES: Record<string, Tone> = {
  approved: "ok", accepted: "ok", cleared: "ok", confirmed: "ok", completed: "ok", closed: "ok", pass: "ok", eligible: "ok", final: "ok", Rated: "ok", "On target": "ok",
  submitted: "accent", scheduled: "accent", in_progress: "accent", held: "accent", provisional: "warn",
  draft: "neutral", proposed: "neutral", unscheduled: "neutral", pending: "warn", requested: "warn", pending_policy: "warn", on_hold: "warn", open: "warn", reopened: "warn", na: "neutral",
  returned: "bad", rejected: "bad", ineligible: "bad", fail: "bad", expired: "bad", revoked: "bad", cancelled: "neutral", released: "neutral", voided: "neutral", invalidated: "bad",
  "Not rated": "neutral", "Off target": "bad", illustrative: "warn",
};
const SYMBOL: Record<Tone, string> = { ok: "✓", warn: "!", bad: "×", info: "•", neutral: "•", accent: "→" };

export function Badge({ state, label, tone, className }: { state: string; label?: string; tone?: Tone; className?: string }) {
  const t = tone ?? TONES[state] ?? "neutral";
  return (
    <span className={className ? `badge ${className}` : "badge"} data-tone={t}>
      <span aria-hidden="true">{SYMBOL[t]}</span>
      {label ?? LABEL[state] ?? state.replace(/_/g, " ")}
    </span>
  );
}

export function DemoTag() {
  return <Badge state="illustrative" label="Demo data" tone="warn" />;
}
