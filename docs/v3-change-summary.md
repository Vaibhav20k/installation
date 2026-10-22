# What changed for the V3 prompt

Source: `INSTALLATION_MANAGEMENT_CLAUDE_MASTER_PROMPT_V3_2026-10-22.md`, plus the follow-up requests of 23 Oct (marked ★).

"Before" is the app as pushed before V3 work started (commit `77c936d`). "Now" is the current code. Details and evidence are in `phase-status.md`, `test-evidence.md` and `performance-after.md`.

## Speed and navigation

| Area | Before | Now |
|---|---|---|
| Tab click speed | Dev server compiled each page on first visit (4.5–8.6 s, once ~68 s). The production build reloaded the whole page on every click (73 / 93 ms median / p95, with a visible repaint). | Production preview via `npm run local`; in-app navigation with prefetch: 40 / 64 ms, no repaint. Large data set on a throttled phone profile: p95 at most 386 ms, all spec budgets met |
| Feedback on tap | A loading placeholder made React hold pages back in ~300 ms batches | The placeholder is removed. The tapped tab shows pending within 1–3 ms and a thin red progress line runs along the top |
| Proof | None | Before/after timing docs, 30+ transitions per scenario, a 12-month fixture (9,390 time entries, 10,000 progress rows) |

## Attendance (worker)

| Area | Before | Now |
|---|---|---|
| Clocking in | No attendance; workers typed start and end times by hand | **Clock in / Clock out** on My day. A fixed 8-hour session from the actual clock-in. Clocking in again the same day keeps the original start |
| ★ Clock-in photo | None | **Required.** The front camera opens on Clock in; take, retake and confirm. Server-enforced: fresh (15 min), unused and content-checked. The photo picker is the fallback if the camera is blocked. Clock-out needs no photo |
| 7:30 reminder | None | A durable job at clock-in + 450 min sends the reminder exactly once, survives restarts, and is marked overdue if late |
| Overtime | Raised by hand per entry | Starts automatically at clock-in + 480 min with no second punch, and is recorded as "approval pending". Clock-out exactly at 8:00 creates no overtime. The reason is asked for (catch-up, future task, additional work, delay, other) |
| Activity | Not tracked | Working / Break / Idle / Travel. Breaks and idle never move the 7:30 or 8:00 points |
| ★ Idle reason | Free text | **Pick from a list** (power cut, no access/keys, waiting for material, another trade, tool problem, customer decision, weather, lift/society rule) **or "Other"** with typed text |
| Timesheet from the day | Manual entry only | Clock-out creates draft rows (work with breaks, travel, waiting) and overtime candidates for work after 8 h. Overlaps are skipped, never overwritten |
| Forgotten clock-out | Not possible to detect | The shift is marked "clock-out missing", stays provisional, and is closed only by an approved correction |
| Corrections | Only timesheet revisions | Clock-in or clock-out correction requests with optional photos; a supervisor approves; history is kept |
| Leave | Managers entered approved leave | Workers request leave or emergency unavailability. Only their manager chain or an admin decides, and attachments are private |
| Worker screens | My day (tasks and manual time) | **Today**, **Attendance** (regular vs recorded OT vs approved OT), **Tasks**, **Requests**, plus a notification bell and banner |

## Photos and videos

| Area | Before | Now |
|---|---|---|
| Attachments | References only (no uploads) | Optional photos and videos on every worker form: progress, blocker, time entry, overtime request, expense, leave, corrections, slipped day, additional work, quality case, delay, acceptance, site rules, appliances, packages, design requests, conversation logs |
| Upload behaviour | Not applicable | Background queue (2 at a time) that survives tab changes; per-file progress, retry and remove; saving never waits |
| Safety | Not applicable | Private storage outside OneDrive; short-lived signed upload links; content checked (disguised files rejected); permission re-checked on link and download; leave media private |

## Planning, site and team (manager)

| Area | Before | Now |
|---|---|---|
| ★ Team size | Fixed at the planned headcount (3) | **Add a member** from the installation page when a plan needs more people. Same checks as booking; the team size grows (max 12) |
| ★ Replacing a person | Only by re-planning the staffing before booking | **Replace** next to every member (sick, cannot join, on leave, emergency, reassigned, other). Days already worked stay theirs; before their start the replacement takes the whole booking. Busy or on-leave people are shown as unavailable with the reason |
| Customer contacts | None | Contacts per customer, with one primary |
| Quantities | One quantity per component | Net installed (used for effort) and gross/material (incl. wastage) recorded separately, never converted |
| Extra effort | Not modelled | Effort drivers (cut-outs, edges, joints…); unknown, not zero, without an approved rate |
| Site rules | Not modelled | Allowed days, hours and restricted activities; the site window adds calendar days without changing the 8-hour session |
| Appliances | Not modelled | Selected / spec final / on site / inspected, plus brand technician. Blocks booking until ready; a manager exception keeps a visible risk |

## Money, customer and packages

| Area | Before | Now |
|---|---|---|
| Additional work | Only additional-scope tasks inside a visit | Requests from site with optional media; manager approval as chargeable (quote required), free of charge or waived; never self-approved |
| Customer charges | Not modelled | Quoted installation charge and waiver per order, shown beside estimate, budget and actual cost. Nothing is called "profit" |
| Overtime eligibility | Catch-up ineligible; additional scope eligible | Also "authorised work brought forward from a future day". For attendance time the overtime period is clock-in + 8 h (this was a bug: it previously used the calendar day) |
| Customer journey | None | Owner and stage, checklist with overdue marking, and a conversation log that never claims anything was sent |
| Design / measurement | None | Requests with revisions and reasons. The revision limit stays unset until approved, so nothing blocks |
| Packages | None | Manifest, and dispatch/receipt/damage scans (type or camera) de-duplicated. "Receipt unverified" instead of "lost". Shortage, damage and unknown-code exceptions with photos; responsibility, replacement and charge decided separately |
| Handover filter | Fixed "next 7 days" | Adjustable window: 7 / 14 / 30 days or custom dates |

## Look and quality

| Area | Before | Now |
|---|---|---|
| Phone layout | Some pages wider than the phone (stamp animation); app bar crowded | Fits at 390 px on every checked page; the bottom bar always visible |
| Accessibility | Earlier DOM audit | Lightweight audit on 12 pages: no unlabelled fields or unnamed controls, visible focus, touch targets at least 40 px (not a full WCAG audit) |
| Tests | 92 | **150**, including attendance, evidence, site, team, commercial, customer and package flows |
| Docs | V2 set | Plus performance before/after, shift contract, example-policy audit, evidence coverage, V3 requirements and decisions |

## Still open

| Item | Status |
|---|---|
| Real-phone testing (camera, keyboard, safe areas) | Not done; emulation only |
| Alerts with the app closed (web push) | Not configured; in-app and open-tab alerts work |
| Production photo storage | Local private folder only |
| Business decisions | Design revision limit, media retention, monthly overtime policy, approved productivity rates |
