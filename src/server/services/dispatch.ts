/**
 * Dispatch to installation (one cycle per dispatch). The factory picks the dispatch types and the BOM lines it
 * carries; each later stage is completed by its owner role from the flow definition. "Not ready" holds the site
 * readiness stage with a reason and an expected date. Receipt checks every line; each missing or damaged line
 * opens one complaint, and installation may start while complaints are open (the dispatch is flagged partial).
 */
import { z } from "zod";
import { audit } from "../audit";
import { conflict, validation } from "../errors";
import { Dec } from "@/domain/decimal";
import { groupsFor, stageOf, type FlowDefinition, type StageSpec } from "@/domain/flow";
import { localDateOf } from "@/lib/dates";
import { PRIORITY_CODES, PRODUCT_TYPES, PRODUCT_TYPE_CODES, UNIT_CODES, UNLISTED_LIMITS, UNLISTED_ORDER_ITEM, priorityLabel, type Priority } from "@/domain/unlisted-items";
import { one, parse, zId, zQty, zVersion, type Ctx } from "./context";
import type { Queryable } from "../db/client";
import {
  actorRoles, cancelReminders, checkBack, expectState, linkFiles, loadDefinition, lockSubject, notifyStage, prepareStage, readyFiles,
  recordStage, requireStageOwner, scheduleReminder, setStage, writeHistory, type SubjectRow,
} from "./flow-core";

export interface DispatchRow extends SubjectRow { order_id: string; types: string[]; factory: string; replacement_for: string | null; hold_until: string | null; partial: boolean }

const zStageInput = z.object({
  dispatchId: zId, version: zVersion, stage: z.string().min(2).max(40),
  values: z.record(z.string(), z.string().max(2000)).default({}), files: z.record(z.string(), z.string().uuid()).default({}), reason: z.string().max(500).optional(),
});

async function projectTz(q: Queryable, projectId: string) {
  return (await one<{ timezone: string }>(q, "select timezone from project where id = $1", [projectId], "Project")).timezone;
}

/** Inserts a dispatch at the stage after the creation step, writes its history and tells the next owner. */
export async function insertDispatch(q: Queryable, ctx: Ctx, def: FlowDefinition, version: number, d: {
  orderId: string; projectId: string; types: string[]; factory: string; replacementFor: string | null; items: Array<{ componentId: string; quantity: string }>; note?: string; withoutList?: boolean;
}) {
  const first = def.stages[0]!;
  const next = stageOf(def, first.next!)!;
  const [r] = await q.query<{ id: string; business_id: string }>(
    `insert into dispatch(business_id, order_id, project_id, types, factory, replacement_for, stage, stage_entered_at, config_version, created_by)
     values ('DSP-' || lpad(nextval('dispatch_number')::text, 4, '0'), $1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, business_id`,
    [d.orderId, d.projectId, d.types, d.factory, d.replacementFor, next.code, new Date(ctx.now).toISOString(), version, ctx.actor.id]);
  for (const it of d.items) await q.query("insert into dispatch_item(dispatch_id, component_id, quantity) values ($1,$2,$3)", [r!.id, it.componentId, it.quantity]);
  const hid = await writeHistory(q, { type: "dispatch", id: r!.id, from: first.code, to: next.code, kind: "create", data: { types: d.types, factory: d.factory, lines: d.items.length, note: d.note ?? null, replacement_for: d.replacementFor, ...(d.withoutList ? { without_list: true } : {}) }, actorId: ctx.actor.id, at: ctx.now });
  await audit(q, { actorId: ctx.actor.id, action: "create_dispatch", objectType: "dispatch", objectId: r!.id, after: d, correlationId: ctx.correlationId });
  await notifyStage(q, { type: "dispatch", id: r!.id, businessId: r!.business_id, projectId: d.projectId, stage: next, historyId: hid, at: ctx.now,
    detail: `${d.replacementFor ? "Replacement dispatch" : "Ready for dispatch"} (${d.types.join(" + ")})${d.withoutList ? ", item list not added yet" : ""}. Your step: ${next.label}.` });
  return { dispatchId: r!.id, businessId: r!.business_id };
}

export async function createDispatch(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    orderId: zId, types: z.array(z.string().max(8)).min(1).max(6), factory: z.string().trim().min(2).max(60),
    items: z.array(z.object({ componentId: zId, quantity: zQty })).max(200).default([]), note: z.string().trim().max(500).optional(),
    // The factory may send before adding the item list (owner decision, 28 Oct 2026), but only by saying so.
    withoutList: z.boolean().optional(),
  }), input);
  return ctx.db.tx(async (q) => {
    const { def, version } = await loadDefinition(q, "dispatch");
    const first = def.stages[0]!;
    if (first.handler !== "create") throw conflict("The dispatch flow must start with the creation step. Ask an administrator to check Dispatch setup.");
    const o = await one<{ project_id: string; status: string; business_id: string }>(q, "select project_id, status, business_id from sales_order where id = $1", [d.orderId], "Order");
    if (o.status === "cancelled" || o.status === "closed") throw conflict(`Order ${o.business_id} is ${o.status}.`);
    await requireStageOwner(q, ctx.actor, first, o.project_id);
    const types = [...new Set(d.types)];
    const { groups, problems } = groupsFor(def, types);
    if (def.factories?.length && !def.factories.includes(d.factory)) problems.push(`Factory must be one of: ${def.factories.join(", ")}.`);
    const ids = d.items.map((i) => i.componentId);
    if (new Set(ids).size !== ids.length) problems.push("A BOM line is listed twice.");
    if (d.withoutList && ids.length) problems.push("You said the item list is not ready, so leave the lines out.");
    if (!d.withoutList && !ids.length) problems.push("Choose at least one line, or tick that the item list is not ready yet.");
    // Lock the order's lines so two dispatches cannot both take the last quantity.
    const lines = await q.query<{ id: string; name: string; quantity: string; dispatch_group: string | null }>(
      `select c.id, c.name, c.quantity::text, c.dispatch_group from component c join order_item oi on oi.id = c.order_item_id where oi.order_id = $1 and c.id = any($2::uuid[]) and not c.unlisted for update of c`, [d.orderId, ids]);
    const sent = await q.query<{ component_id: string; sent: string }>(
      `select di.component_id, sum(di.quantity)::text sent from dispatch_item di join dispatch x on x.id = di.dispatch_id
       where di.component_id = any($1::uuid[]) and x.status <> 'cancelled' and x.replacement_for is null group by di.component_id`, [ids]);
    for (const it of d.items) {
      const c = lines.find((l) => l.id === it.componentId);
      if (!c) { problems.push("A selected line is not on this order's BOM."); continue; }
      if (c.dispatch_group && c.dispatch_group !== "other" && !groups.has(c.dispatch_group)) problems.push(`${c.name} is a ${c.dispatch_group} line; add a dispatch type that covers it or leave it out.`);
      const left = Dec.of(c.quantity).sub(sent.find((s) => s.component_id === c.id)?.sent ?? "0");
      if (Dec.of(it.quantity).cmp(0) <= 0) problems.push(`${c.name}: quantity must be above zero.`);
      else if (Dec.of(it.quantity).cmp(left) > 0) problems.push(`${c.name}: only ${left.toString()} left to dispatch on this order.`);
    }
    if (problems.length) throw validation("This dispatch cannot be created yet.", problems);
    return insertDispatch(q, ctx, def, version, { orderId: d.orderId, projectId: o.project_id, types, factory: d.factory, replacementFor: null, items: d.items, note: d.note, withoutList: !!d.withoutList });
  });
}

async function openComplaints(q: Queryable, dispatchId: string) {
  const [r] = await q.query<{ n: number }>("select count(*)::int n from complaint where dispatch_id = $1 and status = 'open'", [dispatchId]);
  return r?.n ?? 0;
}

/** Completes the current stage (any stage without its own screen). */
export async function advanceDispatch(ctx: Ctx, input: unknown) {
  const d = parse(zStageInput, input);
  return ctx.db.tx(async (q) => {
    const row = await lockSubject<DispatchRow>(q, "dispatch", d.dispatchId);
    expectState(row, d.stage, d.version);
    const { def } = await loadDefinition(q, "dispatch", row.config_version);
    const s = stageOf(def, row.stage);
    if (!s) throw conflict("This dispatch is on a stage the flow no longer has. Ask an administrator.");
    if (s.handler === "receive_mnd") throw conflict("Use the receipt check to complete this step.");
    await requireStageOwner(q, ctx.actor, s, row.project_id);
    const p = await prepareStage(q, ctx.actor, s, d.values, d.files, d.reason);
    const tz = await projectTz(q, row.project_id);
    if (p.move.kind === "hold") {
      const until = p.data.expected_date;
      if (!until) throw validation(`${s.label}: an expected date is required.`);
      if (until <= localDateOf(ctx.now, tz)) throw validation("The expected ready date must be after today.");
      await q.query("update dispatch set hold_reason = $2, hold_until = $3, version = version + 1, updated_at = now() where id = $1", [row.id, p.data.reason ?? "Not ready", until]);
      await recordStage(q, ctx, "dispatch", row, p, "hold", row.stage);
      await scheduleReminder(q, "dispatch", row.id, "site_ready_check", until, s.remindDaysBefore ?? 1, tz, ctx.now);
      return { held: true, until };
    }
    const to = stageOf(def, p.move.to)!;
    const extra: Record<string, unknown> = {};
    let partial = row.partial;
    if (s.handler === "install_start" || s.handler === "install_done") {
      const open = await openComplaints(q, row.id);
      partial = open > 0;
      extra.open_complaints = open;
    }
    await setStage(q, "dispatch", row.id, to.code, ctx.now, `, hold_reason = null, hold_until = null, partial = $4${to.terminal ? ", status = 'completed'" : ""}`, [partial]);
    await cancelReminders(q, "dispatch", row.id);
    const hid = await recordStage(q, ctx, "dispatch", row, p, p.move.kind, to.code, extra);
    await notifyStage(q, { type: "dispatch", id: row.id, businessId: row.business_id, projectId: row.project_id, stage: to, historyId: hid, at: ctx.now,
      detail: p.move.kind === "back" ? `Sent back from ${s.label}: ${p.reason}` : `${s.label} done. Your step: ${to.label}.` });
    return { stage: to.code, partial };
  });
}

/** Sends the dispatch back to an earlier stage the current stage allows, with a reason. */
export async function moveDispatchBack(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ dispatchId: zId, version: zVersion, stage: z.string().max(40), to: z.string().max(40), reason: z.string().trim().min(3).max(500) }), input);
  return ctx.db.tx(async (q) => {
    const row = await lockSubject<DispatchRow>(q, "dispatch", d.dispatchId);
    expectState(row, d.stage, d.version);
    const { def } = await loadDefinition(q, "dispatch", row.config_version);
    const s = checkBack(def, row.stage, d.to, d.reason);
    await requireBackRight(q, ctx, s, row.project_id, "dispatch");
    const to = stageOf(def, d.to)!;
    await setStage(q, "dispatch", row.id, to.code, ctx.now, ", hold_reason = null, hold_until = null");
    await cancelReminders(q, "dispatch", row.id);
    const hid = await recordStage(q, ctx, "dispatch", row, { data: {}, found: {}, reason: d.reason }, "back", to.code);
    await notifyStage(q, { type: "dispatch", id: row.id, businessId: row.business_id, projectId: row.project_id, stage: to, historyId: hid, at: ctx.now, detail: `Sent back from ${s.label}: ${d.reason}` });
    return { stage: to.code };
  });
}

/**
 * The current stage's owner may send work back. Management may also do so in the complaint flow, where it owns
 * the cost gate; dispatch stages stay with their owners (break-it finding F2).
 */
export async function requireBackRight(q: Queryable, ctx: Ctx, s: StageSpec, projectId: string, flow: "dispatch" | "complaint") {
  if (flow === "complaint" && (await actorRoles(q, ctx.actor.id)).includes("management")) return;
  await requireStageOwner(q, ctx.actor, s, projectId);
}

const zLine = z.object({
  itemId: zId, ok: z.boolean(), kind: z.enum(["missing", "damaged"]).optional(), quantity: zQty.optional(),
  reason: z.string().trim().max(500).optional(), photoDraftKey: z.string().uuid().optional(),
  priority: z.enum(PRIORITY_CODES, { message: "Priority must be Normal, High or Urgent" }).default("normal"),
});

const L = UNLISTED_LIMITS;
/** An item reported at receipt that is not on the factory's list. */
const zUnlisted = z.object({
  name: z.string().trim().min(L.nameMin, `Product name: at least ${L.nameMin} characters`).max(L.nameMax, `Product name: at most ${L.nameMax} characters`),
  quantity: zQty, unit: z.enum(UNIT_CODES, { message: "Choose a unit from the list" }).default("pcs"),
  kind: z.enum(["missing", "damaged"], { message: "Choose missing or damaged" }),
  priority: z.enum(PRIORITY_CODES, { message: "Priority must be Normal, High or Urgent" }).default("normal"),
  productType: z.enum(PRODUCT_TYPE_CODES, { message: "Choose a product type from the list" }),
  reason: z.string().trim().min(L.reasonMin, "Reason: add a few words").max(L.reasonMax), photoDraftKey: z.string().uuid().optional(),
});
type Unlisted = z.infer<typeof zUnlisted>;

/**
 * Receipt with Missing & Damaged. Every factory-list line of the dispatch is answered; each unchecked line needs a
 * type, quantity, reason and at least one photo, and opens one complaint under this dispatch. Items not on the list
 * (or sent before the factory added one) are reported by name and product type: each becomes an unlisted BOM line
 * of the order on this dispatch and runs the same complaint flow. With no list, at least one reported item or an
 * explicit `nothingMissing` is required, so an empty receipt is never saved by accident.
 */
export async function receiveDispatch(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    dispatchId: zId, version: zVersion, stage: z.string().max(40), lines: z.array(zLine).max(200).default([]),
    unlisted: z.array(zUnlisted).max(L.maxItems).default([]), nothingMissing: z.boolean().default(false),
  }), input);
  return ctx.db.tx(async (q) => {
    const row = await lockSubject<DispatchRow>(q, "dispatch", d.dispatchId);
    expectState(row, d.stage, d.version);
    const { def } = await loadDefinition(q, "dispatch", row.config_version);
    const s = stageOf(def, row.stage);
    if (s?.handler !== "receive_mnd") throw conflict("This dispatch is not waiting for receipt.");
    await requireStageOwner(q, ctx.actor, s, row.project_id);
    const items = await q.query<{ id: string; component_id: string; quantity: string; name: string }>(
      "select di.id, di.component_id, di.quantity::text, c.name from dispatch_item di join component c on c.id = di.component_id where di.dispatch_id = $1", [row.id]);
    const problems: string[] = [];
    const given = new Map(d.lines.map((l) => [l.itemId, l]));
    if (given.size !== d.lines.length) problems.push("A line is answered twice.");
    for (const l of d.lines) if (!items.some((i) => i.id === l.itemId)) problems.push("A line does not belong to this dispatch.");
    const photos = new Map<string, string[]>();
    for (const it of items) {
      const l = given.get(it.id);
      if (!l) { problems.push(`${it.name}: not answered.`); continue; }
      if (l.ok) continue;
      if (!l.kind) problems.push(`${it.name}: choose missing or damaged.`);
      if (!l.quantity || Dec.of(l.quantity).cmp(0) <= 0) problems.push(`${it.name}: enter the quantity affected.`);
      else if (Dec.of(l.quantity).cmp(it.quantity) > 0) problems.push(`${it.name}: at most ${it.quantity} was on this dispatch.`);
      if (!l.reason || l.reason.length < 3) problems.push(`${it.name}: add a reason.`);
      const ph = await readyFiles(q, ctx.actor.id, l.photoDraftKey, "photo");
      if (!ph.length) problems.push(`${it.name}: add at least one photo that has finished uploading.`);
      photos.set(it.id, ph);
    }
    const unlistedPhotos = await checkUnlisted(q, ctx, d.unlisted, problems);
    if (!items.length && !d.unlisted.length && !d.nothingMissing) {
      problems.push("The factory has not added the item list: report what is missing or damaged, or confirm that nothing is.");
    }
    if (problems.length) throw validation("The receipt check is not complete.", problems);

    const created: Array<{ id: string; business_id: string; itemId: string }> = [];
    for (const it of items) {
      const l = given.get(it.id)!;
      await q.query("update dispatch_item set received_ok = $2 where id = $1", [it.id, l.ok]);
      if (l.ok) continue;
      const c = await openComplaint(q, ctx, row, it, { kind: l.kind!, quantity: l.quantity!, reason: l.reason!, priority: l.priority }, photos.get(it.id)!);
      created.push({ ...c, itemId: it.id });
    }
    // Only the replacement's own line settles its complaint; an unlisted item on the same truck is a new problem.
    if (row.replacement_for) await settleReplacement(q, ctx, row, created);
    const unlisted = await addUnlisted(q, ctx, row, d.unlisted, unlistedPhotos);
    const all = [...created, ...unlisted];
    const to = stageOf(def, s.next!)!;
    await setStage(q, "dispatch", row.id, to.code, ctx.now, ", partial = $4", [all.length > 0 || (await openComplaints(q, row.id)) > 0]);
    const hid = await recordStage(q, ctx, "dispatch", row, { data: {}, found: {}, reason: null }, "forward", to.code,
      { lines: items.length, received_ok: items.length - created.length, unlisted: unlisted.length, no_list: items.length === 0, complaints: all.map((c) => c.business_id) });
    await notifyStage(q, { type: "dispatch", id: row.id, businessId: row.business_id, projectId: row.project_id, stage: to, historyId: hid, at: ctx.now,
      detail: all.length ? `Received with ${all.length} complaint${all.length === 1 ? "" : "s"} open; installation may start.` : "Received in full." });
    return { complaints: all.map(({ id, business_id }) => ({ id, business_id })) };
  });
}

/** Checks reported unlisted items beyond their shape: quantity, duplicates and finished photos. */
async function checkUnlisted(q: Queryable, ctx: Ctx, list: Unlisted[], problems: string[]) {
  const photos: string[][] = [];
  const seen = new Set<string>();
  for (const [i, u] of list.entries()) {
    const label = `Item ${i + 1} (${u.name})`;
    const key = `${u.name.toLowerCase()}|${u.kind}`;
    if (seen.has(key)) problems.push(`${label}: reported twice. Change its quantity instead.`);
    seen.add(key);
    if (Dec.of(u.quantity).cmp(0) <= 0) problems.push(`${label}: the quantity must be above zero.`);
    else if (Dec.of(u.quantity).cmp(L.maxQuantity) > 0) problems.push(`${label}: the quantity can be at most ${L.maxQuantity}.`);
    const ph = await readyFiles(q, ctx.actor.id, u.photoDraftKey, "photo");
    if (!ph.length) problems.push(`${label}: add at least one photo that has finished uploading.`);
    photos.push(ph);
  }
  return photos;
}

/** Next business id in the existing max + 1 numbering (as master data and imports do), e.g. CMP-042. */
const nextBid = (table: "component" | "order_item", prefix: string) =>
  `'${prefix}-' || lpad((select coalesce(max(substring(business_id from '\\d+$')::int), 0) + 1 from ${table})::text, 3, '0')`;

/**
 * Adds each unlisted item to the order (under one "Unlisted items" order item per order) and to this dispatch as a
 * line not received OK, then opens its complaint, so replacement, stage moves and the one-open-complaint-per-line
 * rule all work unchanged.
 */
async function addUnlisted(q: Queryable, ctx: Ctx, row: DispatchRow, list: Unlisted[], photos: string[][]) {
  if (!list.length) return [];
  // Locking the order keeps two receipts of one order from both creating its "unlisted items" order item.
  await q.query("select id from sales_order where id = $1 for update", [row.order_id]);
  let [oi] = await q.query<{ id: string }>("select id from order_item where order_id = $1 and product_type = $2 order by created_at limit 1", [row.order_id, UNLISTED_ORDER_ITEM.productType]);
  if (!oi) {
    [oi] = await q.query<{ id: string }>(`insert into order_item(business_id, order_id, product_type, name, source_version) values (${nextBid("order_item", "OI")}, $1, $2, $3, 'site') returning id`,
      [row.order_id, UNLISTED_ORDER_ITEM.productType, UNLISTED_ORDER_ITEM.name]);
    await audit(q, { actorId: ctx.actor.id, action: "create", objectType: "order_item", objectId: oi!.id, after: { ...UNLISTED_ORDER_ITEM, dispatch: row.business_id }, correlationId: ctx.correlationId });
  }
  const out: Array<{ id: string; business_id: string; itemId: string }> = [];
  for (const [i, u] of list.entries()) {
    const group = PRODUCT_TYPES.find((t) => t.code === u.productType)?.group ?? "other";
    const [c] = await q.query<{ id: string }>(
      `insert into component(business_id, order_item_id, name, quantity, unit, quantity_kind, dispatch_group, unlisted, product_type)
       values (${nextBid("component", "CMP")}, $1, $2, $3, $4, 'unlisted', $5, true, $6) returning id`, [oi!.id, u.name, u.quantity, u.unit, group, u.productType]);
    const [di] = await q.query<{ id: string }>("insert into dispatch_item(dispatch_id, component_id, quantity, received_ok) values ($1,$2,$3,false) returning id", [row.id, c!.id, u.quantity]);
    const { photoDraftKey: _draft, ...fields } = u;
    await audit(q, { actorId: ctx.actor.id, action: "report_unlisted_item", objectType: "component", objectId: c!.id, after: { ...fields, dispatch: row.business_id }, correlationId: ctx.correlationId });
    const k = await openComplaint(q, ctx, row, { id: di!.id, component_id: c!.id, name: u.name }, { kind: u.kind, quantity: u.quantity, reason: u.reason, priority: u.priority }, photos[i]!,
      { unlisted: true, product_type: u.productType, unit: u.unit });
    out.push({ ...k, itemId: di!.id });
  }
  return out;
}

/**
 * Opens one complaint for one BOM line of a dispatch, at the complaint flow's first stage, with its photos, and
 * tells that stage's owner. Used by the receipt check and by confirmed installer reports (priority defaults to
 * normal there).
 */
export async function openComplaint(q: Queryable, ctx: Ctx, d: { id: string; business_id: string; order_id: string; project_id: string },
  it: { id: string; component_id: string; name: string }, l: { kind: "missing" | "damaged"; quantity: string; reason: string; priority?: Priority }, photos: string[], extra: Record<string, unknown> = {}) {
  const cdef = await loadDefinition(q, "complaint");
  const first = cdef.def.stages[0]!;
  const priority = l.priority ?? "normal";
  const [c] = await q.query<{ id: string; business_id: string }>(
    `insert into complaint(business_id, dispatch_id, dispatch_item_id, order_id, project_id, component_id, kind, quantity, reason, stage, stage_entered_at, config_version, created_by, priority)
     values ('MND-' || lpad(nextval('complaint_number')::text, 4, '0'), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id, business_id`,
    [d.id, it.id, d.order_id, d.project_id, it.component_id, l.kind, l.quantity, l.reason, first.code, new Date(ctx.now).toISOString(), cdef.version, ctx.actor.id, priority]);
  const hid = await writeHistory(q, { type: "complaint", id: c!.id, from: null, to: first.code, kind: "create", data: { kind: l.kind, quantity: l.quantity, item: it.name, dispatch: d.business_id, photos: photos.length, priority, ...extra }, reason: l.reason, actorId: ctx.actor.id, at: ctx.now });
  await linkFiles(q, photos, hid, "flow.mnd_photo", ctx.actor.id);
  const urgency = priority === "normal" ? "" : `${priorityLabel(priority)} priority. `;
  await notifyStage(q, { type: "complaint", id: c!.id, businessId: c!.business_id, projectId: d.project_id, stage: first, historyId: hid, at: ctx.now,
    detail: `${urgency}${l.kind === "missing" ? "Missing" : "Damaged"}: ${l.quantity} × ${it.name}${extra.unlisted ? " (not on the factory list)" : ""} on ${d.business_id}.` });
  return c!;
}

/** A replacement received: its complaint closes when the line arrived OK, or hands over to the new complaint. */
async function settleReplacement(q: Queryable, ctx: Ctx, row: DispatchRow, created: Array<{ id: string; business_id: string }>) {
  const c = await lockSubject<SubjectRow>(q, "complaint", row.replacement_for!);
  if (c.status !== "open") return;
  const next = created[0] ?? null;
  await q.query("update complaint set stage = 'closed', status = 'closed', outcome = $2, superseded_by = $3, closed_at = $4, version = version + 1, updated_at = $4 where id = $1",
    [c.id, next ? "superseded" : "replaced", next?.id ?? null, new Date(ctx.now).toISOString()]);
  await writeHistory(q, { type: "complaint", id: c.id, from: c.stage, to: "closed", kind: "close", data: { replacement: row.business_id, outcome: next ? "superseded" : "replaced", new_complaint: next?.business_id ?? null },
    reason: next ? `Replacement ${row.business_id} arrived with a problem; follow-up in ${next.business_id}.` : `Replacement ${row.business_id} received OK.`, actorId: ctx.actor.id, at: ctx.now });
  await audit(q, { actorId: ctx.actor.id, action: "close_complaint", objectType: "complaint", objectId: c.id, after: { outcome: next ? "superseded" : "replaced" }, correlationId: ctx.correlationId });
}
