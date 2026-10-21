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
