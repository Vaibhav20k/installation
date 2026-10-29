/**
 * Table-driven checks of the stage engine, generated from the shipped flow definitions so the tests and the
 * config cannot drift: every allowed move passes, every other move is impossible, no stage can be skipped, and
 * backward moves need both a listed target and a reason.
 */
import { describe, expect, it } from "vitest";
import { ageDays, agingBucket, checkData, checkDefinition, resolveMove, stageIndex, stageOf, zFlowDefinition, type FlowDefinition, type StageSpec } from "@/domain/flow";
import { DEFAULT_COMPLAINT_FLOW, DEFAULT_DISPATCH_FLOW } from "@/domain/flow-defaults";
import { checkBack } from "@/server/services/flow-core";

const ROLES = ["factory_dispatch", "installation_manager", "accounts", "qc", "planning", "management", "store", "purchase", "production", "packaging"];
const FLOWS: Array<[string, FlowDefinition]> = [["dispatch", DEFAULT_DISPATCH_FLOW], ["complaint", DEFAULT_COMPLAINT_FLOW]];

/** Every value combination a stage's choice fields can take (enough to reach every branch). */
function choices(s: StageSpec): Array<Record<string, string>> {
  const selects = s.fields.filter((f) => f.type === "select");
  let out: Array<Record<string, string>> = [{}];
  for (const f of selects) out = out.flatMap((o) => f.options!.map((x) => ({ ...o, [f.key]: x.value })));
  return out;
}

describe.each(FLOWS)("%s flow transitions", (_name, def) => {
  const active = def.stages.filter((s) => !s.terminal);

  it.each(active.map((s) => [s.code, s] as const))("%s moves only to its configured next stage or branches", (_c, s) => {
    const allowed = new Set([s.next, ...(s.branches ?? []).map((b) => b.to)].filter(Boolean));
    for (const values of choices(s)) {
      const m = resolveMove(s, values);
      if (m.kind === "hold") { expect((s.branches ?? []).some((b) => b.hold)).toBe(true); continue; }
      expect(allowed.has(m.to)).toBe(true);
      // Forward moves never jump past the next stage unless a branch says so (no skipping).
      if (m.kind === "forward" && m.to === s.next) expect(stageIndex(def, m.to)).toBeGreaterThan(stageIndex(def, s.code));
    }
  });

  it.each(active.map((s) => [s.code, s] as const))("%s: back moves only to listed stages, never without a reason", (_c, s) => {
    for (const t of def.stages) {
      const listed = (s.backTo ?? []).includes(t.code);
      expect(() => checkBack(def, s.code, t.code, "")).toThrow();
      if (listed) expect(checkBack(def, s.code, t.code, "Wrong invoice attached").code).toBe(s.code);
      else expect(() => checkBack(def, s.code, t.code, "Wrong invoice attached")).toThrow();
    }
  });

  it("every non-terminal stage has an owner and a way forward", () => {
    for (const s of active) {
      expect(s.owner.length).toBeGreaterThan(0);
      expect(!!s.next || (s.branches ?? []).some((b) => b.to && !b.back)).toBe(true);
    }
  });
});

describe("gates", () => {
  const site = stageOf(DEFAULT_DISPATCH_FLOW, "site_readiness")!;
  it("Not ready holds the dispatch (Tax invoice stays locked) and needs a reason and an expected date", () => {
    expect(resolveMove(site, { status: "not_ready" })).toEqual({ kind: "hold" });
    const p = checkData(site, { status: "not_ready" }).problems.join(" ");
    expect(p).toMatch(/Why it is not ready: required/);
    expect(p).toMatch(/Expected ready date: required/);
    expect(checkData(site, { status: "not_ready", reason: "Tiles pending", expected_date: "2026-11-02" }).problems).toEqual([]);
    expect(site.remindDaysBefore).toBeGreaterThanOrEqual(1);
  });
  it("Dispatched is reachable only from the E-way bill stage, and the E-way bill needs its file", () => {
    const into = DEFAULT_DISPATCH_FLOW.stages.filter((s) => s.next === "dispatched" || (s.branches ?? []).some((b) => b.to === "dispatched" && !b.back));
    expect(into.map((s) => s.code)).toEqual(["eway_bill"]);
    const eway = stageOf(DEFAULT_DISPATCH_FLOW, "eway_bill")!;
    expect(checkData(eway, { eway_no: "EWB-1" }).problems.join(" ")).toMatch(/E-way bill: add at least 1/);
  });
  it("Management reject does not move the complaint forward and requires a reason", () => {
    const gate = stageOf(DEFAULT_COMPLAINT_FLOW, "management_approval")!;
    expect(checkData(gate, { decision: "reject" }).problems.join(" ")).toMatch(/Reason: required/);
    const m = resolveMove(gate, { decision: "reject", reason: "Too costly" });
    expect(m.kind).toBe("back");
    expect(stageIndex(DEFAULT_COMPLAINT_FLOW, (m as { to: string }).to)).toBeLessThan(stageIndex(DEFAULT_COMPLAINT_FLOW, "management_approval"));
  });
  it("Installation done needs completion photos", () => {
    expect(checkData(stageOf(DEFAULT_DISPATCH_FLOW, "installation_done")!, {}).problems.join(" ")).toMatch(/Completion photos/);
  });
});

describe("complaint routing", () => {
  const walk = (start: string, answers: Record<string, Record<string, string>>) => {
    const path = [start];
    let s = stageOf(DEFAULT_COMPLAINT_FLOW, start)!;
    while (!s.terminal && s.owner !== "system") {
      const m = resolveMove(s, answers[s.code] ?? {});
      if (m.kind === "hold") break;
      path.push(m.to);
      s = stageOf(DEFAULT_COMPLAINT_FLOW, m.to)!;
    }
    return path;
  };
  it("FG in stock goes straight to Ready for dispatch", () => {
    expect(walk("store_check", { store_check: { item_source: "fg_in_stock" } })).toEqual(["store_check", "ready_for_dispatch", "awaiting_replacement"]);
  });
  it.each(["raw_material", "to_purchase"])("%s goes Purchase → IQC → Store → Production → Packaging → Ready for dispatch", (src) => {
    expect(walk("store_check", { store_check: { item_source: src }, iqc: { result: "pass" } }))
      .toEqual(["store_check", "purchase", "iqc", "store_issue", "production", "packaging", "ready_for_dispatch", "awaiting_replacement"]);
  });
  it("IQC reject goes back to Purchase", () => {
    expect(resolveMove(stageOf(DEFAULT_COMPLAINT_FLOW, "iqc")!, { result: "reject" })).toEqual({ kind: "back", to: "purchase" });
  });
});

describe("config validation", () => {
  const clone = () => zFlowDefinition.parse(structuredClone(DEFAULT_DISPATCH_FLOW));
  it("accepts the shipped flows", () => {
    for (const [, d] of FLOWS) expect(checkDefinition(zFlowDefinition.parse(d), ROLES)).toEqual([]);
  });
  it("rejects a stage nobody can reach (orphan)", () => {
    const d = clone();
    d.stages.splice(3, 0, { code: "orphan_step", label: "Orphan step", owner: "qc", fields: [], next: "eway_bill" });
    expect(checkDefinition(d, ROLES).join(" ")).toMatch(/Orphan step: no stage leads here/);
  });
  it("rejects a stage with no owner, or an unknown owner", () => {
    const d = clone();
    d.stages[2]!.owner = "nobody";
    expect(checkDefinition(d, ROLES).join(" ")).toMatch(/not a known role/);
    expect(zFlowDefinition.safeParse({ ...clone(), stages: clone().stages.map((s, i) => (i === 2 ? { ...s, owner: "" } : s)) }).success).toBe(false);
  });
  it("rejects loops with no way out (a forward link pointing backwards) and dead ends", () => {
    const d = clone();
    d.stages[4]!.next = "site_readiness";
    expect(checkDefinition(d, ROLES).join(" ")).toMatch(/must come later/);
    const e = clone();
    delete e.stages[4]!.next;
    expect(checkDefinition(e, ROLES).join(" ")).toMatch(/needs a next stage/);
  });
  it("rejects branches on fields the stage does not have, and backward forward-branches", () => {
    const d = clone();
    d.stages[1]!.branches = [{ when: { field: "nope", equals: "x" }, to: "ready_for_dispatch" }];
    const p = checkDefinition(d, ROLES).join(" ");
    expect(p).toMatch(/branch field "nope"/);
    expect(p).toMatch(/must point to a later stage/);
  });
  it("a changed definition changes behaviour with no code change", () => {
    const d = clone();
    const site = d.stages.find((s) => s.code === "site_readiness")!;
    site.next = "eway_bill"; // e.g. a business that invoices later
    d.stages = d.stages.filter((s) => s.code !== "tax_invoice");
    d.stages.find((s) => s.code === "dispatched")!.backTo = ["eway_bill"];
    d.stages.find((s) => s.code === "eway_bill")!.backTo = [];
    expect(checkDefinition(d, ROLES)).toEqual([]);
    expect(resolveMove(site, { status: "ready" })).toEqual({ kind: "forward", to: "eway_bill" });
  });
});

describe("validator edge cases", () => {
  const clone = () => zFlowDefinition.parse(structuredClone(DEFAULT_COMPLAINT_FLOW));
  it("reports duplicate stages, bad branches, choice fields without options and a missing terminal", () => {
    const d = clone();
    d.stages.push({ ...d.stages[1]! });
    const store = d.stages.find((s) => s.code === "store_check")!;
    store.branches = [{ when: { field: "item_source", equals: "fg_in_stock" }, to: "purchase", hold: true }, { when: { field: "item_source", equals: "raw_material" }, to: "packaging", back: true }, { when: { field: "item_source", equals: "x" }, to: "ghost" }];
    store.fields[0]!.options = [];
    store.fields.push({ key: "extra", label: "Extra", type: "text", requiredWhen: { field: "missing_field", equals: "y" } });
    store.backTo = ["ghost", "packaging"];
    d.stages = d.stages.map((s) => (s.terminal ? { ...s, terminal: false, next: "qc_review" } : s));
    const p = checkDefinition(d, ROLES).join(" ");
    for (const m of [/appears twice/, /cannot also move/, /back branch to "packaging" must point to an earlier/, /branch stage "ghost" does not exist/, /needs options/, /"required when" field does not exist/, /back stage "ghost" does not exist/, /back stage "packaging" must be earlier/, /needs a terminal stage/]) expect(p).toMatch(m);
  });
  it("checks dates, numbers, choices and short text", () => {
    const s = { code: "x", label: "X", owner: "qc", next: "y", fields: [
      { key: "d", label: "Date", type: "date" as const, required: true }, { key: "n", label: "Number", type: "number" as const, required: true },
      { key: "t", label: "Text", type: "text" as const, required: true }, { key: "o", label: "Optional", type: "text" as const },
    ] };
    const p = checkData(s, { d: "15/11/2026", n: "-3", t: "a", extra: "dropped" }).problems.join(" ");
    expect(p).toMatch(/Date: use a date/);
    expect(p).toMatch(/Number: use a non-negative number/);
    expect(p).toMatch(/Text: too short/);
    const ok = checkData(s, { d: "2026-11-15", n: "12.50", t: "ok", o: null, extra: "dropped" });
    expect(ok.problems).toEqual([]);
    expect(ok.data).toEqual({ d: "2026-11-15", n: "12.50", t: "ok" });
    expect(checkData(s, { d: "2026-11-15", n: "1", t: "x".repeat(400) }).data.t).toHaveLength(300);
  });
  it("throws for a stage with no next stage and no matching branch", () => {
    expect(() => resolveMove({ code: "x", label: "X", owner: "qc", fields: [] }, {})).toThrow();
  });
  it("buckets aging by whole days, never negative", () => {
    const day = 86_400_000;
    expect([0, 2, 3, 7, 8, 14, 15, 90].map(agingBucket)).toEqual(["0-2 days", "0-2 days", "3-7 days", "3-7 days", "8-14 days", "8-14 days", "15+ days", "15+ days"]);
    expect(ageDays(5 * day, 3 * day)).toBe(0);
    expect(ageDays(0, 2.9 * day)).toBe(2);
  });
});
