# Test evidence

All results below were produced on 21 Oct 2026 on Windows 11, Node 24.18, Next.js 15.5.28, PGlite 0.5.11 (PostgreSQL 18.6). No result is claimed that was not run.

## Automated tests

```bash
npm run check
```

Final run: `tsc --noEmit` exit 0; **Vitest 12 files, 92 tests, all passing.**

| File | Tests | What it proves (master-prompt scenario numbers) |
|---|---|---|
| tests/unit/estimation.test.ts | 14 | Decimal maths; 5 (8 team-days = 24 person-days); 23 (8-h rate-day vs 6-h calendar); 36 (quantity kinds); 6 (assignment dates, weekend gap, 30 person-assignment dates); schedule start blockers; hotel nights |
| tests/unit/skills.test.ts | 11 | 2 (unverified High); 3 (distinct people per simultaneous slot); 4 (preferred team, mandatory continuity); 25 (mid-work expiry, disjoint crew presence); 26 (team size 4, bounded search statement, determinism) |
| tests/unit/time.test.ts | 6 | 11 (11 h net / 9 within / 2 outside; catch-up ineligible, no override); 12 (22:00–02:00 = 210 min, day/month split); 13 (overlaps vs adjacency, breaks) |
| tests/unit/reconciliation.test.ts | 11 | 14, 15 (exact N/Q/E/X/cap); 16, 32 (unset fields block; both catch-up credit variants); 33 (60 + 30 partial allocation; no double minutes); 31 (cross-project, cross-month split); leave once; finalization gates |
| tests/unit/expenses-kpi.test.ts | 15 | 18 (2 rooms × 3 nights × ₹1,500 = ₹9,000); 19 (residual paise, N/A %); 10, 24 (remaining scope, reversals); 34, 35 (FTR Not rated, 19/20 = 95%, summed cohorts); 37–40; 42 (CSV escaping) |
| tests/integration/foundation.test.ts | 6 | Seed shape (40/3/10 roles/5 cities); 1 (customer → 2 projects, project → 2 orders); DB-level validation; append-only audit; value types |
| tests/integration/planning.test.ts | 7 | 1 (cross-project order link rejected); out-of-scope supervisor forbidden; 24 (concurrent scope commit, one wins); 8, 9 (blocked booking, exception, idempotent booking, immutable baseline); 7 (concurrent bookings, one conflict); 27 (proposal non-blocking, hold blocks until expiry); 4, 26 |
| tests/integration/flow.test.ts | 7 | 22 (plan → approval → clearance → readiness-gated start → progress → completion with transfer → follow-up → timesheet → reconciliation); 29; 10; 11, 20; 15, 31, 33 (concurrent finalize allocates once: 120 min); 17, 30 (amendment invalidates the final month); 18, 19 |
| tests/integration/queries.test.ts | 5 | Operational seed via services; 21 (dashboard counts = detail rows); read scope; every read model; 37–42 (trackers, KRA Not rated, CSV) |
| tests/integration/boundaries.test.ts | 5 | Source import preview / unit rejection / idempotent apply / approved revision unchanged / review issue; manager preview scope; 27 (travel legs, outstation occupancy blocks same-day local work); 28 (proposal moves nothing); 30 (unbooked work exception, returned entry history) |
| tests/integration/security.test.ts | 4 | Recorder cannot accept the entry they recorded; employee cannot submit plans; revision author cannot approve via another submitter; credits need approved original and supervisor role and cannot exceed it concurrently; per-user idempotency |
| tests/integration/perf.test.ts | 1 | Observed timings (below) |

## Observed timings (perf.test.ts, demo dataset)

Dataset: 40 employees, 4 visits, 9 time entries, 9 reservations. Dashboard 53 ms; planning board (28 days) 9 ms; planning sheet 21 ms; KRA review 26 ms; manpower tracker 27 ms; team suggestion 39 ms over 6,545 combinations. The dataset is small; these are not benchmarks for production volumes.

## Production build and production-mode authentication

- `npm run build`: compiled successfully; 18 routes.
- Production server (`next start`, NODE_ENV=production) on port 3311: `GET /` → 307 to `/sign-in`; `/sign-in` → "Sign-in not configured"; `GET /` with a forged demo cookie → 307; `GET /api/export/kra` → 401.

## Browser checks (in-app browser, dev server)

- All 21 top-level routes and 45 detail pages/steps returned 200 with one `h1` and no error notices (signed in as EMP-001 and EMP-004).
- UI workflow driven through real forms as EMP-008: add scope → estimate shows 8 team-days / 24 person-days / 192 h (provisional) → save skill requirements → find teams (earliest option, bounded search statement) → propose team → submit plan. As EMP-004: create customer, project, order, order item and component (three dependent tasks); import preview (update / new / rejected-unit rows).
- Accessibility (DOM audit of 29 pages): every input/select/textarea labelled, no duplicate IDs, no unnamed buttons or links, one `h1` per page. Colour tokens: all text/background pairs ≥ 5.1:1 (WCAG AA).
- Responsive: at 390 px width no page-level horizontal overflow on Dashboard, Timesheets (week and month), Projects, Expenses, Reports, People, Settings, My day; wide tables scroll inside their containers.

## Limitations of the evidence

- Screenshots could not be captured: the browser pane was hidden for the whole session and its screenshot calls timed out. Visual quality was checked through DOM, layout-overflow and contrast measurements, not by eye.
- Pointer clicks also required a drawn pane, so form tests submitted through `form.requestSubmit()` and React-compatible value setters; the same handlers and server actions ran.
- Keyboard-only operation and 200% zoom were not exercised interactively; semantic controls, visible focus styles and native dialogs with focus restoration are in place.
- No Playwright suite exists (browsers not installed); integration tests cover services against a real PostgreSQL engine instead.
- External PostgreSQL (`DATABASE_URL`) was not exercised; only the embedded engine was.

## V3 evidence (22–23 Oct 2026)

Same machine; Chrome headless via puppeteer-core for browser checks.

### Automated tests

`npx tsc --noEmit`: 0 errors. `npx vitest run`: **22 files, 146 tests, all passed** (18.7 s). One earlier full run under heavy CPU load from a concurrent build reported 121/136; three clean reruns passed, so the cause was timing pressure, not a defect.

| File | Tests | What it proves (spec scenario numbers) |
|---|---|---|
| `unit/shift.test.ts` | 10 | 480/450 constants, 09:00 and 10:15 starts, midnight (43, 67); clock-out at 16:00 and exactly at 17:00 (44); 09:00–19:00 with a break gives 7 h regular + 2 h recorded OT (11); idle across the boundary (48); resume keeps the anchor (49); draft rows |
| `integration/attendance.test.ts` | 12 | Durable jobs: no reminder at 16:29:59, exactly one at 16:30 even when processed twice (43, 45); a 5-minute-late runner records OT effective 17:00 (46); catch-up message and OT candidate (51); early and exact clock-outs (44); resume re-arms jobs; missed clock-out stays provisional (52); corrections never self-approved, anchor moves with a new revision (50); leave decided only by the manager chain |
| `integration/evidence.test.ts` | 6 | Photo + video upload, sniffing, linking, captions, idempotent link (70); disguised/oversize/PDF rejected; cross-worker link and download blocked; leave media private (73); draft vs linked removal (74); storage off reports unavailable while the record saves (77) |
| `unit/storage.test.ts` | 3 | Upload token binding; content sniffing for allowed and rejected formats |
| `unit/site.test.ts` | 6 | Net 100 vs gross 125 (56); drivers without rates are unknown, not zero; kinds must match (36); six-hour site window adds a day (23); appliance blockers and risks (57) |
| `integration/site.test.ts` | 4 | One primary contact; net kind/unit enforced; appliance in the readiness gate, manager exception becomes a risk (57); day-4 substitution keeps days 1–3, blocks overlapping and non-manager substitutions (61) |
| `integration/commercial.test.ts` | 3 | Additional work never self-approved, chargeable needs a quote, free-of-charge allowed; charges/waivers/costs separate with no profit field; future-task OT outside schedule, pending policy; catch-up ineligible (51) |
| `integration/customer-packages.test.ts` | 4 | Journey and logs never claim delivery; revision limit unset never blocks (64); receipt unverified, de-duplicated scans, unknown codes kept (59); damage exception with separate responsibility and charge (60) |
| `unit/demo-auth.test.ts` | 3 | Demo identities off in production unless the local preview flag is set |

### Browser checks (production build)

- Worker flow at 390 px (EMP-015, EMP-020): clock in → regular state; photo uploaded and linked to the progress event; the timer kept its anchor across route changes; 0 px overflow; no console errors.
- Every V3 screen at 390 px and 1440 px (Site, Charges, Customer, Packages tabs, Approvals, Installations with a 14-day window): HTTP 200, one h1, no error page, no console errors, no horizontal overflow.
- Lightweight DOM accessibility audit on 12 pages (forms opened): no unlabelled fields, no unnamed buttons or links, alt text present, no duplicate ids, no heading jumps, primary controls at least 40×40 px, visible focus on the first tab stop. This is not a full WCAG audit; screen-reader testing and 200% zoom were not performed.
- Bugs found in the browser and fixed: the stamp animation widened phone pages and hid the bottom bar (contained); the app bar overflowed at 390 px (wordmark shortened); the 7:30 and 8:00 labels collided (separated); missing favicon 404 (icon added).

### Performance

See `performance-baseline.md` and `performance-after.md`: tab click to usable page went from 73/93 ms (median/p95, full reloads) to 40/64 ms. On the large fixture, every documented budget was met: desktop p95 at most 148 ms; mobile-profile p95 at most 386 ms; feedback p95 74 ms desktop and 6 ms mobile.

### Not verified

Real phones (sticky hover, tap delay, safe areas, keyboard, camera capture); closed-app push; production object storage; behaviour with a real authentication provider.

## Checklist round (23 Oct 2026)

`npx tsc --noEmit`: 0 errors. `npx vitest run`: **23 files, 162 tests, all passed** (three forks; with the default pool and the local server running, five workers crashed from memory pressure, then passed on rerun). `npm run build` succeeded.

| New or changed test | Proves |
|---|---|
| `unit/itinerary.test.ts` (7) | Departure ≤ start ≤ end ≤ return; outbound arrives by the start date and return leaves after the last day, in the site's local date; a site closed on Saturdays pushes schedule work past it |
| `unit/skills.test.ts` (+3) | Coverage by period: a qualified senior replaced by an unqualified person leaves the later period uncovered, named by date; a qualified replacement covers it; a part-visit member is checked against team size per period |
| `integration/boundaries.test.ts` (+1, +2 assertions) | Out-of-order visit dates refused; late outbound and early return legs refused |
| `integration/evidence.test.ts` (+1) | Measurement photos link to the measurement record; a worker outside the project cannot attach |
| `integration/site.test.ts` (fixed) | The whole-booking replacement test picked the outgoing person by random UUID order, so it sometimes chose the only qualified member, and the app correctly refused. It now tries each member |

Browser (production build on :3300):
- **Saved filters:** saved and reopened as EMP-004.
- **Expenses:** totals cover all matching records.
- **Readiness checklist:** each check shows a photo option, with no overflow.
- **Clock-in camera:** loads on demand; with the camera blocked it falls back to the picker.

Headless Chrome with a fake camera, as EMP-020 at 390 px:
- clocked in with a photo
- switched to Travel
- attached a photo to that activity ("1 attachment linked")
- 0 px overflow and no console errors

This left an open shift for EMP-020 in the demo database.

## Employee skill cards (24 Oct 2026)

`npx tsc --noEmit`: 0 errors. `npx vitest run` (three forks): **25 files, 176 tests, all passed**. `npm run build` succeeded.

| Test | Proves |
|---|---|
| `integration/skill-cards.test.ts` (10) | Manager, supervisor and worker refused by every card query and action; the page is admin-only. 40 people paged 24 at a time, with derived availability, current visit and next available date. Releasing a booking makes the person available. Skill, minimum-level and expired filters work. A level change clears verification, records why (level, notes, unverified) and refuses a stale version; history is append-only. Verification uses the existing capability rule; self-verification is refused; duplicate skills are refused. Card evidence is admin-only to link and to read. A one-person draft is saved as non-blocking proposals and reported incomplete; confirming an incomplete team is refused. Attendance rows are unchanged. Inactive people and out-of-order dates are refused. **Two simultaneous assignments of one person to overlapping booked visits: exactly one succeeds** |
| `unit/availability.test.ts` (4) | Next available date: a booking ending mid-day, back-to-back bookings, Sundays, holidays and leave; nothing found within 90 days gives null, never a guess |
| `integration/flow.test.ts` (fixed) | Picked "another employee" as a fixed ID that, in random UUID order, could be the team member under test; it now picks someone else |

Browser, production build on :3300, headless Chrome:
- **As EMP-004 (admin):**
  - 24 cards load in about 1.2 s; the filter for stone fitting at High leaves 2 cards.
  - The details drawer opens with focus inside, and Esc closes it.
  - A level edit with a reason is saved and shown in the history.
  - The assign drawer lists its checks: availability, team coverage, clearance, readiness and plan state.
  - Saving a draft reports "Not complete yet: Team has 2 members; configured team size is 3".
  - The list view shows 24 rows.
  - At 390 px there is no overflow, and there were no console errors.
- **As EMP-001 (manager), EMP-008 (supervisor) and EMP-020 (worker):** `/skill-cards` returns 404 and the menu has no link to it.
- **EMP-020's My day:** still loads with the shift panel.

## Site operations (27 Oct 2026)

- `tests/unit/site-days.test.ts` (7):
  - several sessions on one date count as one day
  - overlaps are merged before measuring
  - an overnight session is split at local midnight
  - a session ending exactly at midnight adds no date
  - an open session is not counted
  - a short visit is counted
  - planned dates come from bookings
- `tests/integration/site-ops.test.ts` (12):
  - check-in is allowed only at sites booked today, and repeated check-in or check-out is idempotent
  - the daily shift is unchanged
  - the database refuses overlapping sessions
  - corrections are made by a supervisor, with history
  - an overnight check-out is refused, flagged and later corrected, and counts only its real dates
  - workers can't read the head view
  - managers create dated tasks; workers can't
  - a tick counts once, is idempotent, and unticking needs a reason
  - one finished day does not finish a task
  - overdue items and moves keep the original date; stale task edits are refused
  - calendar counts are never multiplied by bookings, and workers are refused the calendar
  - handover overdue, due, done and not-set states work in the site's timezone
  - a supervisor corrects a skill with history; a worker can't
- Full suite: 27 files, 195 tests passed. `npm run build` succeeded.
- Browser check on the production build:
  - **List view:** the List/Calendar/Map switch works, and the "Overdue handover · due 23.10.26" flag shows.
  - **Calendar:** the preview shows on keyboard focus and on hover; clicking a date lists the same number of visits as its cell.
  - **Map:** shows the "Map not set up" notice and 3 city groups.
  - **Site detail:**
    - The workforce summary appears, with 8 people.
    - A new task was added from the form.
  - **Worker EMP-011 (390 px):**
    - Site check-in survives a reload, and a double tap on check-out recorded one check-out.
    - Ticked items persist after a reload.
    - The page has no overflow, and there were no console errors.
    - The worker gets "Not permitted" on the calendar.
  - **Reduced motion:** turns the overdue animation off. Otherwise the pulse is 2.4 s.
