# Dispatch to installation, and the MND complaint loop

Built 27 Oct 2026. Screens: **Dispatch & MND** (`/dispatch`: My steps, My team, All open, Dashboard), **Ready for dispatch** (`/dispatch/new`), a dispatch (`/dispatch/[id]`), a complaint (`/dispatch/complaints/[id]`), **Dispatch setup** for administrators (`/dispatch/setup`).

## Data model (migration `014_dispatch_flow.sql`)

The new tables reuse the existing ones and add only what the flow needs.

**Reused, not duplicated:**
- `sales_order` is the order.
- `component` is the BOM line. It gains a `dispatch_group` column: carcass, shutters, countertop, backsplash or other.
- `employee` holds the users. It gains the job role `department_staff`.
- `audit_event`, `notification` (plus `href`) and `evidence_asset` / `evidence_link` (plus PDF documents) record actions, alerts and attachments.

**New tables:**

| Table | What it holds |
|---|---|
| `dispatch` | One installation cycle: types, factory, current stage, hold (site not ready), the `partial` flag, `replacement_for` (complaint) and its flow version. |
| `dispatch_item` | The BOM lines and quantities this dispatch carries, plus whether each was received OK. |
| `complaint` | One per missing or damaged line. Linked to the order, the dispatch (and through it the factory), the BOM line and the replacement dispatch. Holds the cost, who costed it, who approved it, and the item source. |
| `stage_history` | Append-only: every create, forward, back, hold and close. Records who, when, the field values and the reason. Attachments link to the row. |
| `flow_role`, `flow_role_member` | The 10 department roles and who holds each one. |
| `flow_config` | Versioned stage definitions (JSON), with one active version per flow. |
| `flow_reminder` | Reminders, each sent once. |

## State machines

A record's current stage is the step being waited for. Forward moves go only to the configured next stage or branch, so stages can't be skipped. A stale screen or a double tap is refused, because the stage and version must still match. Going back is allowed only to stages listed in `backTo`, and always needs a reason.

**Dispatch:**
- The main path:
  1. Ready for dispatch
  2. Site readiness
  3. Tax invoice
  4. E-way bill
  5. Dispatched
  6. Received & MND
  7. Installation started
  8. Installation done
  9. Completed
- **Not ready:** the dispatch stays at Site readiness on hold, with a reason and an expected date. A reminder goes out at 09:00 site time the day before.
- **Complaints don't block installation:** Installation started and Installation done are allowed while complaints are open. The dispatch is flagged "partial".

**Complaint:**
- The main path:
  1. QC review
  2. Costing
  3. Management approval (reject goes back to Costing)
  4. Replacement plan
  5. Store check
  6. Purchase (from here only for raw material or items to be bought)
  7. Incoming QC (reject goes back to Purchase)
  8. Store issue
  9. Production
  10. Packaging
  11. Ready for dispatch
  12. Replacement on its way
  13. Closed
- **Finished good in stock:** the Store check goes straight to Ready for dispatch.
- **Replacement:** at Ready for dispatch, Factory / Dispatch creates the replacement dispatch, tagged "Replacement – Complaint MND-…". It runs the main flow and closes the complaint when it is received OK. If it arrives with a problem, a new complaint opens and the old one closes as "superseded", linked to the new one.

## Reports from the site (crew)

Added 28 Oct 2026. An installer who finds something missing or damaged after receipt reports it from **My day → Report missing or damaged**.

**The installer's steps:**
1. Tap the item.
2. Choose Missing or Damaged.
3. Set how many with − / + (at most the quantity delivered).
4. Tap a ready-made reason, or add details.
5. Take a photo (required).
6. Send.

**Built so it can't go wrong:**
- **Clear send button:** it says what is still missing, and stays off until everything is filled in.
- **No double reports:** an item that is already reported, or has an open complaint, can't be picked.
- **Only your own sites:** installers see only the sites they are booked on today, and only items that have been received.

**What happens next:**
- **Installation Manager:** the site's IM is notified, and sees the report at the top of **Dispatch → My steps** and on the dispatch.
- **Confirm:** opens a complaint exactly as the receipt check does, with the photo, and flags the dispatch "partial".
- **Reject:** needs a reason.
- **Reporter:** is told the outcome either way, and sees it under "My reports".

**Data rules:** a line can have one waiting report and one open complaint at a time. Once a line's complaint closes, the line can be reported again (migration `016_site_mnd_report.sql`).

## Stage / role matrix

| Flow | Stage | Owner (acts) | Must provide | Can send back to |
|---|---|---|---|---|
| Dispatch | Ready for dispatch | Factory / Dispatch | Order, type(s) D1, D2, D3 or D3a + D3b, BOM lines and quantities | – |
| Dispatch | Site readiness | Installation Manager (own projects) | Ready, or Not ready with a reason and expected date | – |
| Dispatch | Tax invoice | Accounts | Invoice number + invoice file (PDF or photo) | Site readiness |
| Dispatch | E-way bill | Accounts | E-way bill number + file | Tax invoice |
| Dispatch | Dispatched | Factory / Dispatch | Vehicle number, driver, date | E-way bill, Tax invoice, Site readiness |
| Dispatch | Received & MND | Installation Manager | Every line ticked, or missing/damaged with quantity, reason and at least 1 photo | Dispatched |
| Dispatch | Installation started | Installation Manager | Start date | – |
| Dispatch | Installation done | Installation Manager | At least 1 completion photo | Installation started |
| Complaint | QC review | QC | Review notes | – |
| Complaint | Costing | Planning | Cost (₹) | QC review |
| Complaint | Management approval | Management (not the person who costed it) | Approve, or reject with a reason | – |
| Complaint | Replacement plan | Planning | Plan + target date | – |
| Complaint | Store check | Store | Item type: FG in stock, raw material, or to purchase | – |
| Complaint | Purchase | Purchase | PO reference + expected date | – |
| Complaint | Incoming QC | QC | Pass, or reject with a reason (back to Purchase) | – |
| Complaint | Store issue / Production / Packaging | Store / Production / Packaging | Notes (optional) | – |
| Complaint | Ready for dispatch | Factory / Dispatch | Creates the replacement dispatch | – |
| Complaint | Replacement on its way | Automatic | Closes when the replacement is received OK | – |

**Who may send work back:** the owner of the current stage, or Management.

**Who sees what:**
- Administrators and the factory-side departments see every order.
- Installation Managers, managers and supervisors see their own projects.

**Who edits the setup:** Dispatch setup (roles and definitions) is for administrators only.

**Notifications:**
- Everyone holding the next stage's role gets an in-app notification that links to the record.
- For the Installation Manager, only the managers of that project are notified.
- A WhatsApp or email channel would plug in at `CHANNELS` in `src/server/services/flow-core.ts`; the calling code stays the same.

**Editing the flow:**
- Stages, fields, owners, branches, back links, SLA days, dispatch types and factories are edited as JSON in Dispatch setup.
- Every save is checked: owners exist, next stages exist and point forward, branches use real fields, and back links point backward.
- Each save becomes a new version. Records already open finish on the version they started with.
- Stage behaviour that needs code is named by `handler`: create, receipt, installation start/done, costing, the approval gate, and the replacement.

## Assumptions (one line each)

- The Factory ERP isn't in this repository, so its order and BOM arrive in the existing `sales_order` / `component` tables. The dispatch type of each BOM line (`dispatch_group`) comes from the factory BOM. Demo lines take it from their quantity kind.
- Several dispatches of one order may run at the same time. The spec's "then D2 starts again" is read as each dispatch having its own cycle, not a forced order.
- A BOM line can't be dispatched beyond its ordered quantity. Replacements don't count against that total.
- A part quantity of a line is allowed, so a line can be split across trucks.
- "Ready for dispatch" is completed when the factory creates the dispatch. The Installation Manager is told at once.
- One complaint per affected line, so there is no separate `complaint_items` table. The complaint holds its line directly, and the "group" is the dispatch.
- QC can't reject a complaint as invalid. The spec gives QC only a review step, so ask if a "not a valid complaint" exit is needed.
- Management rejecting the cost sends the complaint back to Costing for a new cost. It doesn't close the complaint.
- "IQC" is done by the QC role. The spec's role list has no separate IQC role.
- Raw material and "to be purchased" both go through Purchase, as the spec groups them.
- Only Installation Managers are limited to their own projects. The factory departments work across all projects.
- Administrators manage roles and the flow but can't act on stages unless they hold the role. This keeps duties separate.
- Department staff are demo people (HUB-001 … HUB-009) with the new job role `department_staff`. They are kept off crew boards, team suggestions and skill cards.
- Invoices and e-way bills can be a PDF or a photo, up to 15 MB. PDFs download rather than open inside the app.
- Overdue means more days in a step than the stage's `slaDays`, which are illustrative values. A site on hold isn't counted as overdue.
- The order's own status in `sales_order` isn't changed by this flow, because the factory system owns it.

## Open questions

1. Which factories should the dispatch list offer? Today there is a single "Main factory".
2. What are the real SLA days per stage? The current values are placeholders.
3. Does QC need a "complaint rejected / not valid" exit?
4. Should a cost rejected by Management close the complaint (for example, charged to the customer) instead of going back to Costing?
5. Is the e-way bill needed for every dispatch, or only above the legal value threshold? Today it is always required.
6. Should a replacement go through Site readiness again? Today it does, as the spec says it re-enters at Ready for dispatch.
7. Which WhatsApp or email provider and templates should be used, once approved?
8. Should the reporting-manager team view also cover Installation Managers' own reports, and not only department staff?
