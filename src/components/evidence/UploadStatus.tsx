"use client";
/** Persistent, non-blocking status of background evidence uploads, visible on every screen while any run or fail. */
import { useSyncExternalStore } from "react";
import { CloudArrowUp, WarningCircle } from "@phosphor-icons/react";
import { uploadQueue, type QueueItem } from "@/lib/upload-queue";

const empty: QueueItem[] = [];

export function UploadStatus() {
  const items = useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot, () => empty);
  const active = items.filter((i) => i.state === "queued" || i.state === "uploading" || i.state === "validating").length;
  const failed = items.filter((i) => i.state === "failed").length;
  if (!active && !failed) return null;
  return (
    <div className="upload-status" role="status" data-failed={failed > 0 || undefined}>
      {failed ? <WarningCircle size={16} weight="fill" aria-hidden /> : <CloudArrowUp size={16} aria-hidden />}
      <span>{active ? `${active} attachment${active === 1 ? "" : "s"} uploading` : ""}{active && failed ? " · " : ""}{failed ? `${failed} failed: open the form to retry` : ""}</span>
    </div>
  );
}
