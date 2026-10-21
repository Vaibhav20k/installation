/**
 * Source-system boundary for orders, items and components. No external CRM, estimator, PDA or
 * dispatch API schema is assumed: a live adapter must implement this interface once a documented
 * contract exists. The fixture adapter is explicitly labelled demo data and is never "live".
 */
export interface SourceComponent { externalId: string; name: string; quantity: string; unit: string; quantityKind: string; drawingVersion?: string; availableQuantity?: string }
export interface SourceItem { externalId: string; productType: string; name: string; components: SourceComponent[] }
export interface SourceOrderRecord {
  externalId: string;
  revision: string;
  customer: { externalId: string; name: string };
  /** Project business ID when already matched; unmatched projects are rejected for manual mapping. */
  projectBusinessId: string;
  order: { externalRef: string; promisedCompletion?: string | null; status?: "open" | "dispatched" | "partly_dispatched" };
  items: SourceItem[];
}

export interface SourceAdapter {
  system: string;
  label: string;
  /** True only for a connected, documented integration. */
  live: boolean;
  fetchOrders(): Promise<SourceOrderRecord[]>;
}

/** Steps generated per component kind when a new component is imported. */
export const STEPS_BY_KIND: Record<string, Array<"unpack" | "assemble" | "install">> = {
  carcass_count: ["unpack", "assemble", "install"],
  shutter_count: ["unpack", "assemble", "install"],
  cabinet_surface_area: ["install"],
  counter_surface_area: ["install"],
};
export const UNIT_BY_KIND: Record<string, string> = { carcass_count: "unit", shutter_count: "unit", cabinet_surface_area: "sqft", counter_surface_area: "sqft" };

export const demoFixtureAdapter: SourceAdapter = {
  system: "demo_fixture",
  label: "Demo fixture (not a live integration)",
  live: false,
  async fetchOrders() {
    return [
      {
        externalId: "FX-SO-1001", revision: "v2", customer: { externalId: "FX-C-1", name: "Demo Customer Mehta Family" }, projectBusinessId: "PRJ-001",
        order: { externalRef: "FX-SO-1001", status: "dispatched" },
        items: [{ externalId: "FX-OI-1", productType: "kitchen", name: "Modular kitchen", components: [
          { externalId: "FX-C-SHUTTERS", name: "Shutters", quantity: "14", unit: "unit", quantityKind: "shutter_count", drawingVersion: "DRG-B", availableQuantity: "6" },
        ] }],
      },
      {
        externalId: "FX-SO-2001", revision: "v1", customer: { externalId: "FX-C-2", name: "Demo Customer Rao Residence" }, projectBusinessId: "PRJ-003",
        order: { externalRef: "FX-SO-2001", promisedCompletion: "2026-12-15", status: "open" },
        items: [{ externalId: "FX-OI-21", productType: "utility", name: "Utility cabinets", components: [
          { externalId: "FX-C-21A", name: "Utility carcasses", quantity: "4", unit: "unit", quantityKind: "carcass_count", drawingVersion: "DRG-A" },
          { externalId: "FX-C-21B", name: "Utility shutters", quantity: "4", unit: "unit", quantityKind: "shutter_count", drawingVersion: "DRG-A" },
        ] }],
      },
      {
        externalId: "FX-SO-2002", revision: "v1", customer: { externalId: "FX-C-2", name: "Demo Customer Rao Residence" }, projectBusinessId: "PRJ-003",
        order: { externalRef: "FX-SO-2002", status: "open" },
        items: [{ externalId: "FX-OI-22", productType: "kitchen", name: "Island counter", components: [
          { externalId: "FX-C-22A", name: "Island stone", quantity: "18", unit: "unit", quantityKind: "counter_surface_area" },
        ] }],
      },
    ];
  },
};

export const ADAPTERS: Record<string, SourceAdapter> = { [demoFixtureAdapter.system]: demoFixtureAdapter };
