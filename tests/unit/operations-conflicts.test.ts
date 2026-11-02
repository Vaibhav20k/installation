/**
 * The screens built before the revised process must understand its stages once it is published: nothing may fall out
 * of the stage tiles, the complaint tracker must show the real step, and the workspace switch must still change the menu.
 */
import { describe, expect, it } from "vitest";
import { OPERATIONS_COMPLAINT, OPERATIONS_DISPATCH } from "@/domain/operations-flow";
import { chipPhases, phaseOf, phaseTrack } from "@/domain/complaint-phases";
import { imAction, tileFor } from "@/server/queries/im-pipeline";
import { dispatchTile, factoryDispatchAction, stepRank } from "@/server/queries/factory-pipeline";
import { activeGroup, groupOwner, phoneSlots, visibleGroups, type Viewer } from "@/components/nav-config";

const OPEN_DISPATCH = OPERATIONS_DISPATCH.stages.filter((s) => !s.terminal).map((s) => s.code);
// The dispatch rests at the step after creation; "packaging" is the create step itself.
const RESTING = OPEN_DISPATCH.filter((c) => c !== "packaging");

describe("stage tiles know every stage of the revised dispatch flow", () => {
  it("places every open stage on the Installation home", () => {
    for (const code of RESTING) expect(tileFor(code, ["D1"]), code).not.toBeNull();
  });
  it("shows payment and clearance as still at the factory, and the MND check as at site", () => {
    for (const code of ["ready_for_dispatch", "payment_request", "payment_check", "cleared"]) expect(tileFor(code, ["D1"]), code).toBe("ready");
    expect(tileFor("mnd_check", ["D1"])).toBe("received");
  });
  it("gives the Installation Manager a button for the MND check", () => {
    expect(imAction("mnd_check")).toBe("Do MND check");
    expect(imAction("received")).toBe("Mark received");
  });
  it("places every factory-side stage on the Factory home", () => {
    expect(dispatchTile("ready_for_dispatch")).toBe("packing");
    expect(dispatchTile("payment_request")).toBe("accounts");
    expect(dispatchTile("payment_check")).toBe("accounts");
    expect(dispatchTile("cleared")).toBe("load");
    expect(dispatchTile("mnd_check")).toBeNull(); // the site's step
  });
  it("names the button for each revised factory step", () => {
    expect(factoryDispatchAction("ready_for_dispatch")).toBe("Mark ready");
    expect(factoryDispatchAction("payment_request")).toBe("Request payment check");
    expect(factoryDispatchAction("payment_check")).toBe("Confirm payment");
    expect(factoryDispatchAction("cleared")).toBe("Clear for dispatch");
    expect(factoryDispatchAction("dispatched")).toBe("Record dispatch");
  });
});

describe("the complaint tracker shows the real step in the revised flow", () => {
  const track = (stage: string, owner: string, itemSource?: string) => phaseTrack({ stage, status: "open", owner, itemSource, operations: true });
  const labels = (stage: string, owner: string, src?: string) => track(stage, owner, src).steps.map((s) => s.label);
  it("draws five dots: Planning, Purchase, Production, QA, Dispatched", () => {
    expect(labels("qc_review", "qc")).toEqual(["Planning", "Purchase", "Production", "QA", "Dispatched"]);
  });
  it("places every stage in a phase without using the Planning fallback for later steps", () => {
    expect(phaseOf("qc_handoff", "qc")).toBe("planning");
    expect(phaseOf("store_receipt", "store")).toBe("purchase");
    expect(phaseOf("qa_review", "qa")).toBe("qa");
    for (const s of OPERATIONS_COMPLAINT.stages) expect(phaseOf(s.code, s.owner, s.terminal), s.code).toBeTruthy();
  });
  it("says QA is holding a complaint at QA Review, not the Planning team", () => {
    const t = track("qa_review", "qa");
    expect(t.phase).toBe("qa");
    expect(t.waitingFor).toBe("QA");
    expect(t.steps.find((s) => s.code === "qa")!.state).toBe("current");
  });
  it("names the approver the cost tier routed to", () => {
    expect(track("management_approval", "founders_office").waitingFor).toBe("Founder's Office");
  });
  it("marks the supply routes not taken as skipped", () => {
    const state = (src: string, stage: string, owner: string, code: string) => track(stage, owner, src).steps.find((s) => s.code === code)!.state;
    expect(state("fg_in_stock", "qa_review", "qa", "purchase")).toBe("skipped");
    expect(state("fg_in_stock", "qa_review", "qa", "production")).toBe("skipped");
    expect(state("to_purchase", "qa_review", "qa", "production")).toBe("skipped");
    expect(state("manufacture", "qa_review", "qa", "purchase")).toBe("skipped");
    expect(state("manufacture", "qa_review", "qa", "production")).toBe("done");
  });
  it("says a closed complaint was installed, and leaves the old flow's five dots alone", () => {
    expect(phaseTrack({ stage: "closed", status: "closed", operations: true }).says).toMatch(/installed/i);
    expect(phaseTrack({ stage: "iqc", status: "open" }).steps.map((s) => s.label)).toEqual(["Planning", "Purchase", "QC", "Production", "Dispatched"]);
  });
  it("offers filter chips for the active flow, plus any phase an old record is still in", () => {
    const n = { planning: 0, purchase: 0, qc: 0, production: 0, qa: 0, dispatched: 0 };
    expect(chipPhases(true, n).map((p) => p.code)).toEqual(["planning", "purchase", "production", "qa", "dispatched"]);
    expect(chipPhases(true, { ...n, qc: 1 }).map((p) => p.code)).toEqual(["planning", "purchase", "qc", "production", "qa", "dispatched"]);
    expect(chipPhases(false, n).map((p) => p.code)).toEqual(["planning", "purchase", "qc", "production", "dispatched"]);
  });
  it("sorts the revised steps into flow order in the Factory queue", () => {
    expect(stepRank("planning_costing")).toBeLessThan(stepRank("qc_handoff"));
    expect(stepRank("qc_handoff")).toBeLessThan(stepRank("planning_replacement"));
    expect(stepRank("purchase")).toBeLessThan(stepRank("store_receipt"));
    expect(stepRank("packaging")).toBeLessThan(stepRank("qa_review"));
    expect(stepRank("qa_review")).toBeLessThan(stepRank("ready_for_dispatch"));
  });
});

describe("the workspace switch still changes the menu in the revised flow", () => {
  const admin = (ws: "installation" | "factory"): Viewer => ({ role: "admin", flow: false, flowRoles: [], ws, operations: true });
  const ids = (v: Viewer) => visibleGroups(v).map((g) => g.id);
  it("shows the process menu on Installation and factory work on Factory", () => {
    expect(ids(admin("installation"))).toEqual(["home", "sites", "dispatch", "complaints", "siteplans", "team", "reports", "setup"]);
    expect(ids(admin("factory"))).toEqual(["home", "fdispatch", "complaints", "reports", "setup"]);
  });
  it("follows the side on the phone bar", () => {
    expect(phoneSlots(admin("factory"), visibleGroups(admin("factory"))).map((g) => g.id)).toEqual(["home", "fdispatch", "complaints", "reports"]);
    expect(phoneSlots(admin("installation"), visibleGroups(admin("installation"))).map((g) => g.id)).toEqual(["home", "sites", "dispatch", "team"]);
  });
  it("moves to the side a page lives on", () => {
    expect(groupOwner("/site-plans", admin("factory"))).toBe("installation");
    expect(groupOwner("/dispatch/setup", admin("installation"))).toBeNull();
    expect(activeGroup(visibleGroups(admin("factory")), "/complaints")?.id).toBe("complaints");
  });
});

describe("Ready for dispatch follows the role that owns the step", () => {
  const tabs = (flowRoles: string[]) => visibleGroups({ role: "employee", flow: true, flowRoles, ws: "factory", operations: true }).find((g) => g.id === "fdispatch")!.tabs.map((t) => t.href);
  it("shows the tab to the new Factory role and the old Factory/Dispatch role, and not to others", () => {
    expect(tabs(["factory"])).toContain("/dispatch/new");
    expect(tabs(["factory_dispatch"])).toContain("/dispatch/new");
    expect(tabs(["dispatch_department"])).not.toContain("/dispatch/new");
  });
});
