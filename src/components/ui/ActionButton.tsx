"use client";
/**
 * A button bound to one server action. Destructive actions confirm in an accessible <dialog>
 * that restores focus to the button afterwards. Results are announced in a live region.
 */
import { useId, useRef } from "react";
import { useAction, type ActionResult } from "./useAction";
import { ResultNotice } from "./ResultNotice";

export function ActionButton<I>({ action, input, label, confirm, tone, successText, className }: {
  action: (input: I) => Promise<ActionResult<unknown>>; input: I; label: string; confirm?: string; tone?: "primary" | "danger"; successText?: string; className?: string;
}) {
  const { run, pending, result } = useAction(action);
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const go = () => (confirm ? dialog.current?.showModal() : run(input));
  return (
    <span className="stack" style={{ gap: 4 }}>
      <button ref={button} type="button" className={[tone, className].filter(Boolean).join(" ")} onClick={go} disabled={pending} aria-busy={pending}>
        {pending ? "Working…" : label}
      </button>
      {confirm && (
        <dialog ref={dialog} aria-labelledby={titleId} onClose={() => button.current?.focus()}>
          <h2 id={titleId}>{label}?</h2>
          <p>{confirm}</p>
          <div className="row">
            <button type="button" className={tone === "danger" ? "danger" : "primary"} onClick={() => { dialog.current?.close(); run(input); }}>{label}</button>
            <button type="button" onClick={() => dialog.current?.close()} autoFocus>Cancel</button>
          </div>
        </dialog>
      )}
      <ResultNotice result={result} successText={successText} />
    </span>
  );
}
