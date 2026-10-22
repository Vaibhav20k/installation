# Example-policy audit

Every source-derived number is classified as **confirmed requirement**, **illustrative example**, **unresolved proposal** or **engineering/test parameter** (spec V3 §2). Demo seed data only loads when demo identities are on (`seedIfEmpty` runs only under `demoAuthEnabled()`); production initialisation seeds nothing.

## Confirmed requirements (active)

| Rule | Where |
|---|---|
| Regular session 480 minutes after actual clock-in | `src/domain/shift.ts` `REGULAR_SESSION_MINUTES` (server constant, not editable) |
| Reminder 450 minutes after actual clock-in | `src/domain/shift.ts` `REMINDER_MINUTES` |
| Automatic overtime recording at 480 minutes, no second punch | shift state machine + due jobs |
| Original-target catch-up is ineligible for overtime | `src/domain/time.ts` `decideEligibility` |
| Kitchen installation schedule (9 steps, 13 working days) | `db/migrations/005_install_schedule.sql`; supplied directly by the user as the plan shared with customers |

## Illustrative examples (demo fixtures only, labelled, never active policy)

| Example | Status in the app |
|---|---|
| 40 sq ft/team-day and other productivity rates | `productivity_rate.status = 'illustrative'`, demo seed only; estimates using them are labelled provisional |
| Role-hour templates (0.2 h/sq ft etc.) | `role_template.status = 'illustrative'` |
| 12,000-minute monthly normal requirement | `POL-001` draft, `illustrative = true`; finalisation blocked while unresolved fields remain |
| 09:00 / 16:30 / 17:00 clock times, 10:15 clock-in | Test inputs in `tests/unit/shift.test.ts` only |
| 320 sq ft, 2 rooms × 3 nights × ₹1,500 | Test fixtures only |
| ₹1,000 allowance | Not used anywhere (confirmed example only) |

## Unresolved proposals (inactive)

| Proposal | Treatment |
|---|---|
| Ten-day planning buffer | No buffer is applied; none configured |
| Two/three design revisions before approval | Threshold unset; drafts always recordable (phase 10) |
| 45-day or one-year media retention | No automatic deletion; `evidence_asset.retention_policy` null |
| Included/chargeable visit counts | Not modelled as a limit |
| KRA targets (6 days, FTR ≥95%, ₹1.5–2 lakh) | `kpi_target.status = 'provisional'`; results show "Not rated" |
| Two-week baseline collection | Text reference only |

## Engineering parameters (labelled)

Media limits (image 15 MB, video 200 MB, 10 files per form), polling interval (60 s, focus-aware), due-job runner interval (30 s), performance budgets, test fixture sizes.

## Removed or corrected during the audit

| Finding | Fix |
|---|---|
| "Handovers in the next 7 days" was a fixed window on the installations board | Now an adjustable date range with a 7-day preset (phase 12) |
