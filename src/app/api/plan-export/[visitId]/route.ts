/**
 * Client-facing plan export: dates, scope and site requirements only. It excludes employee names and
 * private fields, internal costs and approval commentary. It is a download; nothing is sent.
 */
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { DEMO_COOKIE, resolveActor } from "@/server/auth/actor";
import { requireProjectScope } from "@/server/auth/permissions";
import { AppError, HTTP_STATUS, toAppError } from "@/server/errors";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(visitId)) throw new AppError("not_found", "Visit not found");
    const db = await getDb();
    const actor = await resolveActor(db, (await cookies()).get(DEMO_COOKIE)?.value);
    const [v] = await db.query<{ project_id: string; business_id: string; project: string; site_address: string; visit_type: string; planned_start: string | null; planned_end: string | null; team_size: number }>(
      `select v.project_id, v.business_id, p.name project, p.site_address, v.visit_type, v.planned_start::text, v.planned_end::text, v.team_size from visit v join project p on p.id = v.project_id where v.id = $1`, [visitId]);
    if (!v) throw new AppError("not_found", "Visit not found");
    await requireProjectScope(db, actor, v.project_id);
    const scope = await db.query<{ component: string; activity: string; qty: string; unit: string; kind: string }>(
      `select c.name component, t.activity, vt.scoped_quantity::text qty, t.unit, vt.kind from visit_task vt join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id
       where vt.visit_id = $1 and vt.status = 'active' order by c.business_id, t.step_order`, [visitId]);
    const daily = await db.query<{ plan_date: string; component: string; activity: string; qty: string; unit: string }>(
      `select d.plan_date::text, c.name component, t.activity, d.target_quantity::text qty, t.unit from daily_target d join visit_task vt on vt.id = d.visit_task_id
       join installation_task t on t.id = vt.task_id join component c on c.id = t.component_id where vt.visit_id = $1 and d.is_current order by d.plan_date, c.business_id`, [visitId]);
    const rows: unknown[][] = [
      ...scope.map((s) => ["Scope", "", s.component, s.activity, Number(s.qty), s.unit, s.kind === "original" ? "" : s.kind]),
      ...daily.map((d) => ["Daily plan", d.plan_date, d.component, d.activity, Number(d.qty), d.unit, ""]),
      ["Site requirement", "", "Site access and power available on planned dates", "", "", "", ""],
      ["Site requirement", "", "Customer or representative available to confirm completion", "", "", "", ""],
    ];
    const body = toCsv(["Section", "Date", "Item", "Step", "Quantity", "Unit", "Note"], rows, [
      ["Plan", `${v.business_id} (${v.visit_type.replace("_", "-")} visit)`], ["Project", v.project], ["Site", v.site_address],
      ["Planned dates", `${v.planned_start ?? "to be confirmed"} to ${v.planned_end ?? "to be confirmed"}`], ["Installation team size", String(v.team_size)],
      ["Note", "Dates are planned and may change; you will be informed of confirmed dates."],
    ]);
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="plan-${v.business_id}.csv"`, "cache-control": "no-store" } });
  } catch (e) {
    const err = e instanceof AppError ? e : toAppError(e);
    return new Response(err.message, { status: HTTP_STATUS[err.kind] });
  }
}
