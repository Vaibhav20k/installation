# Installation Management

Installation planning and workforce management: customer → location-based project → orders → components → installation tasks, skill-based team suggestions, travel, accounts/site/installation clearance, daily execution, timesheets, monthly time reconciliation, expenses and KRA reporting.

**All people, customers, rates, calendars, policies and targets in the demo are fictional or illustrative.** They are not company records, approved payroll settings or approved KRA targets.

## Requirements

- Node.js 20 or later (tested with Node 24.18 on Windows 11)
- No database server is needed for the demo: an embedded PostgreSQL (PGlite) is used unless `DATABASE_URL` is set.

## Run it

```bash
npm install
```

```bash
npm run dev
```

For smooth day-to-day use on this machine, run the production build instead. Pages load in well under a second and nothing compiles on first visit, while demo identities stay on (`IM_LOCAL_DEMO=1`):

```bash
npm run local
```

Open http://localhost:3300 and choose a demo identity. Once inside, switch person at any time from the ID chip in the top bar (phone) or the "Switch person" list under the menu (desktop). On first start the embedded database is created, migrated and seeded through the application services (takes ~15 seconds).

Useful identities: **EMP-001** (manager, accounts clearance, KRA review, policy approval), **EMP-002** (manager, Finance verification), **EMP-004** (administrator: rate approval, policy activation, target approval), **EMP-005** (site supervisor), **EMP-010** (carpenter, booked on the October visit).

```bash
npm run check
```

runs the TypeScript check and all tests (unit + integration against an in-memory PostgreSQL).

```bash
npm run build
```

then `npm start` serves the production build. In production the demo identity selector is disabled; connect an authentication provider in `src/server/auth/actor.ts` (`resolveActor`).

```bash
npm run db:reset
```

recreates the embedded demo database (stop the dev server first; it refuses to run while a server holds the database and never touches `DATABASE_URL`).

## Configuration

Copy `.env.example` to `.env.local`.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | unset | Use an external PostgreSQL 14+ server instead of the embedded one. The `btree_gist` extension must be available. Migrations run automatically on start. |
| `IM_DATA_DIR` | `%LOCALAPPDATA%\magppie-installation-management\pg` (Windows) or `~/.local/share/...` | Embedded database folder. Keep it out of OneDrive/Dropbox. |
| `IM_DISABLE_DEMO_AUTH` | unset | Set `1` to disable the demo identity selector outside production too. |
| `IM_LOCAL_DEMO` | unset | Set by `npm run local` only: keeps demo identities on in a local production build. Never set it on a shared server. |
| `IM_EVIDENCE_DIR` | `%LOCALAPPDATA%\magppie-installation-management\evidence` | Private folder for photo/video evidence (local storage adapter). Keep it out of OneDrive. |
| `IM_EVIDENCE_STORAGE` | unset | Set `off` to simulate unavailable storage: entries still save; attachments show as unavailable. |
| `IM_EVIDENCE_SECRET` | random per process | Secret for short-lived upload links. Set a fixed value on a server so links survive restarts. |
| `IM_JOB_SECRET` | unset | Enables `POST /api/jobs/run` (header `x-job-secret`) for a production scheduler to settle shift reminders and overtime transitions. Unset = endpoint disabled. |
| `IM_DISABLE_JOB_RUNNER` | unset | Set `1` to switch off the in-process 30 s due-job runner (for example when a cron calls `/api/jobs/run`). |

Business settings (team size, hold hours, search horizon, clearance policy) live in `app_setting` and are listed under Settings → General. Time policies, productivity rates and KPI targets are versioned and approved in the app (Settings).

### OneDrive note

This folder is inside OneDrive. OneDrive turns an existing `.next` build folder into cloud placeholders, which breaks Next.js (`EINVAL readlink`). `npm run dev` and `npm run build` therefore clear `.next` first when the path contains "OneDrive" (cold compile each start). Moving the project outside OneDrive removes this.

## Demo walkthrough

### Worker (phone), V3

1. Sign in as a field employee (for example EMP-015) and open **Today**. Tap **Clock in**: the regular session is 8 hours from that moment, the reminder comes at 7 h 30 m, and after 8 h the time is recorded as overtime automatically (approval stays separate). Switch Working / Break / Idle / Travel; idle needs a reason.
2. Record task progress with the stepper and optionally add photos or a video; uploads continue in the background while you switch tabs or clock out.
3. **Attendance** shows each day's regular work, time recorded after 8 hours and what review decided; request a clock-in/out correction there. **Requests** holds leave/unavailability (private to your manager chain) and the status of every request. **Tasks** lists everything you are booked on.
4. On site: **Receive packages** (type the code or scan with the camera), report a missing or damaged item, or record a request for additional work.

### Manager and installation head

1. **Dashboard** (EMP-001): upcoming visits, clearance blockers, pending approvals, accepted work/travel, expense variance. Each figure has a definition and a drill-down.
2. **Planning → Timeline / Planning sheet**: confirmed, held, proposed and leave segments; one row per visit with conflicts, next action, owner, column chooser and CSV export.
3. **New plan** (EMP-005 or EMP-008) → visit wizard: scope → estimate (8 team-days = 24 person-days for 320 sq ft) → dates & travel legs → skills → clearances & readiness → team options (earliest vs strongest continuity, bounded search statement, tie-break rules, exclusions) → expenses → review & submit.
4. **Approve** as EMP-001 (another manager than the submitter), set clearances or record an accounts exception, then **Firm booking** on the team step. Booking without clearance is refused.
5. **Daily execution**: freeze targets, start the visit (blocked until readiness passes), record progress, reverse an entry, record a delay, transfer remaining shutters, create a follow-up visit that carries only the remaining scope.
6. **My day** (EMP-010, phone width): today's tasks, progress entry, start/end/breaks, blocker report.
7. **Timesheets**: within vs outside schedule, overnight entries, overtime review requests, corrections as revisions; **Month settlement** shows N, Q, X, E, cap and every blocker.
8. **Approvals**: plans, time, overtime eligibility (catch-up stays ineligible) and expenses; nobody approves their own submission.
9. **Settings → Time policies**: EMP-004 drafts a version and sets the unresolved fields; EMP-001 previews it against the sample cases and approves it for demo use (nobody approves their own version); months can then finalize.
10. **Reports**: KRA review (everything Not rated until approved), the five workbook trackers, safe CSV export. **Projects → Import orders** previews the labelled demo source fixture.

V3 additions for managers: **Approvals** also holds attendance corrections, missed clock-outs, leave and additional work. Each project has **Site & readiness** (contacts, net vs gross quantities, effort drivers, site window, appliances), **Charges & extra work**, **Customer & design** (journey, checklist, communication log, design/measurement requests) and **Packages**. On a booked visit's team step a manager can **replace a crew member** from a chosen moment.

## Architecture

```text
src/app/            routes (App Router), server actions (src/app/actions), CSV route handlers
src/components/     UI primitives and feature components (no calculations)
src/domain/         pure calculations: decimal, intervals, effort, skills, team suggestion, time, reconciliation, expenses, KPI
src/server/services use cases: validation (zod), permission, state, scope, version, transaction, audit
src/server/queries  scoped read models for screens and exports
src/server/db       client (embedded or external), migrations runner, seeds
src/integrations    source adapter interface + labelled demo fixture; evidence storage adapter (local private folder)
db/migrations       SQL schema with exclusion constraints and immutability triggers
tests/unit          domain tests (master-prompt scenarios with exact figures)
tests/integration   services against a real in-memory PostgreSQL (concurrency, scope, flows)
docs/               requirements, decisions, phase status, test evidence, data dictionary, source mapping, resume notes
```

## Integration contract

No external CRM, estimator, PDA or dispatch system is connected, and none of their schemas are assumed. A live source must implement `SourceAdapter` in `src/integrations/source-adapter.ts` (`fetchOrders()` returning orders with stable external IDs, revision, matched project business ID, items and components with quantity, unit and quantity kind). Imports are previewed, validated (units per quantity kind, project/customer match, quantities not below accepted progress), applied idempotently per system + external ID + revision, and raise a review issue for approved plans instead of rewriting them.

## Deployment notes (not deployed)

Public deployment is a separate, authorised step. Before it: connect a real authentication provider (demo sign-in is off in production), wire a private object store into `src/integrations/storage.ts`, set `IM_EVIDENCE_SECRET`, choose the due-job runner (in-process or a cron calling `/api/jobs/run` with `IM_JOB_SECRET`), and configure web push (VAPID keys and a service worker) if closed-app alerts are wanted. None of these is configured today.

## Backup and restore

- **Embedded database:** stop the server, then copy the data folder (see `IM_DATA_DIR`) to a backup location; restore by copying it back while the server is stopped.
- **External PostgreSQL:** use `pg_dump -Fc` / `pg_restore`. All integrity rules are in the schema, so a restored database enforces them.
- **Evidence files:** back up the evidence folder (`IM_EVIDENCE_DIR`) together with the database; rows reference files by key.

## Limitations

See `docs/phase-status.md` for the full list. Key ones: demo authentication only (no provider configured); no live source integrations; evidence uses a local private folder (no production object store, no thumbnails or transcoding); in-app and open-tab browser alerts only (closed-app push not configured; no SMS/email/WhatsApp); no offline mode; performance figures are lab emulation, not real phones.
