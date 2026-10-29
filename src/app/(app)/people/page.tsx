import Link from "next/link";
import { session } from "@/server/session";
import { listEmployees, skillsCatalog } from "@/server/queries/people";
import { LEVEL } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";

export const metadata = { title: "People & Skills" };
const ROLES = ["project_manager", "operator", "site_supervisor", "carpenter", "helper", "senior_technician", "technician", "junior_technician", "assistant_technician", "stone_technician", "department_staff"];
const STATE_LABEL = { ok: "verified", unverified: "not checked yet", expired: "expired" } as const;
const STATE_MARK = { ok: "✓", unverified: "?", expired: "⌛" } as const;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const [all, skills] = await Promise.all([
    listEmployees(db, actor, { role: sp.role || undefined, skill: sp.skill || undefined, includeInactive: sp.inactive === "1" }),
    skillsCatalog(db),
  ]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const stateOf = (s: { verified: boolean; valid_to: string | null }) => (s.valid_to && s.valid_to < today ? "expired" : s.verified ? "ok" : "unverified") as keyof typeof STATE_LABEL;
  // Someone who can verify skills sees the people waiting on that check first (never their own record).
  const canVerify = actor.capabilities.includes("skill_verify");
  const needsCheck = (e: (typeof all)[number]) => canVerify && e.id !== actor.id && e.skills.some((s) => stateOf(s) !== "ok");
  const rows = [...all.filter(needsCheck), ...all.filter((e) => !needsCheck(e))];
  const waiting = rows.filter(needsCheck).length;
  return (
    <div className="inbox-page">
      <PageHeader title="People & Skills" subtitle="Job role is what someone does; permission is what they may approve. A skill counts only once it is checked and still valid on the work date." />
      {waiting > 0 && (
        <p className="wait-strip" data-state="waiting" role="status">
          <span className="wait-total"><span className="wait-n">{waiting}</span> {waiting === 1 ? "person has" : "people have"} skills waiting for your check</span>
          <span className="small muted">They are listed first and marked. Open a person to check their skills.</span>
        </p>
      )}
      <form className="row card no-print inbox-filter" role="search" aria-label="Filter people">
        <div className="field"><label htmlFor="pp-role">Job role</label><select id="pp-role" name="role" defaultValue={sp.role ?? ""}><option value="">All</option>{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>
        <div className="field"><label htmlFor="pp-skill">Has skill</label><select id="pp-skill" name="skill" defaultValue={sp.skill ?? ""}><option value="">Any</option>{skills.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}</select></div>
        <label className="check"><input type="checkbox" name="inactive" value="1" defaultChecked={sp.inactive === "1"} /> Include inactive</label>
        <button type="submit">Apply</button>
      </form>
      {rows.length === 0 ? <Empty>No people match these filters. Clear a filter to see more.</Empty> : (
        <div className="table-wrap"><table className="rows-mobile">
          <caption className="sr-only">Skill card: ✓ verified and valid today, ? not checked yet, ⌛ expired.</caption>
          <thead><tr><th className="pin">Employee</th><th>Job role</th><th>Permission</th><th>Base</th><th>Reports to</th><th>Skill card</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id} data-needs={needsCheck(e) || undefined}>
              <th scope="row" className="pin" style={{ fontWeight: 400 }}><Link href={`/people/${e.id}`}>{e.name}</Link><div className="small muted">{e.business_id}{!e.active && " · inactive"}</div></th>
              <td data-label="Job role">{e.job_role.replace(/_/g, " ")}</td>
              <td data-label="Permission"><span>{e.permission_role}{e.capabilities.length > 0 && <span className="small muted" style={{ display: "block" }}>{e.capabilities.map((c) => c.replace(/_/g, " ")).join(", ")}</span>}</span></td>
              <td data-label="Base">{e.base_city}</td><td data-label="Reports to">{e.manager ?? "None"}</td>
              <td data-label="Skill card">{e.skills.length === 0 ? <span className="small muted">None recorded</span> : (
                <span className="skill-chips">{e.skills.map((s) => {
                  const st = stateOf(s);
                  return <span key={s.code} className="skill-chip" data-state={st} title={STATE_LABEL[st]}><span aria-hidden>{STATE_MARK[st]}</span> {s.code.replace(/_/g, " ")} {LEVEL[s.level]}<span className="sr-only">, {STATE_LABEL[st]}</span></span>;
                })}</span>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="small muted" style={{ margin: 0 }}><Badge state="illustrative" label="Provisional" /> 40 demo employees include 3 with manager permission; whether the three managers are part of the forty is unresolved.</p>
    </div>
  );
}
