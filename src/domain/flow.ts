/**
 * Config-driven stage flows (dispatch to installation, and the MND complaint loop). A flow is a list of stages;
 * each stage names its owner role, the fields its owner fills in, the next stage, optional branches on a field
 * value, and the earlier stages it may be sent back to. The current stage is the step being waited for.
 * Everything here is pure: the services load the definition, check roles and write history.
 */
import { z } from "zod";

export const FIELD_TYPES = ["text", "longtext", "date", "number", "select", "files"] as const;
export const HANDLERS = ["create", "receive_mnd", "install_start", "install_done", "cost", "approve_cost", "create_replacement", "await_replacement"] as const;

const zCode = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Use lower-case letters, digits and underscores");
const zWhen = z.object({ field: zCode, equals: z.string().min(1).max(40) });

const zField = z.object({
  key: zCode,
  label: z.string().min(2).max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  requiredWhen: zWhen.optional(),
  options: z.array(z.object({ value: zCode, label: z.string().min(1).max(60) })).max(12).optional(),
  accept: z.enum(["photo", "document", "photo_or_document"]).optional(),
  minFiles: z.number().int().min(1).max(10).optional(),
  help: z.string().max(200).optional(),
});

const zStage = z.object({
  code: zCode,
  label: z.string().min(2).max(60),
  owner: zCode,
  handler: z.enum(HANDLERS).optional(),
  fields: z.array(zField).max(12).default([]),
  next: zCode.optional(),
  branches: z.array(z.object({ when: zWhen, to: zCode.optional(), hold: z.boolean().optional(), back: z.boolean().optional() })).max(6).optional(),
  backTo: z.array(zCode).max(8).optional(),
  terminal: z.boolean().optional(),
  slaDays: z.number().int().min(1).max(90).optional(),
  remindDaysBefore: z.number().int().min(0).max(14).optional(),
});

export const zFlowDefinition = z.object({
  flow: z.enum(["dispatch", "complaint"]),
  stages: z.array(zStage).min(2).max(30),
  dispatchTypes: z.array(z.object({ code: z.string().regex(/^[A-Z][A-Za-z0-9]{0,5}$/), label: z.string().min(2).max(60), groups: z.array(z.enum(["carcass", "shutters", "countertop", "backsplash", "other"])).min(1) })).max(12).optional(),
  factories: z.array(z.string().min(2).max(60)).max(12).optional(),
});

export type FieldSpec = z.infer<typeof zField>;
export type StageSpec = z.infer<typeof zStage>;
export type FlowDefinition = z.infer<typeof zFlowDefinition>;
export type FlowData = Record<string, string>;

export const stageOf = (def: FlowDefinition, code: string) => def.stages.find((s) => s.code === code);
export const stageIndex = (def: FlowDefinition, code: string) => def.stages.findIndex((s) => s.code === code);

/** Checks a definition's internal references. Returns problems in plain words; empty means valid. */
export function checkDefinition(def: FlowDefinition, roles: string[]): string[] {
  const out: string[] = [];
  const codes = new Set<string>();
  for (const s of def.stages) {
    if (codes.has(s.code)) out.push(`Stage "${s.code}" appears twice.`);
    codes.add(s.code);
  }
  const has = (c: string | undefined) => !c || codes.has(c);
  for (const [i, s] of def.stages.entries()) {
    if (s.owner !== "system" && !roles.includes(s.owner)) out.push(`${s.label}: owner "${s.owner}" is not a known role.`);
    if (!s.terminal && !s.next && !(s.branches ?? []).some((b) => b.to)) out.push(`${s.label}: needs a next stage or be marked terminal.`);
    if (!has(s.next)) out.push(`${s.label}: next stage "${s.next}" does not exist.`);
    for (const b of s.branches ?? []) {
      if (!has(b.to)) out.push(`${s.label}: branch stage "${b.to}" does not exist.`);
      if (!s.fields.some((f) => f.key === b.when.field)) out.push(`${s.label}: branch field "${b.when.field}" is not one of its fields.`);
      if (b.hold && b.to) out.push(`${s.label}: a hold branch keeps the stage, so it cannot also move to "${b.to}".`);
      if (b.to && !b.back && stageIndex(def, b.to) <= i) out.push(`${s.label}: forward branch to "${b.to}" must point to a later stage (mark it back otherwise).`);
      if (b.to && b.back && stageIndex(def, b.to) >= i) out.push(`${s.label}: back branch to "${b.to}" must point to an earlier stage.`);
    }
    if (s.next && stageIndex(def, s.next) <= i) out.push(`${s.label}: next stage must come later in the list (no loops forward).`);
    for (const t of s.backTo ?? []) {
      if (!codes.has(t)) out.push(`${s.label}: back stage "${t}" does not exist.`);
      else if (stageIndex(def, t) >= i) out.push(`${s.label}: back stage "${t}" must be earlier.`);
    }
    for (const f of s.fields) {
      if (f.type === "select" && !(f.options?.length)) out.push(`${s.label} / ${f.label}: a choice field needs options.`);
      if (f.requiredWhen && !s.fields.some((g) => g.key === f.requiredWhen!.field)) out.push(`${s.label} / ${f.label}: "required when" field does not exist.`);
    }
  }
  if (!def.stages.some((s) => s.terminal)) out.push("The flow needs a terminal stage.");
  // Every stage must be reachable from the first one by forward links (an orphan stage could never be worked).
  const seen = new Set<string>();
  const walk = [def.stages[0]?.code];
  while (walk.length) {
    const c = walk.pop();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    const s = stageOf(def, c);
    if (s) walk.push(s.next, ...(s.branches ?? []).filter((b) => !b.back).map((b) => b.to));
  }
  for (const s of def.stages) if (!seen.has(s.code)) out.push(`${s.label}: no stage leads here, so it could never be reached.`);
  return out;
}

export function isRequired(f: FieldSpec, data: FlowData) {
  return !!f.required || (!!f.requiredWhen && data[f.requiredWhen.field] === f.requiredWhen.equals);
}

/**
 * Validates submitted values against the stage's fields (files are counted by the caller and passed in).
 * Unknown keys are dropped; returns cleaned values and problems.
 */
export function checkData(stage: StageSpec, raw: Record<string, unknown>, fileCounts: Record<string, number> = {}) {
  const data: FlowData = {};
  const problems: string[] = [];
  for (const f of stage.fields) {
    if (f.type === "files") continue;
    const v = typeof raw[f.key] === "string" ? (raw[f.key] as string).trim() : raw[f.key] == null ? "" : String(raw[f.key]);
    if (v) data[f.key] = v.slice(0, f.type === "longtext" ? 2000 : 300);
  }
  for (const f of stage.fields) {
    const v = data[f.key];
    if (f.type === "files") {
      const n = fileCounts[f.key] ?? 0;
      const min = f.minFiles ?? 1;
      if (isRequired(f, data) && n < min) problems.push(`${f.label}: add at least ${min} ${f.accept === "document" ? "file" : "photo"}${min === 1 ? "" : "s"} that finished uploading.`);
      continue;
    }
    if (!v) { if (isRequired(f, data)) problems.push(`${f.label}: required.`); continue; }
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) problems.push(`${f.label}: use a date (YYYY-MM-DD).`);
    // At most 12 whole digits: fits the money columns (numeric(14,2)) so a huge value is a message, not a crash.
    if (f.type === "number" && !/^\d{1,12}(\.\d{1,2})?$/.test(v)) problems.push(`${f.label}: use a non-negative number with up to 12 digits and 2 decimals.`);
    if (f.type === "select" && !f.options?.some((o) => o.value === v)) problems.push(`${f.label}: choose one of the listed options.`);
    if ((f.type === "text" || f.type === "longtext") && v.length < 2) problems.push(`${f.label}: too short.`);
  }
  return { data, problems };
}

export type Move = { kind: "forward"; to: string } | { kind: "back"; to: string } | { kind: "hold" };

/** Where completing this stage with these values leads: the first matching branch, else the next stage. */
export function resolveMove(stage: StageSpec, data: FlowData): Move {
  for (const b of stage.branches ?? []) {
    if (data[b.when.field] !== b.when.equals) continue;
    if (b.hold) return { kind: "hold" };
    if (b.to) return b.back ? { kind: "back", to: b.to } : { kind: "forward", to: b.to };
  }
  if (!stage.next) throw new Error(`Stage ${stage.code} has no next stage`);
  return { kind: "forward", to: stage.next };
}

/** Whole days between two instants, floored (for aging and SLA). */
export const ageDays = (fromMs: number, nowMs: number) => Math.max(0, Math.floor((nowMs - fromMs) / 86_400_000));

export function agingBucket(days: number) {
  return days <= 2 ? "0-2 days" : days <= 7 ? "3-7 days" : days <= 14 ? "8-14 days" : "15+ days";
}
export const AGING_BUCKETS = ["0-2 days", "3-7 days", "8-14 days", "15+ days"] as const;

/** BOM groups a set of dispatch types covers. D3 and its parts cannot ship in the same dispatch. */
export function groupsFor(def: FlowDefinition, types: string[]): { groups: Set<string>; problems: string[] } {
  const known = def.dispatchTypes ?? [];
  const problems: string[] = [];
  const groups = new Set<string>();
  for (const t of types) {
    const k = known.find((x) => x.code === t);
    if (!k) { problems.push(`Unknown dispatch type ${t}.`); continue; }
    for (const g of k.groups) {
      if (groups.has(g)) problems.push(`${k.label} overlaps another selected type (${g} twice).`);
      groups.add(g);
    }
  }
  return { groups, problems };
}
