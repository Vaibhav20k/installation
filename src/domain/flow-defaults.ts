/**
 * Version 1 of each flow, written into flow_config the first time the flow is used. After that the stored
 * definition is the source of truth and an administrator edits it in Dispatch setup; this file is only the start.
 */
import type { FlowDefinition } from "./flow";

const notes = { key: "notes", label: "Notes", type: "longtext" as const };

export const DEFAULT_DISPATCH_FLOW: FlowDefinition = {
  flow: "dispatch",
  dispatchTypes: [
    { code: "D1", label: "Carcass", groups: ["carcass"] },
    { code: "D2", label: "Shutters", groups: ["shutters"] },
    { code: "D3", label: "Countertop + backsplash", groups: ["countertop", "backsplash"] },
    { code: "D3a", label: "Countertop", groups: ["countertop"] },
    { code: "D3b", label: "Backsplash", groups: ["backsplash"] },
  ],
  factories: ["Main factory"],
  stages: [
    { code: "ready_for_dispatch", label: "Ready for dispatch", owner: "factory_dispatch", handler: "create", fields: [], next: "site_readiness" },
    {
      code: "site_readiness", label: "Site readiness", owner: "installation_manager", slaDays: 2, remindDaysBefore: 1,
      fields: [
        { key: "status", label: "Site status", type: "select", required: true, options: [{ value: "ready", label: "Ready" }, { value: "not_ready", label: "Not ready" }] },
        { key: "reason", label: "Why it is not ready", type: "longtext", requiredWhen: { field: "status", equals: "not_ready" } },
        { key: "expected_date", label: "Expected ready date", type: "date", requiredWhen: { field: "status", equals: "not_ready" }, help: "A reminder goes to the Installation Manager the day before." },
      ],
      branches: [{ when: { field: "status", equals: "not_ready" }, hold: true }],
      next: "tax_invoice",
    },
    {
      code: "tax_invoice", label: "Tax invoice", owner: "accounts", slaDays: 2, backTo: ["site_readiness"],
      fields: [{ key: "invoice_no", label: "Invoice number", type: "text", required: true }, { key: "invoice_file", label: "Tax invoice", type: "files", accept: "photo_or_document", required: true }],
      next: "eway_bill",
    },
    {
      code: "eway_bill", label: "E-way bill", owner: "accounts", slaDays: 1, backTo: ["tax_invoice"],
      fields: [{ key: "eway_no", label: "E-way bill number", type: "text", required: true }, { key: "eway_file", label: "E-way bill", type: "files", accept: "photo_or_document", required: true }],
      next: "dispatched",
    },
    {
      code: "dispatched", label: "Dispatched", owner: "factory_dispatch", slaDays: 2, backTo: ["eway_bill", "tax_invoice", "site_readiness"],
      fields: [
        { key: "vehicle_no", label: "Vehicle number", type: "text", required: true },
        { key: "driver", label: "Driver name and phone", type: "text", required: true },
        { key: "dispatch_date", label: "Dispatch date", type: "date", required: true },
      ],
      next: "received",
    },
    { code: "received", label: "Received & MND", owner: "installation_manager", handler: "receive_mnd", slaDays: 3, backTo: ["dispatched"], fields: [], next: "installation_started" },
    { code: "installation_started", label: "Installation started", owner: "installation_manager", handler: "install_start", slaDays: 3, fields: [{ key: "start_date", label: "Start date", type: "date", required: true }, notes], next: "installation_done" },
    {
      code: "installation_done", label: "Installation done", owner: "installation_manager", handler: "install_done", slaDays: 10, backTo: ["installation_started"],
      fields: [{ key: "photos", label: "Completion photos", type: "files", accept: "photo", required: true }, notes],
      next: "completed",
    },
    { code: "completed", label: "Completed", owner: "system", terminal: true, fields: [] },
  ],
};

export const DEFAULT_COMPLAINT_FLOW: FlowDefinition = {
  flow: "complaint",
  stages: [
    { code: "qc_review", label: "QC review", owner: "qc", slaDays: 1, fields: [{ key: "review", label: "Review notes", type: "longtext", required: true }], next: "planning_costing" },
    { code: "planning_costing", label: "Costing", owner: "planning", handler: "cost", slaDays: 2, backTo: ["qc_review"], fields: [{ key: "cost", label: "Replacement cost (₹)", type: "number", required: true }, notes], next: "management_approval" },
    {
      code: "management_approval", label: "Management approval", owner: "management", handler: "approve_cost", slaDays: 2,
      fields: [
        { key: "decision", label: "Decision", type: "select", required: true, options: [{ value: "approve", label: "Approve cost" }, { value: "reject", label: "Reject cost (back to costing)" }] },
        { key: "reason", label: "Reason", type: "longtext", requiredWhen: { field: "decision", equals: "reject" } },
      ],
      branches: [{ when: { field: "decision", equals: "reject" }, to: "planning_costing", back: true }],
      next: "planning_replacement",
    },
    { code: "planning_replacement", label: "Replacement plan", owner: "planning", slaDays: 2, fields: [{ key: "plan", label: "Replacement plan", type: "longtext", required: true }, { key: "target_date", label: "Target dispatch date", type: "date", required: true }], next: "store_check" },
    {
      code: "store_check", label: "Store check", owner: "store", slaDays: 1,
      fields: [{ key: "item_source", label: "Item type", type: "select", required: true, options: [{ value: "fg_in_stock", label: "Finished good in stock" }, { value: "raw_material", label: "Raw material" }, { value: "to_purchase", label: "To be purchased" }] }, notes],
      branches: [{ when: { field: "item_source", equals: "fg_in_stock" }, to: "ready_for_dispatch" }],
      next: "purchase",
    },
    { code: "purchase", label: "Purchase", owner: "purchase", slaDays: 7, fields: [{ key: "po_ref", label: "Purchase order reference", type: "text", required: true }, { key: "expected_date", label: "Expected delivery", type: "date", required: true }], next: "iqc" },
    {
      code: "iqc", label: "Incoming QC", owner: "qc", slaDays: 1,
      fields: [
        { key: "result", label: "Result", type: "select", required: true, options: [{ value: "pass", label: "Pass" }, { value: "reject", label: "Reject (back to purchase)" }] },
        { key: "reason", label: "Reason", type: "longtext", requiredWhen: { field: "result", equals: "reject" } },
      ],
      branches: [{ when: { field: "result", equals: "reject" }, to: "purchase", back: true }],
      next: "store_issue",
    },
    { code: "store_issue", label: "Store issue", owner: "store", slaDays: 1, fields: [notes], next: "production" },
    { code: "production", label: "Production", owner: "production", slaDays: 5, fields: [notes], next: "packaging" },
    { code: "packaging", label: "Packaging", owner: "packaging", slaDays: 1, fields: [notes], next: "ready_for_dispatch" },
    { code: "ready_for_dispatch", label: "Ready for dispatch", owner: "factory_dispatch", handler: "create_replacement", slaDays: 1, fields: [], next: "awaiting_replacement" },
    { code: "awaiting_replacement", label: "Replacement on its way", owner: "system", handler: "await_replacement", fields: [], next: "closed" },
    { code: "closed", label: "Closed", owner: "system", terminal: true, fields: [] },
  ],
};

export const DEFAULT_FLOWS = { dispatch: DEFAULT_DISPATCH_FLOW, complaint: DEFAULT_COMPLAINT_FLOW } as const;
