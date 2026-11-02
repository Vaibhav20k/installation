/**
 * The complaint flow in five plain phases, for the Installation Manager who raised it. The detailed flow has
 * thirteen stages owned by eight departments; the person waiting on site only needs to know which of five
 * things the factory is doing now. These names are used everywhere the IM sees a complaint (the Complaints
 * view and the top of the complaint page), so they always read the same.
 *
 *   Planning   ← qc_review, planning_costing, management_approval, planning_replacement, store_check
 *   Purchase   ← purchase
 *   QC         ← iqc
 *   Production ← store_issue, production, packaging
 *   Dispatched ← ready_for_dispatch, awaiting_replacement
 *   (done)     ← closed
 *
 * QC review (the first step) sits in Planning, not QC: it is the factory deciding what to do, before anything is
 * bought. "QC" as a phase means checking bought material (Incoming QC), which is what the IM sees after Purchase.
 * When the store has the finished good (item_source fg_in_stock) the flow jumps from Store check straight to
 * Ready for dispatch, so Purchase, QC and Production show as skipped.
 *
 * The revised process (protocol operations_v1) has no Incoming QC but a mandatory QA review before dispatch, so its
 * five dots are Planning, Purchase, Production, QA, Dispatched. Records keep the phases of the flow they started on.
 */
import type { FlowDefinition } from "./flow";

export const PHASES = [
  { code: "planning", label: "Planning", waiting: "Planning team", says: "The factory is checking the complaint and planning the replacement." },
  { code: "purchase", label: "Purchase", waiting: "Purchase", says: "Material for the replacement is being bought." },
  { code: "qc", label: "QC", waiting: "QC", says: "The bought material is being checked." },
  { code: "production", label: "Production", waiting: "Production", says: "The replacement is being made and packed." },
  { code: "dispatched", label: "Dispatched", waiting: "Factory dispatch", says: "The replacement is leaving the factory or on its way to site." },
] as const;

/** QA review before dispatch; only the revised process has this phase. */
const QA_PHASE = { code: "qa", label: "QA", waiting: "QA", says: "Quality is confirming the real cause and what will stop it happening again." } as const;
export const OPERATIONS_PHASES = [PHASES[0], PHASES[1], PHASES[3], QA_PHASE, PHASES[4]] as const;
/** Every phase of either flow, in the order they run. */
export const ALL_PHASES = [PHASES[0], PHASES[1], PHASES[2], PHASES[3], QA_PHASE, PHASES[4]] as const;

export type PhaseCode = (typeof ALL_PHASES)[number]["code"];
export type PhaseState = "done" | "current" | "todo" | "skipped";

/** Every stage of the shipped complaint flow, mapped to exactly one phase ("done" for the end). */
export const STAGE_PHASE: Readonly<Record<string, PhaseCode | "done">> = {
  qc_review: "planning",
  planning_costing: "planning",
  management_approval: "planning",
  planning_replacement: "planning",
  store_check: "planning",
  purchase: "purchase",
  iqc: "qc",
  store_issue: "production",
  production: "production",
  packaging: "production",
  ready_for_dispatch: "dispatched",
  awaiting_replacement: "dispatched",
  closed: "done",
};

/** Stages only the revised process has. */
const OPERATIONS_STAGE_PHASE: Readonly<Record<string, PhaseCode>> = { qc_handoff: "planning", store_receipt: "purchase", qa_review: "qa" };

/** Owners decide the phase of a stage an administrator adds later, so an edited flow never breaks the tracker. */
const OWNER_PHASE: Readonly<Record<string, PhaseCode>> = {
  purchase: "purchase", production: "production", packaging: "production", factory_dispatch: "dispatched", dispatch_department: "dispatched", qa: "qa", system: "dispatched",
};

/** Who holds a step in the revised process, in plain words. Approval goes to whichever tier the cost routed to. */
const OWNER_WORDS: Readonly<Record<string, string>> = {
  qc: "QC", qa: "QA", planning: "Planning team", store: "Store", purchase: "Purchase", production: "Production", packaging: "Packaging",
  dispatch_department: "Dispatch", installation_manager: "Installation Manager", founders_office: "Founder's Office", owners: "Owners", system: "Delivery to site",
};

export function phaseOf(stage: string, owner?: string, terminal?: boolean): PhaseCode | "done" {
  if (terminal) return "done";
  return STAGE_PHASE[stage] ?? OPERATIONS_STAGE_PHASE[stage] ?? OWNER_PHASE[owner ?? ""] ?? "planning";
}

export const phaseIndex = (p: PhaseCode) => ALL_PHASES.findIndex((x) => x.code === p);
export const phaseInfo = (p: PhaseCode) => ALL_PHASES[phaseIndex(p)]!;

/** Filter chips: the active flow's phases, plus any phase an older record is still in. */
export function chipPhases(operations: boolean, counts: Readonly<Partial<Record<PhaseCode, number>>>) {
  const active: readonly { code: PhaseCode }[] = operations ? OPERATIONS_PHASES : PHASES;
  return ALL_PHASES.filter((p) => active.some((a) => a.code === p.code) || (counts[p.code] ?? 0) > 0);
}

/** Stages of a definition that only the owner fallback (not STAGE_PHASE) places; empty for the shipped flow. */
export function unmappedStages(def: FlowDefinition): string[] {
  return def.stages.filter((s) => !(s.code in STAGE_PHASE)).map((s) => s.code);
}

export interface PhaseStep { code: PhaseCode; label: string; state: PhaseState }

export interface PhaseTrack {
  /** The phase being worked on now, or "done" once the complaint is closed. */
  phase: PhaseCode | "done";
  steps: PhaseStep[];
  /** One plain sentence for what is happening, and who the IM is waiting for (null once closed). */
  says: string;
  waitingFor: string | null;
}

/**
 * The five dots for one complaint. `itemSource` is what the Store chose; "fg_in_stock" skips Purchase, QC and Production.
 * A closed complaint shows every phase it went through as done.
 */
export function phaseTrack(c: { stage: string; status: string; itemSource?: string | null; owner?: string; terminal?: boolean; outcome?: string | null; operations?: boolean }): PhaseTrack {
  const closed = c.status !== "open";
  const phase = closed ? "done" : phaseOf(c.stage, c.owner, c.terminal);
  const list: readonly { code: PhaseCode; label: string }[] = c.operations ? OPERATIONS_PHASES : PHASES;
  const at = phase === "done" ? list.length : list.findIndex((p) => p.code === phase);
  const fromStock = c.itemSource === "fg_in_stock";
  // The revised process takes one supply route; the others never happen, so they read as skipped, not done.
  const notTaken = (code: PhaseCode) => (code === "purchase" && c.itemSource === "manufacture") || (code === "production" && c.itemSource === "to_purchase");
  const steps = list.map((p, i): PhaseStep => {
    const skipped = (fromStock && p.code !== "planning" && p.code !== "qa" && p.code !== "dispatched") || (!!c.operations && notTaken(p.code));
    const state: PhaseState = skipped && i !== at ? "skipped" : i < at ? "done" : i === at ? "current" : "todo";
    return { code: p.code, label: p.label, state };
  });
  if (phase === "done") {
    const says = c.outcome === "superseded" ? "Closed. The replacement arrived with a problem, so a follow-up complaint was opened."
      : c.operations ? "Closed. The replacement was installed on site." : "Closed. The replacement was received on site.";
    return { phase, steps, says, waitingFor: null };
  }
  const info = phaseInfo(phase);
  // The last step is the IM's own: the replacement is on its way and closes when received OK on site.
  if (c.stage === "awaiting_replacement") return { phase, steps, says: c.operations ? "The replacement is on its way. It closes once it is received OK and installed." : "The replacement is on its way. It closes when you receive it OK on site.", waitingFor: "Delivery to site" };
  return { phase, steps, says: info.says, waitingFor: c.operations ? OWNER_WORDS[c.owner ?? ""] ?? info.waiting : info.waiting };
}
