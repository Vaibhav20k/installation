# Fixed eight-hour session contract

Confirmed user rules (spec V3 §9): regular session 480 minutes and reminder 450 minutes after the **actual** clock-in; automatic switch to recorded overtime at 480 minutes with no second punch. Recorded overtime is not approved overtime.

## Constants and clock

- `REGULAR_SESSION_MINUTES = 480`, `REMINDER_MINUTES = 450` in `src/domain/shift.ts`. Server constants; no worker control can change them. The database enforces `warn_at = t0 + 450 min` and `ot_at = t0 + 480 min`.
- Clock source: the server's time when it accepts the request. The browser only displays elapsed time from a server-time offset; changing the phone clock changes nothing.
- `t0` is set once per shift (one shift per employee per local work date). Clocking in again the same day **resumes** the shift with the same `t0`: no second eight-hour allowance. Clocked-out gaps are not counted.

## States

`Not started → Regular → Overtime → Clocked out` (early `Regular → Clocked out` allowed). Activity (Working, Break, Idle, Travel) is independent and carries across the 8-hour boundary. Breaks and idle never move the reminder or the end. Idle needs a reason.

## Durable jobs and notifications

1. Clock-in writes two `due_job` rows (`shift_warning`, `shift_overtime`) for the shift revision.
2. They are settled by (a) the in-process runner every 30 s (`src/instrumentation.ts`), (b) every attendance or notification read for that employee, and (c) `POST /api/jobs/run` with `IM_JOB_SECRET` for a production cron. Jobs live in the database, so a restart loses nothing (tested).
3. A job checks whether the shift was open **at its due time**, not at processing time. A late runner still records overtime effective at `t0 + 480`, with the processing time kept separately (tested with a 5-minute delay).
4. Exactly once: `notification.dedupe_key = shiftId:event` and a unique index on `attendance_event (shift_id) where kind = 'overtime_started'`. Repeats, two tabs and corrections cannot duplicate a delivered event.
5. A reminder processed after `t0 + 480` is stored as **overdue** in the inbox and is not shown as "30 minutes left".
6. Clock-out cancels pending jobs. A clock-out exactly at `t0 + 480` runs only boundaries strictly before it, so no overtime session is created (tested). Resuming re-arms cancelled jobs; already delivered events still don't repeat.

Worker messages (verbatim): see `SHIFT_MESSAGES` in `src/domain/shift.ts`.

## Delivery channels

| Channel | Status |
|---|---|
| In-app inbox (bell), banner while the app is open | Implemented. Focus-aware poll every 60 s, plus one fetch just after the next due event |
| Browser notification while a tab is open | Implemented after the worker taps "Also alert me on this device"; denial does not affect attendance |
| Push with the app closed (service worker + push service) | **Not configured.** Needs VAPID keys and a push transport; shown honestly in the bell panel |
| SMS / email / WhatsApp | Not authorised; not built |

## Clock-in photo (user rule, 23 Oct 2026)

Every clock-in, including clocking in again the same day, needs a photo.
- **Capture:** the app opens the front camera (`ClockInCamera`), shrinks the photo (longest side 960 px) and uploads it.
- **Server check:** the server accepts the clock-in only with a ready, content-checked image of the actor's, uploaded in the last 15 minutes and not used before. The photo is linked to the clock-in or resume event.
- **No camera:** if the camera is blocked or missing, the phone's own camera or photo picker is used. A photo is still required.
- **Clock-out:** never needs a photo.
- **The anchor:** `t0` is the server time when the clock-in is accepted, after the photo has uploaded.

This deliberately overrides the V3 spec's "media never blocks attendance" principle at the user's direct instruction. The cost: a worker with no network or no working camera cannot clock in until the photo uploads. A supervisor correction remains the fallback for a missed clock-in.

## Idle reasons

Idle needs a reason picked from a list:
- Power cut
- No site access / keys
- Waiting for material
- Waiting for another trade
- Tool or equipment problem
- Waiting for customer decision
- Weather
- Lift or society restriction
- Other, which asks for the specific reason

## Clock-out and timesheets

Clock-out turns the shift into draft time rows: working time (with breaks inside it) becomes installation rows, travel and idle become travel and waiting rows. A break outside working time is unlogged. Rows overlapping existing entries are skipped and reported, never overwritten. Work after `t0 + 480` becomes an `ot_request` candidate with the worker's chosen reason; the existing review applies the confirmed rule that original-target catch-up is ineligible. Without a reason the candidate says "reason not given yet".

## Corrections and missed clock-outs

- A worker requests a clock-in or clock-out correction with a reason (optional photos/videos). A supervisor in scope (never the worker) approves it.
- Clock-in approval moves `t0`, the deadlines and the revision; old jobs become `superseded` and new ones are scheduled if the shift is open.
- Clock-out approval sets `clock_out_override`. Events stay append-only; reads cut the timeline at the override.
- Clocking in on a new date while yesterday's shift is open marks that shift `missed_clock_out`: it stays provisional in the manager's queue, with no invented end, until a clock-out correction is approved.

## Not built yet

Wall-clock schedule start, lateness rules and paid-break rules (not specified). Supervisor clock-in on behalf of a worker.
