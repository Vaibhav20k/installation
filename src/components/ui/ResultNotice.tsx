"use client";
import type { ActionResult } from "./useAction";

const TITLES: Record<string, string> = {
  validation: "Please fix this", forbidden: "Not permitted", conflict: "Conflict", not_found: "Not found",
  unavailable: "Service unavailable", unexpected: "Something went wrong", unauthenticated: "Sign in required",
};

/** Announces a server result. Stale-conflict and validation details stay visible next to the form. */
export function ResultNotice({ result, successText = "Saved." }: { result: ActionResult<unknown> | null; successText?: string }) {
  return (
    <div aria-live="polite">
      {result && result.ok && <div className="notice" data-tone="ok" role="status">{successText}</div>}
      {result && !result.ok && (
        <div className="notice" data-tone={result.kind === "conflict" || result.kind === "validation" ? "warn" : "bad"} role="alert">
          <strong>{TITLES[result.kind] ?? "Error"}: </strong>{result.message}
          {result.details.length > 0 && <ul>{result.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          {result.kind === "unexpected" && <div className="small muted">Reference: {result.correlationId}</div>}
        </div>
      )}
    </div>
  );
}
