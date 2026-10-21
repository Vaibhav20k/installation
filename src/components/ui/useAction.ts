"use client";
/** Calls a server action, tracks pending state and keeps the structured result for display. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; kind: string; message: string; details: string[]; correlationId: string };

export function useAction<I, T>(action: (input: I) => Promise<ActionResult<T>>, opts: { refresh?: boolean; onSuccess?: (data: T) => void } = {}) {
  const [result, setResult] = useState<ActionResult<T> | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const runAction = (input: I) =>
    start(async () => {
      const r = await action(input);
      setResult(r);
      if (r.ok) {
        opts.onSuccess?.(r.data);
        if (opts.refresh !== false) router.refresh();
      }
    });
  return { run: runAction, pending, result, reset: () => setResult(null) };
}
