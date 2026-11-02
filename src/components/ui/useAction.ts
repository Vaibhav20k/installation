"use client";
/** Calls a server action, tracks pending state and keeps the structured result for display. */
import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

export type ActionResult<T = unknown> =
  | { ok: true; data: T; revalidatedPaths?: string[] }
  | { ok: false; kind: string; message: string; details: string[]; correlationId: string };

export function useAction<I, T>(action: (input: I) => Promise<ActionResult<T>>, opts: { refresh?: boolean; onSuccess?: (data: T) => void } = {}) {
  const [result, setResult] = useState<ActionResult<T> | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const inFlight = useRef(false);
  const runAction = (input: I) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setResult(null);
    start(async () => {
      try {
        const r = await action(input);
        setResult(r);
        if (r.ok) {
          if (r.revalidatedPaths === undefined || r.revalidatedPaths.length) window.dispatchEvent(new Event('im-data-changed'));
          opts.onSuccess?.(r.data);
          // An exact page revalidation already includes the current RSC update in the action response.
          // Otherwise refresh this route once, without invalidating the entire app layout.
          if (opts.refresh !== false && !r.revalidatedPaths?.includes(pathname)) router.refresh();
        }
      } catch {
        setResult({ok:false,kind:'unexpected',message:'The request could not be completed. Check your connection and try again.',details:[],correlationId:'client-request'});
      } finally { inFlight.current = false; }
    });
  };
  return { run: runAction, pending, result, reset: () => setResult(null) };
}
