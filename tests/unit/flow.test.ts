import { describe, expect, it } from "vitest";
import { checkData, checkDefinition, groupsFor, resolveMove, stageOf, zFlowDefinition } from "@/domain/flow";
import { DEFAULT_COMPLAINT_FLOW, DEFAULT_DISPATCH_FLOW } from "@/domain/flow-defaults";

const ROLES = ["factory_dispatch", "installation_manager", "accounts", "qc", "planning", "management", "store", "purchase", "production", "packaging"];

describe("flow definitions", () => {
  it("ships valid default flows", () => {
    expect(checkDefinition(zFlowDefinition.parse(DEFAULT_DISPATCH_FLOW), ROLES)).toEqual([]);
    expect(checkDefinition(zFlowDefinition.parse(DEFAULT_COMPLAINT_FLOW), ROLES)).toEqual([]);
  });

  it("rejects unknown owners, backward 'next' links and missing stages", () => {
    const def = structuredClone(DEFAULT_DISPATCH_FLOW);
    def.stages[2]!.owner = "nobody";
    def.stages[3]!.next = "site_readiness";
    def.stages[4]!.backTo = ["nowhere"];
    const p = checkDefinition(def, ROLES).join(" ");
    expect(p).toMatch(/not a known role/);
    expect(p).toMatch(/must come later/);
    expect(p).toMatch(/does not exist/);
  });
});

describe("stage moves", () => {
  const site = stageOf(DEFAULT_DISPATCH_FLOW, "site_readiness")!;
  const store = stageOf(DEFAULT_COMPLAINT_FLOW, "store_check")!;
  const iqc = stageOf(DEFAULT_COMPLAINT_FLOW, "iqc")!;

  it("holds on Not ready and moves on Ready", () => {
    expect(resolveMove(site, { status: "not_ready" })).toEqual({ kind: "hold" });
    expect(resolveMove(site, { status: "ready" })).toEqual({ kind: "forward", to: "tax_invoice" });
  });

  it("branches the store check and sends IQC rejects back", () => {
    expect(resolveMove(store, { item_source: "fg_in_stock" })).toEqual({ kind: "forward", to: "ready_for_dispatch" });
    expect(resolveMove(store, { item_source: "to_purchase" })).toEqual({ kind: "forward", to: "purchase" });
    expect(resolveMove(iqc, { result: "reject" })).toEqual({ kind: "back", to: "purchase" });
  });

  it("requires conditional fields and files", () => {
    expect(checkData(site, { status: "not_ready" }).problems.join(" ")).toMatch(/Why it is not ready: required/);
    expect(checkData(site, { status: "ready" }).problems).toEqual([]);
    expect(checkData(site, { status: "maybe" }).problems.join(" ")).toMatch(/choose one/);
    const inv = stageOf(DEFAULT_DISPATCH_FLOW, "tax_invoice")!;
    expect(checkData(inv, { invoice_no: "INV-9" }).problems.join(" ")).toMatch(/Tax invoice: add at least 1/);
    expect(checkData(inv, { invoice_no: "INV-9" }, { invoice_file: 1 }).problems).toEqual([]);
  });
});

describe("dispatch types", () => {
  it("maps types to BOM groups and refuses D3 with its parts", () => {
    expect([...groupsFor(DEFAULT_DISPATCH_FLOW, ["D1", "D2"]).groups]).toEqual(["carcass", "shutters"]);
    expect([...groupsFor(DEFAULT_DISPATCH_FLOW, ["D3"]).groups]).toEqual(["countertop", "backsplash"]);
    expect(groupsFor(DEFAULT_DISPATCH_FLOW, ["D3", "D3b"]).problems.join(" ")).toMatch(/overlaps/);
    expect(groupsFor(DEFAULT_DISPATCH_FLOW, ["D9"]).problems.join(" ")).toMatch(/Unknown/);
  });
});
