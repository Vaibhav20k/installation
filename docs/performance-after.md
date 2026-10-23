# Performance after remediation

Same machine, browser, viewport, seed and script as `performance-baseline.md`.

## Changes (each tied to a measured cause)

| Cause | Change |
|---|---|
| Dev compile on first visit (4.5–8.6 s, up to ~68 s) | `npm run local`: production build served locally with demo identities (`IM_LOCAL_DEMO=1`, test-covered so production stays locked). `npm run dev` remains for editing code. |
| Full document reload on every tab click | All internal links use `next/link`: the shell, rail, bottom bar and theme stay mounted; routes prefetch in the background. |
| A route-level `loading.tsx` added on 22 Oct made pages *slower* (ready median 304 ms) | Removed. With a placeholder showing, React reveals the real page in ~300 ms batches even though the server answered in ~35 ms (traced with `rsctrace.mjs`: RSC response 34–36 ms, page ready 311–317 ms). Instant feedback now comes from `useLinkStatus` on the tapped tab plus a thin top progress line. |

## Result: production build, 30 warm transitions

| Measure | Before (full reload) | After | Budget (spec §4, desktop) |
|---|---|---|---|
| Click → page usable, median | 73 ms | **40 ms** | — |
| Click → page usable, p95 | 93 ms | **64 ms** | ≤200 ms warm, ≤1 s data-backed |
| Max | 103 ms | 104 ms | — |
| Full page repaint per click | yes | no | — |

## Checkpoint A (after phase 3, same protocol)

| Scenario | Median | p95 | Max | Samples |
|---|---|---|---|---|
| Worker (EMP-015) clocked in, timer running, tabs My day / Attendance / Tasks / Requests / Timesheets / Expenses | 52 ms | 81 ms | 105 ms | 35 |
| Admin (EMP-004) manager tabs | 61 ms | 98 ms | 108 ms | 30 |

The admin path rose from 40/64 ms because the shell now counts attendance exceptions (missed clock-outs, corrections, leave) on each navigation. It is still inside the budget. Optimising that count is a candidate for phase 13.

Only the timer component re-renders each second. The worker flow test (`scratchpad/shots/flow.mjs`) confirms:
- the timer keeps its anchor across tab changes (00:00:01, then 00:00:02 after two route changes)
- a photo uploaded while recording progress links to the saved progress event
- 0 px horizontal overflow at 390 px, and no console errors

## Phase 13: large fixture, desktop and throttled phone

Fixture: `npx tsx scripts/fixture-large.ts` builds a separate database (`pg-large`): the demo seed plus 9,390 accepted time entries (12 months, 30 field employees, Sundays off) and 10,000 progress rows. It is fictional test data and never touches the demo database. Served with the production build on port 3320.

Mobile profile: 390×844 touch viewport, 4× CPU slowdown, 60 ms RTT, 9 Mbps down / 1.5 Mbps up (Chrome DevTools emulation, not a real phone).

Click to page usable (`navtime.mjs`, polling):

| Scenario | Samples | Median | p95 | Budget p95 |
|---|---|---|---|---|
| Admin, desktop, 6 tabs | 36 | 67 ms | 148 ms | ≤200 ms (warm), ≤1 s (data-backed) |
| Worker, desktop, 6 tabs | 42 | 48 ms | 91 ms | ≤200 ms |
| Admin, mobile profile, 4 bottom-bar tabs | 40 | 226 ms | 386 ms | ≤400 ms (warm), ≤2 s (data-backed) |
| Worker, mobile profile, 4 bottom-bar tabs | 40 | 172 ms | 296 ms | ≤400 ms |

Click to first visible feedback (`feedback.mjs`, in-page MutationObserver, so no polling delay):

| Scenario | Samples | Feedback median / p95 | Usable median / p95 | Budget (feedback p95) |
|---|---|---|---|---|
| Admin, desktop | 36 | 1 / 74 ms | 38 / 74 ms | ≤100 ms |
| Admin, mobile profile | 40 | 3 / 6 ms | 177 / 260 ms | ≤200 ms |
| Worker, mobile profile | 40 | 3 / 5 ms | 144 / 224 ms | ≤200 ms |

All documented budgets are met in these lab conditions. The polling numbers run higher than the in-page numbers because the poll itself adds delay; both are reported.

## Not yet measured (honest limits)

- Real phones and real mobile networks; the figures above are emulation.
- Navigation while a large video uploads under throttling. Uploads run in a separate queue with at most 2 in parallel; the worker flow test covered navigation during a small photo upload only.

## Checklist round (23 Oct 2026)

Not re-measured. The changes add no work to page loads: the clock-in camera and package scanner now load on demand (smaller My day and Packages bundles), and expenses fetch 50 rows per page instead of up to 300.
