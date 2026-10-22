# Requirements traceability

Sources: **U** = user's direct requirements, **T1–T5** = meeting transcript pages, **W** = `Installation_Head_KRA_Trackers.xlsx`, **E** = engineering proposal from the master prompt (revision 2). Status: **Confirmed** (direct requirement), **Proposed** (engineering choice), **Unresolved** (exposed, not invented). "Verified by" names the test or browser check that exercises it.

## Confirmed requirements

| ID | Requirement | Source | Implementation | Verified by |
|---|---|---|---|---|
| R-01 | Customer → location-based project → multiple orders → order items → components → installation tasks | U, T1 | `001_core.sql` tables; `queries/projects.ts`; Projects pages | `foundation.test.ts` (scenario 1), browser sweep |
| R-02 | ~40 employees, 3 managers, roles: project manager, operator, site supervisor, carpenter, helper, senior/technician/junior/assistant technician, stone technician | U | `seed-master.ts` (40 fictional, 3 manager permission, all 10 roles, 5 cities) | `foundation.test.ts` |
| R-03 | Skill cards and site/task requirements use Low/Medium/High | U | `employee_skill.level 1–3`, `skill_requirement.min_level`; `domain/skills.ts` | `skills.test.ts` (scenarios 2, 3, 25) |
| R-04 | Planning: proposed start, travel, staffing availability, preferred returning team, estimated expenses | U | Plan wizard steps (dates, travel legs, team options with continuity, expenses) | `planning.test.ts`, `boundaries.test.ts`, browser UI run |
| R-05 | Installation plan and timesheet coexist and share records | U | Time entries reference visit/task; expected work derived from reservations | `flow.test.ts` |
| R-06 | Preserve actual hours; extra time solely to finish the original target is ineligible for internal overtime; reviewer verifies facts; no button bypasses the rule | U | `domain/time.ts decideEligibility` (no override parameter); `services/time.ts reviewEligibility` | `time.test.ts` (scenario 11), `flow.test.ts` |
| R-07 | Approved additional scope and documented causes need their own eligibility rules | U | Additional scope = dated `visit_task kind='additional'`; external-delay/other rules configurable (unset = pending policy) | `time.test.ts`, `flow.test.ts` |
| R-08 | Monthly hours reconciliation | T4 | `domain/reconciliation.ts`, `services/reconciliation.ts`, Timesheets → Month settlement | `reconciliation.test.ts` (14, 15, 16, 31, 32, 33), `flow.test.ts` |
| R-09 | Component-level remaining work; repeat visits fetch remaining scope | T5 | `taskUsage`, `createFollowUpVisit`, project scope tab | `flow.test.ts` (scenario 10) |
| R-10 | Daily activity planning (unpack/assemble/install) | T5 | `installation_task.activity` steps, frozen `daily_target` | `flow.test.ts` (scenario 29) |
| R-11 | Accounts and site clearance with documented urgency exceptions | T3 | `clearance`, `clearance_exception`, `clearanceGate` | `planning.test.ts` (scenario 8) |
| R-12 | Fresh / follow-up / final visits with repeat cause | T5 | `visit.visit_type`, `repeat_reason` (required for non-fresh) | `flow.test.ts`, FTR tracker |
| R-13 | Delay causes recorded | T3 | `delay_event` with cause, function, separate employee-fault field | `queries.test.ts` (tracker) |
| R-14 | Quantity/rate estimates; skill mix; separate role effort | T2 | `domain/effort.ts`, `productivity_rate`, `role_template` | `estimation.test.ts` (5, 23, 36) |
| R-15 | Employee capacity booking; tentative dates | T2 | Reservations proposed/held/confirmed, exclusion constraint | `planning.test.ts` (7, 27) |
| R-16 | Estimate-linked travel/meals/lodging | T4 | `estimate_line` bases incl. per-room-night | `flow.test.ts` (18, 19), `expenses-kpi.test.ts` |
| R-17 | Lead/source/conversion history preserved (analytics deferred) | T1 | `customer.lead_*` columns, shown on project page | Seed + project page |
| R-18 | Dashboard and usable responsive frontend | U | 12 essential screens; checked at 390 px and desktop | Browser checks (see test-evidence) |
| R-19 | KRA workbook trackers and KPI reference as views over shared records | W | `queries/trackers*.ts`, `queries/kra.ts`, Reports | `queries.test.ts` (37–42) |

## Proposed (engineering) requirements

| ID | Requirement | Implementation | Verified by |
|---|---|---|---|
| P-01 | Opaque keys + readable business IDs | uuid PKs + `business_id` unique | schema |
| P-02 | Immutable approved revisions, baseline + current pointers | trigger `protect_decided_revision` | `planning.test.ts` (9) |
| P-03 | Append-only audit trail with correlation IDs | `audit_event` + trigger | `foundation.test.ts` |
| P-04 | Permission model, capabilities, no self-approval, server-side scope | `auth/permissions.ts`; every service and query | `planning.test.ts`, `flow.test.ts` (20), `queries.test.ts` |
| P-05 | No double booking / overlapping time under concurrency | GiST exclusion constraints | `planning.test.ts` (7), `flow.test.ts` (33) |
| P-06 | Optimistic versions, idempotency keys | `bumpVersion`, `idempotency_key` | `planning.test.ts` (idempotent booking) |
| P-07 | Source import idempotent, previewed, unit-validated, never rewrites approved revisions | `services/imports.ts`, `integrations/source-adapter.ts` | `boundaries.test.ts` |
| P-08 | Demo identity selector disabled in production | `auth/actor.ts` | Production check (test-evidence) |

## Unresolved requirements (exposed, not invented)

| ID | Issue | Treatment | Where visible |
|---|---|---|---|
| U-01 | Teams of three vs three teams | Default team size 3, configurable per visit; labelled | New plan form, Settings → General |
| U-02 | Are the 3 managers part of the 40? | 40 records, 3 with manager permission; labelled provisional | People page |
| U-03 | Objective High/Medium/Low criteria | No scoring formula; verification is a human decision by a skill-verify holder | People profile |
| U-04 | Normal day/month hours, breaks, holidays | Illustrative calendar and draft policy | Settings → Calendars / Time policies |
| U-05 | Travel / waiting / leave treatment | Separate activities; credited activities and leave adjustment are policy fields | Policy editor |
| U-06 | Monthly threshold vs daily overtime | Configurable monthly-threshold policy; stated as not statutory | Policy page notice |
| U-07 | Which eligible hours consume the monthly cap | `allocation_method` unset blocks finalization | Month settlement blockers |
| U-08 | Eligible candidate intervals | `candidate_rule` (demo: outside schedule only) | Policy editor |
| U-09 | Do catch-up hours earn threshold credit? | `catch_up_threshold_credit` unset blocks; both variants shown | Month settlement |
| U-10 | Role title vs skill level | Qualification only from verified skill records | Skills step, People |
| U-11 | Draft planning vs firm booking clearance | Drafts/holds allowed; firm booking and departure require clearance or exception | Clearance step |
| U-12 | Ten-day planning buffer | Not configured (`planning_buffer: null`) | Dates step |
| U-13 | Productivity rates / role templates | Illustrative only; approval creates a new version | Settings → Rates |
| U-14 | INR 1,000 allowance | Not configured | Settings → General note |
| U-15 | External CRM/estimator/PDA/dispatch APIs | Not integrated; labelled demo fixture adapter only | Projects → Import |
| U-16 | KRA targets, period, FTR definition, cohorts | Reference text kept provisional; everything Not rated until approved | Reports → KRA review |

## V3 requirements (spec of 22 Oct 2026)

Sources: **U3** = the user's 22 Oct clarifications, **B1–B3** = board meetings 1–3 (as consolidated in the V3 spec; transcripts not reopened here), **E3** = V3 engineering proposal.

| ID | Requirement | Source | Status | Implementation | Verified by |
|---|---|---|---|---|---|
| V3-01 | Diagnose and fix slow tab clicks with before/after measurements | U3 | Confirmed, done | Production preview, client navigation, removed reveal-batching placeholder | `performance-baseline.md`, `performance-after.md` |
| V3-02 | Fixed 480-minute regular session from actual clock-in | U3 | Confirmed, done | `domain/shift.ts`, `services/attendance.ts`, DB check constraint | `shift.test.ts`, `attendance.test.ts` |
| V3-03 | Reminder 450 minutes after clock-in, durable and exactly once | U3 | Confirmed, done (in-app + open-tab alerts; closed-app push not configured) | `due_job`, `notification` ledger, runner, bell | `attendance.test.ts` (scenarios 43, 45, 46) |
| V3-04 | Automatic switch to recorded overtime at 480 minutes; no approval implied | U3 | Confirmed, done | `overtime_started` event, OT candidates at clock-out | `attendance.test.ts`, `commercial.test.ts` |
| V3-05 | Keka-inspired worker dashboard, list-first phone view | U3 | Confirmed, done | My day, Attendance, Tasks, Requests | browser flow at 390 px |
| V3-06 | Optional photos/videos on every worker manual-input surface | U3 | Confirmed, done for all listed surfaces | Evidence service, uploader, queue | `evidence.test.ts`, `manual-input-evidence-coverage.md` |
| V3-07 | Example numbers are not policy (₹1,000, ten-day buffer, revision counts, retention, targets) | U3 | Confirmed, done | `example-policy-audit.md` | audit and seeds labelled illustrative |
| V3-08 | Customer contacts without phone/name as account key | B1 | Done | `customer_contact` | `site.test.ts` |
| V3-09 | Net vs gross quantities kept separate; effort uses net | B1 | Done | `quantity_snapshot`, `domain/site.ts` | `site.test.ts` (36, 56) |
| V3-10 | Multiple effort drivers only for separately covered activities | B1 | Done (rates illustrative) | `effort_driver`, `driverEffort` | `site.test.ts` |
| V3-11 | Site restrictions limit productive time, not attendance or estimate | B2 | Done | `site_restriction`, `siteCapacity` | `site.test.ts` (23) |
| V3-12 | Appliance and brand-technician readiness blockers; exceptions kept as risks | B1 | Done | `appliance_dependency`, readiness gate | `site.test.ts` (57) |
| V3-13 | Additional work: approval, chargeable/free/waived, never self-approved | B1 | Done | `additional_work` | `commercial.test.ts` |
| V3-14 | Quoted charges, waivers, estimate, budget, cost kept apart; no "profit" | B1 | Done | `installation_charge`, Charges tab | `commercial.test.ts` |
| V3-15 | Future work brought forward vs catch-up vs additional scope | B3, U | Done | verified reason `authorized_future_task` | `commercial.test.ts` (51) |
| V3-16 | Idle recorded with reason; idle stays idle across 8 h | B3 | Done | activity `idle` | `shift.test.ts` (48) |
| V3-17 | Package manifest, scans, receipt unverified, damage/shortage exceptions | B2 | Done | migration 009, Packages tab, My day scan | `customer-packages.test.ts` (59, 60) |
| V3-18 | Customer journey owner, checklist, communication log (no sending) | B2 | Done | migration 009, Customer tab | `customer-packages.test.ts` (64) |
| V3-19 | Design/measurement requests and revisions; limit unset until approved | B2 | Feature done; limit unresolved | `design_request`, `design_revision`, `design_revision_limit` setting | `customer-packages.test.ts` |
| V3-20 | Explicit substitution keeping the outgoing person's history | B3 | Done | `substitution`, team step form | `site.test.ts` (61) |
| V3-21 | Worker and manager views; adjustable handover window, 7-day preset | B3 | Done | Installations board range filter | browser check |

### V3 unresolved decisions

| ID | Question | Current behaviour |
|---|---|---|
| V3-U1 | Design revision limit and approver | `design_revision_limit` unset: nothing blocks; drafts allowed |
| V3-U2 | Evidence retention (45 days vs one year proposals) | No automatic deletion |
| V3-U3 | Production object storage and closed-app push transport | Local folder adapter; in-app and open-tab alerts only |
| V3-U4 | Paid breaks, lateness and wall-clock start rules | Not modelled; session anchored to actual clock-in |
| V3-U5 | Included/chargeable visit counts | Not modelled as limits |
