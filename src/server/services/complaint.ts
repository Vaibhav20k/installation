/**
 * Installation complaints (the MND loop). One complaint per missing or damaged line, linked to its order,
 * dispatch and factory. Stages come from the complaint flow definition: QC, costing, the Management cost gate
 * (approver is never the person who costed it), replacement planning, the store branch (stock vs purchase),
 * IQC (reject goes back to purchase), production and packaging. At "ready for dispatch" the factory creates the
 * replacement dispatch, which runs the main flow and closes the complaint when it is received OK.
 */
import { z } from "zod";
import { forbidSelfApproval } from "../auth/permissions";
import { conflict } from "../errors";
import { stageOf } from "@/domain/flow";
import { one, parse, zId, zVersion, type Ctx } from "./context";
import {
  checkBack, expectState, loadDefinition, lockSubject, notifyStage, prepareStage, recordStage, requireStageOwner, setStage, type SubjectRow,
} from "./flow-core";
import { insertDispatch, requireBackRight } from "./dispatch";

interface ComplaintRow extends SubjectRow {
  dispatch_id: string; order_id: string; component_id: string; quantity: string; costed_by: string | null; cost_approved_by: string | null;
}

export async function advanceComplaint(ctx: Ctx, input: unknown) {
  const d = parse(z.object({
    complaintId: zId, version: zVersion, stage: z.string().min(2).max(40),
    values: z.record(z.string(), z.string().max(2000)).default({}), files: z.record(z.string(), z.string().uuid()).default({}), reason: z.string().max(500).optional(),
  }), input);
  return ctx.db.tx(async (q) => {
    const row = await lockSubject<ComplaintRow>(q, "complaint", d.complaintId);
    expectState(row, d.stage, d.version);
    const { def } = await loadDefinition(q, "complaint", row.config_version);
    const s = stageOf(def, row.stage);
    if (!s) throw conflict("This complaint is on a stage the flow no longer has. Ask an administrator.");
    if (s.handler === "await_replacement") throw conflict("This complaint closes when its replacement dispatch is received.");
    await requireStageOwner(q, ctx.actor, s, row.project_id);
    const p = await prepareStage(q, ctx.actor, s, d.values, d.files, d.reason);
    if (p.move.kind === "hold") throw conflict(`${s.label} cannot be put on hold.`);
    const to = stageOf(def, p.move.to)!;
    let set = "";
    const params: unknown[] = [];
    const extra: Record<string, unknown> = {};
    if (s.handler === "cost") { params.push(p.data.cost, ctx.actor.id); set = ", cost = $4, costed_by = $5, cost_approved_by = null"; }
    if (s.handler === "approve_cost") {
      if (row.costed_by) forbidSelfApproval(ctx.actor, row.costed_by, "complaint costing");
      if (p.move.kind === "forward") { params.push(ctx.actor.id); set = ", cost_approved_by = $4"; }
    }
    if (p.data.item_source) { params.push(p.data.item_source); set += `, item_source = $${params.length + 3}`; }
    if (s.handler === "create_replacement") {
      const r = await createReplacement(ctx, q, row);
      params.push(r.dispatchId); set += `, replacement_dispatch_id = $${params.length + 3}`;
      extra.replacement = r.businessId;
    }
    await setStage(q, "complaint", row.id, to.code, ctx.now, set, params);
    const hid = await recordStage(q, ctx, "complaint", row, p, p.move.kind, to.code, extra);
    await notifyStage(q, { type: "complaint", id: row.id, businessId: row.business_id, projectId: row.project_id, stage: to, historyId: hid, at: ctx.now,
      detail: p.move.kind === "back" ? `Sent back from ${s.label}: ${p.reason}` : `${s.label} done. Your step: ${to.label}.` });
    return { stage: to.code, replacement: extra.replacement ?? null };
  });
}

/** The replacement re-enters the main flow at Ready for dispatch, carrying only the affected line and quantity. */
async function createReplacement(ctx: Ctx, q: Parameters<typeof lockSubject>[0], c: ComplaintRow) {
  const orig = await one<{ types: string[]; factory: string }>(q, "select types, factory from dispatch where id = $1", [c.dispatch_id], "Dispatch");
  const comp = await one<{ dispatch_group: string | null }>(q, "select dispatch_group from component where id = $1", [c.component_id], "BOM line");
  const { def, version } = await loadDefinition(q, "dispatch");
  const match = (def.dispatchTypes ?? []).filter((t) => orig.types.includes(t.code) && comp.dispatch_group && t.groups.includes(comp.dispatch_group as never)).map((t) => t.code);
  return insertDispatch(q, ctx, def, version, {
    orderId: c.order_id, projectId: c.project_id, types: match.length ? match : orig.types, factory: orig.factory, replacementFor: c.id,
    items: [{ componentId: c.component_id, quantity: c.quantity }], note: `Replacement – Complaint ${c.business_id}`,
  });
}

export async function moveComplaintBack(ctx: Ctx, input: unknown) {
  const d = parse(z.object({ complaintId: zId, version: zVersion, stage: z.string().max(40), to: z.string().max(40), reason: z.string().trim().min(3).max(500) }), input);
  return ctx.db.tx(async (q) => {
    const row = await lockSubject<ComplaintRow>(q, "complaint", d.complaintId);
    expectState(row, d.stage, d.version);
    const { def } = await loadDefinition(q, "complaint", row.config_version);
    const s = checkBack(def, row.stage, d.to, d.reason);
    await requireBackRight(q, ctx, s, row.project_id, "complaint");
    const to = stageOf(def, d.to)!;
    // Going back before the cost gate voids the approval, so a new cost is approved again.
    await setStage(q, "complaint", row.id, to.code, ctx.now, to.handler === "cost" || to.handler === "approve_cost" ? ", cost_approved_by = null" : "");
    const hid = await recordStage(q, ctx, "complaint", row, { data: {}, found: {}, reason: d.reason }, "back", to.code);
    await notifyStage(q, { type: "complaint", id: row.id, businessId: row.business_id, projectId: row.project_id, stage: to, historyId: hid, at: ctx.now, detail: `Sent back from ${s.label}: ${d.reason}` });
    return { stage: to.code };
  });
}
