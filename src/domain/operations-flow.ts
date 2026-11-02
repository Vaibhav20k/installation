import type { FlowDefinition, StageSpec } from './flow';
import { DEFAULT_DISPATCH_FLOW } from './flow-defaults';
export const ROOT_CAUSES = ['factory', 'packing', 'transport', 'design', 'installation', 'client_requirement', 'other'] as const;
const text = (key: string, label: string) => ({ key, label, type: 'longtext' as const, required: true });
const date = (key: string, label: string) => ({ key, label, type: 'date' as const, required: true });
const select = (key: string, label: string, options: string[]) => ({ key, label, type: 'select' as const, required: true, options: options.map(value => ({ value, label: value.replaceAll('_', ' ') })) });
const step = (code: string, label: string, owner: string, next: string, fields: StageSpec['fields'] = [], handler?: StageSpec['handler']): StageSpec => ({ code, label, owner, next, fields, handler });
export const OPERATIONS_DISPATCH: FlowDefinition = {
    ...DEFAULT_DISPATCH_FLOW, protocol: 'operations_v1', stages: [
        step('packaging', 'Packaging', 'factory', 'ready_for_dispatch', [], 'create'),
        step('ready_for_dispatch', 'Ready for Dispatch', 'factory', 'site_readiness'),
        { ...DEFAULT_DISPATCH_FLOW.stages[1]!, next: 'payment_request' },
        step('payment_request', 'Request payment confirmation', 'dispatch_department', 'payment_check'),
        { ...step('payment_check', 'Awaiting Payment', 'finance', 'tax_invoice', [select('decision', 'Payment', ['received', 'not_received']), text('note', 'Finance note')]), branches: [{ when: { field: 'decision', equals: 'not_received' }, hold: true }] },
        { ...DEFAULT_DISPATCH_FLOW.stages[2]!, backTo: [] },
        { ...DEFAULT_DISPATCH_FLOW.stages[3]!, next: 'cleared', backTo: [] },
        step('cleared', 'Cleared for dispatch', 'dispatch_department', 'dispatched'),
        { ...DEFAULT_DISPATCH_FLOW.stages[4]!, owner: 'dispatch_department', next: 'received', backTo: [] },
        step('received', 'Confirm receipt', 'installation_manager', 'mnd_check'),
        step('mnd_check', 'MND check', 'installation_manager', 'installation_started', [], 'receive_mnd'),
        { ...DEFAULT_DISPATCH_FLOW.stages[6]! },
        { ...DEFAULT_DISPATCH_FLOW.stages[7]!, backTo: [] },
        { ...DEFAULT_DISPATCH_FLOW.stages[8]!, label: 'Installation Done' },
    ]
};
export const OPERATIONS_COMPLAINT: FlowDefinition = { flow: 'complaint', protocol: 'operations_v1', stages: [
        step('qc_review', 'QC Review', 'qc', 'planning_costing', [text('review', 'QC review')]),
        step('planning_costing', 'Costing', 'planning', 'management_approval', [{ key: 'cost', label: 'Replacement cost (₹)', type: 'number', required: true }], 'cost'),
        { ...step('management_approval', 'Pending Approval', 'installation_manager', 'qc_handoff', [select('decision', 'Decision', ['approve', 'reject']), text('reason', 'Decision comment')], 'approve_cost'), branches: [{ when: { field: 'decision', equals: 'reject' }, to: 'planning_costing', back: true }] },
        step('qc_handoff', 'Approved · QC handoff', 'qc', 'planning_replacement', [text('note', 'Handoff note')]),
        step('planning_replacement', 'Planning', 'planning', 'store_check', [text('plan', 'Replacement plan'), date('target_date', 'Target date')]),
        { ...step('store_check', 'Store Check', 'store', 'purchase', [select('item_source', 'Supply route', ['fg_in_stock', 'to_purchase', 'manufacture'])]), branches: [{ when: { field: 'item_source', equals: 'fg_in_stock' }, to: 'qa_review' }, { when: { field: 'item_source', equals: 'manufacture' }, to: 'production' }] },
        step('purchase', 'Purchase', 'purchase', 'store_receipt', [text('po_ref', 'Purchase order reference'), date('expected_date', 'Expected delivery')]),
        step('store_receipt', 'Store receipt', 'store', 'qa_review', [text('receipt_ref', 'Receipt reference'), date('received_date', 'Received date')]),
        step('production', 'Production', 'production', 'packaging', [text('job_ref', 'Production job reference')]),
        step('packaging', 'Packaging', 'packaging', 'qa_review', [text('note', 'Packaging confirmation')]),
        step('qa_review', 'QA Review', 'qa', 'ready_for_dispatch', [select('root_cause', 'Final root cause', [...ROOT_CAUSES]), text('preventive_action', 'Preventive action')]),
        step('ready_for_dispatch', 'Dispatch complaint material', 'dispatch_department', 'awaiting_replacement', [], 'create_replacement'),
        step('awaiting_replacement', 'Awaiting replacement receipt and installation', 'system', 'closed', [], 'await_replacement'),
        { code: 'closed', label: 'Closed', owner: 'system', terminal: true, fields: [] },
    ] };
