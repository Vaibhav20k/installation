# Installation process audit — 31 October 2026

Scope: compare the existing application with the attached installation-process brief. This is the requested audit and gap report, not an implementation plan or a code change. Existing features and operational data have not been modified.

Evidence: source services, migrations 001–018, flow definitions, permission checks, routes, forms, queries, and focused integration tests. This is a source-level audit with automated verification of existing behavior; no live browser/mobile walkthrough or production-database inspection was performed. Stored `flow_config` definitions can differ from the defaults examined here, and existing records retain their original configuration version. Therefore findings about configured stage order describe the repository defaults, not a verified deployment configuration.

Legend: ✅ Exists and correct for the specified behavior; ⚠️ Exists but differs or is incomplete; ❌ Missing from the inspected implementation. A passing existing test does not establish compliance with the new brief.

## Overall finding

Extend this app rather than rebuild it. It already provides a substantial foundation: orders and BOM, versioned dispatch/complaint workflows, receipt evidence, department queues, scoped record pages, planning revisions, staff reservations, attendance, site presence, expenses, budgets, notifications and history.

The most consequential gaps are a dispatch-specific payment gate, configurable cost-tier approvals, mandatory outbound QA with preventive action, complaint closure after installation, workforce regularization, and completion notifications to Factory. Existing visit clearance is not dispatch-payment confirmation; incoming QC is not outbound QA; existing quality-case root causes are not integrated complaint QA.

## Process 1 — normal installation

| Step | Status | What exists (file/table/screen) | What must change |
|---|---|---|---|
| Multiple dispatches per order | ⚠️ | `db/migrations/014_dispatch_flow.sql`: `dispatch.order_id`, types D1/D2/D3; `src/server/services/dispatch.ts` | Add an order-local sequence. Current D1/D2/D3 codes are product groups, not a reliable Dispatch 1/2/3 sequence. Preserve existing IDs/types. |
| 1. Factory marks RFD and selects IM | ⚠️ | `createDispatch`; `/dispatch/new`; `project.manager_id`; combined `factory_dispatch` role | Add explicit IM selection/assignment validation and normal packaging stage. Factory and Dispatch are currently one role. Creation immediately advances from RFD to site readiness. |
| 2. IM notified; Ready/Not Ready with reason/date | ✅ | `src/domain/flow-defaults.ts`; `advanceDispatch`; `notifyStage`; `scheduleReminder` | Retain scoped notification, required reason/future expected date and readiness hold. Current reminder targets IM before expected readiness. |
| 3. Dispatch requests payment check | ❌ | Default flow proceeds to Accounts tax invoice and e-way bill; visit clearance is separate | Add dispatch-linked payment request, owner and task for Finance. Preserve invoice/e-way features. |
| 4. Finance records Received/Not received + note | ❌ | No dispatch-payment decision in `dispatch.ts` or default flow | Add an explicit Finance decision and audit trail. Do not infer payment from an invoice. |
| 5. Dispatch requires BOTH gates | ⚠️ | Readiness blocks the default linear flow; `advanceDispatch` enforces current configured stage | Enforce readiness AND payment atomically on dispatch, independently of editable stage layout; show each unresolved gate and owner. |
| 6. IM marks received | ⚠️ | `receiveDispatch`; `ReceiveForm.tsx`; stage “Received & MND” | Separate receipt acknowledgement from MND completion if matching the specified distinct states. Current receipt and checklist are one transaction. |
| 7. Full packing-list BOM checklist | ⚠️ | `dispatch_item` references `component`; `ReceiveForm` checks every listed line | Preserve/reconcile dispatch BOM as the packing list. Existing `withoutList` dispatches and unlisted-item reporting intentionally allow no factory list; this conflicts with mandatory full BOM and needs explicit migration policy. |
| 7. OK/Missing/Damaged with quantity | ✅ | `receiveDispatch` validates every line and affected quantity | Retain server-side completeness and quantity checks. |
| 7. Damaged requires photo | ✅ | `readyFiles` + `receiveDispatch` reject missing/unready image uploads | Retain the server gate. |
| 7. Missing photo rule / progressive controls | ⚠️ | Photos and reason required for both missing and damaged lines; checkbox reveals issue radios and upload | Brief requires a photo for damaged only. Decide whether to retain the stricter missing rule; adapt to three prominent choices and conditional upload behavior. |
| 7. Everything OK in one tap | ✅ | `ReceiveForm.tsx`: listed lines start OK and one receipt submission confirms them | Retain explicit whole-list confirmation. |
| 7. Automatic complaint creation | ✅ | `openComplaint` creates one complaint per affected item and links photos to history | Retain transactionally linked complaints. Add missing observer notifications described below. |
| 7. Installation can proceed with complaints | ✅ | `receiveDispatch` advances to installation; `advanceDispatch` flags partial/open complaints | Retain IM-controlled start action while complaints remain open. |
| 8. Installation started, then done | ✅ | `install_start`/`install_done` handlers and owner checks | Retain enforced progression and completion evidence; unify labels with the target state vocabulary. |
| 9. Done notifies Factory for next dispatch | ❌ | Done advances to terminal `completed`; `notifyStage` skips terminal/system stages | Emit a separate completion event to Factory with order and next-dispatch context; add subsequent packaging task. |

## Process 2 — workforce, attendance and man-hours

| Step | Status | What exists (file/table/screen) | What must change |
|---|---|---|---|
| 1. Plan selects one or more sites | ⚠️ | `plan.project_id`, `visit.project_id`; `planning.ts`; `NewPlanForm.tsx` selects one project | Support a multi-site planning experience while preserving existing per-site plans and visits. Do not duplicate the planning subsystem. |
| 1. Date range and multiple staff | ✅ | Visit planned dates; `reservation`; `TeamStep.tsx`; `booking.ts` | Reuse date and staffing controls, availability and overlapping-booking protection. |
| 1. Staff dropdown filtered by designation master | ⚠️ | Employee master, job-role enum, skills and manual/suggested teams | Add configurable designation master and filter. Electrician/measurement roles are not represented as the requested configurable designation list. |
| 1. Approval and budget | ⚠️ | `plan_revision` approval; manager review with self-approval prohibition; `budget`, `estimate`; visit booking clearance | Reuse approvals/budgets but add configurable routing and explicit workforce-budget enforcement. Existing plan approval does not itself enforce the requested budget. |
| 2. Assignment notifications | ❌ | No assignment/change notification emission found in planning, booking or site-work services | Notify affected staff on approved assignment and changes, linking to their dated task. |
| 2. Punch in/out with time | ✅ | `attendance.ts` shift events; `site-presence.ts` site check-in/out; `/my-day`, `/attendance` | Reuse server timestamps, booking checks, duplicate/overlap protection and corrections. |
| 2. Location on every punch | ❌ | Site identity is recorded, but punch inputs/tables do not capture geographic coordinates | Capture location, accuracy and capture time for both entry and exit. A stored site address is not a punch location. |
| 3. Unselect a day for all staff or one person | ❌ | Schedules, reservation releases, work-item rescheduling, attendance corrections exist | Add explicit day exclusions at whole-plan and person level. These existing actions do not implement the specified operation. |
| 3. Reason, audit and approval for regularization | ⚠️ | Audit/reason patterns, plan revisions and attendance correction decisions | Add a regularization request/decision lifecycle and apply approved changes to planned effort without removing attendance evidence. |
| 4. IM confirms man-hours after completion | ⚠️ | Time entries, monthly reconciliation and site-presence summaries | Add completion-linked confirmation with traceability to punches and approved corrections. Monthly reconciliation is a different process. |
| 4. Planned vs actual hours and preset budget | ⚠️ | `assignment-metrics.ts` effort variance; `site-ops.ts` presence summaries; cost tracker project budgets | Connect these into one site/installation comparison including approved exclusions and the configured normal/complaint budget formulas. |
| 5. Same planning for complaint installation | ⚠️ | Follow-up/rework visit types and existing planning can be reused | Explicitly link complaint/replacement dispatch to the installation visit and assignments; require installation completion before normal complaint closure. |

## Process 3 — MND complaint journey

| Step | Status | What exists (file/table/screen) | What must change |
|---|---|---|---|
| Initial issue and photos retained | ✅ | `complaint.kind`, quantity/reason, component/order/dispatch links; evidence on `stage_history` | Preserve original report when QA later records its own conclusion. |
| 1. QC receives complaint | ✅ | Default first stage `qc_review`; `openComplaint` notifies owner role | Retain QC queue and actionable record link. |
| 2. QC requests Planning costing | ✅ | `qc_review → planning_costing`; cost handler persists amount/cost author | Retain costing and audit evidence; add notification back to QC after costing. |
| 3. Three configurable approval tiers | ❌ | Default single `management_approval` owner; no cost-dependent role routing | Add Admin-managed threshold policy and IM/Founder's Office/Owners routing. Existing flow editing is not numeric approval-tier logic. |
| 3. Decision screen with evidence/context | ⚠️ | Complaint detail has item, order, cost, evidence/history; `StageForm` approve/reject; self-cost approval blocked | Reuse record screen; show applicable tier/approver and require comments as specified. Rejection currently loops to costing, and approval comment is not mandatory. |
| 4. Approved → QC → Planning → Store | ⚠️ | Approval directly advances to Planning replacement, then Store | Add QC handoff and its task/notification while preserving cost approval evidence. |
| 5a. Stock available → QA | ⚠️ | Stock branch jumps directly to `ready_for_dispatch` | Insert mandatory QA before replacement shipment. |
| 5b. Purchase → Store receipt → QA | ⚠️ | Purchase captures PO reference/date, then IQC, Store issue, Production, Packaging | Model receipt and a purchased-finished-goods path to QA without forced manufacture. No standalone purchase-order lifecycle was found. |
| 5c. Manufacture → Production → Packaging → QA | ⚠️ | Production/packaging stages exist; raw-material route goes through Purchase | Add an explicit manufacturing branch and inventory-aware routing; insert outbound QA after packaging. Preserve useful incoming-QC behavior. |
| 6. Branch status and dates | ⚠️ | `stage_history`, current stage/time, source field and tracker | Reuse stage events; add the missing branches, receipt/production milestones and branch-specific dates. |
| 7. Mandatory final QA root cause | ❌ | Incoming QC is pass/reject only. Separate `quality_case` has root-cause/corrective-action fields | Link/reuse quality-case concepts for complaint QA, add final category and actor/time, and enforce completion before dispatch. |
| 7. Preventive action / project | ⚠️ | `quality_case` corrective action and `issue` action tracking in `quality.ts` | Extend/reuse action tracking for complaint-linked preventive action, owner, steps, deadline and Open → In Progress → Done → Verified. No complete preventive project lifecycle exists. |
| 8. Dispatch complaint material | ⚠️ | `createReplacement` creates linked replacement dispatch through normal flow | Retain dispatch reuse; gate it on complaint QA and payment/readiness policy. |
| 9. Receive and repeat MND | ✅ | Replacement uses `receiveDispatch`; repeat issue opens successor complaint with `superseded_by` link | Retain evidence and replacement lineage. |
| 9. Assign staff and install before closure | ❌ | `settleReplacement` closes original complaint immediately on receipt or supersedes it | Add Received → Installed → Closed behavior and plan linkage. Do not reinterpret historical closed complaints as installed. |
| 10. IM read-only factory journey | ✅ | `/complaints`, `/dispatch/complaints/[id]`, `complaint-tracker.ts`, scoped detail/history and owner-only actions | Retain existing factory-stage visibility. Full target journey will depend on adding missing stages. |
| 10. Installation Head sees all IM sites | ❌ | Admin sees all; no dedicated Installation Head role/scoping | Add explicit cross-IM read access without requiring Admin or unrelated factory-department permissions. |
| 10. Owner and elapsed time at each stage | ⚠️ | Current owner/waiting message, current age, timestamps and phase tracker | Add explicit duration for every completed/revisited step and identify accountable owners. |

## Roles, state models, information architecture and audit

| Step | Status | What exists (file/table/screen) | What must change |
|---|---|---|---|
| Department/approver roles | ⚠️ | `flow_role`, `flow_role_member`: Factory/Dispatch, IM, Accounts, QC, Planning, Management, Store, Purchase, Production, Packaging | Add/split Factory, Dispatch, Finance, QA, Installation Head, Founder's Office and Owners with explicit migration of memberships. Preserve existing permission-role and job-role distinctions. |
| Dispatch state machine | ⚠️ | Versioned default flow + stage/version locks, required fields, forward/back validation | Add Packaging, payment/clearance and separate receipt/MND semantics. Existing `stage` generally denotes the task awaiting completion, so do not blindly rename it as an accomplished milestone. |
| Complaint state machine | ⚠️ | Versioned complaint flow, audited branching, rejection back to costing | Add tier approval, QC handoff, corrected branches, QA, installation and closure semantics. Preserve prior history and versions. |
| Site Plan state machine | ⚠️ | Separate approval, visit execution, reservation and timesheet states in `lifecycle.ts` | Expose target plan lifecycle over existing dimensions; add regularization and man-hours confirmation rather than flattening away useful states. |
| Preventive Action Project state machine | ❌ | No complete requested state machine | Extend existing action model with required states, transition ownership and verification. |
| My Tasks first for every role | ⚠️ | `/my-tasks` exists; `/` renders installation dashboard/pipeline or Factory overview | Make a unified role-specific actionable queue the landing experience. Current My Tasks is centered on visit assignments. |
| IM navigation | ⚠️ | `nav-config.ts` groups Home, Sites, Dispatch, My work, Inbox, Time & money, People, Reports | Reorganize to requested labels/objects while preserving URLs and access to existing features. |
| Other roles see own queue + read-only context | ⚠️ | Owner-only workflow writes; factory roles have cross-project flow visibility | Add own-queue defaults and confirm department visibility boundaries. Current `flowVisibility` gives every non-IM flow role visibility across projects. |
| Canonical records and timelines | ⚠️ | Dispatch/complaint canonical routes and shared Stepper/Timeline; project and visit records | Reuse routes. Place status/timeline before details consistently; avoid divergent installation/visit presentations and add canonical plan/action records where needed. |
| Consistent status labels | ⚠️ | Definitions supply stage labels; additional five-phase complaint tracker labels exist | Define a consistent vocabulary and explicitly distinguish grouped phases, pending tasks and completed milestones. |
| Site-scoped access | ⚠️ | `permissions.ts` project/employee scope; `flow-core.ts` read/write checks | Retain server checks; add Installation Head scope and review broad department visibility against the new assignment rule. |
| One clear primary action, blocked owner | ⚠️ | Stage forms, Waiting for owner messages, booking blockers | Reuse good stage pattern; apply to composite workforce screens with several prominent actions and add gate-specific Finance/readiness explanations. |
| Prefill and progressive disclosure | ⚠️ | BOM lines, linked order/site context, team suggestions, dynamic issue controls | Reuse known data; streamline designation selection, approval context and receipt controls. |
| Mobile-first field use | ⚠️ | Phone navigation, responsive styles, receipt uploads, attendance camera | Existing foundations; GPS capture is absent. One-handed usability and accessibility require a browser/device verification pass, not a source-only claim. |
| Every status change in audit log | ⚠️ | Append-only `audit_event`, `stage_history`; transactional `recordStage` writes both | Verify all new transitions and unify event coverage. `openComplaint` writes stage history but no separate complaint-create `audit_event`; work-item completion/rescheduling uses its own event table. Decide whether the acceptance criterion permits these ledgers or requires one unified view. |

## Notification coverage

The existing mechanism sends deduplicated in-app notifications with canonical record links to the next stage's owner. It does not automatically notify observers or emit terminal-stage notifications.

| Step | Status | What exists (file/table/screen) | What must change |
|---|---|---|---|
| RFD → IM | ✅ | `insertDispatch → notifyStage` | Retain and connect explicit IM assignment. |
| Readiness submitted → Dispatch | ⚠️ | Ready advances to Accounts; Not Ready records hold/reminder | Add Dispatch observer notification for either result. |
| Payment request → Finance; confirmation → Dispatch | ❌ | No payment-check workflow | Add both events. |
| Dispatched → IM | ✅ | Next stage is IM receipt | Retain. |
| Received → prompt MND | ⚠️ | Combined receipt/MND form | Add task when receipt and inspection become separate events. |
| Complaint raised → QC + Installation Head | ⚠️ | QC receives task | Add Installation Head observer. |
| Costing done → QC | ❌ | Next owner is Management | Add QC notification. |
| Approval needed → correct tier | ⚠️ | Management receives stage task | Replace fixed recipient with configured tier routing. |
| Approved/Rejected → QC + IM | ❌ | Next stage owner receives notification instead | Add both observers on both outcomes. |
| Stock/purchase/production updates → IM | ⚠️ | IM can inspect timeline; next owner is notified | Add IM progress notifications linking to affected complaint. |
| QA done → Dispatch | ❌ | No final QA stage | Add event with QA result. |
| Complaint material dispatched → IM | ✅ | Linked replacement runs dispatch notification flow | Retain. |
| Installation done → Factory | ❌ | Terminal stage notification suppressed | Add explicit Factory event independent of next-stage notification. |
| Plan assigned/changed → staff | ❌ | No emitter in reviewed planning/booking services | Add deduplicated per-person assignment/change notifications. |
| Regularization request → approver | ❌ | No regularization workflow | Add policy-routed request notification. |

## Reports

| Step | Status | What exists (file/table/screen) | What must change |
|---|---|---|---|
| Final QA cause vs initial IM report + mismatch | ❌ | FTR tracker uses separate `quality_case`; MND complaints have initial kind/reason | Add linked QA classification and explicit mismatch logic; do not directly compare missing/damaged with factory/transport categories as though they were the same taxonomy. |
| Repetitive item/category issues over time | ⚠️ | Item-linked complaint records and existing quality/report queries | Add recurrence aggregation, date filters and agreed item/category grouping. |
| Time at each complaint step and current owner | ⚠️ | History timestamps, current age/owner and phase tracker | Add per-step duration reporting, including revisits/holds and current open interval. |
| Planned vs actual man-hours/budget per site | ⚠️ | Effort variance, site presence, time reports and project cost/budget tracker | Integrate punch-derived hours, approved regularization and separate complaint/main-installation budgets. |
| Open preventive projects with owner/deadline | ⚠️ | Issue/action tracking has related fields | Add linked preventive-project list and verification state/filtering. |

## Acceptance criteria result

| Step | Status | What exists (file/table/screen) | What must change |
|---|---|---|---|
| Both payment and readiness required before dispatch | ❌ | Only default readiness progression exists | Add mandatory payment decision and two-gate server validation. |
| Damaged line cannot submit without photo | ✅ | Receipt service gate and tests | Preserve. |
| Automatic configurable tier approvals | ❌ | Single Management approval | Add threshold policy and routing. |
| Complaint cannot dispatch without QA cause/action | ❌ | Stock route bypasses final QA entirely | Add non-bypassable final QA gate. |
| IM/Head full read-only complaint journey | ⚠️ | IM scoped history exists; Head role and target stages missing | Extend access and journey. |
| Dispatch N installation done notifies Factory | ❌ | Terminal stage suppresses notification | Add completion event. |
| Regularized days/hours enter budget comparison | ❌ | No integrated regularization flow | Add approved exclusions and linked calculations. |
| Every status change logged | ⚠️ | Strong existing audit/history foundation, multiple ledgers | Close event-coverage gaps and verify transition-by-transition. |

## Existing behavior that must be preserved or migrated explicitly

- Dispatch without a factory list and unlisted-item reporting are intentional existing features, including a source comment recording an earlier owner decision. The new full-BOM requirement conflicts with them. Do not silently remove them or invent historical packing lists.
- Tax invoices, e-way bills, incoming QC, cost self-approval protection, evidence upload validation, historical plan revisions, booking constraints, visit clearance exceptions and original financial reports must remain available.
- Existing complaint closure means replacement received or superseded, not installation complete. Any new lifecycle must preserve historical meaning and classify legacy records explicitly.
- Defaults are only initialization inputs. Publish new flow versions and define an explicit migration for in-flight records; changing `flow-defaults.ts` alone will not update existing configurations or records.
- Reuse `project`, `sales_order`, `component`, `dispatch_item`, `plan`, `plan_revision`, `visit`, `reservation`, `site_presence`, `time_entry`, `budget`, `quality_case`, `issue`, evidence and notification infrastructure. Decide precise additions in the subsequent plan, avoiding duplicate Site/Order/Staff/Plan entities.

## Verification performed

Ran existing integration suites against fresh in-memory embedded databases, not operational data:

```text
npx vitest run tests/integration/dispatch-flow.test.ts tests/integration/flow-security.test.ts tests/integration/complaint-tracker.test.ts tests/integration/planning.test.ts tests/integration/site-ops.test.ts --maxWorkers=2 --minWorkers=1

5 test files passed; 62 tests passed.
```

Coverage includes existing dispatch/complaint behavior, security boundaries, complaint tracker, plan/booking guards and site operations. No new implementation was built, no new tests were written, and the full test suite, build and browser E2E were not run. These results validate the existing behavior exercised by those tests, not the missing requirements in this report.

## Assumptions and unresolved policy choices — audit stopping point

1. Treat the attachment as the comparison brief and stop after audit/gap reporting, as its requested first deliverable specifies. No implementation phase has started.
2. Existing `project` represents a site; `sales_order` is the order; `component` and `dispatch_item` represent BOM and shipment lines. Confirm whether a project may contain multiple physical sites before changing relationships.
3. “Location per punch” means captured geographic position at entry and exit, not merely a site identifier/address. Permission-denial behavior and acceptable accuracy still need definition.
4. Approval thresholds, boundary inclusivity, currency handling and effective dates are unspecified. They should be configurable; no amounts are assumed.
5. Keep Not Ready as a dispatch hold with reason, expected date and reminder as the starting behavior. Reminder repetition/escalation policy remains unspecified.
6. Normal-installation versus complaint-installation man-hour budgets, break/travel/overtime treatment and conversion of hours to money remain unspecified; do not hard-code a formula.
7. Site-plan and regularization approvers, delegation/escalation and self-approval rules need configuration. Existing manager/four-eyes rules are current behavior, not assumed final policy.
8. Clarify whether factory departments retain cross-site operational context while IMs remain assignment-scoped; the brief's department workflow and global assignment restriction need a consistent scope policy.
9. Clarify rejection outcome (terminal rejection or costing revision), required approval comments, and whether successful receipt can ever close a complaint without installation.
10. Preserve optional/unlisted packing-list handling until its conflict with the full-BOM requirement is resolved in the migration design.
11. Distinguish original issue type (missing/damaged) from reported suspected cause and QA final cause before defining a mismatch report.

Next deliverable would be the reuse-first data model, state-machine, screen and notification plan. This report ends at the audit/gap boundary; it does not enact that plan.
