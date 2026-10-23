"use client";
/** Forms for the project's site and readiness record. Server validation is authoritative; results are announced. */
import { useEffect, useRef, useState } from "react";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { EvidenceDisclosure, EvidenceUploader, attachmentNote, useEvidenceDraft } from "@/components/evidence/EvidenceUploader";
import { addContact, addEffortDriver, exceptAppliance, saveAppliance, setQuantitySnapshot, setSiteRestriction } from "@/app/actions";

const val = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };

export function ContactForm({ projectId }: { projectId: string }) {
  const a = useAction(addContact);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ projectId, name: val(f, "n"), relationship: val(f, "r"), isPrimary: f.get("p") === "on", phone: val(f, "ph"), email: val(f, "em"), note: val(f, "no") }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="ct-n">Name</label><input id="ct-n" name="n" required minLength={2} /></div>
        <div className="field"><label htmlFor="ct-r">Relationship</label><input id="ct-r" name="r" required placeholder="Owner, spouse, architect, caretaker…" /></div>
        <div className="field"><label htmlFor="ct-ph">Phone</label><input id="ct-ph" name="ph" type="tel" inputMode="tel" autoComplete="off" /></div>
        <div className="field"><label htmlFor="ct-em">Email</label><input id="ct-em" name="em" type="email" autoCapitalize="none" /></div>
      </div>
      <div className="field"><label htmlFor="ct-no">Note</label><input id="ct-no" name="no" /></div>
      <label className="check"><input type="checkbox" name="p" /> Primary contact (replaces the current primary)</label>
      <div><button type="submit" disabled={a.pending}>Add contact</button></div>
      <ResultNotice result={a.result} successText="Contact added. Contacts never merge accounts automatically." />
    </form>
  );
}

export function QuantityForm({ components }: { components: Array<{ id: string; label: string; unit: string; quantityKind: string }> }) {
  const a = useAction(setQuantitySnapshot);
  const draft = useEvidenceDraft("site.measurement");
  const [cid, setCid] = useState(components[0]?.id ?? "");
  const c = components.find((x) => x.id === cid);
  const [basis, setBasis] = useState<"net" | "gross">("net");
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ componentId: cid, basis, quantity: val(f, "q"), unit: basis === "net" ? c?.unit : val(f, "u"), quantityKind: basis === "net" ? c?.quantityKind : val(f, "k"), wastageBasis: val(f, "w"), source: val(f, "s"), sourceRevision: val(f, "sr") }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="qs-c">Component</label><select id="qs-c" value={cid} onChange={(e) => setCid(e.target.value)}>{components.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
        <div className="field"><label htmlFor="qs-b">Which quantity</label><select id="qs-b" value={basis} onChange={(e) => setBasis(e.target.value as "net" | "gross")}><option value="net">Net installed (used for effort)</option><option value="gross">Gross / material (incl. wastage)</option></select></div>
        <div className="field"><label htmlFor="qs-q">Quantity</label><input id="qs-q" name="q" inputMode="decimal" required pattern="\d+(\.\d{1,6})?" /></div>
        {basis === "gross" && <>
          <div className="field"><label htmlFor="qs-u">Unit</label><input id="qs-u" name="u" defaultValue={c?.unit} required /></div>
          <div className="field"><label htmlFor="qs-k">Quantity kind</label><input id="qs-k" name="k" defaultValue={c?.quantityKind} required /></div>
          <div className="field"><label htmlFor="qs-w">Wastage basis (as approved by the source)</label><input id="qs-w" name="w" /></div>
        </>}
        <div className="field"><label htmlFor="qs-s">Source</label><input id="qs-s" name="s" required placeholder="Estimator sheet, drawing, site measure…" /></div>
        <div className="field"><label htmlFor="qs-sr">Source revision</label><input id="qs-sr" name="sr" /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{basis === "net" ? `Net uses the component's own unit and kind (${c?.unit}, ${c?.quantityKind}).` : "Gross is recorded as sourced. It is never converted from net, and never used to calculate time."}</p>
      <EvidenceUploader draft={draft} label="Measurement photos or video (optional)" />
      <div><button type="submit" disabled={a.pending || !cid}>Record quantity</button></div>
      <ResultNotice result={a.result} successText="Recorded. The previous value stays in history." />
      <AttachOnSuccess result={a.result} draft={draft} parentType="quantity_snapshot" />
    </form>
  );
}

export function DriverForm({ components }: { components: Array<{ id: string; label: string }> }) {
  const a = useAction(addEffortDriver);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ componentId: val(f, "c"), driver: val(f, "d"), activity: val(f, "a"), quantity: val(f, "q"), unit: val(f, "u"), quantityKind: val(f, "k"), note: val(f, "n") }); }}>
      <div className="fields">
        <div className="field"><label htmlFor="ed-c">Component</label><select id="ed-c" name="c">{components.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
        <div className="field"><label htmlFor="ed-d">Driver</label><select id="ed-d" name="d">{["linear", "cutout", "joint", "trim", "island", "lighting", "drawer", "handling", "area", "other"].map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor="ed-a">Activity</label><select id="ed-a" name="a">{["install", "finish", "assemble", "unpack", "other"].map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor="ed-q">Quantity</label><input id="ed-q" name="q" inputMode="decimal" required pattern="\d+(\.\d{1,6})?" /></div>
        <div className="field"><label htmlFor="ed-u">Unit</label><input id="ed-u" name="u" required placeholder="rft, count…" /></div>
        <div className="field"><label htmlFor="ed-k">Quantity kind</label><input id="ed-k" name="k" required placeholder="counter_edge_length, sink_cutout…" /></div>
      </div>
      <div className="field"><label htmlFor="ed-n">Note</label><input id="ed-n" name="n" placeholder="Only work not already covered by the base rate" /></div>
      <div><button type="submit" disabled={a.pending}>Add driver</button></div>
      <ResultNotice result={a.result} successText="Driver added. Effort counts only with a matching rate; otherwise it shows as unknown." />
    </form>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function RestrictionForm({ projectId, current }: { projectId: string; current: { allowed_weekdays: number[]; start_time: string; end_time: string; note: string | null } | null }) {
  const a = useAction(setSiteRestriction);
  const draft = useEvidenceDraft("site.restriction");
  const [days, setDays] = useState<number[]>(current?.allowed_weekdays ?? [1, 2, 3, 4, 5, 6]);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ projectId, allowedWeekdays: days, startTime: val(f, "s"), endTime: val(f, "e"), restrictedActivities: (val(f, "r") ?? "").split(",").map((x) => x.trim()).filter(Boolean), note: val(f, "n") }); }}>
      <fieldset className="weekday-pick"><legend className="small">Days work is allowed</legend>
        {DAYS.map((d, i) => <label key={d} className="check"><input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i].sort() : days.filter((x) => x !== i))} /> {d}</label>)}
      </fieldset>
      <div className="fields">
        <div className="field"><label htmlFor="sr-s">From</label><input id="sr-s" name="s" type="time" defaultValue={current?.start_time.slice(0, 5) ?? "10:00"} required /></div>
        <div className="field"><label htmlFor="sr-e">Until</label><input id="sr-e" name="e" type="time" defaultValue={current?.end_time.slice(0, 5) ?? "18:00"} required /></div>
        <div className="field"><label htmlFor="sr-r">Restricted activities (comma separated)</label><input id="sr-r" name="r" placeholder="drilling after 17:00, stone cutting…" /></div>
      </div>
      <div className="field"><label htmlFor="sr-n">Society or site rule</label><input id="sr-n" name="n" defaultValue={current?.note ?? ""} /></div>
      <EvidenceUploader draft={draft} label="Photo of the notice or rule (optional)" />
      <div><button type="submit" disabled={a.pending || days.length === 0}>Save site window</button></div>
      <ResultNotice result={a.result} successText="Saved. Planning now limits productive time per day to this window; attendance stays 8 hours." />
      <AttachOnSuccess result={a.result} draft={draft} parentType="site_restriction" />
    </form>
  );
}

export function ApplianceForm({ projectId, items, existing }: { projectId: string; items: Array<{ id: string; label: string }>;
  existing?: { id: string; appliance: string; state: string; brand_technician: string; install_scope: string | null; depends_on: string | null; version: number } }) {
  const a = useAction(saveAppliance);
  const draft = useEvidenceDraft("appliance.check");
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      a.run({ id: existing?.id, version: existing?.version, projectId, orderItemId: val(f, "oi"), appliance: val(f, "ap") ?? existing?.appliance, state: val(f, "st"), brandTechnician: val(f, "bt"), installScope: val(f, "sc"), dependsOn: val(f, "dp") }); }}>
      <div className="fields">
        {!existing && <div className="field"><label htmlFor="ap-a-n">Appliance</label><input id="ap-a-n" name="ap" required placeholder="Hob, chimney, built-in oven…" /></div>}
        {!existing && <div className="field"><label htmlFor="ap-oi">Order item</label><select id="ap-oi" name="oi"><option value="">Whole project</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></div>}
        <div className="field"><label htmlFor={`ap-s-${existing?.id ?? "n"}`}>State</label><select id={`ap-s-${existing?.id ?? "n"}`} name="st" defaultValue={existing?.state ?? "selected"}>
          <option value="selected">Selected</option><option value="spec_final">Specification final</option><option value="on_site">Physically on site</option><option value="inspected">Inspected / unpacked</option></select></div>
        <div className="field"><label htmlFor={`ap-b-${existing?.id ?? "n"}`}>Brand technician</label><select id={`ap-b-${existing?.id ?? "n"}`} name="bt" defaultValue={existing?.brand_technician ?? "not_needed"}>
          <option value="not_needed">Not needed</option><option value="needed">Needed, not booked</option><option value="booked">Booked</option><option value="unavailable">Unavailable</option></select></div>
        {!existing && <div className="field"><label htmlFor="ap-sc">Installation scope</label><input id="ap-sc" name="sc" /></div>}
        {!existing && <div className="field"><label htmlFor="ap-dp">Affects</label><input id="ap-dp" name="dp" placeholder="Sink cutting, hob cut-out…" /></div>}
      </div>
      <EvidenceUploader draft={draft} label="Photo of the appliance or box (optional)" />
      <div><button type="submit" disabled={a.pending}>{existing ? "Update" : "Add appliance"}</button></div>
      <ResultNotice result={a.result} successText="Saved." />
      <AttachOnSuccess result={a.result} draft={draft} parentType="appliance_dependency" />
    </form>
  );
}

export function ApplianceException({ id }: { id: string }) {
  const a = useAction(exceptAppliance);
  const draft = useEvidenceDraft("appliance.exception");
  return (
    <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run({ id, reason: val(f, "r") }); }}>
      <div className="row">
        <label className="sr-only" htmlFor={`ax-${id}`}>Reason to proceed anyway</label>
        <input id={`ax-${id}`} name="r" required minLength={5} placeholder="Why work can proceed anyway" style={{ flex: 1, minWidth: 180 }} />
        <button type="submit" disabled={a.pending}>Record exception</button>
      </div>
      <EvidenceDisclosure draft={draft} />
      <ResultNotice result={a.result} successText="Exception recorded. The dependency stays listed as a risk." />
      <AttachOnSuccess result={a.result} draft={draft} parentType="appliance_dependency" />
    </form>
  );
}

/** Links a form's attachments once its record is saved and the server returned the new id. */
function AttachOnSuccess({ result, draft, parentType }: { result: ReturnType<typeof useAction>["result"]; draft: ReturnType<typeof useEvidenceDraft>; parentType: string }) {
  const done = useRef<string | null>(null);
  const [note, setNote] = useState("");
  const id = result?.ok ? (result.data as { id?: string } | null)?.id : undefined;
  useEffect(() => {
    if (!id || done.current === id) return;
    done.current = id;
    void draft.attach(parentType, id).then((r) => setNote(attachmentNote(r)));
  }, [id, draft, parentType]);
  return note ? <p className="small muted" role="status" style={{ margin: 0 }}>{note.trim()}</p> : null;
}
