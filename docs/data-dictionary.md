# Data dictionary

Schema: `db/migrations/001_core.sql`, `002_time_money_reporting.sql`, `003_source_refs.sql`. All tables have opaque `uuid` keys; operational tables also have a unique readable `business_id` (CUS-, PRJ-, ORD-, OI-, CMP-, TSK-, PLN-, VIS-, TRV-, EXP-, QC-, ISS-, POL-, RATE-, EMP-).

## Units and representations

| Kind | Storage | Notes |
|---|---|---|
| Time instants | `timestamptz` (UTC) | Returned to the app as epoch milliseconds |
| Intervals | `tstzrange` half-open `[start, end)` | Adjacent intervals do not overlap |
| Local dates | `date` | Calendars, plans, leave, months; returned as `YYYY-MM-DD` |
| Durations | integer minutes | Net = entry minus union of breaks |
| Money | `bigint` minor units (paise) | Rounded once per line, half away from zero |
| Quantities, rates | `numeric(18,6)` | Arithmetic via `domain/decimal.ts`, never binary floating point |
| Quantity kind | text with unit | e.g. `cabinet_surface_area` + `sqft`, `kitchen_floor_area` + `sqft` (different kinds, same unit) |

## Main entities and relationships

```text
customer 1─* project 1─* sales_order 1─* order_item 1─* component 1─* installation_task (─* task_dependency, acyclic)
project 1─* plan 1─* plan_revision (baseline_revision_id, current_revision_id; approved/returned immutable)
plan 1─* visit (stable identity across revisions) ─* visit_order (composite FK: same project only)
visit 1─* visit_task (task + scoped_quantity + kind original/rework/additional + status active/transferred/cancelled)
visit_task 1─* daily_target (frozen; superseded rows kept) and 1─* progress_event (append-only; reversals reference the original)
visit 1─* reservation (employee, role, span, proposed/held/confirmed/released/cancelled) 1─* reservation_activity (work/travel)
travel_leg 1─* travel_participant (employee + visit)
visit 1─3 clearance (accounts/site/installation) 1─* clearance_exception;  visit 1─* readiness_check
visit 1─* delay_event, acceptance;  quality_case, issue (linked to project/order/visit/delay/quality case)
employee 1─* employee_skill (level 1–3, verified, verifier, validity) ; team 1─* team_membership (effective-dated)
work_calendar 1─* holiday ; employee 1─* leave_record
employee 1─* time_entry (revisions via supersedes_id/is_current; state draft/submitted/accepted/returned/voided) 1─* break_interval
time_entry 1─* ot_request (claimed reason, verified reason, decision, policy)
month_reconciliation (employee, month, revision, provisional/final/invalidated, totals JSON) 1─* reconciliation_allocation
estimate 1─* estimate_line ; budget (current per project) ; expense (credits link reverses_expense_id) 1─* expense_allocation
kpi_definition (versioned), kpi_target (provisional/approved), savings_claim (Finance-verified flag)
source_import (system + external_id + revision unique), audit_event (append-only), idempotency_key, app_setting
```

## Enumerations

- Job roles: project_manager, operator, site_supervisor, carpenter, helper, senior_technician, technician, junior_technician, assistant_technician, stone_technician.
- Permission roles: employee, supervisor, manager, admin. Capabilities: accounts_clearance, finance_verify, kra_review, skill_verify, rate_approve, policy_activate, target_approve.
- Plan revision approval: draft → submitted → approved | returned.
- Visit execution: unscheduled → scheduled → in_progress → completed → closed; on_hold; cancelled. Visit type: fresh, follow_up, final.
- Repeat reason: planned_phasing, material_shortage, customer_change, failed_readiness, rework, other_documented.
- Reservation: proposed (non-blocking), held (blocking, expires), confirmed (blocking), released, cancelled.
- Time activity: installation, additional, rework, travel, waiting, other. Time entry state: draft, submitted, accepted, returned, voided.
- Overtime decision: requested, eligible, ineligible, pending_policy. Verified reason: original_target_catch_up, authorized_additional_scope, external_delay, other_documented.
- Delay cause: materials, site_access, equipment, customer, other_function, weather, employee, unknown. Function: Factory, Purchase, Logistics, Services, Site, Installation, Customer, Unknown.

## Formulas

| Name | Formula | Code |
|---|---|---|
| Rate effort | team-days = Q / R(team-day); person-days = team-days × crew (full attendance only); minutes = person-days × net-day minutes of the rate version | `domain/effort.ts` |
| Role effort | role hours = quantity × hours-per-unit, or fixed hours (alternative to rates, never added) | `estimateFromRoleTemplate` |
| Scheduling | effort rounded once to the scheduling granularity, spread over daily available minutes; effort never shrinks | `scheduleEffortAcrossDays` |
| Assignment dates | distinct work ∪ travel dates per employee; elapsed = first → last inclusive | `domain/assignment-metrics.ts` |
| Start date | max(requested, arrival, predecessor, material, clearance, site access) + configured buffer, moved to first working day; missing inputs → tentative + blockers | `domain/scheduling.ts` |
| Coverage | collective: distinct qualifying members via bipartite matching per concurrency group; per-person: every applicable member | `domain/skills.ts` |
| Within / outside schedule | intersect / subtract net work intervals with calendar shifts S | `domain/time.ts workMetrics` |
| Monthly | N (calendar or fixed, minus leave once), Q (credited accepted minutes, catch-up per policy), X = max(0, Q − N), B = max(0, N − Q), E = eligible ∩ Q, cap = min(X, E), allocation deterministic | `domain/reconciliation.ts` |
| Expense line | product(factors) × unit rate, rounded once | `domain/expenses.ts lineAmountMinor` |
| Allocation | largest remainder, ties to earlier target; parts sum exactly | `allocateMinor` |
| Variance | actual − budget; % only when budget > 0 (else N/A) | `varianceSummary` |
| Remaining scope | max(0, scoped − accepted); uncommitted = required − accepted − active commitments | `domain/progress.ts` |
| KPI ratios | aggregate numerators/denominators; zero denominator → N/A | `domain/kpi.ts` |
| FTR | qualifying accepted units without installation rework or unplanned return / eligible completed units; Not rated without an approved definition | `ftr` |
| MIS | complete obligations / expected; on-time complete / expected | `misCompleteness` |
| Scheduled utilization | reserved working-calendar minutes / available minutes after leave (not capped) | `scheduledUtilization` |
| Installation days | inclusive local calendar days; in-progress is an as-of value | `installationDays`, installation tracker |

## V3 entities (migrations 005–009)

| Table | Purpose | Key rules |
|---|---|---|
| `schedule_template`, `visit_schedule_day` | Customer-facing day-by-day installation schedule | Off days from the calendar; days ticked done/slipped (reason required) |
| `shift_instance` | One attendance shift per employee per local work date | `warn_at = t0 + 450 min`, `ot_at = t0 + 480 min` (check constraint); `revision` bumps on approved correction; `clock_out_override` for approved end corrections |
| `attendance_event` | Append-only punches, activities, notes, overtime transition, corrections | Trigger forbids update/delete; one `overtime_started` per shift |
| `attendance_correction` | Clock-in/out correction request and decision | Never self-approved; scope-checked |
| `due_job` | Durable reminder/overtime jobs | Unique per (shift, revision, kind); pending/done/cancelled/superseded |
| `notification` | In-app inbox | `dedupe_key = shift:event`, so each logical event is delivered once; `overdue` for late reminders |
| `leave_request` | Leave / emergency unavailability | Approval creates `leave_record`; private to the manager chain and admins |
| `evidence_asset`, `evidence_link`, `upload_session` | Private image/video evidence | No bytes in the database; parent-type allowlist; link idempotent per (asset, parent) |
| `customer_contact` | Related people per customer account | One active primary per account |
| `quantity_snapshot` | Net installed vs gross/material quantity | Net must match the component's kind and unit; never converted |
| `effort_driver` | Extra disjoint activity drivers | Unique per (component, driver, activity) |
| `site_restriction` | Allowed weekdays/hours and restricted activities | One active per project |
| `appliance_dependency` | Appliance state and brand technician | Blocks readiness unless on site/inspected and the technician is not needed or booked; an exception keeps a risk |
| `substitution` | Crew replacement at an effective moment | The outgoing reservation ends there; the incoming one starts there |
| `additional_work` | Requested extra scope | Approved with a charge type; chargeable needs a quote |
| `installation_charge` | Quoted charge and waiver per order | Waiver ≤ quote; history kept |
| `customer_journey`, `journey_obligation`, `communication_log` | Customer coordination | Logs record what happened; acknowledgement only as recorded |
| `design_request`, `design_revision` | Design/measurement requests | Escalation only if an approved limit is configured |
| `package`, `scan_event`, `package_exception` | Manifest, scans, exceptions | Scans de-duplicated by client event id |

Readable IDs added: AW- (additional work), DR- (design request), PX- (package exception).

### Shift formulas (spec §9)

`elapsed = max(0, tEnd − t0)`; `regularElapsed = min(elapsed, 480)`; `overtimePeriodElapsed = max(0, elapsed − 480)`; `regularWork = |work ∩ [t0, t0+480)|`; `recordedOvertimeWork = |work ∩ [t0+480, tEnd)|`. Breaks, idle and travel keep their own categories; clocked-out gaps are not counted.
