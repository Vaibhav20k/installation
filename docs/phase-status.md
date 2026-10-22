# Phase status

## V3 (spec of 22 Oct 2026)

| Phase | Status | Evidence |
|---|---|---|
| 1 Discovery and latency baseline | Done | performance-baseline.md (dev 4.5–8.6 s first visits; prod 73/93 ms with full reloads), example-policy-audit.md |
| 2 Navigation responsiveness | Done | performance-after.md: 40/64 ms, no full repaint; loading.tsx removed after tracing React's ~300 ms reveal batching |
| 3 Worker dashboard, fixed session, notifications, evidence | Done (push and production storage not configured) | migration 006; tests: shift.test.ts (10), attendance.test.ts (12), evidence.test.ts (6); browser flow at 390 px; shift-contract.md; manual-input-evidence-coverage.md |
| Checkpoint A | Done | 126/126 tests; boundaries 7:30/8:00, late runner, clock-out at 8:00, resume re-arm, missed clock-out; worker tabs 52/81 ms with timer running; two bugs found and fixed (8:00 clock-out race, resume re-arm); phone layout overflow from stamp animation fixed |

| 4 Identities, workforce, source data | Done | Customer contacts (one primary per account, never an account key); existing hierarchy, skills, roles/permissions, calendars, leave and import adapter kept |
| 5 Estimation, scope, site readiness | Done (rates illustrative) | migration 007: net/gross snapshots (net only for effort, kind/unit enforced), effort drivers (unknown when no rate), site windows (extra days, not changed effort or session), appliance dependencies in the readiness gate with manager exceptions kept as risks; tests: site.test.ts (6 unit, 4 integration) |
| 6 Planning, travel, booking, substitution | Done | Substitution keeps earlier days, re-checks overlap (database), leave and coverage from the effective moment; existing planner, sheet, wizard, suggestions, holds and booking kept |
| Checkpoint B | Done (large-fixture timing deferred to phase 13) | 136/136 tests. One earlier full run reported 121/136 under CPU load from a concurrent build; three clean reruns passed |

| 7 Daily execution, additional work, evidence | Done | migration 008: additional work (request, manager approval, chargeable/free/waived, never self-approved), evidence on quality cases, delays and customer acceptance; existing frozen targets, bounded cumulative progress and follow-ups kept |
| 8 Timesheets and attribution | Done | Attendance → draft rows (phase 3); the overtime period for attendance time is clock-in + 480 min (fixed: review previously used the calendar day) |
| 9 Eligibility, reconciliation, expenses | Done (monthly policy still draft) | New verified reason "authorised work brought forward" (eligible with authorisation, no customer order); approved additional work can authorise scope; quoted charges and waivers kept apart from estimate, budget and actual; no profit figure |
| Checkpoint C | Done | 139/139 tests; commercial.test.ts traces future-task → eligible-pending-policy and confirmed catch-up → ineligible on the same interval with actual time kept |

| 10 Customer coordination and design requests | Done | migration 009: journey owner and stage, checklist with overdue marking, communication log (no sending; acknowledgement only as recorded; future events refused), design/measurement requests with revisions (limit setting unset, so nothing blocks), manager decisions never self-approved |
| 11 Package receipt, shortage, replacement | Done (camera scanner depends on browser support) | Manifest, dispatch/receipt/damage scans de-duplicated by client event id, receipt-unverified (not "lost"), unknown codes kept as exceptions, damage/shortage exceptions with evidence, separate responsibility/replacement/charge decisions; typed-code fallback always available |
| 12 Management dashboard and trackers | Done | Adjustable handover window with 7/14/30-day presets and custom dates; existing five tracker views, KRA review and exports kept |
| Checkpoint D | Done | 143/143 tests; production build; every new tab and Approvals loads at 390 px and 1440 px with no console errors and no horizontal overflow |

| 13 Accessibility, mobile polish, performance | Done (lab only) | Large fixture (9,390 entries, 10,000 progress rows) and 4× CPU / 4G profile: all budgets met; DOM accessibility audit on 12 pages clean; phone layout bugs fixed |
| 14 Reliability, security, deployment readiness | Done (not deployed) | Due jobs survive restarts (tests); upload tokens and content sniffing (tests); evidence and leave permissions (tests); demo auth off in production (test); checklist edits limited to owner/supervisor after review; deployment steps listed in README |
| 15 Acceptance and handover | Done | README walkthrough (worker and manager), docs updated, 146/146 tests, production build, browser checks |
| Checkpoint E | Done | Example-policy audit, evidence coverage, latency and shift boundaries rechecked; 480/450 constants unchanged; limitations recorded below |

### V3 limitations (honest)

- Real phones not tested; all mobile numbers come from emulation.
- Closed-app push and production object storage are not configured. Alerts are in-app and in an open tab; evidence uses a local private folder with no thumbnails or transcoding.
- The camera code scanner needs browser `BarcodeDetector` support; typing the code always works.
- A lightweight accessibility audit was done, not a full WCAG audit. No screen-reader or 200% zoom testing.
- The V3 acceptance scenarios are covered by the tests named in `test-evidence.md`. Scenarios needing real devices or external services (47, 75, parts of 72) are not verified.

## Earlier build (V2 phases, kept for history)

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
