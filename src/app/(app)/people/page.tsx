import { session } from "@/server/session";
import { listEmployees, skillsCatalog } from "@/server/queries/people";
import { LEVEL } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";

export const metadata = { title: "People & Skills" };
const ROLES = ["project_manager", "operator", "site_supervisor", "carpenter", "helper", "senior_technician", "technician", "junior_technician", "assistant_technician", "stone_technician"];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, actor } = await session();
  const [rows, skills] = await Promise.all([
    listEmployees(db, actor, { role: sp.role || undefined, skill: sp.skill || undefined, includeInactive: sp.inactive === "1" }),
    skillsCatalog(db),
  ]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return (
    <>
      <PageHeader title="People & Skills" subtitle="Job role (what someone does) and permission level (what they may approve) are separate. Skill levels qualify only when verified and valid on the work date." />
      <form className="row card no-print" role="search" aria-label="Filter people">
        <div className="field"><label htmlFor="pp-role">Job role</label><select id="pp-role" name="role" defaultValue={sp.role ?? ""}><option value="">All</option>{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>
        <div className="field"><label htmlFor="pp-skill">Has skill record</label><select id="pp-skill" name="skill" defaultValue={sp.skill ?? ""}><option value="">Any</option>{skills.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}</select></div>
        <label className="check" style={{ alignSelf: "flex-end" }}><input type="checkbox" name="inactive" value="1" defaultChecked={sp.inactive === "1"} /> Include inactive</label>
        <button type="submit" style={{ alignSelf: "flex-end" }}>Apply</button>
      </form>
      {rows.length === 0 ? <Empty>No people match.</Empty> : (
        <div className="table-wrap"><table>
          <caption className="sr-only">Skill card: ✓ verified and valid today, ? unverified, ⌛ expired.</caption>
          <thead><tr><th className="pin">Employee</th><th>Job role</th><th>Permission</th><th>Base</th><th>Reports to</th><th>Skill card</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id}>
              <th scope="row" className="pin" style={{ fontWeight: 400 }}><a href={`/people/${e.id}`}>{e.name}</a><div className="small muted">{e.business_id}{!e.active && " · inactive"}</div></th>
              <td>{e.job_role.replace(/_/g, " ")}</td>
              <td>{e.permission_role}{e.capabilities.length > 0 && <div className="small muted">{e.capabilities.map((c) => c.replace(/_/g, " ")).join(", ")}</div>}</td>
              <td>{e.base_city}</td><td>{e.manager ?? "None"}</td>
              <td className="small">{e.skills.length === 0 ? "None" : e.skills.map((s) => {
                const expired = s.valid_to && s.valid_to < today;
                return <span key={s.code} style={{ marginRight: 8, whiteSpace: "nowrap" }}>{expired ? "⌛" : s.verified ? "✓" : "?"} {s.code.replace(/_/g, " ")} {LEVEL[s.level]}</span>;
              })}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="small muted"><Badge state="illustrative" label="Provisional" /> 40 demo employees include 3 with manager permission; whether the three managers are part of the forty is unresolved.</p>
    </>
  );
}
