"use client";
/**
 * In-app bell and inbox. One focus-aware poll per page (60 s while visible, plus one fetch right after the next
 * due reminder), never a per-second request. New alerts also show as a banner while the app is open and, if the
 * worker allowed it on this device, as a browser notification. Closed-app push is not configured (see docs).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRinging, X } from "@phosphor-icons/react";
import { markNotificationsRead } from "@/app/actions";

interface Item { id: string; kind: string; title: string; body: string; effective_at: number; overdue: boolean; read_at: number | null }
interface Data { items: Item[]; unread: number; nextDueAt: number | null; serverNow: number }

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function NotificationBell() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const d: Data = await r.json();
      setData(d);
      const fresh = d.items.filter((i) => !i.read_at && !i.overdue && !(seen.current?.has(i.id)) && d.serverNow - Number(i.effective_at) < 15 * 60_000);
      if (seen.current && fresh[0]) {
        setToast(fresh[0]);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(fresh[0].title, { body: fresh[0].body, tag: fresh[0].id });
      }
      seen.current = new Set(d.items.map((i) => i.id));
    } catch { /* offline: keep the last state; the server keeps the events */ }
  }, []);

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    void load();
    const tick = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(tick); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [load]);

  // Fetch once just after the next due reminder/transition so it appears on time while the app is open.
  useEffect(() => {
    if (!data?.nextDueAt) return;
    const wait = data.nextDueAt - data.serverNow + 2000;
    if (wait <= 0 || wait > 12 * 3600_000) return;
    const t = setTimeout(() => void load(), wait);
    return () => clearTimeout(t);
  }, [data?.nextDueAt, data?.serverNow, load]);

  const readAll = async () => { await markNotificationsRead({}); void load(); };
  const unread = data?.unread ?? 0;
  return (
    <div className="bell">
      <button type="button" className="bell-btn" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {unread ? <BellRinging size={20} weight="fill" aria-hidden /> : <Bell size={20} aria-hidden />}
        {unread > 0 && <span className="bell-count" aria-hidden>{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="bell-head"><strong>Notifications</strong>{unread > 0 && <button type="button" className="link small" onClick={readAll}>Mark all read</button>}</div>
          {!data?.items.length ? <p className="small muted" style={{ margin: 0 }}>Nothing yet. Shift reminders and approvals appear here.</p> : (
            <ul>
              {data.items.map((i) => (
                <li key={i.id} data-unread={!i.read_at || undefined}>
                  <span className="bell-title">{i.title}{i.overdue ? " · late" : ""}</span>
                  <span className="small">{i.body}</span>
                  <span className="small muted code">{fmt.format(Number(i.effective_at))}</span>
                </li>
              ))}
            </ul>
          )}
          {perm === "default" && <button type="button" className="small" onClick={async () => setPerm(await Notification.requestPermission())}>Also alert me on this device</button>}
          {perm === "denied" && <p className="small muted" style={{ margin: 0 }}>Device alerts are blocked in the browser; in-app alerts still work.</p>}
          <p className="small muted" style={{ margin: 0 }}>Alerts when the app is closed need push setup, which is not configured yet.</p>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <BellRinging size={18} weight="fill" aria-hidden />
          <span><strong>{toast.title}</strong><span className="small">{toast.body}</span></span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
