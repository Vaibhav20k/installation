/**
 * Small tags for a complaint or BOM line: its priority (High = warn, Urgent = red; Normal shows only when asked)
 * and "Not on factory list" for items the Installation Manager reported on site. Server and client safe.
 */
import { priorityLabel, productTypeLabel } from "@/domain/unlisted-items";

const TONE: Record<string, string | undefined> = { high: "warn", urgent: "bad" };

export function PriorityTag({ priority, showNormal = false }: { priority: string | null | undefined; showNormal?: boolean }) {
  if (!priority || (priority === "normal" && !showNormal)) return null;
  return <span className="flow-tag" data-tone={TONE[priority]} data-priority={priority}>{priorityLabel(priority)} priority</span>;
}

export function UnlistedTag({ unlisted, productType }: { unlisted: boolean | null | undefined; productType?: string | null }) {
  if (!unlisted) return null;
  const t = productTypeLabel(productType);
  return <span className="flow-tag" data-unlisted>Not on factory list{t ? ` · ${t}` : ""}</span>;
}
