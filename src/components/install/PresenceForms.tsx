"use client";
/**
 * Site presence controls. Workers check in and out at a booked site (the server stamps the time; a repeated
 * tap returns the same record). Supervisors correct sessions or add a missed one, always with a reason.
 */
import { useState } from "react";
import { MapPin, SignIn, SignOut } from "@phosphor-icons/react";
import { addSitePresence, correctSitePresence, siteCheckIn, siteCheckOut } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { formatDateTime, localDateOf, localTimeOf } from "@/lib/dates";

export interface CheckSite { visit_id: string; visit: string; project: string; site_address: string }
export interface OpenSession { id: string; visit: string; project: string; check_in_at: number; timezone: string }

export function SiteCheck({ sites, open, stale, recent }: {
  sites: CheckSite[]; open: OpenSession | null; stale: boolean;
  recent: Array<{ id: string; visit: string; check_in_at: number; check_out_at: number | null; missed_checkout: boolean; timezone: string }>;
}) {
  const cin = useAction(siteCheckIn);
  const cout = useAction(siteCheckOut);
  const [visitId, setVisitId] = useState(sites[0]?.visit_id ?? "");
  // A session left open from an earlier day is never closed with "now": that would count the whole night.
  const current = open && !stale ? open : null;
  return (
    <div className="site-check">
      {open && stale && <p className="notice" data-tone="warn" role="status" style={{ margin: 0 }}>You checked in at {open.visit} on {formatDateTime(Number(open.check_in_at), open.timezone)} and did not check out. That session is not counted until your supervisor enters the real check-out time. You can check in again today.</p>}
      {current ? (
        <>
          <p style={{ margin: 0 }}><strong>Checked in at {current.visit}</strong> · {current.project}<span className="small muted" style={{ display: "block" }}>Since {formatDateTime(Number(current.check_in_at), current.timezone)}</span></p>
          <button type="button" className="primary big" disabled={cout.pending} aria-busy={cout.pending} onClick={() => cout.run({ presenceId: current.id })}><SignOut size={20} aria-hidden /> {cout.pending ? "Saving…" : "Site check-out"}</button>
        </>
      ) : sites.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>You are not booked on a site today, so there is nowhere to check in.</p>
      ) : (
        <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); cin.run({ visitId }); }}>
          {sites.length > 1 ? (
            <div className="field"><label htmlFor="sc-site">Site</label>
              <select id="sc-site" value={visitId} onChange={(e) => setVisitId(e.target.value)}>{sites.map((s) => <option key={s.visit_id} value={s.visit_id}>{s.visit} · {s.project}</option>)}</select>
            </div>
          ) : <p style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><MapPin size={16} aria-hidden /> {sites[0]!.visit} · {sites[0]!.project}</p>}
          <button type="submit" className="primary big" disabled={cin.pending || !visitId} aria-busy={cin.pending}><SignIn size={20} aria-hidden /> {cin.pending ? "Saving…" : "Site check-in"}</button>
        </form>
      )}
      <ResultNotice result={cin.result} successText={cin.result?.ok && (cin.result.data as { already: boolean }).already ? "You were already checked in here." : "Checked in at the site."} />
      <ResultNotice result={cout.result} successText={cout.result?.ok && (cout.result.data as { already: boolean }).already ? "Already checked out." : "Checked out of the site."} />
      {recent.length > 0 && (
        <ul className="session-list" aria-label="Your recent site sessions">
          {recent.map((r) => <li key={r.id}><span>{r.visit}</span><span>{formatDateTime(Number(r.check_in_at), r.timezone)} – {r.check_out_at !== null ? localTimeOf(Number(r.check_out_at), r.timezone) : r.missed_checkout ? "check-out missed, waiting for correction" : "open"}</span></li>)}
        </ul>
      )}
      <p className="small muted" style={{ margin: 0 }}>Site check-in records where you are. It does not start or end your day&apos;s attendance.</p>
    </div>
  );
}

export function SessionFix({ session, tz }: { session: { id: string; version: number; checkIn: number; checkOut: number | null }; tz: string }) {
  const fix = useAction(correctSitePresence);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="link small" onClick={() => setOpen(true)}>{session.checkOut === null ? "Close missed check-out" : "Correct"}</button>;
  const out = session.checkOut ?? null;
  return (
    <form className="stack" style={{ gap: 8, width: "100%" }} onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      fix.run({ presenceId: session.id, version: session.version, voided: f.get("void") === "on" || undefined,
        checkIn: { date: String(f.get("id")), time: String(f.get("it")) }, checkOut: f.get("od") && f.get("ot") ? { date: String(f.get("od")), time: String(f.get("ot")) } : undefined, reason: String(f.get("r")) });
    }}>
      <div className="fields">
        <div className="field"><label htmlFor={`id-${session.id}`}>In date</label><input id={`id-${session.id}`} name="id" type="date" defaultValue={localDateOf(session.checkIn, tz)} required /></div>
        <div className="field"><label htmlFor={`it-${session.id}`}>In time</label><input id={`it-${session.id}`} name="it" type="time" defaultValue={localTimeOf(session.checkIn, tz)} required /></div>
        <div className="field"><label htmlFor={`od-${session.id}`}>Out date</label><input id={`od-${session.id}`} name="od" type="date" defaultValue={out ? localDateOf(out, tz) : ""} required={session.checkOut === null} /></div>
        <div className="field"><label htmlFor={`ot-${session.id}`}>Out time</label><input id={`ot-${session.id}`} name="ot" type="time" defaultValue={out ? localTimeOf(out, tz) : ""} required={session.checkOut === null} /></div>
      </div>
      <div className="field"><label htmlFor={`r-${session.id}`}>Reason (kept in the history)</label><input id={`r-${session.id}`} name="r" required minLength={3} maxLength={300} /></div>
      <label className="small"><input type="checkbox" name="void" /> Remove this session (recorded by mistake)</label>
      <div className="row" style={{ gap: 8 }}><button type="submit" className="primary" disabled={fix.pending}>Save correction</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
      <ResultNotice result={fix.result} successText="Correction saved." />
    </form>
  );
}

export function AddSessionForm({ employeeId, visitId }: { employeeId: string; visitId: string }) {
  const add = useAction(addSitePresence);
  return (
    <details>
      <summary className="small">Add a missed site session</summary>
      <form className="stack" style={{ gap: 8, marginTop: 8 }} onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        add.run({ employeeId, visitId, checkIn: { date: String(f.get("d")), time: String(f.get("i")) }, checkOut: { date: String(f.get("od") || f.get("d")), time: String(f.get("o")) }, reason: String(f.get("r")) });
      }}>
        <div className="fields">
          <div className="field"><label htmlFor={`ad-${employeeId}`}>Date</label><input id={`ad-${employeeId}`} name="d" type="date" required /></div>
          <div className="field"><label htmlFor={`ai-${employeeId}`}>Check-in</label><input id={`ai-${employeeId}`} name="i" type="time" required /></div>
          <div className="field"><label htmlFor={`aod-${employeeId}`}>Check-out date (if next day)</label><input id={`aod-${employeeId}`} name="od" type="date" /></div>
          <div className="field"><label htmlFor={`ao-${employeeId}`}>Check-out</label><input id={`ao-${employeeId}`} name="o" type="time" required /></div>
        </div>
        <div className="field"><label htmlFor={`ar-${employeeId}`}>Reason</label><input id={`ar-${employeeId}`} name="r" required minLength={3} maxLength={300} /></div>
        <button type="submit" disabled={add.pending}>Add session</button>
        <ResultNotice result={add.result} successText="Session added." />
      </form>
    </details>
  );
}
