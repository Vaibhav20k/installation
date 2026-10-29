"use client";
import { updateEmployee } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import { ActionButton } from "@/components/ui/ActionButton";

const ROLES = ["project_manager", "operator", "site_supervisor", "carpenter", "helper", "senior_technician", "technician", "junior_technician", "assistant_technician", "stone_technician", "department_staff"];

/** Admin-only master data changes. Deactivation keeps all history; future bookings are flagged on the planning sheet. */
export function EmployeeAdmin({ employee }: { employee: { id: string; version: number; active: boolean; job_role: string; permission_role: string } }) {
  const save = useAction(updateEmployee);
  return (
    <section className="card stack" aria-labelledby="h-adm">
      <h2 id="h-adm">Administration</h2>
      <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); save.run({ employeeId: employee.id, version: employee.version, jobRole: String(f.get("j")), permissionRole: String(f.get("p")) }); }}>
        <div className="fields">
          <div className="field"><label htmlFor="ad-j">Job role</label><select id="ad-j" name="j" defaultValue={employee.job_role}>{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>
          <div className="field"><label htmlFor="ad-p">Permission level</label><select id="ad-p" name="p" defaultValue={employee.permission_role}><option value="employee">Employee</option><option value="supervisor">Supervisor</option><option value="manager">Manager</option><option value="admin">Administrator</option></select></div>
        </div>
        <p className="small muted">Job role and permission are independent; a senior title grants no approval rights and proves no skill level.</p>
        <button type="submit" disabled={save.pending}>Save roles</button>
        <ResultNotice result={save.result} successText="Saved." />
      </form>
      <ActionButton action={updateEmployee} input={{ employeeId: employee.id, version: employee.version, active: !employee.active }} label={employee.active ? "Deactivate employee" : "Reactivate employee"} tone={employee.active ? "danger" : undefined}
        confirm={employee.active ? "Past time, assignments and approvals are kept. Future bookings stay in place and are flagged for review; the employee can no longer be suggested or sign in." : "The employee becomes available for suggestions again."} />
    </section>
  );
}
