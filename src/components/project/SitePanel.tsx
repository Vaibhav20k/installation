/** Site and readiness tab: contacts, net vs gross quantities, effort drivers, permitted window, appliances, substitutions. */
import type { siteDetail } from "@/server/queries/site";
import { hours, qty, when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Notice";
import { ApplianceException, ApplianceForm, ContactForm, DriverForm, QuantityForm, RestrictionForm } from "./SiteForms";

type Site = Awaited<ReturnType<typeof siteDetail>>;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATE: Record<string, string> = { selected: "Selected", spec_final: "Spec final", on_site: "On site", inspected: "Inspected" };

export function SitePanel({ projectId, s, canEdit, canExcept }: { projectId: string; s: Site; canEdit: boolean; canExcept: boolean }) {
  const comps = s.components.map((c) => ({ id: c.id, label: `${c.business_id} ${c.name} (${c.item})`, unit: c.unit, quantityKind: c.quantity_kind }));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" aria-labelledby="h-ready">
        <h2 id="h-ready">Readiness from appliances</h2>
        {s.applianceBlockers.blockers.length === 0 && s.applianceBlockers.risks.length === 0 ? <p className="muted" style={{ margin: 0 }}>No appliance blockers recorded.</p> : (
          <ul className="req-list">
            {s.applianceBlockers.blockers.map((b) => <li key={b.message}><span className="code-tag">BLOCKER</span><span>{b.message}</span><Badge state="fail" tone="bad" label="Blocks booking" /></li>)}
            {s.applianceBlockers.risks.map((b) => <li key={b.message}><span className="code-tag">RISK</span><span>{b.message}<span className="small muted" style={{ display: "block" }}>Exception recorded; a repeat visit may still be needed.</span></span><Badge state="pending" label="Excepted" /></li>)}
          </ul>
        )}
        <p className="small muted" style={{ margin: 0 }}>These also appear in each visit&apos;s readiness check. A selected appliance is not proof it is on site.</p>
      </section>

      <section className="card stack" aria-labelledby="h-app">
        <h2 id="h-app">Appliances ({s.appliances.length})</h2>
        {s.appliances.length === 0 ? <Empty>No appliances recorded.</Empty> : (
          <ul className="req-list">
            {s.appliances.map((a) => (
              <li key={a.id}>
                <span className="code-tag">{a.item ?? "PROJECT"}</span>
                <span><strong>{a.appliance}</strong> · {STATE[a.state]} · brand technician {a.brand_technician.replace("_", " ")}{a.depends_on ? ` · affects ${a.depends_on}` : ""}
                  {a.exception_reason && <span className="small" style={{ display: "block" }}>Exception: {a.exception_reason}</span>}
                  {canEdit && <details><summary className="small">Update</summary><ApplianceForm projectId={projectId} items={s.items} existing={a} /></details>}
                  {canExcept && !a.exception_reason && <details><summary className="small">Proceed anyway (manager)</summary><ApplianceException id={a.id} /></details>}</span>
                <Badge state={a.state === "on_site" || a.state === "inspected" ? "completed" : "pending"} label={STATE[a.state] ?? a.state} />
              </li>
            ))}
          </ul>
        )}
        {canEdit && <details><summary className="button">Add an appliance</summary><ApplianceForm projectId={projectId} items={s.items} /></details>}
      </section>

      <section className="card stack" aria-labelledby="h-win">
        <h2 id="h-win">Site working window</h2>
        {s.restriction ? (
          <dl className="facts">
            <dt>Allowed days</dt><dd>{s.restriction.allowed_weekdays.map((d) => DAYS[d]).join(", ")}</dd>
            <dt>Window</dt><dd className="code">{s.restriction.start_time.slice(0, 5)}–{s.restriction.end_time.slice(0, 5)} ({hours(s.capacity.windowMinutes)})</dd>
            <dt>Restricted</dt><dd>{s.restriction.restricted_activities.join(", ") || "None"}</dd>
            {s.restriction.note && <><dt>Rule</dt><dd>{s.restriction.note}</dd></>}
          </dl>
        ) : <p className="muted" style={{ margin: 0 }}>No site restriction recorded; planning assumes the employee calendar.</p>}
        {s.totalDriverMinutes > 0 && (
          <p className="small" style={{ margin: 0 }}>
            Driver effort {hours(Math.round(s.totalDriverMinutes))} for a crew of {s.crewSize}: {s.capacity.crewDays} working day{s.capacity.crewDays === 1 ? "" : "s"} at {hours(s.capacity.productiveMinutesPerDay)} productive time per day
            {s.capacity.extraDaysFromRestriction > 0 ? `, ${s.capacity.extraDaysFromRestriction} more than without the site window` : ""}. The 8-hour attendance session and the estimate itself do not change.
          </p>
        )}
        {canEdit && <details><summary className="button">{s.restriction ? "Change the window" : "Record a site window"}</summary><RestrictionForm projectId={projectId} current={s.restriction} /></details>}
      </section>

      <section className="card stack" aria-labelledby="h-qty">
        <h2 id="h-qty">Quantities and effort drivers</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Component</th><th>Order quantity</th><th>Net installed</th><th>Gross / material</th><th>Extra drivers</th><th>Driver effort</th></tr></thead>
          <tbody>{s.components.map((c) => {
            const net = c.snapshots.find((x) => x.basis === "net"), gross = c.snapshots.find((x) => x.basis === "gross");
            return (
              <tr key={c.id}>
                <td>{c.business_id} {c.name}<div className="small muted">{c.item}</div></td>
                <td className="code">{qty(c.quantity)} {c.unit}<div className="small muted">{c.quantity_kind}</div></td>
                <td className="code">{net ? `${qty(net.quantity)} ${net.unit}` : "Not recorded"}{net && <div className="small muted">{net.source}{net.revision ? ` · ${net.revision}` : ""}</div>}</td>
                <td className="code">{gross ? `${qty(gross.quantity)} ${gross.unit}` : "Not recorded"}{gross?.wastage && <div className="small muted">{gross.wastage}</div>}</td>
                <td className="small">{c.drivers.length ? c.drivers.map((d) => `${d.driver} ${qty(d.quantity)} ${d.unit}`).join(", ") : "None"}</td>
                <td className="small">{c.drivers.length === 0 ? "None" : <>{hours(Math.round(c.effort.knownMinutes))}{!c.effort.complete && " + unknown"}{c.effort.provisional && <Badge state="provisional" label="Provisional" />}
                  {c.effort.lines.filter((l) => l.issue).map((l) => <div key={l.driverId} className="muted">{l.issue}</div>)}</>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="small muted" style={{ margin: 0 }}>Effort uses the net installed quantity. Gross includes wastage and is never used for time. Extra drivers add effort only for work the base rate does not already cover.</p>
        {canEdit && comps.length > 0 && <div className="grid cols-2">
          <details><summary className="button">Record net or gross quantity</summary><QuantityForm components={comps} /></details>
          <details><summary className="button">Add an effort driver</summary><DriverForm components={comps} /></details>
        </div>}
      </section>

      <section className="card stack" aria-labelledby="h-ct">
        <h2 id="h-ct">Customer contacts ({s.contacts.length})</h2>
        {s.contacts.length === 0 ? <Empty>No contacts recorded.</Empty> : (
          <ul className="req-list">
            {s.contacts.map((c) => <li key={c.id}><span className="code-tag">{c.is_primary ? "PRIMARY" : "CONTACT"}</span><span><strong>{c.name}</strong> · {c.relationship}{c.phone ? ` · ${c.phone}` : ""}{c.email ? ` · ${c.email}` : ""}{c.note && <span className="small muted" style={{ display: "block" }}>{c.note}</span>}</span><span /></li>)}
          </ul>
        )}
        {canEdit && <details><summary className="button">Add a contact</summary><ContactForm projectId={projectId} /></details>}
      </section>

      {s.substitutions.length > 0 && (
        <section className="card stack" aria-labelledby="h-sub">
          <h2 id="h-sub">Crew substitutions</h2>
          <ul className="req-list">{s.substitutions.map((x) => <li key={x.id}><span className="code-tag">{x.visit}</span><span><strong>{x.outgoing} → {x.incoming}</strong> from {when(x.effective_at)}<span className="small muted" style={{ display: "block" }}>{x.reason} · by {x.by}</span></span><span /></li>)}</ul>
        </section>
      )}
    </div>
  );
}
