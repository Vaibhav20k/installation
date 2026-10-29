# Dispatch & MND: tests, coverage, security findings and traceability

The test suites check the spec in [dispatch-flow.md](dispatch-flow.md), not whatever the code happens to do.

## Setup

- **Stack:** Next.js 15 with Postgres (PGlite embedded locally, or `DATABASE_URL`). Permissions are checked in the service layer.
- **Supabase:** not used, so there are no RLS policies, service-role key or storage buckets to test.
- **Tools:** the existing Vitest suite, plus `@vitest/coverage-v8` 2.1.9 for coverage and `@playwright/test` 1.63.0 for E2E. Playwright drives the installed Chrome, so no browser download is needed.

## How to run

| What | Command |
|---|---|
| Unit tests (pure logic) | `npm run test:unit` |
| Integration tests (services on a real in-memory database) | `npm run test:integration` |
| Coverage report, with the 90% gate on the flow code | `npm run test:coverage` (HTML report in `coverage/`) |
| E2E: the IM journey at 390 px (needs a build first) | `npm run build && npm run test:e2e` |
| Everything, as CI would run it | `npm run ci` (typecheck, coverage gate, build, E2E) |

**Test isolation:**
- Integration tests seed a fresh in-memory database per file. They contain one user per role, plus a reporting manager, an admin, an installer and an Installation Manager of another project.
- The data has 5 orders with BOMs. Store's answer decides whether an item is a finished good in stock or needs purchasing.
- E2E starts its own server on port 3310, on a throwaway database and file store in `.e2e/`.
- No test touches your local demo data, Zoho, real storage, WhatsApp or email. Files are written to a temporary folder, and notifications go only to the in-app table.

## Coverage

Coverage from `npm run test:coverage`. The build fails if a target file drops below 90%.

| File | Lines | Branches | Functions |
|---|---|---|---|
| `src/domain/flow.ts` (state machine, config validation) | 100% | 95.9% | 100% |
| `src/server/services/flow-core.ts` (permissions, history, files, notifications) | 100% | 88.5% | 100% |
| `src/server/services/dispatch.ts` (dispatch flow, receipt with missing/damaged lines) | 100% | 86.4% | 100% |
| `src/server/services/complaint.ts` (complaint routing, approval gate, replacement) | 100% | 87.5% | 100% |

**Results:**
- Vitest: 35 files, 337 tests, all passing.
- Playwright: 4 tests, all passing, run twice in a row.

## Spec-to-test traceability

Test files are under `tests/`. Labels: **U** = `unit/flow-engine.test.ts`, **U2** = `unit/flow.test.ts`, **DF** = `integration/dispatch-flow.test.ts`, **FP** = `integration/flow-permissions.test.ts`, **FS** = `integration/flow-scenarios.test.ts`, **E2E** = `e2e/im-journey.spec.ts`.

| Spec rule | Test(s) |
|---|---|
| Dispatch types D1/D2/D3, the D3a + D3b split, and combined dispatches | U2 *maps types to BOM groups and refuses D3 with its parts*; DF *checks types against BOM groups, D3 overlap and quantity left*; DF *creates D1 + D2 together…*; DF *ships countertop and backsplash as separate dispatches* |
| Each dispatch carries only its own BOM lines; a quantity can't be dispatched twice | FS *the next dispatch (D2)… starts its own cycle*; FS *a BOM line's quantity can never be dispatched twice*; FS *two dispatches racing for the same quantity: only one wins* |
| Multiple dispatches per order, each with its own cycle; D2 starts after D1 | FS *the next dispatch (D2) of the same order starts its own cycle after D1 completes* |
| Stage order and no skipping, in both flows | U *{stage} moves only to its configured next stage or branches* (every stage); FP *no stage can be skipped and stale screens are refused, for every stage* |
| Going back only with a reason, only to allowed stages | U *{stage}: back moves only to listed stages, never without a reason* (every stage); FP *back moves…*; DF *goes back only to allowed stages and only with a reason* |
| Site readiness: Not ready blocks the next stage, needs a reason and expected date, and sets a reminder before that date | U *Not ready holds the dispatch…*; DF *Not ready holds the stage with a reason and date, and reminds the day before*; DF *only Ready moves on*; E2E |
| Tax invoice upload (Accounts) | DF *only Ready moves on; invoices and the e-way bill need their files*; E2E |
| E-way bill is mandatory before Dispatched | U *Dispatched is reachable only from the E-way bill stage…*; DF (same as above) |
| Dispatched records vehicle, driver and date | FS *full D1 path…*; E2E |
| Received & MND: full BOM listed, all ticked by default; an unticked line needs type, quantity, reason and ≥1 photo | FS *refuses zero quantity / more than was dispatched / no photo / empty reason*; FS *refuses negative quantities and 50k-character reasons*; FS *refuses an unanswered line…*; DF *needs type, quantity, reason and a photo…*; E2E |
| One complaint per affected line, grouped under the dispatch | DF *needs type, quantity, reason and a photo…*; FS *double submit: exactly one receipt is saved and one complaint per bad line* |
| Installation can start with complaints open, and is flagged partial | DF *installation starts while the complaint is open…*; FS *double submit…* (partial); E2E |
| Installation done needs completion photos | U *Installation done needs completion photos*; DF; E2E |
| Complaint stages: QC, then Planning costing, then the Management gate | DF *runs QC, costing and the management gate…*; FS *rejected cost does not move forward and keeps the reason…* |
| Management reject stops the complaint and records why | U *Management reject does not move the complaint forward…*; FS *rejected cost does not move forward and keeps the reason* |
| Store: an FG item in stock goes straight to Ready for dispatch | U *FG in stock goes straight to Ready for dispatch*; DF *MND complaint with a finished good in stock* |
| Store: raw material or purchase goes Purchase → IQC → Store → Production → Packaging → Ready for dispatch | U *raw_material / to_purchase goes…*; DF *goes through purchase…* |
| IQC reject goes back to Purchase | U *IQC reject goes back to Purchase*; DF *goes through purchase; IQC reject sends it back to purchase with a reason* |
| Replacement tagged "Replacement – Complaint #"; closes the complaint only when received OK | DF *creates a tagged replacement dispatch that closes the complaint when received OK*; FS *rejected cost…* (can't be closed by hand while the replacement is on its way) |
| A replacement with its own missing/damaged line opens a new complaint linked to the original | FS *rejected cost does not move forward…* (superseded, linked) |
| A replacement can't be forged | FS *ignores a forged replacement link on a normal dispatch* |
| Notification to the next stage's owner | FS *records who, what, when (and attachments) and notifies the next owner at each step*; DF *creates D1 + D2 together and notifies the Installation Manager* |
| Role-based access: only the owning role acts on each stage | FP *matrix* (dispatch and complaint, generated from the stored config); FP *the creation stage is Factory / Dispatch only*; FP *automatic stages cannot be completed by anyone* |
| Full audit trail (who, what, when, attachments) on every stage change; append-only | FS *records who, what, when…*; FS *the history and the audit log are append-only*; DF *keeps every stage change in an append-only history* |
| Views: My pending tasks, the reporting manager's team view, the management dashboard (orders by stage, open complaints, aging, complaint cost) | FS *match the records created above*; FS *My pending tasks and the reporting manager's team view agree*; DF *shows the management dashboard and the reporting manager's team* |
| Config-driven: changing the config changes behaviour; invalid config rejected; admins only | U *a changed definition changes behaviour with no code change*; U *rejects a stage nobody can reach (orphan) / with no owner / loops / dead ends*; U *validator edge cases*; DF *saves a valid new flow version; open records keep theirs* |
| Reuse the existing order, BOM and user tables | FS *adds no copy of orders, BOM lines or users; new rows reference the existing ones* |
| Mobile-friendly IM journey | E2E *IM journey at phone width* (390 px, no horizontal scroll, no console errors) |
| Access control at the HTTP layer (logged out, wrong role, guessed file ids) | `e2e/http-guards.spec.ts` (all 3 tests) |
| Installers report missing/damaged items found on site; the site's IM confirms (opens a complaint) or rejects with a reason; the reporter is told | `integration/site-mnd-report.test.ts` (all 11 tests, written before the feature) |
| Least privilege on cost and finance documents | `integration/flow-security.test.ts` F1 tests |

## Bugs found by the new tests (fixed test-first)

| Finding | Test that failed first | Fix |
|---|---|---|
| A flow definition with an orphan stage (one nothing leads to) was accepted | U *rejects a stage nobody can reach (orphan)* | `checkDefinition` now walks the forward links and rejects stages it can't reach (`src/domain/flow.ts`) |
| History steps saved in the same millisecond came back in random order, scrambling the timeline | FS *records who, what, when…* | Added an insertion sequence (`db/migrations/015_stage_history_order.sql`); history is now read in that order |

## Security findings (break-it pass)

An independent agent that hadn't written the module attacked it. It drove the real services as every role, against a throwaway database. It added nothing to the repository; its proof scripts stay in the session scratch folder.

It didn't call the HTTP endpoints, so `tests/e2e/http-guards.spec.ts` now does. It calls the evidence file route and the server actions directly, with no session, with an installer's session, with guessed IDs and with path tricks.

No Critical or High issues were found. All four findings are fixed: a regression test was written first, seen to fail, then made to pass by the fix.

| # | Finding | Severity | Status | Regression test |
|---|---|---|---|---|
| F1 | Store, Purchase, Production, Packaging, QC and Factory staff could read every complaint's cost and who set it, the cost dashboard, and every tax-invoice and e-way-bill file in every project | Medium | **Fixed.** Cost (detail, history values, dashboard totals) is limited to Planning, Management, admins and the project's managers. Files on Accounts-owned steps are limited to Accounts, Factory / Dispatch, Management, admins and the project's managers, in both the file route and the timeline. MND photos stay visible to the departments that work the complaint. | `flow-security.test.ts` › F1 (all) |
| F2 | Management could rewind any dispatch stage, though only the stage's owner may act | Low | **Fixed.** Management keeps its back-right only in the complaint flow, where it owns the cost gate. | `flow-security.test.ts` › F2; `flow-permissions.test.ts` › *back moves: only the stage owner…* (assertion corrected to the spec) |
| F3 | A cost too large for the column caused a generic server error | Low | **Fixed.** Numbers are capped at 12 whole digits and 2 decimals, with a clear validation message. | `flow-security.test.ts` › F3 |
| F4 | For a project with no scoped Installation Manager, every Installation Manager was notified (dispatch number and stage) | Low | **Fixed.** No fallback any more; only Installation Managers of the project are told. | `flow-security.test.ts` › F4 |

**Checked and found sound by the agent:**
- Role checks on every write.
- Stage skipping, replays and stale versions.
- A double-submitted receipt.
- Concurrent BOM quantity.
- Forged replacement links.
- Cross-project reads (IDOR).
- Self-approval of cost.
- Append-only history.
- Quantity and length abuse.
- XSS: no raw HTML anywhere, and React escapes user text.
- Uploads: signed 15-minute URLs, server-chosen keys, content sniffing, SVG rejected, PDFs only on flow steps.
- Using another user's upload draft.
- SQL injection: all queries are parameterised.
- Admin-only config, with open records pinned to their version.

**Still open (low risk):**
- **Raw HTTP races and byte-range downloads:** not attacked live. PGlite runs one transaction at a time, so races were tested through stale-version replays and the row locks.
- **Self-approval if an admin edits the cost step out of the flow:** the approver couldn't be compared with a coster who doesn't exist. This is only reachable by an admin flow edit; noted rather than fixed.

## Assumptions, ambiguities, open questions

- **Not done here:** no tests or code were committed. The testing spec asks for test and code to be committed together, but the repository also holds earlier uncommitted work, so committing waits for the owner.
- **New visibility rule (F1):** department staff outside Planning and Management no longer see complaint cost, and only Accounts, Factory / Dispatch, Management and the project's managers open invoices and e-way bills. Say if, for example, Store needs cost.
- **"The same BOM line can't land in two dispatches":** read as "the same quantity can't be dispatched twice". A part quantity can follow on a later truck, and that split is tested. If one line must be on only one dispatch, part dispatches have to go.
- **"Management reject stops the complaint":** read as "it doesn't move forward, and the reason is recorded". It returns to Costing for a new cost rather than closing. Open question: should a rejection close the complaint, for example as chargeable to the customer?
- **"Reminder is scheduled before that date":** 09:00 site time, one day before (configurable per stage).
- **Supabase checks** (RLS, service-role key, public buckets) don't apply. The equivalent controls are the service-layer permission checks and the permission-checked file route. Both are covered by the matrix tests and the break-it pass.
- **Real Zoho Inventory sync:** not part of this module yet. The order and BOM tables are the integration seam, and tests use the seeded copies.
