# Temporary tutorials

The **See tutorial** button appears above the page content throughout the signed-in application, including before the revised workflows are activated.

Selecting any of the ten topics starts an automatic, read-only simulation. The guide explains the responsible role, where the feature lives, example values, the action and its result. Pause/Play, Back, Next, playback speed, Replay, All tutorials and Close are available. Escape closes the native modal and restores focus to the launcher. Playback pauses while the browser tab is hidden. Mobile content scrolls independently of the playback controls.

Topics: My Tasks, dispatch to installation, BOM/MND, site plans, site punches/man-hours, regularization, complaint replacement, preventive projects, reports, and Admin setup/activation.

These are labelled demo screens, not an automated recording of live records. They do not switch identities, submit forms, request GPS, upload photos, change settings or create records. All examples are illustrative.

## Disable or remove later

- To hide the button without deleting code: set the server environment variable `IM_HIDE_TEMP_TUTORIALS=1` and restart the app.
- To remove permanently: remove the `TemporaryTutorials` import and mount from `src/app/(app)/layout.tsx`, then remove `src/components/tutorials/`, `tests/e2e/tutorials.spec.ts` and this document.
- No database migration, data cleanup or operational service changes are needed.

## Verification

TypeScript passed. Browser checks cover automatic advancement, paused playback, every tutorial reaching completion, replay, closing with Escape/focus restoration, absence of POST requests during the tutorials, and phone overflow/control visibility. Production build passed. All 10 browser tests passed (eight navigation regressions and two tutorial tests). The mobile screenshot was reviewed at `test-results/tutorial-mobile.png`.
