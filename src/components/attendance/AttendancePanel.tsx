"use client";
/**
 * The worker's shift control (fixed 8-hour session). State comes from the server; only <Ticker> re-renders
 * each second, from a server-time offset, so local clock changes cannot alter anything. At the 7:30 and 8:00
 * boundaries the page refreshes once to show the server-recorded state. No overtime button, no shift editor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Coffee, Hammer, Pause, SignIn, SignOut, Truck } from "@phosphor-icons/react";
import { useAction } from "@/components/ui/useAction";
import dynamic from "next/dynamic";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { AttachToRecord, EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";

// The camera code loads only when Clock in is tapped, so My day stays light.
const ClockInCamera = dynamic(() => import("./ClockInCamera").then((m) => m.ClockInCamera), { ssr: false, loading: () => <p className="small muted" role="status">Opening the camera…</p> });
import { addAttendanceNote, clockIn, clockOut, requestAttendanceCorrection, setAttendanceActivity, setOvertimeReason } from "@/app/actions";

export interface PanelShift {
  shiftId: string; state: "regular" | "overtime" | "clocked_out"; activity: string | null; t0: number; warnAt: number; otAt: number; timezone: string; workDate: string;
  open: boolean; regularWorkMinutes: number; recordedOvertimeWorkMinutes: number; breakMinutes: number; lastClockOut: number | null; otReason: string | null;
}

const ACTIVITIES = [
  { id: "working", label: "Working", icon: Hammer },
  { id: "break", label: "Break", icon: Coffee },
  { id: "idle", label: "Idle", icon: Pause },
  { id: "travel", label: "Travel", icon: Truck },
] as const;
/** Common reasons work stops on site; "Other" asks for the specific reason. */
const IDLE_REASONS = ["Power cut", "No site access / keys", "Waiting for material", "Waiting for another trade (plumber, electrician, stone)",
  "Tool or equipment problem", "Waiting for customer decision", "Weather", "Lift or society restriction"];

const OT_REASONS: Array<[string, string]> = [["catch_up", "Finishing today's original target"], ["future_task", "Tomorrow's task brought forward"],
  ["additional_work", "Approved additional customer work"], ["external_delay", "Site, material or equipment delay"], ["other", "Other reason"]];

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const hms = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; };
const hm = (min: number) => `${Math.floor(min / 60)}h ${pad(min % 60)}m`;
/** A shift never runs past 24 hours; the server closes it then (owner's rule, 28 Oct 2026). */
const MAX_SHIFT_MS = 24 * 3600_000;

function useClock(tz: string) {
  return useMemo(() => new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [tz]);
}

/** The only per-second renderer. Elapsed time is derived from server time, never from a stored counter. */
function Ticker({ shift, offset }: { shift: PanelShift; offset: number }) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!shift.open) return;
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [shift.open, offset]);
  const end = shift.open ? now : (shift.lastClockOut ?? now);
  const elapsed = Math.min(MAX_SHIFT_MS, Math.max(0, end - shift.t0));
  const regular = Math.min(elapsed, 8 * 3600_000);
  const ot = Math.max(0, elapsed - 8 * 3600_000);
  const pct = Math.min(100, (regular / (8 * 3600_000)) * 100);
  const remaining = Math.max(0, 8 * 3600_000 - elapsed);
  return (
    <div className="shift-timers">
      <div className="shift-timer">
        <span className="shift-timer-label">Regular session</span>
        <span className="shift-timer-value" aria-hidden>{hms(regular)}</span>
        <span className="shift-timer-sub">{shift.open && remaining > 0 ? `${hms(remaining).slice(0, 5)} left` : remaining === 0 ? "8:00 complete" : "Clocked out"}</span>
      </div>
      <div className="shift-track" role="img" aria-label={`Regular session ${Math.floor(regular / 60000)} of 480 minutes`}>
        <span className="shift-fill" style={{ transform: `scaleX(${pct / 100})` }} data-warn={elapsed >= 7.5 * 3600_000 || undefined} />
        <span className="shift-tick" style={{ left: `${(7.5 / 8) * 100}%` }}><span>7:30</span></span>
        <span className="shift-tick end" style={{ left: "100%" }}><span>8:00</span></span>
      </div>
      {(shift.state === "overtime" || ot > 0) && (
        <div className="shift-timer ot">
          <span className="shift-timer-label">Overtime period</span>
          <span className="shift-timer-value" aria-hidden>{hms(ot)}</span>
          <span className="shift-timer-sub">Recorded · approval pending</span>
        </div>
      )}
    </div>
  );
}

export function AttendancePanel({ shift, serverNow, visitLabel, employeeFirstName, today }: { shift: PanelShift | null; serverNow: number; visitLabel: string | null; employeeFirstName: string; today: string }) {
  const router = useRouter();
  const offset = useMemo(() => serverNow - Date.now(), [serverNow]);
  const fmt = useClock(shift?.timezone ?? "Asia/Kolkata");
  const outAction = useAction(clockOut);
  const act = useAction(setAttendanceActivity);
  const reason = useAction(setOvertimeReason);
  const [idleNote, setIdleNote] = useState("");
  const [idleChoice, setIdleChoice] = useState("");
  const [askIdle, setAskIdle] = useState(false);
  const [camera, setCamera] = useState(false);
  const [clockErr, setClockErr] = useState<string | null>(null);
  const [clockedIn, setClockedIn] = useState(false);

  // One refresh at each boundary so the server-recorded reminder / overtime / 24-hour close appears without a reload.
  const refreshed = useRef(new Set<number>());
  useEffect(() => {
    if (!shift?.open) return;
    const timers = [shift.warnAt, shift.otAt, shift.t0 + MAX_SHIFT_MS].map((b) => {
      const wait = b - (Date.now() + offset) + 1500;
      if (wait <= 0 || refreshed.current.has(b)) return null;
      return setTimeout(() => { refreshed.current.add(b); router.refresh(); }, Math.min(wait, 2 ** 31 - 1));
    });
    return () => timers.forEach((t) => t && clearTimeout(t));
  }, [shift?.open, shift?.warnAt, shift?.otAt, shift?.t0, offset, router]);

  const stamp = !shift ? "Not clocked in" : shift.state === "regular" ? "Regular" : shift.state === "overtime" ? "Overtime" : "Clocked out";
  return (
    <section className="plate shift-plate" data-state={shift?.state ?? "not_started"} aria-labelledby="h-shift">
      <div className="plate-head">
        <span className="code-tag">SHIFT · {today}</span>
        <span className="badge stamp-hero" data-tone={shift?.state === "overtime" ? "bad" : shift?.open ? "accent" : "neutral"}>{stamp}</span>
      </div>
      <h2 id="h-shift" className="plate-title">{!shift ? `Good to go, ${employeeFirstName}?` : shift.open ? (shift.activity === "break" ? "On break" : shift.activity === "idle" ? "Idle on site" : shift.activity === "travel" ? "Travelling" : "Working") : "Day closed"}</h2>
      {visitLabel && <p className="plate-sub">{visitLabel}</p>}

      {shift ? <Ticker shift={shift} offset={offset} /> : (
        <p className="small muted" style={{ margin: "12px 0 4px" }}>Your regular session is 8 hours from the moment you clock in. You get a reminder at 7 h 30 m; after 8 h, time is recorded as overtime automatically and waits for review.</p>
      )}

      {shift && (
        <dl className="shift-facts">
          <div><dt>Clock-in</dt><dd className="code">{fmt.format(shift.t0)}</dd></div>
          <div><dt>Reminder</dt><dd className="code">{fmt.format(shift.warnAt)}</dd></div>
          <div><dt>Regular ends</dt><dd className="code">{fmt.format(shift.otAt)}</dd></div>
          <div><dt>Work so far</dt><dd className="code">{hm(Math.round(shift.regularWorkMinutes + shift.recordedOvertimeWorkMinutes))}{shift.breakMinutes ? ` · break ${hm(Math.round(shift.breakMinutes))}` : ""}</dd></div>
        </dl>
      )}

      {shift?.open && (
        <div className="activity-switch" role="group" aria-label="What are you doing now?">
          {ACTIVITIES.map((a) => (
            <button key={a.id} type="button" aria-pressed={shift.activity === a.id} disabled={act.pending}
              onClick={() => { if (a.id === "idle") setAskIdle(true); else { setAskIdle(false); act.run({ shiftId: shift.shiftId, activity: a.id }); } }}>
              <a.icon size={18} weight={shift.activity === a.id ? "fill" : "regular"} aria-hidden /> {a.label}
            </button>
          ))}
        </div>
      )}
      {shift?.open && askIdle && (
        <form className="idle-form" onSubmit={(e) => { e.preventDefault();
          act.run({ shiftId: shift.shiftId, activity: "idle", note: idleChoice === "other" ? `Other: ${idleNote.trim()}` : idleChoice });
          setAskIdle(false); setIdleChoice(""); setIdleNote(""); }}>
          <div className="field"><label htmlFor="idle-r">What is holding the work up?</label>
            <select id="idle-r" value={idleChoice} onChange={(e) => setIdleChoice(e.target.value)} required>
              <option value="" disabled>Choose a reason</option>
              {IDLE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="other">Other (type the reason)</option>
            </select></div>
          {idleChoice === "other" && (
            <div className="field"><label htmlFor="idle-n">Specific reason</label>
              <input id="idle-n" value={idleNote} onChange={(e) => setIdleNote(e.target.value)} required minLength={3} maxLength={200} autoFocus enterKeyHint="done" placeholder="Describe what is stopping the work" /></div>
          )}
          <div className="row"><button type="submit" className="primary" disabled={!idleChoice}>Mark idle</button><button type="button" onClick={() => setAskIdle(false)}>Cancel</button></div>
        </form>
      )}
      <ResultNotice result={act.result && !act.result.ok ? act.result : null} />
      {shift?.open && act.result?.ok && (act.result.data as { eventId?: string }).eventId && (
        <AttachToRecord key={(act.result.data as { eventId: string }).eventId} parentType="attendance_event" id={(act.result.data as { eventId: string }).eventId}
          context="attendance.activity" label={`Photo or video for this ${ACTIVITIES.find((x) => x.id === (act.result?.ok ? (act.result.data as { activity: string }).activity : ""))?.label.toLowerCase() ?? "activity"} (optional)`} />
      )}

      {shift && (shift.state === "overtime" || shift.recordedOvertimeWorkMinutes > 0) && (
        <div className="ot-reason">
          <label htmlFor="ot-r" className="small">Why are you working past 8 hours?</label>
          <select id="ot-r" defaultValue={shift.otReason ?? ""} disabled={reason.pending} onChange={(e) => e.target.value && reason.run({ shiftId: shift.shiftId, reason: e.target.value, note: e.target.value === "other" ? "Explained on site" : undefined })}>
            <option value="" disabled>Choose a reason</option>
            {OT_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {(shift.otReason === "catch_up" || (reason.result?.ok && (reason.result.data as { catchUp: boolean }).catchUp)) && (
            <p className="notice" data-tone="warn" role="status" style={{ margin: 0 }}>Recorded after regular hours. Original-target catch-up is not eligible for overtime approval.</p>
          )}
          {shift.otReason && <AttachToRecord parentType="shift_instance" id={shift.shiftId} context="overtime.reason" label="Photo or video explaining the overtime (optional)" />}
        </div>
      )}

      <div className="shift-primary">
        {!shift?.open ? (camera ? (
          <ClockInCamera label={shift ? "Clock in again (same shift)" : "Clock in"} onCancel={() => setCamera(false)}
            onClockIn={async (photoDraftKey) => { const r = await clockIn({ photoDraftKey }); if (r.ok) { setCamera(false); setClockedIn(true); router.refresh(); } setClockErr(r.ok ? null : r.message); return r.ok; }} />
        ) : (
          <button type="button" className="primary clock-btn" onClick={() => { setClockErr(null); setCamera(true); }}>
            <SignIn size={20} weight="bold" aria-hidden /> {shift ? "Clock in again (same shift)" : "Clock in"}
          </button>
        )) : (
          <button type="button" className="clock-btn clock-out" disabled={outAction.pending} aria-busy={outAction.pending} onClick={() => outAction.run({ shiftId: shift.shiftId })}>
            <SignOut size={20} weight="bold" aria-hidden /> Clock out
          </button>
        )}
      </div>
      {clockErr && <p className="notice" data-tone="warn" role="alert">{clockErr}</p>}
      {clockedIn && shift?.open && <p className="notice" data-tone="ok" role="status">Clocked in with your photo. Your 8-hour regular session has started.</p>}
      <ResultNotice result={outAction.result} successText={outAction.result?.ok ? clockOutText(outAction.result.data as ClockOutData) : undefined} />

      {shift && <AttendanceExtras shift={shift} />}
    </section>
  );
}

interface ClockOutData { draftEntries: number; skippedOverlaps: string[]; overtimeCandidateMinutes: number }
function clockOutText(d: ClockOutData) {
  return `Clocked out. ${d.draftEntries} draft timesheet row${d.draftEntries === 1 ? "" : "s"} ready to check and submit${d.overtimeCandidateMinutes ? `; ${d.overtimeCandidateMinutes} min recorded after 8 hours await review` : ""}${d.skippedOverlaps.length ? `; ${d.skippedOverlaps.length} period(s) overlapped existing entries and were left for you to review` : ""}.`;
}

/** Notes with optional photos/videos, and correction requests. Never blocks clock-in or clock-out. */
function AttendanceExtras({ shift }: { shift: PanelShift }) {
  const draft = useEvidenceDraft("attendance.note");
  const note = useAction(addAttendanceNote, { onSuccess: async (d) => setLinked(attachmentNote(await draft.attach("attendance_event", (d as { id: string }).id))) });
  const [text, setText] = useState("");
  const [linked, setLinked] = useState("");
  return (
    <div className="shift-extras">
      <details>
        <summary className="small">Add a note, photo or video to today&apos;s attendance</summary>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); note.run({ shiftId: shift.shiftId, note: text || "Photo/video attached" }); setText(""); }}>
          <div className="field"><label htmlFor="att-n">Note</label><textarea id="att-n" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="For example: site gate opened late" /></div>
          <EvidenceUploader draft={draft} />
          <div><button type="submit" disabled={note.pending}>Save note</button></div>
          <ResultNotice result={note.result} successText={`Note saved.${linked}`} />
        </form>
      </details>
      <CorrectionForm shiftId={shift.shiftId} workDate={shift.workDate} />
    </div>
  );
}

/** Ask for a clock-in or clock-out correction; punches stay in history and nothing changes until approval. */
export function CorrectionForm({ shiftId, workDate, open = false, label = "Request a correction to clock-in or clock-out" }: { shiftId: string; workDate: string; open?: boolean; label?: string }) {
  const corr = useAction(requestAttendanceCorrection);
  const draft = useEvidenceDraft("attendance.correction");
  const [linked, setLinked] = useState("");
  return (
    <details open={open}>
      <summary className="small">{label}</summary>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        corr.run({ shiftId, field: f.get("field"), date: f.get("date"), time: f.get("time"), reason: f.get("reason") });
      }}>
        <div className="grid cols-3">
          <div className="field"><label htmlFor={`c-f-${shiftId}`}>What is wrong</label><select id={`c-f-${shiftId}`} name="field"><option value="clock_in">Clock-in time</option><option value="clock_out">Clock-out time</option></select></div>
          <div className="field"><label htmlFor={`c-d-${shiftId}`}>Correct date</label><input id={`c-d-${shiftId}`} name="date" type="date" defaultValue={workDate} required /></div>
          <div className="field"><label htmlFor={`c-t-${shiftId}`}>Correct time</label><input id={`c-t-${shiftId}`} name="time" type="time" required /></div>
        </div>
        <div className="field"><label htmlFor={`c-r-${shiftId}`}>Reason</label><input id={`c-r-${shiftId}`} name="reason" required minLength={5} maxLength={500} placeholder="For example: phone had no network at the gate" /></div>
        <EvidenceUploader draft={draft} />
        <p className="small muted" style={{ margin: 0 }}>Your manager reviews it. Your recorded punches stay in history; nothing changes until it is approved.</p>
        <div><button type="submit" disabled={corr.pending}>Send for review</button></div>
        <CorrectionResult result={corr.result} draft={draft} linked={linked} setLinked={setLinked} />
      </form>
    </details>
  );
}

function CorrectionResult({ result, draft, linked, setLinked }: { result: ReturnType<typeof useAction>["result"]; draft: ReturnType<typeof useEvidenceDraft>; linked: string; setLinked: (s: string) => void }) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (result?.ok && done.current !== (result.data as { id: string }).id) {
      done.current = (result.data as { id: string }).id;
      void draft.attach("attendance_correction", done.current).then((r) => setLinked(attachmentNote(r)));
    }
  }, [result, draft, setLinked]);
  return <ResultNotice result={result} successText={`Correction sent for review.${linked}`} />;
}
