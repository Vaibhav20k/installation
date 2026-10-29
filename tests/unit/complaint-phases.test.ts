import { describe, expect, it } from "vitest";
import { PHASES, STAGE_PHASE, phaseIndex, phaseOf, phaseTrack, unmappedStages } from "@/domain/complaint-phases";
import { DEFAULT_COMPLAINT_FLOW } from "@/domain/flow-defaults";

const order = (p: string) => (p === "done" ? PHASES.length : phaseIndex(p as never));

describe("complaint phases", () => {
  it("are the five plain phases, in the order the IM reads them", () => {
    expect(PHASES.map((p) => p.label)).toEqual(["Planning", "Purchase", "QC", "Production", "Dispatched"]);
  });

  it("map every stage of the shipped complaint flow to exactly one phase", () => {
    const codes = DEFAULT_COMPLAINT_FLOW.stages.map((s) => s.code);
    expect(unmappedStages(DEFAULT_COMPLAINT_FLOW)).toEqual([]);
    expect(Object.keys(STAGE_PHASE).sort()).toEqual([...codes].sort());
    const valid = new Set<string>([...PHASES.map((p) => p.code), "done"]);
    for (const c of codes) expect(valid.has(phaseOf(c)), c).toBe(true);
  });

  it("only the terminal stage is done, and every phase has at least one stage", () => {
    for (const s of DEFAULT_COMPLAINT_FLOW.stages) expect(phaseOf(s.code) === "done", s.code).toBe(!!s.terminal);
    for (const p of PHASES) expect(Object.values(STAGE_PHASE)).toContain(p.code);
  });

  it("never goes backwards along the forward path (next and forward branches)", () => {
    for (const s of DEFAULT_COMPLAINT_FLOW.stages) {
      const targets = [s.next, ...(s.branches ?? []).filter((b) => !b.back && b.to).map((b) => b.to)].filter(Boolean) as string[];
      for (const t of targets) expect(order(phaseOf(t)), `${s.code} -> ${t}`).toBeGreaterThanOrEqual(order(phaseOf(s.code)));
    }
  });

  it("places stages an administrator adds by their owner", () => {
    expect(phaseOf("new_vendor_check", "purchase")).toBe("purchase");
    expect(phaseOf("paint_shop", "production")).toBe("production");
    expect(phaseOf("site_photo_check", "qc")).toBe("planning");
    expect(phaseOf("anything", "store", true)).toBe("done");
  });

  it("highlights the current phase and says who is being waited for", () => {
    const t = phaseTrack({ stage: "management_approval", status: "open" });
    expect(t.steps.map((s) => s.state)).toEqual(["current", "todo", "todo", "todo", "todo"]);
    expect(t.waitingFor).toBe("Planning team");
    const p = phaseTrack({ stage: "packaging", status: "open", itemSource: "raw_material" });
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo"]);
    expect(p.waitingFor).toBe("Production");
    expect(phaseTrack({ stage: "ready_for_dispatch", status: "open" }).waitingFor).toBe("Factory dispatch");
    expect(phaseTrack({ stage: "awaiting_replacement", status: "open" }).waitingFor).toBe("Delivery to site");
  });

  it("shows Purchase, QC and Production as skipped when the finished good was in stock", () => {
    const t = phaseTrack({ stage: "ready_for_dispatch", status: "open", itemSource: "fg_in_stock" });
    expect(t.steps.map((s) => s.state)).toEqual(["done", "skipped", "skipped", "skipped", "current"]);
    const closed = phaseTrack({ stage: "closed", status: "closed", itemSource: "fg_in_stock", outcome: "replaced" });
    expect(closed.steps.map((s) => s.state)).toEqual(["done", "skipped", "skipped", "skipped", "done"]);
    expect(closed.waitingFor).toBeNull();
  });

  it("tells a superseded complaint apart from a replaced one", () => {
    expect(phaseTrack({ stage: "closed", status: "closed", outcome: "superseded" }).says).toMatch(/follow-up/);
    expect(phaseTrack({ stage: "closed", status: "closed", outcome: "replaced" }).says).toMatch(/received/);
  });
});
