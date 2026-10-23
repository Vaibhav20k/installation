# Implementation checklist (prompt of 23 Oct 2026)

Source: "Claude prompt: installation management additions and fixes checklist", 23 Oct 2026. The master prompt `INSTALLATION_MANAGEMENT_CLAUDE_MASTER_PROMPT_V3_2026-10-22.md` was available and used for formulas and the 77 scenarios.

**Method.** Every item was checked against the code, not against earlier docs. Two read-only reviews, one for phases 1–6 and one for 7–12, cited file and line for each item. Gaps they found were fixed in this round and are marked *(this round)*.

**Status values:**
- **Verified existing:** present and checked
- **Implemented and verified:** built in this round and tested
- **Partial:** works, with the stated gap
- **Missing:** not built
- **Blocked:** needs an outside dependency or a business input

A box is ticked only when the acceptance behaviour was verified. Paths below are relative to `src/`.

**State at the end of this round:** typecheck clean; `npx vitest run`: 23 files, **162 tests passing**; `npm run build` succeeded; served by `npm run local` on :3300.

## Phase 1 — Inspect the project and baseline

- [x] Repository located, instructions read, app run, routes mapped. **Verified existing.** `phase-status.md`; served locally this round.
- [x] Each item compared with the implementation. **Implemented and verified** *(this round)*: this file.
- [x] Slow tab changes reproduced with client, network, API and database evidence. **Verified existing.** `performance-baseline.md`.
- [x] Development and production builds measured separately: cold, warm and after-save. **Verified existing.** `performance-baseline.md`.
- [x] Worker input inventory, including media controls and storage. **Implemented and verified** *(this round)*: `manual-input-evidence-coverage.md` rewritten from the code.
- [x] Sample values classified. **Verified existing.** `example-policy-audit.md`; nothing new added this round.

## Phase 2 — Latency and navigation

- [x] Stable app shell; no full reloads on in-app navigation. **Verified existing.** `components/Nav.tsx` uses `next/link` with pending marks.
- [x] Redundant fetches, waterfalls, rerenders and slow queries fixed. **Verified existing.** `performance-after.md`.
- [ ] Pagination, indexes, scoped caches and invalidation. **Partial.**
  - **Expenses:** now paged, 50 per page, with totals covering every matching record *(this round)*: `server/queries/expenses.ts`, `app/(app)/expenses/page.tsx`.
  - **Approvals:** show the full waiting count and the oldest 200 *(this round)*.
  - **Still capped or filtered only:** the project time list (200 rows) and the tracker views (month and project filters, no row cap).
  - Reads are scoped per user on the server.
- [x] Heavy modules load on demand. **Implemented and verified** *(this round)*.
  - The clock-in camera and the package scanner load with `next/dynamic` only when opened (`components/attendance/AttendancePanel.tsx`, `components/project/PackageScanner.tsx`).
  - Videos use `preload="none"`.
  - There is no chart library.
- [x] The ticking timer is isolated. **Verified existing.** `<Ticker>` in `AttendancePanel.tsx` is the only per-second component, works from a server-time offset and makes no server writes.
- [x] Tabs, saves and attendance stay usable during uploads. **Verified existing.** Uploads run in a queue outside React (`lib/upload-queue.ts`, two at a time).
- [x] Same scenarios timed before and after. **Verified existing.** `performance-after.md`: 73/93 ms became 40/64 ms, and the large fixture met every budget. Not re-measured after this round's changes, which add no work to page loads (camera and scanner now load later, not sooner).

## Phase 3 — Worker dashboard, fixed shift, notifications

- [x] Self-service dashboard with My day, attendance, tasks, requests and inbox. **Verified existing.**
- [x] Shows clock-in, regular end, activity, regular and overtime timers, and approval status. **Verified existing.**
- [x] Fixed 480 and 450 minutes from the server-accepted clock-in. **Verified existing.** `domain/shift.ts`; `tests/unit/shift.test.ts`.
- [x] Automatic recorded overtime at the boundary, with activities classified. **Verified existing.** `tests/integration/attendance.test.ts`.
- [x] Persistent inbox and durable, deduplicated jobs that survive restarts. **Verified existing.** `due_job`, `notification.dedupe_key`, `instrumentation.ts`.
- [ ] Push delivery where permitted; honest denied and offline behaviour. **Partial / Blocked.** In-app and open-tab browser alerts work, and the denied case is explained. Closed-app push needs VAPID keys, a service worker and a push service, none of which are configured.
- [x] Reloads, extra tabs, midnight and clock changes cannot reset or duplicate. **Verified existing.** Server time plus dedupe keys (scenarios 43–46, 49). The browser offset has no dedicated test.
- [x] Jobs cancelled or reconciled on clock-out and corrections; no second eight hours. **Verified existing.** Scenarios 44, 49, 50.
- [x] Shared private attachments on attendance and corrections. **Verified existing.**
  - The clock-in photo is required, by your instruction of 23 Oct (D3-14); this deliberately overrides "media never blocks attendance".
  - Clock-out never needs a photo.

**Checkpoint A:** rechecked. All shift and evidence tests pass, and the worker flow at 390 px was re-run this round (`test-evidence.md`).

## Phase 4 — Customers, projects, orders, people, skills

- [x] Customer → project → orders → items/components → tasks, each with a stable ID. **Verified existing.** Migration 001; `tests/integration/foundation.test.ts`.
- [x] Contacts and history kept; people never merged by name or phone. **Verified existing.** `server/services/site.ts` always inserts. There is no test asserting the non-merge.
- [x] About 40 employees and 3 managers as context, not a limit. **Verified existing** in the seed. Whether managers count in the 40 is a business input.
- [x] All listed roles present. **Verified existing.** Seed has 10 roles (foundation test).
- [x] Job title, permission and verified skill level are separate. **Verified existing.**
- [ ] Skill cards and concurrent qualified crew presence. **Partial.**
  - Levels, verification, validity and expiry mid-work were already checked.
  - **New this round:** coverage is now checked **period by period**. A replacement or an added person splits the visit, and each period must be covered by the people booked in it (`domain/skills.ts` `coverageByPeriod`, used by `server/services/booking.ts` `visitCoverage`; 3 unit tests).
  - **Gap:** skill requirements attach to the visit, not to individual tasks.
- [x] Configurable team size, effective-dated membership, calendars, leave and emergency unavailability. **Verified existing.**
- [x] Idempotent imports through a labelled fixture adapter. **Verified existing.** `integrations/source-adapter.ts`; `boundaries.test.ts`.

## Phase 5 — Estimates, readiness, dependencies

- [x] Net and gross quantities kept separate, with unit, kind and source revision. **Verified existing.** Scenario 56. Caveat: the plan estimate reads the visit's scoped quantity rather than the net snapshot.
- [ ] Approved activity rates or role templates, with no double counting. **Partial.** Approved versioned rates are used. Role-effort templates are stored and tested but not yet used in plan estimates.
- [x] Team-days, person-days, person-hours and calendar duration distinct. **Verified existing.** Scenarios 5, 6, 23.
- [x] Complexity separate from skill; no invented multiplier. **Verified existing.**
- [ ] Separate accounts, material, site, skill and installation checks with exceptions and audit. **Partial.**
  - Accounts, site and installation are clearance gates, with audited exceptions (accounts only by default policy).
  - Materials and skill coverage are readiness checks with no exception path.
- [x] Permitted site days and hours stored and used. **Implemented and verified** *(this round)*.
  - Allowed weekdays now close days in the installation schedule ("Site closed (site rule)") and narrow the working days for team suggestions (`domain/install-schedule.ts`, `server/services/schedule.ts`, `server/services/booking.ts`; `tests/unit/itinerary.test.ts`).
  - The daily window already added calendar days.
- [x] Appliance dependencies block readiness. **Verified existing.** Scenario 57.
- [x] Tentative estimates with named blockers. **Verified existing.**

## Phase 6 — Planning sheet, allocation, travel

- [x] Planning grid and timeline with the listed columns. **Verified existing.** `components/planning/Sheet.tsx`, Board.
- [x] Wizard, saved filters, sorting, pinned columns, expandable allocations, safe exports. **Implemented and verified** *(this round: saved filters)*.
  - Named filter sets are kept in the viewer's browser and are just links, so nothing operational is stored (`components/planning/SavedFilters.tsx`).
  - Saving and reopening a set was checked in the browser.
- [x] Explained suggestions, continuity, alternatives and next feasible date. **Verified existing.** Scenarios 4, 26.
- [ ] Travel start, arrival, work, finish and return, with reachability. **Partial.**
  - **New this round:**
    - visit dates must keep departure ≤ start ≤ end ≤ return
    - an outbound leg must arrive by the start date
    - a return leg must leave on or after the last work day
    - checks: `domain/scheduling.ts`; tests: unit and `boundaries.test.ts`
  - **Gap:** no distance or travel-time data is supplied, so inter-site legs are only checked for arrival after departure.
- [x] Outstation occupancy through return; travel inside the same reservation. **Verified existing.** Scenario 27.
- [x] No double booking; proposed, held, confirmed, released and cancelled states; hold expiry. **Verified existing.** Database exclusion; scenario 7.
- [x] Work and travel hours, dates and calendar days kept separate. **Verified existing.** Scenario 6.
- [x] Authorised substitution with effective time and checks. **Verified existing.** Scenario 61, plus the whole-booking case. Coverage is now judged by period.
- [x] Immutable baselines; revisions previewed before applying. **Verified existing.** Scenarios 9, 28.

**Checkpoint B:** rechecked this round. All planning, booking and substitution tests pass. A flaky test was found and fixed: it picked the outgoing person by random UUID order, so it sometimes chose the only qualified member, and the app rightly refused.

## Phase 7 — Daily execution and universal media

- [ ] Visit types, daily plans, dependencies, component steps, milestones and remaining work. **Partial.** There is no milestone entity. Task dependencies are stored (with a cycle check) but not enforced when progress is recorded.
- [x] Frozen daily targets with dated revisions. **Verified existing.** Scenario 29.
- [x] Accepted quantity counted once and bounded. **Verified existing.** Scenarios 24, 62.
- [x] Phased returns, shortages, failed readiness, changes and rework distinguished; reversal history. **Verified existing.** Scenarios 10, 58.
- [x] Additional work: chargeable or free, scope, brought-forward work. **Verified existing.** The reference is an optional free-text `commercial_ref`.
- [x] Blockers, delays, issues, owners, due dates, acceptance, quality closure. **Verified existing.** Scenario 40.
- [x] One reusable uploader: previews, captions, multiple files, per-file states, progress, cancel, retry. **Implemented and verified.** An explicit **Cancel upload** control now shows while a file is queued or uploading *(this round)*.
- [ ] Image and video on **every** worker input surface. **Partial: code complete, partly exercised.**
  - **Wired this round:**
    - readiness checks
    - measurements
    - break, idle and travel changes
    - the overtime reason on My day
    - issue create and close
    - quality-case closure
    - substitution, from both the team panel and the visit page
    - skill claims and verification
    - package scans
    - design revisions
    - appliance exceptions
    - per-task progress in the visit execution step
  - **Exercised:**
    - activity photo end to end in headless Chrome
    - readiness rows rendered in the browser
    - measurement link in an integration test
  - **Not individually exercised:** the remaining newly wired forms; they typecheck and build. See `manual-input-evidence-coverage.md`.
- [x] Each attachment linked to its exact authorised record and context. **Verified existing.** Migration 010 adds the measurement, substitution, scan and design-revision record types.
- [x] Records save without media; failures never discard input or block attendance. **Verified existing.** Scenarios 69, 77. The clock-in photo is the deliberate exception (D3-14).

## Phase 8 — Timesheets and attribution

- [x] Time linked to plan, employee, visit, order and task. **Verified existing.**
- [x] Installation, additional, rework, travel, waiting and breaks kept separate; plans never create attendance. **Verified existing.**
- [x] Regular-window work and recorded overtime work separate from elapsed attendance. **Verified existing.** Scenarios 11, 48.
- [x] Overlaps rejected, adjacent intervals accepted, midnight and month splits. **Verified existing.** Scenarios 12, 13, 31.
  - *This round:* month invalidation after an amendment now uses the policy's settlement timezone (else the employee's calendar), the same one reconciliation uses (`server/services/time.ts`).
- [x] Truthful unscheduled-work exceptions and missing clock-outs. **Verified existing.** Scenarios 30, 52.
- [x] Draft, submitted, accepted and returned states; versioned corrections; reopening. **Verified existing.**
- [x] Minutes counted once across linked tasks. **Verified existing.** Scenarios 33, 62.

## Phase 9 — Overtime review, monthly reconciliation, expenses

- [ ] Recorded, requested, eligible, pending, rejected and approved overtime kept distinct. **Partial.**
  - "Recorded" lives on the shift.
  - The request states are requested, eligible, ineligible and pending policy.
  - Approval happens when a month is finalised under a policy; there is no separate approved/rejected flag on the request.
- [x] Catch-up exclusion cannot be overridden. **Verified existing.** Scenario 11.
- [x] Future-day work and additional scope considered without automatic approval. **Verified existing.** Scenario 51.
- [x] Versioned policies, settlement timezone, allocation; unset fields block only finalisation. **Verified existing.** Scenarios 14–16, 32.
- [x] Cross-project aggregation once; allocation back without duplicate caps. **Verified existing.** Scenarios 31, 33.
- [x] Amendments invalidate reconciliations and keep history. **Verified existing.** Scenario 17.
- [x] Charges, waivers, estimates, budgets and actuals separate. **Verified existing.**
- [ ] Expense categories with explicit line bases and approvals. **Partial.** All categories and approvals exist. The line basis (per person, per room, per trip) is on estimate lines; an actual expense is the receipt amount, with an optional link to its estimate line.
- [x] Shared expenses allocated once, reconciled exactly; estimate and budget variance distinct. **Verified existing.** Scenarios 18, 19.
- [x] Verified Finance records only; nothing invented. **Verified existing.** `example-policy-audit.md`.

**Checkpoint C:** rechecked. Target → work → overtime → eligibility → month, and estimate → expense → allocation, are traced in `flow.test.ts` and `commercial.test.ts`. Media coverage is updated as above.

## Phase 10 — Customer coordination and design requests

- [x] Journey owner, stage checklist, commitments, next actions, due dates, history. **Verified existing.**
- [x] Acknowledgement recorded separately; nothing claims a message was sent. **Verified existing.** Scenario 64.
- [ ] Design requests linked to order scope, skills, appliance briefs and revisions. **Partial.** Skills are free text, not linked to the skill catalogue.
- [x] Revision origin and reason recorded. **Verified existing.**
- [ ] Visit and revision thresholds stay contract-specific. **Partial.** The revision limit is unset and blocks nothing. No visit-count threshold setting exists, so nothing is enforced either.
- [ ] Audio transcription optional and visibly unconfigured. **Missing.** There is no audio feature at all, and nothing claims one.

## Phase 11 — Packages

- [x] Shipments, package IDs, manifest, dispatch and receipt events, partial and damaged deliveries. **Verified existing.**
- [x] Scans deduplicated; typed entry; a missing scan means unverified, not lost. **Verified existing.** Scenario 59.
- [x] Receipt separate from contents verification. **Verified existing.** A box scan never verifies contents; a mismatch is an exception. There is no positive "contents verified" record yet.
- [x] Shortage and damage evidence, responsibility, replacement and charge decided separately. **Verified existing.** Scenario 60. Scans and exceptions can now take photos *(this round)*.

## Phase 12 — Management dashboard and the five trackers

- [x] Active sites and crews, blockers, conflicts, remaining work, approvals, time and expense variance. **Verified existing.**
- [x] Adjustable handover window. **Verified existing.**
- [x] Installation Tracker. **Verified existing.**
- [x] Manpower Productivity. **Verified existing.**
- [x] FTR Complaints Rework. **Verified existing.** Scenarios 34, 35.
- [x] Cost Overtime Unloading. **Verified existing.** Scenarios 37, 38.
- [x] Cross-Functional Issues. **Verified existing.** Scenario 40.
- [ ] Definitions, denominators, filters, coverage, drill-downs, exports from the same records. **Partial.** Dashboard tiles drill down, but tracker rows have no per-row links. Definitions and exports exist (scenarios 21, 39, 42).
- [x] Targets inactive until approved: N/A or Not rated. **Verified existing.**
- [x] Client-safe plan export separate; CSV formula injection blocked. **Verified existing.** Scenario 42.

**Checkpoint D:** rechecked. No sample commercial term, target or retention period became active; this round added none.

## Phase 13 — UI/UX, mobile, performance

- [x] Distinct worker and manager landings, clear navigation, concise forms. **Verified existing.**
- [x] Phone task list, thumb-reach attendance, manager grid. **Verified existing.** Scenario 63.
- [x] Loading, empty, conflict, denied, validation, upload-failure and success states keep drafts. **Verified existing.**
- [ ] Labels, focus, keyboard, dialogs, contrast, reduced motion, 200% zoom. **Partial.** A DOM audit and contrast checks were done. Screen-reader and 200% zoom testing were not.
- [ ] 1440, 1024 and 390 px layouts. **Partial.** 1440 and 390 px were checked, including the new screens this round (0 px overflow). 1024 px was not checked separately.
- [x] Performance with timer, uploads, reports and a large fixture. **Verified existing.** `performance-after.md`; not re-run this round.

## Phase 14 — Security, persistence, reliability

- [x] Authorisation on every read and write; no self-approval. **Verified existing.** `security.test.ts`, evidence and attendance tests.
- [x] Revisions, verification, policy activation and private media protected. **Verified existing.** New evidence record types reuse the project-scope check (integration test this round).
- [x] Transactions and concurrency controls. **Verified existing.**
- [x] Idempotent submissions, scheduler events, imports and upload completion. **Verified existing.**
- [x] Scheduler recovery, cancellation, reconnect, failure, expiry, invalid files, cross-record attacks. **Verified existing.**
- [x] Secrets server-side; demo authentication off in production; fixtures isolated. **Verified existing.** `demo-auth.test.ts`.
- [x] Migrations, setup, configuration and backup guidance; unavailable adapters labelled. **Verified existing.** README. Migration 010 applies on start.

## Phase 15 — Acceptance and handover

- [ ] All 77 master scenarios. **Partial.** Mapping is below. 47 (closed-app push), 72 and 75 (real phone) are not verified.
- [x] End-to-end customer → … → report flow with persistent records. **Verified existing.** `flow.test.ts` (scenario 22).
- [x] Image and video upload and review on task and non-task forms; save without media; failure and retry; private-request access. **Verified existing.** `evidence.test.ts` (scenarios 70, 73, 74, 77), plus this round's activity-photo browser run.
- [x] Before/after latency, shift checks, test results and runnable setup. **Verified existing.** `npm run local`.
- [x] Checklist with statuses and evidence; business decisions listed separately. **Implemented and verified:** this file.

**Checkpoint E:**
- The 480/450 constants are unchanged.
- Actual time is preserved.
- No example-derived defaults were added.
- Unconfigured integrations (push, object storage, transcription, real authentication) are not marked finished.

## Scenario mapping (master prompt §14)

| Scenarios | Where verified |
|---|---|
| 1–3, 5, 6, 23, 36 | `unit/estimation.test.ts`, `unit/skills.test.ts`, `integration/foundation.test.ts`, `unit/site.test.ts` |
| 4, 7–9, 24–28 | `integration/planning.test.ts`, `integration/boundaries.test.ts`, `unit/skills.test.ts` |
| 10–22, 29–33 | `unit/time.test.ts`, `unit/reconciliation.test.ts`, `integration/flow.test.ts`, `integration/security.test.ts`, `integration/queries.test.ts` |
| 34–42 | `unit/expenses-kpi.test.ts`, `integration/queries.test.ts` |
| 43–46, 48–52, 67 | `unit/shift.test.ts`, `integration/attendance.test.ts`, `integration/commercial.test.ts` |
| 47 | Partial: denied permission and in-app alerts work; closed-app push not configured |
| 53, 54 | `performance-baseline.md`, `performance-after.md` (lab measurements) |
| 55 | Server-side scoping in every read (`queries.test.ts`, `evidence.test.ts`) |
| 56, 57, 61 | `unit/site.test.ts`, `integration/site.test.ts` |
| 58, 62 | `integration/flow.test.ts` (reversals, pooled acceptance) |
| 59, 60, 64 | `integration/customer-packages.test.ts` |
| 63 | Browser check at 390 px (`test-evidence.md`) |
| 65, 66 | `example-policy-audit.md`; no retention, rates or limits active |
| 68 | `manual-input-evidence-coverage.md` (rebuilt this round) |
| 69–71, 73, 74, 76, 77 | `integration/evidence.test.ts` |
| 72, 75 | Not verified: needs a real phone and a slow-network run |

## Business decisions still needed

These are not code defects:
- Actual roster, and whether managers count in the 40.
- Approved rates, effort templates, site calendars, travel times, budgets and contract terms.
- Monthly threshold basis, credited activities, catch-up credit and allocation method.
- Clearance exception authority, revision escalation and included or chargeable visits.
- KRA definitions, cohorts and approved targets.
- Media retention, file and codec limits, and storage, push and integration credentials.

## Remaining engineering gaps, in priority order

1. Closed-app push (service worker plus VAPID) and a production object store.
2. Skill requirements per task, and enforcing task dependencies when progress is recorded.
3. An exception path for the materials and skill readiness checks; role templates in estimates.
4. Paging for project time and the tracker views; per-row tracker drill-downs.
5. Milestones; explicit approved and rejected states on overtime requests; a positive "contents verified" package record.
6. Screen-reader, 200% zoom and 1024 px checks; real-phone testing.
