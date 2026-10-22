/**
 * Package tracking (phase 11). A package expected and dispatched but not receipt-scanned is "receipt unverified",
 * never proven lost. Repeated scans are ignored by client event id. Receiving a box does not verify its contents,
 * and weight is only a supporting signal.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { requireProjectScope, requireRole, type Actor } from "../auth/permissions";
import { conflict, validation } from "../errors";
import { iso, one, parse, zId, type Ctx } from "./context";

export async function addPackage(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, orderId: zId, code: z.string().regex(/^[A-Za-z0-9\-_.]{3,40}$/), loadRef: z.string().max(40).optional(), description: z.string().min(2).max(200),
    expectedContents: z.string().max(1000).optional(), weightKg: z.number().positive().max(10000).optional(), highValue: z.boolean().default(false) }), input);
  requireRole(ctx.actor, "supervisor", "package manifest");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    await one(q, "select 1 from sales_order where id = $1 and project_id = $2", [d.orderId, d.projectId], "Order on this project");
    const [dup] = await q.query("select 1 from package where code = $1", [d.code]);
    if (dup) throw conflict(`Package code ${d.code} already exists.`);
    const [p] = await q.query<{ id: string }>(`insert into package(code, project_id, order_id, load_ref, description, expected_contents, weight_kg, high_value, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [d.code, d.projectId, d.orderId, d.loadRef ?? null, d.description, d.expectedContents ?? null, d.weightKg ?? null, d.highValue, ctx.actor.id]);
    return { id: p!.id };
  });
}

async function nextExceptionId(q: Queryable) {
  const [r] = await q.query<{ n: number }>("select coalesce(max(substring(business_id from '\\d+$')::int), 0) + 1 n from package_exception");
  return `PX-${String(r?.n ?? 1).padStart(3, "0")}`;
}

/**
 * Record a scan (camera or typed code). Duplicate client event ids return the first result. An unknown code on a
 * receipt is kept as an "unknown scan" exception for the project rather than discarded.
 */
export async function recordScan(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, code: z.string().min(2).max(60), kind: z.enum(["dispatch", "receipt", "damage"]), clientEventId: z.string().min(8).max(80),
    method: z.enum(["camera", "manual"]), note: z.string().max(300).optional() }), input);
  if (d.kind === "dispatch") requireRole(ctx.actor, "supervisor", "dispatch scans");
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    const [dup] = await q.query<{ id: string; package_id: string | null }>("select id, package_id from scan_event where client_event_id = $1", [d.clientEventId]);
    if (dup) return { id: dup.id, duplicate: true, known: !!dup.package_id, exceptionId: null as string | null };
    const [pkg] = await q.query<{ id: string; project_id: string }>("select id, project_id from package where code = $1", [d.code.trim()]);
    if (pkg && pkg.project_id !== d.projectId) throw validation("That package belongs to another project.");
    const [s] = await q.query<{ id: string }>("insert into scan_event(package_id, scanned_code, kind, client_event_id, method, note, actor_id, scanned_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [pkg?.id ?? null, d.code.trim(), d.kind, d.clientEventId, d.method, d.note ?? null, ctx.actor.id, iso(ctx.now)]);
    let exceptionId: string | null = null;
    if (!pkg || d.kind === "damage") {
      const bid = await nextExceptionId(q);
      const [x] = await q.query<{ id: string }>(`insert into package_exception(business_id, project_id, package_id, scanned_code, kind, description, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [bid, d.projectId, pkg?.id ?? null, d.code.trim(), pkg ? "damage" : "unknown_scan", d.note ?? (pkg ? "Damage reported at scan" : "Code not in the manifest"), ctx.actor.id]);
      exceptionId = x!.id;
    }
    await audit(q, { actorId: ctx.actor.id, action: `scan_${d.kind}`, objectType: "package", objectId: pkg?.id ?? s!.id, after: { code: d.code, method: d.method }, correlationId: ctx.correlationId });
    return { id: s!.id, duplicate: false, known: !!pkg, exceptionId };
  });
}

export async function raisePackageException(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ projectId: zId, packageId: zId.optional(), kind: z.enum(["receipt_unverified", "shortage", "damage", "contents_mismatch"]), description: z.string().min(3).max(500),
    replacementRequested: z.boolean().default(false) }), input);
  return ctx.db.tx(async (q) => {
    await requireProjectScope(q, ctx.actor, d.projectId);
    if (d.packageId) await one(q, "select 1 from package where id = $1 and project_id = $2", [d.packageId, d.projectId], "Package on this project");
    const bid = await nextExceptionId(q);
    const [x] = await q.query<{ id: string }>(`insert into package_exception(business_id, project_id, package_id, kind, description, replacement_requested, replacement_status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [bid, d.projectId, d.packageId ?? null, d.kind, d.description, d.replacementRequested, d.replacementRequested ? "requested" : "none", ctx.actor.id]);
    await audit(q, { actorId: ctx.actor.id, action: "package_exception", objectType: "package_exception", objectId: x!.id, after: d, correlationId: ctx.correlationId });
    return { id: x!.id, businessId: bid };
  });
}

/** Responsibility, replacement and charge are separate decisions; none is inferred from the scan alone. */
export async function decidePackageException(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ id: zId, responsibleFunction: z.string().max(40).optional(), rootCause: z.string().max(300).optional(),
    replacementStatus: z.enum(["none", "requested", "approved", "rejected", "delivered"]).optional(), chargeType: z.enum(["chargeable", "free_of_charge", "not_applicable"]).optional(), resolve: z.boolean().default(false) }), input);
  requireRole(ctx.actor, "manager", "package exception decisions");
  return ctx.db.tx(async (q) => {
    const x = await one<{ project_id: string }>(q, "select project_id from package_exception where id = $1 for update", [d.id], "Package exception");
    await requireProjectScope(q, ctx.actor, x.project_id);
    await q.query(`update package_exception set responsible_function = coalesce($2, responsible_function), root_cause = coalesce($3, root_cause), replacement_status = coalesce($4, replacement_status),
      charge_type = coalesce($5, charge_type), status = case when $6 then 'resolved' else status end, decided_by = $7, decided_at = $8 where id = $1`,
      [d.id, d.responsibleFunction ?? null, d.rootCause ?? null, d.replacementStatus ?? null, d.chargeType ?? null, d.resolve, ctx.actor.id, iso(ctx.now)]);
    await audit(q, { actorId: ctx.actor.id, action: "package_exception_decision", objectType: "package_exception", objectId: d.id, after: d, correlationId: ctx.correlationId });
    return { id: d.id };
  });
}

export type PackageStatus = "expected" | "dispatched" | "received" | "receipt_unverified";

/** Derived status per package; counts use distinct packages, so repeated scans never inflate them. */
export async function packageBoard(q: Queryable, actor: Actor, projectId: string, now: number) {
  await requireProjectScope(q, actor, projectId);
  const rows = await q.query<{ id: string; code: string; order: string; load_ref: string | null; description: string; expected_contents: string | null; weight_kg: string | null; high_value: boolean;
    dispatched_at: number | null; received_at: number | null; damaged: boolean }>(
    `select p.id, p.code, o.business_id "order", p.load_ref, p.description, p.expected_contents, p.weight_kg::text, p.high_value,
       (select min(scanned_at) from scan_event s where s.package_id = p.id and s.kind = 'dispatch') dispatched_at,
       (select min(scanned_at) from scan_event s where s.package_id = p.id and s.kind = 'receipt') received_at,
       exists (select 1 from scan_event s where s.package_id = p.id and s.kind = 'damage') damaged
     from package p join sales_order o on o.id = p.order_id where p.project_id = $1 order by p.code`, [projectId]);
  // A visit on site that has started means dispatched packages should have arrived; until scanned they are unverified.
  const [onSite] = await q.query<{ started: boolean }>("select exists (select 1 from visit where project_id = $1 and exec_status in ('in_progress','completed')) started", [projectId]);
  const packages = rows.map((r) => {
    const status: PackageStatus = r.received_at ? "received" : r.dispatched_at ? (onSite?.started ? "receipt_unverified" : "dispatched") : "expected";
    return { ...r, status };
  });
  const exceptions = await q.query<{ id: string; business_id: string; code: string | null; kind: string; description: string; responsible_function: string | null; replacement_status: string; charge_type: string | null; status: string; created_at: number; by: string | null }>(
    `select x.id, x.business_id, coalesce(p.code, x.scanned_code) code, x.kind, x.description, x.responsible_function, x.replacement_status, x.charge_type, x.status, x.created_at, e.name by
     from package_exception x left join package p on p.id = x.package_id left join employee e on e.id = x.created_by where x.project_id = $1 order by x.created_at desc`, [projectId]);
  const scans = await q.query<{ n: number }>("select count(*)::int n from scan_event s join package p on p.id = s.package_id where p.project_id = $1", [projectId]);
  void now;
  return { packages, exceptions, counts: { total: packages.length, received: packages.filter((p) => p.status === "received").length, unverified: packages.filter((p) => p.status === "receipt_unverified").length, scanEvents: scans[0]?.n ?? 0 } };
}
