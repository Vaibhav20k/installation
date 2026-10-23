"use client";
/**
 * Visit crew for managers: every member has a Replace action (sick, cannot join, reassigned), and extra people
 * can be added when a plan needs more than the planned headcount. Both go through the server's booking checks
 * (no double booking, no one on approved leave); earlier days stay with the person who worked them.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowsLeftRight, UserPlus, X } from "@phosphor-icons/react";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { Badge } from "@/components/ui/Badge";
import { EvidenceDisclosure, useAttachOnSave, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { addCrewMember, substitute } from "@/app/actions";

interface Member { id: string; business_id: string; name: string; job_role: string; state: string; from: string; until: string }
interface Candidate { id: string; business_id: string; name: string; job_role: string; skills: string; busy: string | null }

const REASONS = ["Sick", "Cannot join", "On leave", "Emergency", "Reassigned to another site", "Needs a different skill"];
const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const nowLocal = () => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
};

function PersonPicker({ id, candidates, name }: { id: string; candidates: Candidate[]; name: string }) {
  const free = candidates.filter((c) => !c.busy), busy = candidates.filter((c) => c.busy);
  return (
    <select id={id} name={name} required defaultValue="">
      <option value="" disabled>Choose a person</option>
      <optgroup label={`Available (${free.length})`}>{free.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.business_id} · {c.job_role.replace(/_/g, " ")}{c.skills ? ` · ${c.skills}` : ""}</option>)}</optgroup>
      {busy.length > 0 && <optgroup label="Not available">{busy.map((c) => <option key={c.id} value={c.id} disabled>{c.name} · {c.business_id} · {c.busy}</option>)}</optgroup>}
    </select>
  );
}

function ReplaceForm({ visitId, member, candidates, onClose }: { visitId: string; member: Member; candidates: Candidate[]; onClose: () => void }) {
  const a = useAction(substitute);
  const draft = useEvidenceDraft("team.substitution");
  const note = useAttachOnSave(draft, "substitution", a.result?.ok ? (a.result.data as { id: string }).id : null);
  const [why, setWhy] = useState(REASONS[0]!);
  const n = nowLocal();
  const done = a.result?.ok ? (a.result.data as { wholeBooking: boolean }) : null;
  return (
    <form className="team-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ visitId, outgoingId: member.id, incomingId: f.get("in"), date: f.get("d"), time: f.get("t"), reason: why === "Other" ? String(f.get("other") ?? "") : `${why}${f.get("note") ? `: ${f.get("note")}` : ""}` }); }}>
      <p className="small" style={{ margin: 0 }}>Replace <strong>{member.name}</strong>. Days they already worked stay theirs.</p>
      <div className="field"><label htmlFor={`rp-in-${member.id}`}>Replacement</label><PersonPicker id={`rp-in-${member.id}`} name="in" candidates={candidates} /></div>
      <div className="grid cols-2">
        <div className="field"><label htmlFor={`rp-d-${member.id}`}>From date</label><input id={`rp-d-${member.id}`} name="d" type="date" defaultValue={n.date} required /></div>
        <div className="field"><label htmlFor={`rp-t-${member.id}`}>From time</label><input id={`rp-t-${member.id}`} name="t" type="time" defaultValue={n.time} required /></div>
      </div>
      <div className="field"><label htmlFor={`rp-w-${member.id}`}>Reason</label>
        <select id={`rp-w-${member.id}`} value={why} onChange={(e) => setWhy(e.target.value)}>{[...REASONS, "Other"].map((r) => <option key={r}>{r}</option>)}</select></div>
      {why === "Other"
        ? <div className="field"><label htmlFor={`rp-o-${member.id}`}>Specific reason</label><input id={`rp-o-${member.id}`} name="other" required minLength={5} /></div>
        : <div className="field"><label htmlFor={`rp-n-${member.id}`}>Note (optional)</label><input id={`rp-n-${member.id}`} name="note" /></div>}
      <EvidenceDisclosure draft={draft} label="Photo of a medical note or message (optional)" />
      <div className="row"><button type="submit" className="primary" disabled={a.pending}>Replace</button><button type="button" onClick={onClose}>Cancel</button></div>
      <ResultNotice result={a.result} successText={`${done?.wholeBooking ? "Replaced for the whole booking (the visit had not started for them)." : "Replaced from the chosen time. History keeps both people."}${note}`} />
    </form>
  );
}

function AddForm({ visitId, candidates, onClose }: { visitId: string; candidates: Candidate[]; onClose: () => void }) {
  const a = useAction(addCrewMember);
  const n = nowLocal();
  return (
    <form className="team-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ visitId, employeeId: f.get("e"), date: f.get("d"), time: f.get("t"), reason: String(f.get("r") ?? "") }); }}>
      <div className="field"><label htmlFor="ad-e">Person to add</label><PersonPicker id="ad-e" name="e" candidates={candidates} /></div>
      <div className="grid cols-2">
        <div className="field"><label htmlFor="ad-d">From date</label><input id="ad-d" name="d" type="date" defaultValue={n.date} required /></div>
        <div className="field"><label htmlFor="ad-t">From time</label><input id="ad-t" name="t" type="time" defaultValue={n.time} required /></div>
      </div>
      <div className="field"><label htmlFor="ad-r">Why the extra person</label><input id="ad-r" name="r" required minLength={3} placeholder="For example: island and stone work need a fourth person" /></div>
      <div className="row"><button type="submit" className="primary" disabled={a.pending}>Add to team</button><button type="button" onClick={onClose}>Cancel</button></div>
      <ResultNotice result={a.result} successText={a.result?.ok ? `Added (${(a.result.data as { state: string }).state}). Team size is now ${(a.result.data as { teamSize: number }).teamSize}.` : "Added."} />
    </form>
  );
}

export function TeamManager({ visitId, team, candidates, canManage, booked }: { visitId: string; team: Member[]; candidates: Candidate[]; canManage: boolean; booked: boolean }) {
  const [replacing, setReplacing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const now = Date.now();
  const current = team.filter((m) => Date.parse(m.until) > now), past = team.filter((m) => Date.parse(m.until) <= now);
  return (
    <div className="stack">
      {current.length === 0 ? <p className="muted" style={{ margin: 0 }}>No one is assigned yet. <Link href={`/visits/${visitId}?step=team`}>Assign the team</Link>.</p> : (
        <ul className="team-list">
          {current.map((m) => (
            <li key={`${m.id}-${m.from}`}>
              <div className="team-row">
                <span className="monogram" aria-hidden>{m.name.split(/\s+/).map((x) => x[0]).join("").slice(0, 2)}</span>
                <Link href={`/people/${m.id}`} className="team-name"><span className="callout-title">{m.name} <span className="code">{m.business_id}</span></span>
                  <span className="callout-meta">{m.job_role.replace(/_/g, " ")}{Date.parse(m.from) > now ? ` · joins ${fmt.format(Date.parse(m.from))}` : ""}</span></Link>
                <Badge state={m.state} />
                {canManage && booked && (
                  <button type="button" className="team-replace" aria-expanded={replacing === m.id} onClick={() => setReplacing(replacing === m.id ? null : m.id)}>
                    {replacing === m.id ? <X size={16} aria-hidden /> : <ArrowsLeftRight size={16} aria-hidden />} {replacing === m.id ? "Close" : "Replace"}
                  </button>
                )}
              </div>
              {replacing === m.id && <ReplaceForm visitId={visitId} member={m} candidates={candidates} onClose={() => setReplacing(null)} />}
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && <p className="small muted" style={{ margin: 0 }}>Earlier on this visit: {past.map((m) => `${m.name} until ${fmt.format(Date.parse(m.until))}`).join(", ")}.</p>}
      {canManage && !booked && current.length > 0 && <p className="small muted" style={{ margin: 0 }}>Replacing people applies once the visit is booked; before that, change the team on the <Link href={`/visits/${visitId}?step=team`}>visit&apos;s team step</Link>.</p>}
      {canManage && (adding
        ? <AddForm visitId={visitId} candidates={candidates} onClose={() => setAdding(false)} />
        : <div><button type="button" onClick={() => setAdding(true)}><UserPlus size={16} aria-hidden /> Add a member</button></div>)}
    </div>
  );
}
