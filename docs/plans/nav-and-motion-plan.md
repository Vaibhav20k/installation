# Plan: shorter navigation, curved controls, smoother motion

For: a new Claude Code session (Opus 5.5). Start it with `/plan` and paste this file. Repo: `magppie-installation-management` (Next.js 15 App Router, plain CSS in `src/app/globals.css` and `src/styles/*.css`, Phosphor icons, no animation library).

Request (28 Oct 2026, from the app owner): *"make it a bit more animated and smooth, use curved buttons, make this nav bar short, merge some into others, and make the merges sensible."*

## 1. Goals and limits

**Goals:**
- Cut the side menu from 15 items (16 for admins) to 8, by merging pages that serve the same job.
- Make every control curved, on one consistent shape scale.
- Add quick, purposeful motion: tap feedback, sliding active markers, a gentle page entrance, list reveals. Motion must never slow anyone down.

**Limits:**
- **Keep every URL.** Notifications (`notification.href`), server-action revalidate paths in `src/app/actions/index.ts`, the Playwright tests and people's bookmarks all point at today's URLs, so nothing moves or is renamed. Merging happens in the navigation and a shared tab strip, not in routes.
- **No new dependencies:** CSS transitions and animations, plus a little React. Don't add Framer Motion or Motion.
- **Reduced motion:** every animation is gated by `prefers-reduced-motion: no-preference`. With reduced motion, things change instantly.
- **Phones first:** the crew and Installation Managers work from a phone.
  - Tap targets are at least 44 px.
  - Hover effects only under `@media (hover: hover) and (pointer: fine)`.
  - No horizontal scroll at 390 px.
- **Permissions stay as they are:** the menu still only mirrors them, and every page keeps its own server-side check.
- **Nothing breaks:** all current tests stay green (`npm run test`, `npm run test:e2e`). Don't weaken any test.

## 2. The merge (8 sections instead of 15)

Each new section is a **group**: one menu entry, with a tab strip at the top of its pages.

| New menu item | Short (phone) | Tabs inside, existing URLs kept | Who sees it | Why these belong together |
|---|---|---|---|---|
| **Home** | Home | Overview `/` | everyone | Unchanged: the daily summary, with "Needs you" and "Sites today" |
| **Sites** | Sites | Installations `/installations` (List · Calendar · Map) · Planning `/planning` (plus `/visits/*`) · Projects `/projects` | supervisors and up | All answer "which job, where, when, with whom": the site list, the crew timeline that staffs it, and the customer → order → BOM record behind it |
| **Dispatch & MND** | Dispatch | `/dispatch` (All open · My steps · My team · Dashboard) | department roles, IMs, admins | Unchanged; it already has its own tabs |
| **My work** | Today | My day `/my-day` · My tasks `/my-tasks` · Attendance `/attendance` | everyone | One person's day: what to do today, what's booked ahead, and clock-in history |
| **Inbox** | Inbox | To approve `/approvals` (staff only) · My requests `/requests` | everyone (To approve: staff) | Both are "requests waiting on someone": things others sent you, and things you sent. The badge is the sum. |
| **Time & money** | Time | Timesheets `/timesheets` · Expenses `/expenses` | everyone | Both record time or money against work, both go to approval, and both feed reconciliation |
| **People** | People | People & Skills `/people` · Skill cards `/skill-cards` (admin only) | everyone (Skill cards: admin) | Same people records, two views |
| **Reports** | Reports | `/reports` | everyone (as today) | Unchanged |

- **Settings** leaves the main list. It becomes a gear button in the identity block at the bottom of the side menu and at the bottom of the phone "More" sheet, still at `/settings`. It's used rarely and mostly by admins.
- **Result:** 8 menu items (7 for crew, who don't see Sites or Dispatch). Nothing is lost; each old page is one tab away.

### Phone bar (4 slots plus More)

| Who | Slots |
|---|---|
| Staff | Sites · Dispatch · Inbox · Home |
| Crew | Today · Time · Inbox · People |
| Department staff | Dispatch · Inbox · Today · Home |

Everything else goes in the More sheet. Today's `PRIMARY_*` lists in `src/components/Nav.tsx` become these.

### Badges on groups
- **Inbox** = the approvals count plus waiting requests.
- **Dispatch** = unchanged.
- **Time & money** = draft timesheets (today's `/timesheets` count).

## 3. How to build the merge (no route moves)

1. **One source of truth.** Create `src/components/nav-config.ts`. It exports `GROUPS`, each with:
   - `id`, `label`, `short`, `icon`;
   - `who` (a function of role, flow roles and job role);
   - `tabs`, each with `href`, `label`, `match` (path prefixes) and an optional `who`.

   `Nav.tsx` (`RailNav`, `TabBar`) and the new tab strip both read it.
2. **Active group:** the group that has a tab whose `match` fits `usePathname()`. Keep today's special case: `/visits/*` belongs to Planning.
3. **Shared tab strip:** a new `src/components/SectionTabs.tsx` (client).
   - It is rendered once in `src/app/(app)/layout.tsx`, right above `{children}`, and shows the active group's tabs when the group has more than one visible tab.
   - Links are real `<Link>`s with `aria-current="page"`.
   - On phones it scrolls sideways inside its own box (`overflow-x: auto; overscroll-behavior-x: contain`), and the page itself never scrolls sideways.
4. **Avoid two tab strips on one screen.** Where a page already has its own inner tabs (`/dispatch` views; `/installations` List · Calendar · Map; Planning views), the section strip sits above as the higher level. Restyle the inner ones as the smaller "segmented" control so the levels read clearly: section tabs above, the page's own views below.
5. **Counts:** `layout.tsx` already computes counts per href. Add `groupCounts` (sum of member hrefs) and pass both down.
6. **Settings gear:** add it to the `identity` block in `layout.tsx`, which both the rail and the More sheet already use.

## 4. Shape: curved, one scale

Replace the single `--radius: 4px` in `globals.css` with a scale, and use it everywhere. The rule, written into the CSS comment: **controls are pills, surfaces are soft.**

```css
--radius-xs: 6px;    /* chips inside dense tables, code tags */
--radius-sm: 10px;   /* inputs, selects, textareas, small icon buttons */
--radius: 14px;      /* cards, plates, panels, notices, map popups */
--radius-lg: 20px;   /* sheets, dialogs, the phone More sheet, the map frame */
--radius-pill: 999px;/* every button, tab, chip, badge, count, segmented control */
```

- **Buttons:** `button, .button` (globals.css around line 340) go to `--radius-pill`, with `padding-inline` raised so the label never touches the curve. Keep the 44 px minimum height on touch.
- **Icon-only buttons** (`.icon-btn`): circles.
- **Tabs and segmented controls** (`.tabs a`, `.view-switch`): pills, with the active pill sliding (section 5).
- **Inputs:** `--radius-sm`, focus ring follows the curve (`outline-offset: 2px`).
- **Cards and plates:** `--radius`. Check the nested radii: an inner element's radius is the outer radius minus the padding, so corners don't look pinched.
- **Find leftovers:** search `src/styles/*.css` and `globals.css` for hard-coded `border-radius` and `var(--radius)`, and map each to the scale. The dispatch, site-ops, cards and features stylesheets all use `var(--radius)` today, so they pick up the new value automatically. Check the ones that should be pills.

## 5. Motion: quick and purposeful

Add tokens next to the easing ones already in `globals.css` (`--ease-out`, `--ease-press`):

```css
--dur-press: 120ms;  --dur-quick: 180ms;  --dur-move: 260ms;  --dur-enter: 320ms;
--ease-spring: cubic-bezier(0.34, 1.36, 0.64, 1); /* small overshoot, for things that slide into place */
```

| Where | What moves | How |
|---|---|---|
| Every button, tab, chip, list card | Press feedback | `:active { transform: scale(0.97) }`, `--dur-press`, `--ease-press`. Hover lifts only under `(hover: hover)`. |
| Side menu | The active marker (today a red bar) slides between items instead of jumping | One absolutely positioned indicator. `transform: translateY()` to the active item's offset (measured in a `useLayoutEffect` in `RailNav`), `--dur-move`, `--ease-spring`. |
| Phone tab bar | The active tab's icon pill grows in; the icon switches to filled | `transform: scale(.6 → 1)` and opacity on a pill behind the icon, `--dur-quick`. |
| Section tabs and segmented controls | The active pill slides to the tapped tab | Same measured-indicator pattern as the rail. One shared hook, `useSlidingIndicator(containerRef, activeKey)`. |
| Page change | Content fades up 6 px | Add `src/app/(app)/template.tsx` (Next re-mounts it on every navigation) wrapping children in `<div class="page-enter">`. Keyframes from `opacity:0; translateY(6px)` over `--dur-enter`, `--ease-out`. Animate only transform and opacity. |
| Lists (site cards, dispatch cards, day list, reports) | Rows reveal top-down on first paint | `animation: rise var(--dur-enter) var(--ease-out) both; animation-delay: calc(var(--i, 0) * 30ms)`. Set `--i` inline on the first 8 items only, so long lists never wait. |
| More sheet (phone), drawers, popovers | Slide or scale in, quicker out | Sheet: `translateY(100%) → 0` at `--dur-move` with `--ease-spring`; backdrop fades. Exit at about 70% of the entry time. Popovers scale from 0.96 at their origin. |
| Counts and badges | A badge that changes pulses once | A short `scale(1.15 → 1)` keyed on the value. Never loops (the late-handover blink stays the only repeating motion). |
| Loading | No spinners on navigation | Add `loading.tsx` per group (Sites, Dispatch, My work, Inbox, Time & money) with skeletons shaped like the real page. The existing `useLinkStatus` pending bar in `Nav.tsx` stays. |

**Rules for the implementer:**
- Animate only `transform` and `opacity`, never width, height, top or left.
- Nothing longer than 320 ms.
- Nothing that delays reading or tapping.
- Wrap every rule above in `@media (prefers-reduced-motion: no-preference)`.
- Use the existing skills: `animate` or `emil-design-eng` to pick curves, `mobile-native` for tap feedback and the sheet, `review-animations` for the finished pass.

## 6. Steps (one PR, in this order)

1. **Shape tokens:** curved buttons, tabs and inputs everywhere. Check the screens for pinched nested corners.
2. **Navigation:**
   1. Write `nav-config.ts`, then rewrite `Nav.tsx` to read it: 8 groups, the new phone slots, group badges and the Settings gear.
   2. Add `SectionTabs.tsx` and mount it in `layout.tsx`.
3. **Motion tokens and press feedback:** global (buttons, tabs, cards).
4. **Sliding indicators:** the rail marker, the section tabs and the existing view switches (one shared hook).
5. **Page entrance:** `template.tsx`, list reveals, sheet and popover motion.
6. **Skeletons:** `loading.tsx` per group.
7. **Clean-up:** remove dead styles from the old nav, then run `review-animations` and fix what it finds.

## 7. Tests (write them first, per the repo's TDD rule)

**Unit tests**, in `tests/unit/nav-config.test.ts`. For each kind of person (crew installer, supervisor, manager, admin, department staff with a flow role, Installation Manager):
- the visible groups and tabs match the table in section 2;
- every old URL maps to exactly one group, and that group is visible to the people allowed on that page;
- no group shows a tab the person can't open.

**Playwright**, in `tests/e2e/navigation.spec.ts`:
- Every old URL still loads, the right group is marked current, and the right tab inside it.
- At 390 px: the phone bar has 4 slots plus More for each role in the table, and there's no horizontal scroll on each group's first page.
- With `reducedMotion: 'reduce'`, `getComputedStyle(...).animationName` is `none` on `.page-enter` and the indicators don't transition.
- Keyboard: Tab reaches the section tabs, `aria-current="page"` is on the active one, and focus rings are visible on the pill shapes.
- The existing `im-journey.spec.ts` and `http-guards.spec.ts` stay green. Notification links (for example `/dispatch/<id>#site-reports`, `/my-day#report-mnd`) still land in the right place.

**Visual check:** screenshots of each group, desktop and phone, light and dark themes, before and after.

**Done when:**
- `npm run ci` passes.
- The menu shows at most 8 items.
- Every old URL works.
- Every control uses a radius from the scale.
- Nothing animates under reduced motion.

## 8. Questions for the owner (ask once, before step 2)

1. **Projects:** under Sites (as proposed), or under Reports for finance and management people?
2. **Reports:** keep it as a menu item, or fold it into Home as a "Reports" tab? Folding it would take the menu to 7.
3. **Inbox name:** "Inbox", or "Approvals" (the more familiar word for staff)?
