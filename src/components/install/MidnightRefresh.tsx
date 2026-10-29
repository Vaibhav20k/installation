"use client";
/** Re-reads the page just after the next local midnight in tz, so date-based flags (overdue handover) roll over on time. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { addDays, localDateOf, startOfLocalDay } from "@/lib/dates";

export function MidnightRefresh({ tz }: { tz: string }) {
  const router = useRouter();
  useEffect(() => {
    const next = startOfLocalDay(addDays(localDateOf(Date.now(), tz), 1), tz) + 5_000;
    const t = window.setTimeout(() => router.refresh(), Math.min(next - Date.now(), 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [router, tz]);
  return null;
}
