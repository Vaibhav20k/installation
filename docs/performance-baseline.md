# Performance baseline (before remediation)

Measured 22–23 Oct 2026 on the developer machine (Windows 11, Node 24.18, Chrome headless via puppeteer-core, 1440×900, no CPU or network throttling, localhost). Seed: 40 employees, 6 visits, demo data. Lab numbers, not field performance.

## Reported defect

"Tab clicks are slow / glitching." Reproduced on the development server the user was running (`npm run dev`).

## Scenario A: development server (what the user ran)

Server-side fetch of each route with a signed-in cookie (`scratchpad/timing.mjs`, two rounds):

| Route | First visit | Warm |
|---|---|---|
| /installations | 619 ms | 488 ms |
| / | 656 ms | 682 ms |
| /planning | 577 ms | 545 ms |
| /approvals | 678 ms | 468 ms |
| /my-day | **8,594 ms** | 437 ms |
| /projects | **4,453 ms** | 453 ms |

Earlier in the same session a first visit after a restart took about 68 s while Next.js compiled, and one request failed with `ArrayBuffer is not detachable` during that compile.

**Root cause (evidence above):** Next.js development mode compiles each route on its first request; on this OneDrive folder `.next` is cleared on every start, so every route compiles cold. Every internal link was a plain `<a>`, so each tab click was a full document reload: the shell, fonts and entrance animations repainted and replayed.

## Scenario B: production build of the same commit

Commit `baeaa17` built with `next build` and served with `next start` (only change: the demo sign-in gate allowed under `IM_LOCAL_DEMO=1` so a measurement user could sign in). `scratchpad/shots/navtime.mjs`, 30 warm transitions across six tabs after one warm-up visit each:

| Measure | Median | p95 | Max |
|---|---|---|---|
| Click → new page usable (full reload) | 73 ms | 93 ms | 103 ms |

So the production server was already fast; the defect the user saw was development-mode compilation plus full-page repaint on every click.

## Reproduction

```bash
# production numbers
npm run local                      # build + start on :3300 with demo identities
node navtime.mjs http://localhost:3300 EMP-004 label 6
```
