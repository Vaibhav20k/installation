"use client";
/**
 * [ Installation | Factory ]: one tap moves the whole app to the other side (docs/plans/workspaces-design.md §3).
 * The choice is remembered in a cookie; people with one side see a plain label, not a button. A link that opens a
 * page living only on the other side switches over and says so (WorkspaceGuard).
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Factory, HardHat } from "@phosphor-icons/react";
import { WORKSPACE_COOKIE, WORKSPACE_LABEL, type Workspace } from "@/lib/workspace";
import { groupOwner, type Viewer } from "./nav-config";
import { useSlidingIndicator } from "./useSlidingIndicator";

const ICON = { installation: HardHat, factory: Factory } as const;

function remember(w: Workspace) {
  document.cookie = `${WORKSPACE_COOKIE}=${w}; path=/; max-age=31536000; samesite=lax`;
}

export function WorkspaceSwitch({ current, available, demo }: { current: Workspace; available: Workspace[]; demo: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(current);
  useEffect(() => setShown(current), [current]);
  useSlidingIndicator(ref, available.length > 1 ? shown : null);
  if (available.length < 2) {
    const I = ICON[current];
    return <span className="ws-label"><I size={16} weight="fill" aria-hidden /> {WORKSPACE_LABEL[current]}</span>;
  }
  const pick = (w: Workspace) => {
    if (w === shown) return;
    setShown(w);
    remember(w);
    router.push("/");
    router.refresh();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = available[(available.indexOf(shown) + 1) % available.length]!;
    pick(next);
    ref.current?.querySelector<HTMLElement>(`[data-key="${next}"]`)?.focus();
  };
  return (
    <div className="ws-switch" role="radiogroup" aria-label="Workspace" ref={ref} onKeyDown={onKey} title={demo ? "Both sides are open to everyone while the app is in demo mode" : undefined}>
      <span className="ind" aria-hidden />
      {available.map((w) => {
        const I = ICON[w], on = w === shown;
        return (
          <button key={w} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-key={w} onClick={() => pick(w)}>
            <I size={17} weight={on ? "fill" : "regular"} aria-hidden /> {WORKSPACE_LABEL[w]}
          </button>
        );
      })}
      <span className="sr-only" aria-live="polite">{WORKSPACE_LABEL[shown]} workspace</span>
    </div>
  );
}

/** Opening a page that lives only on the other side (a link, a notification) switches over, and says so. */
export function WorkspaceGuard({ viewer, available }: { viewer: Viewer; available: Workspace[] }) {
  const path = usePathname();
  const router = useRouter();
  const [moved, setMoved] = useState<{ to: Workspace; from: Workspace } | null>(null);
  useEffect(() => {
    const owner = groupOwner(path, viewer);
    if (!owner || !available.includes(owner)) return;
    remember(owner);
    setMoved({ to: owner, from: viewer.ws ?? "installation" });
    router.refresh();
  }, [path, viewer, available, router]);
  useEffect(() => { if (moved && viewer.ws === moved.to) { const t = setTimeout(() => setMoved(null), 6000); return () => clearTimeout(t); } }, [moved, viewer.ws]);
  if (!moved) return null;
  return (
    <p className="notice ws-moved" role="status">
      Switched to <strong>{WORKSPACE_LABEL[moved.to]}</strong> to show this page.{" "}
      <button type="button" className="link" onClick={() => { remember(moved.from); setMoved(null); router.push("/"); router.refresh(); }}>Back to {WORKSPACE_LABEL[moved.from]}</button>
    </p>
  );
}
