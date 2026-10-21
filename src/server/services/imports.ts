/**
 * Source import: preview, typed validation and idempotent apply (phase 3 / phase 11).
 * Imports never rewrite approved plan revisions; a source change to planned scope raises a review issue.
 */
import { z } from "zod";
import type { Queryable } from "../db/client";
import { audit } from "../audit";
import { requireProjectScope, requireRole } from "../auth/permissions";
import { AppError, validation } from "../errors";
import { Dec } from "@/domain/decimal";
import { ADAPTERS, STEPS_BY_KIND, UNIT_BY_KIND, type SourceOrderRecord } from "@/integrations/source-adapter";
import { parse, type Ctx } from "./context";

export interface ImportPreview {
  externalId: string; revision: string; projectBusinessId: string; orderRef: string;
  status: "new" | "update" | "unchanged" | "rejected"; changes: string[]; reasons: string[]; plansToReview: string[];
}

function adapter(system: string) {
  const a = ADAPTERS[system];
  if (!a) throw new AppError("unavailable", `No source adapter "${system}" is configured.`);
  return a;
}

async function previewOne(q: Queryable, ctx: Ctx, r: SourceOrderRecord, system: string): Promise<ImportPreview & { projectId?: string; orderId?: string }> {
  const base = { externalId: r.externalId, revision: r.revision, projectBusinessId: r.projectBusinessId, orderRef: r.order.externalRef, changes: [] as string[], reasons: [] as string[], plansToReview: [] as string[] };
  const [p] = await q.query<{ id: string; customer_ref: string | null; customer_system: string | null }>(
    "select p.id, c.source_ref customer_ref, c.source_system customer_system from project p join customer c on c.id = p.customer_id where p.business_id = $1", [r.projectBusinessId]);
  if (!p) return { ...base, status: "rejected", reasons: [`Project ${r.projectBusinessId} does not exist; map the location-based project first.`] };
  try { await requireProjectScope(q, ctx.actor, p.id); } catch { return { ...base, status: "rejected", reasons: [`Project ${r.projectBusinessId} is outside your scope.`] }; }
  // Scope is checked first so nothing about other managers' projects is revealed.
  const [done] = await q.query("select 1 from source_import where source_system = $1 and external_id = $2 and revision = $3", [system, r.externalId, r.revision]);
  if (done) return { ...base, status: "unchanged", changes: ["This source revision was already applied."] };
  if (p.customer_system !== system || p.customer_ref !== r.customer.externalId) base.reasons.push(`Customer ${r.customer.externalId} does not match the project's customer source reference.`);
  for (const it of r.items) for (const c of it.components) {
    const unit = UNIT_BY_KIND[c.quantityKind];
    if (!unit) base.reasons.push(`${c.name}: unknown quantity kind "${c.quantityKind}".`);
    else if (unit !== c.unit) base.reasons.push(`${c.name}: ${c.quantityKind.replace(/_/g, " ")} must be measured in ${unit}, not ${c.unit}.`);
    try { if (Dec.of(c.quantity).isNegative()) base.reasons.push(`${c.name}: negative quantity.`); } catch { base.reasons.push(`${c.name}: quantity "${c.quantity}" is not a number.`); }
  }
  if (base.reasons.length) return { ...base, status: "rejected" };

  const [order] = await q.query<{ id: string; business_id: string; project_id: string }>("select id, business_id, project_id from sales_order where source_system = $1 and external_ref = $2", [system, r.order.externalRef]);
  if (!order) {
    const comps = r.items.flatMap((i) => i.components.map((c) => `${i.name} / ${c.name}: ${c.quantity} ${c.unit}`));
    return { ...base, status: "new", projectId: p.id, changes: [`New order ${r.order.externalRef}`, ...comps] };
  }
  if (order.project_id !== p.id) return { ...base, status: "rejected", reasons: [`Order ${r.order.externalRef} already belongs to another project.`] };
  for (const it of r.items) {
    const [item] = await q.query<{ id: string }>("select id from order_item where order_id = $1 and (source_ref = $2 or (source_ref is null and name = $3 and product_type = $4)) limit 1", [order.id, it.externalId, it.name, it.productType]);
    for (const c of it.components) {
      const [cur] = item ? await q.query<{ id: string; quantity: string; drawing_version: string | null; accepted: string }>(
        `select c.id, c.quantity::text, c.drawing_version,
           coalesce((select max(acc) from (select sum(pe.quantity_delta) acc from installation_task t join visit_task vt on vt.task_id = t.id join progress_event pe on pe.visit_task_id = vt.id
             where t.component_id = c.id and pe.accepted and vt.kind = 'original' group by t.id) x), 0)::text accepted
         from component c where c.order_item_id = $1 and (c.source_ref = $2 or (c.source_ref is null and c.name = $3)) limit 1`, [item.id, c.externalId, c.name]) : [];
      if (!cur) { base.changes.push(`Add component ${it.name} / ${c.name}: ${c.quantity} ${c.unit}`); continue; }
      if (Dec.of(c.quantity).cmp(cur.quantity) !== 0) {
        if (Dec.of(c.quantity).cmp(cur.accepted) < 0) base.reasons.push(`${c.name}: new quantity ${c.quantity} is below accepted progress ${Number(cur.accepted)}.`);
        base.changes.push(`${c.name}: quantity ${Number(cur.quantity)} → ${c.quantity} ${c.unit}`);
      }
      if (c.drawingVersion && c.drawingVersion !== cur.drawing_version) base.changes.push(`${c.name}: drawing ${cur.drawing_version ?? "none"} → ${c.drawingVersion}`);
    }
  }
  if (base.reasons.length) return { ...base, status: "rejected" };
  const plans = await q.query<{ business_id: string }>(
    `select distinct pl.business_id from plan pl join visit v on v.plan_id = pl.id join visit_order vo on vo.visit_id = v.id
     where vo.order_id = $1 and pl.status = 'active' and pl.current_revision_id is not null`, [order.id]);
  return { ...base, status: base.changes.length ? "update" : "unchanged", projectId: p.id, orderId: order.id, plansToReview: plans.map((x) => x.business_id), changes: base.changes.length ? base.changes : ["No differences from current records."] };
}

export async function previewImport(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ system: z.string().min(1) }), input);
  requireRole(ctx.actor, "manager", "source imports");
  const a = adapter(d.system);
  const records = await a.fetchOrders();
  const rows: ImportPreview[] = [];
  for (const r of records) { const { projectId: _p, orderId: _o, ...row } = await previewOne(ctx.db, ctx, r, a.system); rows.push(row); }
  return { system: a.system, label: a.label, live: a.live, rows };
}

async function nextId(q: Queryable, table: string, prefix: string, pad = 3) {
  const [n] = await q.query<{ n: number }>(`select coalesce(max(substring(business_id from '\\d+$')::int),0)+1 n from ${table}`);
  return `${prefix}-${String(n!.n).padStart(pad, "0")}`;
}

async function insertComponent(q: Queryable, itemId: string, c: { externalId: string; name: string; quantity: string; unit: string; quantityKind: string; drawingVersion?: string; availableQuantity?: string }) {
  const bid = await nextId(q, "component", "CMP");
  const [row] = await q.query<{ id: string }>(
    `insert into component(business_id, order_item_id, name, quantity, unit, quantity_kind, drawing_version, available_quantity, dispatched_quantity, source_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) returning id`,
    [bid, itemId, c.name, c.quantity, c.unit, c.quantityKind, c.drawingVersion ?? null, c.availableQuantity ?? "0", c.externalId]);
  let prev: string | null = null;
  for (const [i, step] of (STEPS_BY_KIND[c.quantityKind] ?? ["install"]).entries()) {
    const tbid = await nextId(q, "installation_task", "TSK");
    const [t]: Array<{ id: string }> = await q.query<{ id: string }>(
      "insert into installation_task(business_id, component_id, activity, step_order, required_quantity, unit, quantity_kind) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [tbid, row!.id, step, i + 1, c.quantity, c.unit, c.quantityKind]);
    if (prev) await q.query("insert into task_dependency(task_id, predecessor_id) values ($1,$2)", [t!.id, prev]);
    prev = t!.id;
  }
}

/** Applies selected records. Idempotent per source system + external ID + revision. */
export async function applyImport(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ system: z.string().min(1), externalIds: z.array(z.string().min(1)).min(1).max(50) }), input);
  requireRole(ctx.actor, "manager", "source imports");
  const a = adapter(d.system);
  const records = (await a.fetchOrders()).filter((r) => d.externalIds.includes(r.externalId));
  if (!records.length) throw validation("None of the selected records were returned by the source.");
  return ctx.db.tx(async (q) => {
    const applied: string[] = [], skipped: string[] = [];
    for (const r of records) {
      const pv = await previewOne(q, ctx, r, a.system);
      if (pv.status === "rejected" || pv.status === "unchanged") { skipped.push(`${r.externalId}: ${pv.status}${pv.reasons.length ? ` (${pv.reasons.join("; ")})` : ""}`); continue; }
      let orderId = pv.orderId;
      if (pv.status === "new") {
        const obid = await nextId(q, "sales_order", "ORD");
        orderId = (await q.query<{ id: string }>(`insert into sales_order(business_id, project_id, external_ref, source_system, status, promised_completion) values ($1,$2,$3,$4,$5,$6) returning id`,
          [obid, pv.projectId, r.order.externalRef, a.system, r.order.status ?? "open", r.order.promisedCompletion ?? null]))[0]!.id;
      }
      for (const it of r.items) {
        let [item] = await q.query<{ id: string }>("select id from order_item where order_id = $1 and (source_ref = $2 or (source_ref is null and name = $3 and product_type = $4)) limit 1", [orderId, it.externalId, it.name, it.productType]);
        if (!item) {
          const ibid = await nextId(q, "order_item", "OI");
          item = (await q.query<{ id: string }>("insert into order_item(business_id, order_id, product_type, name, source_version, source_ref) values ($1,$2,$3,$4,$5,$6) returning id", [ibid, orderId, it.productType, it.name, r.revision, it.externalId]))[0]!;
        } else await q.query("update order_item set source_ref = coalesce(source_ref, $2), source_version = $3 where id = $1", [item.id, it.externalId, r.revision]);
        for (const c of it.components) {
          const [cur] = await q.query<{ id: string }>("select id from component where order_item_id = $1 and (source_ref = $2 or (source_ref is null and name = $3)) limit 1", [item.id, c.externalId, c.name]);
          if (!cur) { await insertComponent(q, item.id, c); continue; }
          // Current master data follows the source; approved plan revisions keep their own snapshot.
          await q.query("update component set quantity = $2, drawing_version = coalesce($3, drawing_version), available_quantity = coalesce($4, available_quantity), source_ref = coalesce(source_ref, $5) where id = $1",
            [cur.id, c.quantity, c.drawingVersion ?? null, c.availableQuantity ?? null, c.externalId]);
          await q.query("update installation_task set required_quantity = $2 where component_id = $1", [cur.id, c.quantity]);
        }
      }
      const [imp] = await q.query<{ id: string }>("insert into source_import(source_system, external_id, revision, object_type, object_id, applied_by) values ($1,$2,$3,'sales_order',$4,$5) returning id", [a.system, r.externalId, r.revision, orderId, ctx.actor.id]);
      if (pv.status === "update" && pv.plansToReview.length) {
        const [mgr] = await q.query<{ manager_id: string | null }>("select manager_id from project where id = $1", [pv.projectId]);
        const ibid = await nextId(q, "issue", "ISS");
        await q.query(
          `insert into issue(business_id, raised_on, project_id, order_id, function, category, impact, description, owner_id, next_action, due_date)
           values ($1, current_date, $2, $3, 'Services', 'Source change', 'Approved plan may no longer match scope', $4, $5, 'Review the approved plan and start a revision if needed', current_date + 3)`,
          [ibid, pv.projectId, orderId, `Source ${a.system} ${r.externalId} ${r.revision}: ${pv.changes.join("; ")}. Plans to review: ${pv.plansToReview.join(", ")}.`, mgr?.manager_id ?? ctx.actor.id]);
      }
      await audit(q, { actorId: ctx.actor.id, action: `import_${pv.status}`, objectType: "source_import", objectId: imp!.id, after: { externalId: r.externalId, revision: r.revision, changes: pv.changes }, correlationId: ctx.correlationId });
      applied.push(`${r.externalId} ${r.revision}: ${pv.status}`);
    }
    return { applied, skipped };
  });
}
