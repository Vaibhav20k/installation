# Resume notes (context recovery)

Source spec: `../docs/INSTALLATION_MANAGEMENT_CLAUDE_MASTER_PROMPT.md` (revision 2). Standalone app in this folder. All 12 phases and checkpoints are complete; see phase-status.md.

## State (21 Oct 2026)
- `npm run check`: typecheck clean, 92/92 tests. `npm run build` succeeds. Production mode has no demo-auth bypass.
- Dev server: `installation-management` entry in `../Monitoring_review/.claude/launch.json` (port 3300).
- Embedded DB lives in `%LOCALAPPDATA%\magppie-installation-management\pg` (not OneDrive). `npm run db:reset` recreates demo data (stop the server first).
- `dev`/`build` clear `.next` because OneDrive breaks an existing build cache.

## If continuing
1. Business decisions in requirements.md (U-01…U-16).
2. Deferred items in phase-status.md (auth provider, project-closure action, calendar/settings editors, Playwright suite).
3. Nothing is committed to git yet (repo initialised, no commits).
