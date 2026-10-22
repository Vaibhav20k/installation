# Resume notes (context recovery)

Active spec: `../docs/INSTALLATION_MANAGEMENT_CLAUDE_MASTER_PROMPT_V3_2026-10-22.md` (V3, 15 phases). It is built in the existing Fittings Catalogue design (DESIGN.md), not the spec's sample blue tokens. All V3 phases and checkpoints are done; see `phase-status.md` (V3 table first, earlier V2 history below it).

## State (23 Oct 2026)

- Typecheck clean; `npx vitest run`: 22 files, 146 tests passing. `npm run build` succeeds.
- Migrations 001–009. A new or reset database gets everything; an existing one applies 006–009 on start.
- Run locally:
  - `npm run local` builds, then serves on :3300 with demo identities.
  - Launch entry `installation-serve` serves an existing build without rebuilding.
  - `npm run dev` is for editing code.
- Demo database: `%LOCALAPPDATA%\magppie-installation-management\pg`. Reset it with `npm run db:reset` (stop the server first).
- Performance fixture: `npx tsx scripts/fixture-large.ts` writes a separate `pg-large` database. Serve it with `PORT=3320 IM_DATA_DIR=... node scripts/local.mjs`.
- Evidence files: `%LOCALAPPDATA%\magppie-installation-management\evidence`.
- Timing and audit scripts used for the docs live in the session scratchpad (`navtime.mjs`, `feedback.mjs`, `a11y.mjs`, `flow.mjs`, `pages.mjs`). They are not part of the repo.

## If continuing

1. Business decisions: `requirements.md` U-01…U-16 and V3-U1…V3-U5. The most important are the monthly policy fields, approved productivity rates, the design revision limit and evidence retention.
2. Production prerequisites (README "Deployment notes"):
   - an authentication provider
   - a private object store for evidence
   - `IM_EVIDENCE_SECRET`
   - a due-job runner choice
   - web push, if closed-app alerts are wanted
3. Real-phone testing: sticky hover, tap delay, safe areas, keyboard, camera capture, notification permission.
4. Changes since the last push to GitHub (`Vaibhav20k/installation`) are uncommitted until the user asks.
