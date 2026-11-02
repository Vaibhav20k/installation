# Demo roster and responsiveness — 1 November 2026

## Roster

Both sign-in and the in-app selector now show 1 administrator, 4 managers (including Sunita / HUB-005), 3 site supervisors, all 30 currently active field crew, and a separate department group with HUB-001, HUB-002 and HUB-003. This follows the confirmed selection. No employee, role membership or assignment was deleted. A currently signed-in person outside the shortened list remains labelled until the user switches away.

## Refresh boundaries

- Shared action handling invalidates affected pages instead of the entire root layout. The client avoids an extra refresh when the action response already refreshes the current page.
- Operations policy saving updates its own result panel without refreshing the route.
- Queue counts have their own authenticated, private/no-store endpoint and React context. The page shell does not wait for expensive approval and dispatch queue queries. Badge updates are deduplicated, refreshed after actions and periodically while visible, and reset on identity changes.
- Notification reads reload only the notification panel. Notification links use client navigation.
- Explicit workspace switching uses a single cookie-setting server action and redirect instead of push plus refresh.
- Skill-card and assignment drawers no longer request a duplicate page refresh alongside their form hook. Their local details still reload after successful edits.
- Session reads are memoized within the current render request, not shared across users.
- Page navigation has a loading boundary. Person switching and sign-in show pending state; the shared form hook prevents duplicate submissions and reports network failures without discarding typed form values.

Refreshing a div alone is not a data-consistency mechanism: local panels own their independent state, while changes affecting a whole record refresh that route once. Identity changes necessarily update the shell and permissions.

## Verification

- Production build and TypeScript passed.
- 27 roster/navigation/workspace unit tests passed.
- All 20 browser tests passed: auth/action guards, legacy dispatch journey, desktop/mobile navigation, workspaces, tutorials, new operations flow, and two new responsiveness tests.
- Browser test: policy save completed in 262 ms, one POST and zero additional document/RSC page GETs.
- Person switch test: no full document reload.
- Live localhost roster verified as 1 / 4 / 3 / 30 / 3.
- Warm localhost page checks during concurrent test execution: dispatch/new 386 ms, installations 339 ms, site-plans 265 ms. These are observations, not a controlled speedup benchmark or production SLA.

Scope: the shared button/action infrastructure and automated journeys were checked. This does not assert that every possible business action on every record was manually clicked. No workflow redesign was performed.
