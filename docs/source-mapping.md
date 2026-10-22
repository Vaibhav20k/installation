# Source mapping

## Evidence sources

| Source | Opened in this implementation? | Notes |
|---|---|---|
| `docs/INSTALLATION_MANAGEMENT_CLAUDE_MASTER_PROMPT.md` (rev. 2) | Yes | Primary specification |
| `docs/Installation_Head_KRA_Trackers.xlsx` | Yes (headers read with the `xlsx` package) | 7 sheets; header rows only, no data rows or formulas |
| `docs/installation meeting notes_txt.pdf` | No | Not reopened; the specification's consolidated reading of transcript pages 1–5 was used. The transcript ends with repeated text and a transcription-limit notice, so it is not the whole meeting |

## Workbook: Read Me and KPI Dashboard

`Read Me!A2:B11` guidance (cadence, ownership, baseline rule, FTR definition caution, cost discipline, privacy, review cadence) is reflected in Reports notes and the KRA review notice. `KPI Dashboard!A2:J9` rows are stored verbatim as **provisional reference text** in `kpi_target` (source column records the sheet) and `kpi_definition` (status `reference`). They are never imported as observations; every KPI shows **Not rated** until a definition and numeric target are approved.

## Tracker field mapping (header rows → application)

### Installation Tracker!A1:S1 → Reports → Installation tracker (`queries/trackers.ts installationTracker`)

| Workbook column | Application field |
|---|---|
| Order / Project ID | **Split:** Order ID (`sales_order.business_id`), Project ID (`project.business_id`) |
| Customer / Site | **Split:** Customer ID (`customer.business_id`), Site (project city) |
| Location | Project city |
| Kitchen Area (sq. ft.) | `project.kitchen_floor_area` + unit, labelled "floor area (not installed surface)" |
| Complexity / Type | Source complexity labels on the visit's skill requirements |
| Planned Start / Planned Completion | From the **baseline** revision snapshot; current planned completion shown separately (derived) |
| Actual Start / Actual Completion | First accepted work entry / customer sign-off date when no scope remains |
| Status | Derived: Completed / In progress / order status |
| Days Planned / Days Actual / Days Variance | Inclusive calendar days; actual is "as of" until finished; variance only when finished; lateness vs promised date is a separate derived column |
| Delay Reason / Responsible Function | `delay_event.cause` / `responsible_function` across the order's visits |
| Next Action / Action Owner / Due Date | Earliest open `issue` for the order |
| Customer Sign-off | `acceptance.signed_off` (Unknown when not recorded) |

### Manpower Productivity!A1:O1 → Reports → Manpower productivity (`manpowerTracker`)

| Workbook column | Application field |
|---|---|
| Date | Each planned date of an active visit in the month |
| Location / Site | Project city |
| Order / Project ID | **Split:** Project ID, Order IDs; plus Visit ID (derived) |
| Team / Supervisor | Plan creator |
| Installers Assigned / Support Staff | Distinct booked employees by role group (installer roles vs helper/assistant) |
| Planned Work Hours | Sum of calendar net minutes for booked staff that day |
| Actual Work Hours | Accepted net work minutes that day (person-hours) |
| Overtime Hours | **Split:** outside-schedule hours (fact) and approved overtime hours (finalized allocations only) |
| Output | Accepted progress by unit and quantity kind |
| Kitchens Completed | Distinct kitchen order items signed off that day |
| Idle Hours / Reason for Idle Time | Accepted `waiting` minutes / delay causes that day |
| Productivity Metric | Output ÷ person-hours only when a single quantity kind; otherwise "not combined" |
| Action / Notes | Blank column reserved |

### FTR Complaints Rework!A1:R1 → Reports → FTR, complaints & rework (`ftrTracker`)

Order / Project ID → split IDs; Customer / Site → split; Installation Date → first visit start; Completed on First Visit → literal first-visit completion (no transferred scope, no unplanned return); Repeat Visit Count → **split** planned phased vs unplanned returns, plus causes; Rework Required, Complaint, Complaint Category, Root Cause, Responsible Function → quality cases and rework scope; Extra Labour / Travel / Material / Total Additional Cost → unique approved expense allocations linked to quality cases (by category group); Corrective Action, Owner, Closure Date → quality cases; Customer Sign-off → acceptance.

### Cost Overtime Unloading!A1:R1 → Reports → Cost, overtime & unloading (`costTracker`)

Date, Location; Order / Project ID / Load ID → **split** Project ID, Order ID (allocation), Load ID; Cost Category, Vendor / Supervisor → expense; Approved Budget → linked estimate line per row, project budget in the per-project table (not repeated per row); Actual Cost, Variance, Additional Manpower, Unloading, Repeat Visit Cost → per expense; Overtime Hours / Overtime Cost → per project (cost N/A without Finance-verified records); Approval Available, Reason for Variance, Owner, Approval Reference → expense review fields; Savings / Avoidance Action → savings claims (proposed vs Finance-verified).

### Cross-Functional Issues!A1:P1 → Reports → Cross-functional issues (`issuesTracker`)

Issue ID, Date Raised, Order / Project ID (split), Function, Issue Category, Impact, Delay Days, Estimated Additional Cost, Issue Description, Responsible Owner, Escalated To, Resolution / Next Action, Due Date, Status, Closure Date, Repeat Issue → `issue` columns one-to-one; overdue flag and closure evidence are derived additions.

## Unresolved source conflicts

| Conflict | Treatment |
|---|---|
| Teams of three vs three teams | Team size configurable, demo 3 |
| Whether managers are within the 40 | 3 of 40 have manager permission (provisional) |
| Ten-day buffer | Not configured |
| Numerical overtime examples in the transcript | Not used; illustrative master-prompt fixtures only |
| Workbook targets and period | Provisional reference; not rated |

## Provisional target references (verbatim, never active)

Installation time per kitchen (500–700 sq ft): baseline "10–12 days (current stated range)", target "Confirm target and scope; reference target: 6 days" · FTR "≥95%" · Complaints "40% reduction vs agreed baseline" · Unloading savings "₹1.5–2 lakh/month savings target (validate period/scope)" · Productivity "Set after 2 weeks of reliable data" · Overtime cost "Set after baseline review" · Repeat visits "Reduce after baseline" · MIS "100% complete and on time".

## V3 source mapping (spec of 22 Oct 2026)

The V3 spec consolidates three board-meeting transcripts and the user's 22 Oct clarifications. The transcripts themselves were not reopened here; this mapping follows the spec's consolidation.

| Source | Requirement | Where it lives |
|---|---|---|
| User, 22 Oct | Slow tab clicks fixed with measurements | `performance-baseline.md`, `performance-after.md` |
| User, 22 Oct | Fixed 8-hour session, 7:30 reminder, automatic recorded OT | `domain/shift.ts`, `services/attendance.ts`, `shift-contract.md` |
| User, 22 Oct | Keka-inspired worker self-service | My day, Attendance, Tasks, Requests |
| User, latest | ₹1,000 and other meeting numbers are examples only | `example-policy-audit.md` |
| User, latest | Optional photos/videos on every worker input | `manual-input-evidence-coverage.md` |
| Board 1 | Customer contacts; net vs gross; multiple effort drivers; additional work and charges; appliance readiness | Site & readiness and Charges tabs |
| Board 2 | Customer communication owner; dispatch/receipt scans; shortage/damage attribution; site restrictions; design/measurement revisions | Customer & design and Packages tabs; site window |
| Board 3 | Phone list view; bounded progress; idle time; evidence retention proposals; substitution and leave | Worker views; idle activity; retention inactive; substitution form; leave requests |
| User (original) | Catch-up time ineligible for overtime | Unchanged rule; also applied to attendance-derived OT |

Conflicting proposals kept inactive: design revision limit (two vs other counts), evidence retention (45 days vs one year), included or chargeable visit counts.
