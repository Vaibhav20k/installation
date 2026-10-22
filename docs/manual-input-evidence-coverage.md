# Worker manual-input evidence coverage

Every worker input surface offers optional **Add photos / Take photo / Add video / Record video** through the shared `EvidenceUploader` (`src/components/evidence/EvidenceUploader.tsx`). Uploads run in the shared queue (`src/lib/upload-queue.ts`), so saving, switching tabs and clocking out never wait for them. Saving without media is always valid.

On mobile, the camera buttons appear only where the pointer is coarse; desktop gets the file picker. Permissions are re-checked on upload, on link and on every download (`authorizeParent` in `src/server/services/evidence.ts`).

| Route / component | Form or field | Parent record (link) | Context | Permission to link / view |
|---|---|---|---|---|
| /my-day → `DayProgress` TaskRow | Quantity recorded for a task | `progress_event` | `progress.quantity` | Project scope |
| /my-day → `DayProgress` blocker | Report a blocker | `delay_event` | `blocker.report` | Project scope |
| /my-day → `ClockInCamera` | Clock-in (photo **required**, front camera; picker fallback) | `attendance_event` (clock_in / resume) | `attendance.clock_in` | Owner; supervisor+ in employee scope can view |
| /my-day → `AttendancePanel` | Attendance note | `attendance_event` (note) | `attendance.note` | Owner; supervisor+ in employee scope can view |
| /my-day, /attendance → `CorrectionForm` | Clock-in / clock-out correction | `attendance_correction` | `attendance.correction` | Owner; supervisor+ in scope |
| /my-day, /timesheets → `TimeEntryForm` | New, edited or corrected time entry | `time_entry` | `time.entry`, `time.correction` | Owner; supervisor+ in scope |
| /timesheets → `EntryActions` | Overtime review request | `ot_request` | `overtime.request` | Owner; supervisor+ in scope |
| /expenses → `ExpenseForms` | Submit an expense (receipt photo or video) | `expense` | `expense.claim` | Claimant; supervisor+ in scope |
| /requests → `LeaveRequestForm` | Leave or emergency unavailability | `leave_request` | `leave.request` | **Restricted**: requester, their manager chain and admins only, not project managers |
| /installations/[visit] → `DayControls` | Schedule day slipped (reason) | `schedule_day` | `schedule.day` | Project scope (supervisor+) |
| /my-day, project Charges tab → `AdditionalWorkForm` | Additional work request | `additional_work` | `additional_work.request` | Project scope |
| Project Quality tab → `QualityPanel` | Record a complaint or rework case | `quality_case` | `quality.case` | Project scope |
| Visit execution step → `ExecutionStep` | Delay record | `delay_event` | `delay.record` | Project scope |
| Visit execution step → `ExecutionStep` | Customer acceptance (media is not a signature) | `acceptance` | `acceptance.record` | Project scope |
| Project Site tab → `RestrictionForm` | Site working window / society rule | `site_restriction` | `site.restriction` | Project scope (supervisor+) |
| Project Site tab → `ApplianceForm` | Appliance state and brand technician | `appliance_dependency` | `appliance.check` | Project scope (supervisor+) |

Read-only views, filters and navigation have no uploader by design.

## Reviewer views

`EvidenceGallery` shows linked media beside the record (Approvals: attendance corrections and leave). Images lazy-load; videos are click-to-play with `preload="none"`.

## Planned, not built yet

| Surface | Phase |
|---|---|
| Design/measurement requests, communication notes | 10 |
| Package receipt exceptions | 11 |

## Verified

`tests/integration/evidence.test.ts`:
- photo and video upload with content check, linking, captions and idempotent re-link
- disguised and swapped files rejected, oversize and PDF uploads rejected
- cross-worker linking and downloads blocked
- leave privacy enforced
- draft removal allowed, linked removal blocked
- storage switched off reports unavailable while the record still saves

## Storage

Local private folder adapter (`src/integrations/storage.ts`): `%LOCALAPPDATA%\magppie-installation-management\evidence`, or `IM_EVIDENCE_DIR`.
- **Production:** needs a real private object store wired into the adapter. Not configured.
- **Retention:** no automatic deletion. Neither the 45-day nor the one-year proposal is active.
- **Reload:** files only selected in the browser are lost on reload. Completed uploads stay linked on the server.
