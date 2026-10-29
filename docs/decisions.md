# Decision log

Each entry: decision, reason, alternatives, status. "Proposal" marks engineering choices that were not decided in the meeting.

## Technical decisions

| ID | Decision | Reason | Status |
|---|---|---|---|
| D-01 | New standalone app in `magppie-installation-management/` | No existing installation-management codebase; the Monitoring_review repo is a separate product | Proposal |
| D-02 | Next.js 15 App Router + React 19 + TypeScript strict | Master prompt default stack | Adopted |
| D-03 | PostgreSQL via **embedded PGlite** by default, `DATABASE_URL` for a real server | Runs with zero setup on this machine while keeping real PostgreSQL semantics (exclusion constraints, ranges, triggers). Both paths share one client (`src/server/db/client.ts`) | Proposal |
| D-04 | **Hand-written SQL migrations instead of Prisma** | The integrity rules (GiST exclusion constraints, range types, partial unique indexes, immutability triggers) are not expressible in Prisma's schema; disk space was also exhausted during setup. Migrations are numbered and applied once each in a transaction | Deviation from default, documented |
| D-05 | **Plain CSS design tokens instead of Tailwind/Radix** | One small token system (`globals.css`), native `<dialog>`, semantic controls; avoids extra dependencies. No design skill was loaded; the spec's own design rules were applied directly to avoid conflicting recipes | Deviation, documented |
| D-06 | Vitest for domain + integration tests; browser verification through the in-app browser instead of Playwright | Playwright browsers were not installed (disk constraints). Integration tests run real services against a real in-memory PostgreSQL | Deviation, documented |
| D-07 | Money in integer paise, time in integer minutes, quantities in 6-digit fixed decimal (`domain/decimal.ts`) | Master prompt invariants | Adopted |
| D-08 | Timestamps stored UTC; `Asia/Kolkata` default display/settlement timezone; per-project timezone column | Master prompt | Adopted |
| D-09 | Errors are structured (`validation`, `forbidden`, `conflict`, `not_found`, `unavailable`, `unexpected`) and converted at the service boundary; unexpected failures log only a correlation ID | Master prompt section 12 | Adopted |
| D-10 | Reservation span = itinerary (departure → return) when known, otherwise whole local work days | Outstation occupancy must block local assignments until return | Proposal |
| D-11 | Plan edits require an open draft revision; editing an approved/returned plan needs a change reason and creates the next revision | Immutable approvals, reapproval on change | Proposal |
| D-12 | Firm booking requires: approved latest revision, valid clearances (or exception), full skill coverage; revalidated inside one transaction | Master prompt section 8 | Adopted |
| D-13 | Holds expire via indexed timestamp filtering and cleanup on booking/read paths; no background job | Master prompt | Adopted |
| D-14 | Team suggestion: bounded date horizon (default 30 days) and per-date combination budget (20,000); after the first feasible date only the intact preferred team is searched further | Deterministic and explainable; avoids combinatorial blow-up | Proposal |
| D-15 | Reporting obligation grain for MIS: one accepted timesheet per assigned working day, due end of next day | Needed to compute completeness/timeliness | Proposal (needs approval) |
| D-16 | Embedded database folder defaults to `%LOCALAPPDATA%` (or `~/.local/share`), not the project folder | The project is inside OneDrive, which locked the database files mid-write and prevented reopening. An app-level lock file prevents two processes from opening the same folder and clears stale PGlite locks | Adopted after an observed failure |
| D-17 | `dev`/`build` clear `.next` first when the project is under OneDrive | OneDrive converts an existing `.next` into cloud placeholders, after which Next.js fails with `EINVAL readlink`. A junction to a local folder was tried and broke module resolution, so it was reverted | Workaround; moving the project out of OneDrive removes the need |
| D-18 | Route-level `loading.tsx` removed | React 19 reveals streamed Suspense content on animation frames; in background/hidden tabs it never appeared. Pages now render fully in the initial HTML | Adopted after an observed failure |

## Business-policy decisions (demo settings, not approvals)

| ID | Setting | Demo value | Why |
|---|---|---|---|
| B-01 | Default team size | 3 | Unresolved U-01; configurable |
| B-02 | Clearance policy | Firm booking needs accounts, site and installation; exceptions only for accounts; holds before clearance need manager permission | Unresolved U-11 |
| B-03 | Hold duration | 48 hours | Needed for deterministic expiry |
| B-04 | Time policy POL-001 | Draft, illustrative, fixed N = 12,000 min, credited: installation/additional/rework/travel; catch-up credit, allocation and leave adjustment **unset** | Keeps months provisional until decided (scenario 16/32) |
| B-05 | Rates and role templates | Illustrative v1 rows (e.g. 40 sq ft/team-day, crew 3, 480 net min) | Unresolved U-13 |
| B-06 | Capabilities | EMP-001 accounts clearance + KRA review + skill verify + policy activate (second approver so policy changes have four eyes); EMP-002 Finance verify + KRA review; EMP-003 skill verify; EMP-004 (admin) rate approve, policy activate, skill verify, target approve | No extra headcount invented |
| B-07 | Installation Head accountability | Assigned to EMP-001 in settings | Accountability role on an existing employee |

## Gates defined here

- **Visit completion:** all active scoped tasks accepted, or transferred/cancelled with a reason.
- **Project closure:** not automated. A project is closable only when every order's required quantity is accepted or explicitly cancelled, no visit is in progress, and no month reconciliation or expense for it is pending. This gate is shown through the dashboard counts; an explicit close action is deferred (see phase-status).
- **Month finalization:** policy approved, month ended, every expected day accepted or reviewed-missing, no unresolved exceptions, no pending eligibility reviews, all needed policy fields set; manager, not self.

## V3 decisions (22–23 Oct 2026)

| ID | Decision | Reason | Status |
|---|---|---|---|
| D3-01 | Local production preview (`npm run local`) with demo identities behind `IM_LOCAL_DEMO`, test-covered | Dev-mode compile was the measured cause of slowness; production stays locked | Proposal, done |
| D3-02 | No route-level loading placeholder; tab-level `useLinkStatus` feedback instead | The placeholder made React reveal pages in ~300 ms batches (traced) | Proposal, done |
| D3-03 | Shift state derived from server timestamps on every read; jobs only record transitions and notify | A late or restarted runner never shows a wrong state | Proposal, done |
| D3-04 | Due jobs settled by an in-process 30 s runner plus every read; production can use `/api/jobs/run` | No request-bound timers; survives restarts | Proposal, done |
| D3-05 | Clock-out exactly at t0+480 cancels the boundary job instead of running it | "Clock-out at 17:00 produces no open overtime session" | Done, tested |
| D3-06 | Same-day clock-in resumes the shift (same anchor) and re-arms cancelled jobs | No second eight-hour allowance; delivered events never repeat | Done, tested |
| D3-07 | A missed clock-out is never auto-closed; only an approved clock-out correction closes it | No fabricated end times | Done, tested |
| D3-08 | Overtime period for attendance-derived time is after t0+480, not the calendar schedule | The confirmed fixed-session rule | Done, tested |
| D3-09 | Evidence bytes in a private storage adapter, metadata in the database; content sniffing; signed short-lived upload URLs; permission re-checked on link and download | Spec storage contract | Done; production store not configured |
| D3-10 | Upload queue outside React (module singleton), at most 2 in parallel | Survives route changes; never re-renders the timer | Done |
| D3-11 | Leave visible only to the requester, manager chain and admins | Restricted personal requests | Done, tested |
| D3-12 | Package status derived from scan events; "receipt unverified" once the visit is under way | A missing scan is not loss | Done, tested |
| D3-13 | Feature CSS split into `src/styles/features.css` | Keep files under 500 lines | Done |
| D3-14 | Clock-in requires a fresh front-camera photo (server-enforced); clock-out does not | Direct user instruction (23 Oct). This overrides the spec's optional-media principle for clock-in only; no network or camera means no clock-in, with supervisor correction as the fallback | Done, tested |
| D3-15 | Idle reason chosen from a fixed list with "Other" free text | Direct user instruction (23 Oct); keeps reasons comparable in reports | Done |
| D3-16 | Managers can add crew to any open visit (team size grows) and replace any member from a moment; replacing before a booking starts hands over the whole booking | Direct user instruction (23 Oct): plans needing more than 3 people; sick or absent workers | Done, tested |
| D3-17 | Skill coverage judged period by period: membership changes split a visit, and each period must be covered by the people booked in it | Checklist phase 4, concurrent qualified presence: a team's total over the visit can hide a gap after a replacement | Done, tested |
| D3-18 | A recorded site window narrows the company calendar (schedule days and suggestion working days) and never widens it | Checklist phase 5: an eight-hour session does not authorise work on a day the site bars | Done, tested |
| D3-19 | Itinerary order and leg reachability are checked against the supplied dates only; no travel-time model is invented | Checklist phase 6; no distance or travel-time data exists | Done, tested |
| D3-20 | Saved planning filters live in the viewer's browser as links; columns already did | Per-viewer convenience, not operational data | Done |
| D3-21 | Activities and the overtime reason take photos after the fact (pick, then Attach) rather than inside the one-tap switch | Keeps the activity switch a single tap; evidence never delays recording | Done |
| D3-22 | Employee skill cards are Admin-only: the page returns not-found for anyone else, every card query and action checks the Admin permission, and card evidence and portraits are readable only by administrators (even by the person who uploaded them, after a role change) | Request of 23 Oct: navigation hiding is not enough | Done, tested |
| D3-23 | Card availability is derived on every read: approved leave, then travel inside a held or confirmed booking, then a booking, else the work calendar; missing facts or an inactive person show Unknown, never Available. "Next available" looks 90 days ahead and says so when it finds nothing | No editable availability flag; never guess | Done, tested |
| D3-24 | Skill changes are written to an append-only `employee_skill_change` history from every path (People page, cards, verification). Changing a level clears verification; verification stays a separate step with the skill-verify capability and no self-verification | Editing must never silently verify | Done, tested |
| D3-25 | "Assign plan" reuses the staffing, booking and crew-change services. A draft may hold a partial team (non-blocking proposals, gaps listed); confirming needs a complete team, an approved plan and clearance; a booked visit takes people from a chosen moment. A staffing change on an approved plan creates the new revision, which needs approval before booking | No admin bypass; one person never reads as a full team | Done, tested |
| D3-26 | Cards show operational facts only: no XP, rarity, scores or rankings. Experience is counted from real bookings (completed visits, projects, first booking) | Request of 23 Oct | Done |

## Site operations decisions (recording "gursaharan sir notes installation", 27 Oct 2026)

| # | Decision | Why | Status |
|---|---|---|---|
| D4-1 | Site presence is its own record (`site_presence`), linked to the day's shift but never starting, resetting or ending it. Times are stamped by the server; a repeated check-in or check-out returns the same record; the database refuses overlapping or second open sessions | Daily attendance and site presence are different facts | Done, tested |
| D4-2 | A check-out left open past its site-local date is flagged `missed_checkout`, stays uncounted and can only be closed by a supervisor correction with a reason (append-only `site_presence_change`). The worker can check in again the next day | Never invent an overnight check-out | Done, tested |
| D4-3 | Proposed reporting rules: planned site days are the distinct local dates of the person's bookings; recorded site days are the distinct site-local dates touched by completed sessions, half-open `[in, out)`, overlaps merged, split at local midnight; duration is the union. A short visit is a date of presence, not a paid day; no minimum hours, no cost conversion | Recording's definitions; payroll untouched | Done, tested |
| D4-4 | Handover due date = last day of the customer schedule (its final step is the handover), else the planned end. Date-only rule: overdue once the site-local date is after the due date. Completed and closed visits are never overdue; a missing date shows "Handover date not set" | Existing dates; no invented cut-off time | Done, tested |
| D4-5 | Calendar counts distinct visits per date (scheduled working days, or the planned range without a schedule). "1st/2nd/3rd visit" uses the existing visit sequence with no maximum | The recording's "first to fourth installation" is not otherwise defined | Done, tested |
| D4-6 | The Map view lists sites by city with a "Map not set up" notice: the app has no map provider and no stored coordinates, and none were invented | Source boundary | Done |
| D4-7 | Work plan: managers (project scope) create dated tasks; each checklist line repeats on every task date. Items are shared by the task team, so one tick counts once. Ticks are "worker reported"; quantity acceptance and customer sign-off are unchanged. Unticking needs a reason; moves keep the original date; dates outside the visit plan are flagged, not absorbed | No progress multiplication, no approval bypass | Done, tested |
| D4-8 | Skill correction (level and notes, with a reason and history) is open to supervisors and above for people in their scope; the Admin skill cards call the same service. Role changes stay Admin-only, as before | Reuse, no second employee record | Done, tested |
| D4-9 | Not built: total site cost (unclear phrase around 02:08–02:15, no rates given), live tracking or GPS proof | Out of scope for this recording | Open question |
| D4-10 | Managers and administrators start on Installations; the plan list has a handover calendar beside it ("2 due" / "1 late" chips, late dates blink red, hover or tap lists the day's installations, months change in the browser) | Request of 27 Oct | Done |
| D4-11 | The Map view uses MapLibre GL (pinned 6.14.0, loaded only on that view) with OpenFreeMap vector tiles: free, no key or account. Its tile worker is served by the app at `/api/map-worker`. Site locations are new nullable columns on `project`, set by managers by clicking the map or pasting coordinates or a map link; addresses are never sent to a geocoder. Demo projects carry approximate locality coordinates | Request of 27 Oct; no paid provider; customer addresses stay in the app | Done, tested |
