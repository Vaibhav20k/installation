/**
 * Installer reports of missing or damaged items found on site after receipt (request of 28 Oct 2026).
 * Anyone booked on the site today can report a received BOM line with type, quantity, reason and a photo. The
 * report waits for the site's Installation Manager, who confirms it (a complaint opens, exactly as from the
 * receipt check) or rejects it with a reason. The reporter is told either way. One waiting report and one open
 * complaint per line at most, so nobody sees duplicates.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import type { Actor } from "../auth/permissions";
import { conflict, forbidden, validation } from "../errors";
import { Dec } from "@/domain/decimal";
import { addDays, localDateOf, startOfLocalDay } from "@/lib/dates";
import { iso, one, parse, zId, zQty, type Ctx } from "./context";
import { HREF, actorRoles, readyFiles, requireFlowView, stageRecipients } from "./flow-core";
import { openComplaint } from "./dispatch";

/** Projects the person is booked on (held or confirmed) on the site's own local date today. */
async function bookedProjects(q: Queryable, employeeId: string, now: number): Promise<Set<string>> {
  const rows = await q.query<{ project_id: string; timezone: string; lo: number; hi: number }>(
    `select v.project_id, p.timezone, min(lower(r.span)) lo, max(upper(r.span)) hi from reservation r join visit v on v.id = r.visit_id join project p on p.id = v.project_id
     where r.employee_id = $1 and r.state in ('held','confirmed') and r.span && tstzrange($2::timestamptz - interval '1 day', $2::timestamptz + interval '1 day')
     group by v.project_id, p.timezone`, [employeeId, iso(now)]);
  return new Set(rows.filter((r) => {
    const day = localDateOf(now, r.timezone);
    return Number(r.lo) < startOfLocalDay(addDays(day, 1), r.timezone) && Number(r.hi) > startOfLocalDay(day, r.timezone);
  }).map((r) => r.project_id));
}

export interface ReportableLine { item_id: string; name: string; unit: string; quantity: string; open_complaint: string | null; pending_report: string | null }

/** What the person can report on today: received lines of dispatches to the sites they are booked on. */
export async function reportableLines(q: Queryable, actor: Actor, now: number) {
  const projects = [...(await bookedProjects(q, actor.id, now))];
  if (!projects.length) return [];
  const rows = await q.query<{ project_id: string; project: string; dispatch_id: string; business_id: string; types: string[] } & ReportableLine>(
    `select p.id project_id, p.name project, d.id dispatch_id, d.business_id, d.types, di.id item_id, c.name, c.unit, di.quantity::float::text quantity,
       (select k.business_id from complaint k where k.dispatch_item_id = di.id and k.status = 'open' limit 1) open_complaint,
       (select r.id::text from mnd_report r where r.dispatch_item_id = di.id and r.status = 'pending' limit 1) pending_report
     from dispatch d join project p on p.id = d.project_id join dispatch_item di on di.dispatch_id = d.id join component c on c.id = di.component_id
     where d.project_id = any($1::uuid[]) and d.status <> 'cancelled' and di.received_ok is not null
     order by p.name, d.business_id, c.business_id`, [projects]);
  const sites = new Map<string, { project_id: string; project: string; dispatches: Array<{ dispatch_id: string; business_id: string; types: string[]; lines: ReportableLine[] }> }>();
  for (const r of rows) {
    const s = sites.get(r.project_id) ?? { project_id: r.project_id, project: r.project, dispatches: [] };
    let d = s.dispatches.find((x) => x.dispatch_id === r.dispatch_id);
    if (!d) { d = { dispatch_id: r.dispatch_id, business_id: r.business_id, types: r.types, lines: [] }; s.dispatches.push(d); }
    d.lines.push({ item_id: r.item_id, name: r.name, unit: r.unit, quantity: r.quantity, open_complaint: r.open_complaint, pending_report: r.pending_report });
    sites.set(r.project_id, s);
  }
  return [...sites.values()];
}

export async function reportMnd(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ itemId: zId, kind: z.enum(["missing", "damaged"]), quantity: zQty, reason: z.string().trim().min(3, "Say what is wrong").max(500), photoDraftKey: z.string().uuid().optional() }), input);
  return ctx.db.tx(async (q) => {
    const it = await one<{ id: string; dispatch_id: string; project_id: string; quantity: string; received_ok: boolean | null; name: string; dispatch_no: string; status: string }>(q,
      `select di.id, di.dispatch_id, d.project_id, di.quantity::text, di.received_ok, c.name, d.business_id dispatch_no, d.status
       from dispatch_item di join dispatch d on d.id = di.dispatch_id join component c on c.id = di.component_id where di.id = $1 for update of di`, [d.itemId], "Item");
    if (!(await bookedProjects(q, ctx.actor.id, ctx.now)).has(it.project_id)) throw forbidden("You can report items only for a site you are booked on today.");
    if (it.received_ok === null || it.status === "cancelled") throw conflict(`${it.name} has not been received on site yet. The Installation Manager checks it at receipt.`);
    const [open] = await q.query<{ business_id: string }>("select business_id from complaint where dispatch_item_id = $1 and status = 'open'", [it.id]);
    if (open) throw conflict(`${it.name} already has complaint ${open.business_id} open. Tell your Installation Manager if more is wrong.`);
    const [pending] = await q.query("select 1 from mnd_report where dispatch_item_id = $1 and status = 'pending'", [it.id]);
    if (pending) throw conflict(`${it.name} is already reported and waiting for the Installation Manager.`);
    const problems: string[] = [];
    if (Dec.of(d.quantity).cmp(0) <= 0) problems.push("Quantity: enter how many are missing or damaged.");
    else if (Dec.of(d.quantity).cmp(it.quantity) > 0) problems.push(`Quantity: at most ${Number(it.quantity)} came on this dispatch.`);
    const photos = await readyFiles(q, ctx.actor.id, d.photoDraftKey, "photo");
    if (!photos.length) problems.push("Photo: take at least one photo and wait for it to finish uploading.");
    if (problems.length) throw validation("The report is not complete.", problems);
    const [r] = await q.query<{ id: string }>(
      "insert into mnd_report(dispatch_id, dispatch_item_id, project_id, kind, quantity, reason, reported_by, reported_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [it.dispatch_id, it.id, it.project_id, d.kind, d.quantity, d.reason, ctx.actor.id, iso(ctx.now)]);
    for (const a of photos) await q.query("insert into evidence_link(asset_id, parent_type, parent_id, context, actor_id) values ($1,'mnd_report',$2,'flow.mnd_photo',$3)", [a, r!.id, ctx.actor.id]);
    for (const emp of await stageRecipients(q, "installation_manager", it.project_id)) {
      await q.query("insert into notification(employee_id, kind, title, body, dedupe_key, effective_at, href) values ($1,'mnd_report',$2,$3,$4,$5,$6) on conflict (dedupe_key) do nothing",
        [emp, `${it.dispatch_no}: ${d.kind === "missing" ? "missing" : "damaged"} item reported`, `${ctx.actor.name}: ${d.quantity} × ${it.name}. ${d.reason}. Confirm or reject it.`, `mnd-report:${r!.id}:${emp}`, iso(ctx.now), `${HREF("dispatch", it.dispatch_id)}#site-reports`]);
    }
    await audit(q, { actorId: ctx.actor.id, action: "report_mnd", objectType: "dispatch", objectId: it.dispatch_id, after: { report: r!.id, ...d, photos: photos.length }, correlationId: ctx.correlationId });
    return { reportId: r!.id };
  });
}

interface ReportRow { id: string; dispatch_id: string; dispatch_item_id: string; project_id: string; kind: "missing" | "damaged"; quantity: string; reason: string; status: string; reported_by: string }

/** Only the Installation Manager(s) of the report's site decide (the same people who are told about it). */
async function lockForDecision(q: Queryable, actor: Actor, reportId: string) {
  const r = await one<ReportRow>(q, "select id, dispatch_id, dispatch_item_id, project_id, kind, quantity::text, reason, status, reported_by from mnd_report where id = $1 for update", [reportId], "Report");
  const isIm = (await actorRoles(q, actor.id)).includes("installation_manager") && (await stageRecipients(q, "installation_manager", r.project_id)).includes(actor.id);
  if (!isIm) throw forbidden("Only this site's Installation Manager confirms or rejects reports from the site.");
  if (r.status !== "pending") throw conflict(`This report was already ${r.status}.`);
  return r;
}

async function tellReporter(q: Queryable, r: ReportRow, title: string, body: string, href: string, now: number) {
  await q.query("insert into notification(employee_id, kind, title, body, dedupe_key, effective_at, href) values ($1,'mnd_report_decided',$2,$3,$4,$5,$6) on conflict (dedupe_key) do nothing",
    [r.reported_by, title, body, `mnd-report-decided:${r.id}`, iso(now), href]);
}

export async function confirmMndReport(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ reportId: zId }), input);
  return ctx.db.tx(async (q) => {
    const r = await lockForDecision(q, ctx.actor, d.reportId);
    const disp = await one<{ id: string; business_id: string; order_id: string; project_id: string }>(q, "select id, business_id, order_id, project_id from dispatch where id = $1 for update", [r.dispatch_id], "Dispatch");
    const it = await one<{ id: string; component_id: string; name: string }>(q, "select di.id, di.component_id, c.name from dispatch_item di join component c on c.id = di.component_id where di.id = $1", [r.dispatch_item_id], "Item");
    const [open] = await q.query<{ business_id: string }>("select business_id from complaint where dispatch_item_id = $1 and status = 'open'", [it.id]);
    if (open) throw conflict(`${it.name} already has complaint ${open.business_id} open.`);
    const photos = (await q.query<{ asset_id: string }>("select asset_id from evidence_link where parent_type = 'mnd_report' and parent_id = $1 and status = 'active'", [r.id])).map((x) => x.asset_id);
    const [who] = await q.query<{ name: string }>("select name from employee where id = $1", [r.reported_by]);
    const c = await openComplaint(q, ctx, disp, it, { kind: r.kind, quantity: r.quantity, reason: r.reason }, photos, { reported_by: who?.name ?? null, from: "site report" });
    await q.query("update mnd_report set status = 'confirmed', complaint_id = $2, decided_by = $3, decided_at = $4 where id = $1", [r.id, c.id, ctx.actor.id, iso(ctx.now)]);
    await q.query("update dispatch set partial = true, version = version + 1, updated_at = $2 where id = $1 and status = 'open'", [disp.id, iso(ctx.now)]);
    await tellReporter(q, r, `Your report was confirmed: ${c.business_id}`, `${Number(r.quantity)} × ${it.name} is now complaint ${c.business_id}. The factory will plan the replacement.`, HREF("complaint", c.id), ctx.now);
    await audit(q, { actorId: ctx.actor.id, action: "confirm_mnd_report", objectType: "dispatch", objectId: disp.id, after: { report: r.id, complaint: c.business_id }, correlationId: ctx.correlationId });
    return { complaintId: c.id, businessId: c.business_id };
  });
}

export async function rejectMndReport(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ reportId: zId, reason: z.string().trim().min(3, "Say why it is rejected").max(500) }), input);
  return ctx.db.tx(async (q) => {
    const r = await lockForDecision(q, ctx.actor, d.reportId);
    await q.query("update mnd_report set status = 'rejected', decided_by = $2, decided_at = $3, decision_reason = $4 where id = $1", [r.id, ctx.actor.id, iso(ctx.now), d.reason]);
    await tellReporter(q, r, "Your missing/damaged report was not accepted", `${ctx.actor.name}: ${d.reason}`, "/my-day#report-mnd", ctx.now);
    await audit(q, { actorId: ctx.actor.id, action: "reject_mnd_report", objectType: "dispatch", objectId: r.dispatch_id, after: { report: r.id }, reason: d.reason, correlationId: ctx.correlationId });
    return { ok: true };
  });
}

export interface SiteReport { id: string; kind: string; quantity: string; reason: string; status: string; item: string; reporter: string; reported_at: number; photos: number; photo_ids: string[]; complaint: string | null; decision_reason: string | null }

/** Reports from the site on one dispatch, waiting ones first (for the dispatch screen). */
export async function siteReports(q: Queryable, actor: Actor, dispatchId: string): Promise<SiteReport[]> {
  const d = await one<{ project_id: string }>(q, "select project_id from dispatch where id = $1", [dispatchId], "Dispatch");
  await requireFlowView(q, actor, d.project_id);
  return q.query<SiteReport>(
    `select r.id, r.kind, r.quantity::float::text quantity, r.reason, r.status, c.name item, e.name reporter, r.reported_at, k.business_id complaint, r.decision_reason,
       (select count(*)::int from evidence_link l where l.parent_type = 'mnd_report' and l.parent_id = r.id and l.status = 'active') photos,
       coalesce((select array_agg(l.asset_id::text) from evidence_link l where l.parent_type = 'mnd_report' and l.parent_id = r.id and l.status = 'active'), '{}') photo_ids
     from mnd_report r join dispatch_item di on di.id = r.dispatch_item_id join component c on c.id = di.component_id join employee e on e.id = r.reported_by
     left join complaint k on k.id = r.complaint_id where r.dispatch_id = $1 order by (r.status = 'pending') desc, r.reported_at desc`, [dispatchId]);
}

/** The reporter's own reports and what happened to them. */
export async function myMndReports(q: Queryable, actor: Actor) {
  return q.query<{ id: string; kind: string; quantity: string; item: string; dispatch: string; status: string; decision_reason: string | null; complaint: string | null; reported_at: number }>(
    `select r.id, r.kind, r.quantity::float::text quantity, c.name item, d.business_id dispatch, r.status, r.decision_reason, k.business_id complaint, r.reported_at
     from mnd_report r join dispatch d on d.id = r.dispatch_id join dispatch_item di on di.id = r.dispatch_item_id join component c on c.id = di.component_id
     left join complaint k on k.id = r.complaint_id where r.reported_by = $1 order by r.reported_at desc limit 20`, [actor.id]);
}

/** Waiting reports this person decides (they are an Installation Manager of the site), oldest first. */
export async function reportsToDecide(q: Queryable, actor: Actor) {
  if (!(await actorRoles(q, actor.id)).includes("installation_manager")) return [];
  const rows = await q.query<{ id: string; dispatch_id: string; dispatch: string; project_id: string; project: string; kind: string; quantity: string; item: string; reporter: string; reported_at: number }>(
    `select r.id, r.dispatch_id, d.business_id dispatch, r.project_id, p.name project, r.kind, r.quantity::float::text quantity, c.name item, e.name reporter, r.reported_at
     from mnd_report r join dispatch d on d.id = r.dispatch_id join project p on p.id = r.project_id join dispatch_item di on di.id = r.dispatch_item_id
     join component c on c.id = di.component_id join employee e on e.id = r.reported_by where r.status = 'pending' order by r.reported_at`);
  const mine = [];
  for (const r of rows) if ((await stageRecipients(q, "installation_manager", r.project_id)).includes(actor.id)) mine.push(r);
  return mine;
}
