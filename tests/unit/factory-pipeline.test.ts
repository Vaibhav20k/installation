import { describe, expect, it } from "vitest";
import {
  COMPLAINT_ACTION, DISPATCH_ACTION, FACTORY_PHASES, FACTORY_TILES, FTILE_KEYS, complaintWaiting, defaultFactoryTile, dispatchTile, dispatchWaiting,
  factoryPhaseLabel, groupQueue, hasFactoryRole, isFTileKey, landingPhase, parseQueueFilter, queueCounts, stepRank, type QueueComplaint,
} from "@/server/queries/factory-pipeline";
import { DEFAULT_FLOWS } from "@/domain/flow-defaults";
import { STAGE_PHASE } from "@/domain/complaint-phases";

const q = (o: Partial<QueueComplaint>): QueueComplaint => ({
  id: o.id ?? "x", business_id: "MND-1", kind: "missing", quantity: "1", unit: "", item: "Shelf", unlisted: false, priority: "normal", order: "ORD-1",
  customer: "A", project: "P", status: "open", stage: "qc_review", stage_label: "QC review", phase: "planning", owner: "qc", owner_name: "QC",
  days: 0, overdue: false, mine: false, created_at: 0, closed_at: null, ...o,
});

describe("factory pipeline bucketing", () => {
  it("has six tiles in the factory's order", () => {
    expect(FACTORY_TILES.map((t) => t.label)).toEqual(["To send", "At site check", "Accounts", "Ready to load", "On the truck", "Replacements"]);
    expect(FACTORY_TILES.map((t) => t.key)).toEqual([...FTILE_KEYS]);
    expect(isFTileKey("load")).toBe(true);
    expect(isFTileKey("ready")).toBe(false);
    expect(isFTileKey(undefined)).toBe(false);
  });

  it("puts each factory-side dispatch stage in exactly one tile, and site stages in none", () => {
    expect(dispatchTile("site_readiness")).toBe("site");
    expect(dispatchTile("tax_invoice")).toBe("accounts");
    expect(dispatchTile("eway_bill")).toBe("accounts");
    expect(dispatchTile("dispatched")).toBe("load");
    expect(dispatchTile("received")).toBe("truck");
    for (const s of ["installation_started", "installation_done", "completed", "ready_for_dispatch"]) expect(dispatchTile(s)).toBeNull();
  });

  it("gives buttons only to the owning department, matching the shipped dispatch flow", () => {
    const owner = (code: string) => DEFAULT_FLOWS.dispatch.stages.find((s) => s.code === code)!.owner;
    for (const [stage, a] of Object.entries(DISPATCH_ACTION)) expect(a.role).toBe(owner(stage));
    expect(DISPATCH_ACTION.tax_invoice!.label).toBe("Add tax invoice");
    expect(DISPATCH_ACTION.eway_bill!.label).toBe("Add e-way bill");
    expect(DISPATCH_ACTION.dispatched!.label).toBe("Record dispatch");
    expect(DISPATCH_ACTION.site_readiness).toBeUndefined();
    expect(DISPATCH_ACTION.received).toBeUndefined();
  });

  it("says who a row waits for in plain words", () => {
    expect(dispatchWaiting("site_readiness")).toBe("Waiting for the Installation Manager");
    expect(dispatchWaiting("tax_invoice")).toBe("Waiting for accounts");
    expect(dispatchWaiting("eway_bill")).toBe("Waiting for accounts");
    expect(dispatchWaiting("received")).toBe("Waiting for site");
    expect(complaintWaiting("planning", "Planning")).toBe("Waiting for Planning");
    expect(complaintWaiting("system", "Automatic")).toBe("On its way to site");
  });

  it("picks the first tile the viewer can act on, else the first non-empty one", () => {
    const t = (key: (typeof FTILE_KEYS)[number], n: number, mine = 0) => ({ key, n, mine });
    expect(defaultFactoryTile([t("send", 3), t("site", 1), t("accounts", 2, 2)])).toBe("accounts");
    expect(defaultFactoryTile([t("send", 0), t("site", 1), t("accounts", 2)])).toBe("site");
    expect(defaultFactoryTile([t("send", 0), t("site", 0)])).toBe("send");
  });

  it("treats every flow role but the Installation Manager's as a factory department", () => {
    expect(hasFactoryRole(["qc"])).toBe(true);
    expect(hasFactoryRole(["installation_manager"])).toBe(false);
    expect(hasFactoryRole([])).toBe(false);
  });
});

describe("factory phase words", () => {
  it("reads the Dispatched phase as Ready to send and keeps the domain key", () => {
    expect(factoryPhaseLabel("dispatched")).toBe("Ready to send");
    expect(factoryPhaseLabel("planning")).toBe("Planning");
    expect(factoryPhaseLabel("qc")).toBe("QC");
    expect(FACTORY_PHASES.map((p) => p.code)).toEqual(["planning", "purchase", "qc", "production", "dispatched"]);
    expect(FACTORY_PHASES.map((p) => p.label)).toEqual(["Planning", "Purchase", "QC", "Production", "Ready to send"]);
  });

  it("has an action for every person-owned complaint step, and orders steps as the flow does", () => {
    for (const s of DEFAULT_FLOWS.complaint.stages) if (s.owner !== "system") expect(COMPLAINT_ACTION[s.code], s.code).toBeTruthy();
    const codes = Object.keys(STAGE_PHASE);
    expect(codes.map(stepRank)).toEqual(codes.map((_, i) => i));
    expect(stepRank("added_later")).toBe(codes.length);
  });
});

describe("complaints queue grouping", () => {
  const list = [
    q({ id: "a", stage: "planning_costing", stage_label: "Costing", owner: "planning", days: 1 }),
    q({ id: "b", stage: "qc_review", days: 3 }),
    q({ id: "c", stage: "qc_review", days: 1, mine: true }),
    q({ id: "d", stage: "purchase", stage_label: "Purchase", phase: "purchase", owner: "purchase", overdue: true, days: 9 }),
    q({ id: "e", stage: "ready_for_dispatch", stage_label: "Ready for dispatch", phase: "dispatched", owner: "factory_dispatch" }),
    q({ id: "z", status: "closed", phase: "done", closed_at: 5 }),
    q({ id: "y", status: "closed", phase: "done", closed_at: 9 }),
  ];

  it("groups a phase by its detailed steps in flow order, your steps first", () => {
    const g = groupQueue(list, "open", "planning");
    expect(g.map((x) => x.label)).toEqual(["QC review", "Costing"]);
    expect(g[0]!.rows.map((r) => r.id)).toEqual(["c", "b"]);
    expect(g[0]!.mine).toBe(1);
  });

  it("shows every open step under All, and closed complaints newest first", () => {
    expect(groupQueue(list, "open", "all").map((x) => x.stage)).toEqual(["qc_review", "planning_costing", "purchase", "ready_for_dispatch"]);
    const closed = groupQueue(list, "closed", "all");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.rows.map((r) => r.id)).toEqual(["y", "z"]);
    expect(groupQueue(list, "open", "qc")).toEqual([]);
  });

  it("counts chips per phase and lands a person on the phase that holds their step", () => {
    const n = queueCounts(list);
    expect(n).toMatchObject({ open: 5, closed: 2, overdue: 1, mine: 1, byPhase: { planning: 3, purchase: 1, qc: 0, production: 0, dispatched: 1 } });
    expect(n.overdueByPhase.purchase).toBe(1);
    expect(landingPhase(list)).toBe("planning");
    expect(landingPhase(list.map((c) => ({ ...c, mine: false })))).toBe("all");
    expect(parseQueueFilter({}, list)).toEqual({ show: "open", phase: "planning" });
    expect(parseQueueFilter({ phase: "all" }, list)).toEqual({ show: "open", phase: "all" });
    expect(parseQueueFilter({ phase: "qc" }, list)).toEqual({ show: "open", phase: "qc" });
    expect(parseQueueFilter({ phase: "nonsense" }, list)).toEqual({ show: "open", phase: "planning" });
    expect(parseQueueFilter({ show: "closed", phase: "qc" }, list)).toEqual({ show: "closed", phase: "all" });
  });
});
