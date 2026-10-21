# Phase status

Legend: **Done** (implemented and verified), **Provisional** (works, awaiting business decisions), **Deferred** (not built), **Blocked** (external dependency).

| Phase | Status | Evidence | Notes |
|---|---|---|---|
| 1 Discovery and requirements | Done | requirements.md, decisions.md, source-mapping.md | Transcript PDF not reopened (spec's consolidation used) |
| 2 Foundation and persistence | Done | migrations 001–004, client, audit, identity boundary; foundation tests; production auth check | Embedded PostgreSQL; Prisma replaced by SQL migrations (D-04) |
| 3 Master data and project scope | Done | Seed (40 employees, 3 managers, all roles, 5 cities, multi-order project); create customer/project/order/item/component UI; skill verification; leave; source import boundary | Import adapter is a labelled demo fixture |
| Checkpoint A | Done | Clean-database migrations in every integration test; permission negative tests; demo labels; shell a11y audit | |
| 4 Estimation and policy foundations | Done / Provisional | Effort, role templates, rate versioning (approval creates new version), calendars, policy editor with preview and unresolved-field list | Rates, calendars and policy values illustrative |
| 5 Planner and reservations | Done | Timeline, planning sheet, wizard, deterministic suggestions, continuity, travel legs, holds with expiry, transactional booking, concurrency tests | |
| 6 Clearances, visits, daily execution | Done | Separate gates, exceptions, readiness, revisions/baseline, lifecycle, frozen targets, progress/reversals, delays, acceptance, follow-ups, schedule revision | Project-closure action deferred (gate documented) |
| Checkpoint B | Done | flow.test traces quantity → effort → skills → staffing → approval → daily plan; partial attendance, team-days vs person-days, expired clearance, mandatory continuity, cross-project, double booking | |
| 7 Timesheets and interval calculations | Done | Overnight, overlap, breaks, day/month split, truthful exceptions, review, amendments as revisions | |
| 8 Eligibility and monthly reconciliation | Done / Provisional | Confirmed catch-up exclusion, policy-gated eligibility, deterministic allocation, finalize/reopen, invalidation | Months stay provisional until policy fields are decided |
| 9 Expenses and operational dashboard | Done | Estimates, budgets (Finance), expenses, credits, exact allocation, dashboard drill-downs, five trackers, KRA review, savings verification, safe CSV | Targets Not rated by design |
| Checkpoint C | Done | flow/queries/boundaries tests; hand-checked reconciliation (N 1200, Q 1860, X 660, E 120, cap 120) | |
| 10 UI polish and accessibility | Done (with limits) | DOM a11y audit 29 pages, contrast, 390 px overflow checks | No screenshots possible (hidden pane) |
| 11 Reliability, integration boundaries, performance | Done | Independent server-layer review: 12 findings, all fixed with regression tests (security.test.ts); idempotency per user; timings recorded; OneDrive database/build issues resolved | |
| 12 Acceptance and handover | Done | README, docs, `npm run check` 92/92, build, production auth check | |
| Checkpoint D | Done | This file and test-evidence.md | |

## Review findings fixed in phase 11

Recorder-can-accept-own-recorded-time and overtime equivalent (now blocked via `created_by`); plan four-eyes via proxy submitter (submit needs supervisor, approver ≠ revision author); eligibility re-review after finalization (invalidates the month); decisions under draft policy (now pending policy, except the confirmed catch-up rule); time on out-of-scope projects (reviewed exception, scope needed when recording for others); supervisor releasing booked staff via staffing (manager only); internal exports for employees (supervisor+); task dependency/savings/allocation/estimate-line scope checks; credit race and state; per-user idempotency; policy self-approval; CSV escaping for all non-numbers. A deadlock found while testing (in-transaction scope check through the outer handle) was also fixed.

## Deferred or limited

- Real authentication provider (identity boundary ready; demo selector disabled in production).
- Live CRM / estimator / PDA / dispatch integrations (not specified; adapter interface only).
- Receipt/file upload (references only), email/notifications, offline mode.
- Explicit project-closure action (gate documented in decisions.md).
- Editing work calendars and general settings in the UI (seeded; documented).
- Playwright end-to-end suite; keyboard-only and 200% zoom interactive checks; screenshots.

## Business decisions needed

See requirements.md U-01 … U-16. Most important: monthly policy fields (catch-up threshold credit, cap allocation method, leave adjustment, external-delay eligibility), approved productivity rates, approved KRA definitions/targets and review period, team size, clearance timing.
