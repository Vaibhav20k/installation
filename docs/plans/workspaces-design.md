# System design: Factory and Installation workspaces

Status: **design agreed, decisions in section 8; not built yet** (requested 28 Oct 2026).
Owner's ask: "Make one button to switch to Factory and one to switch to Installation, as it is getting confusing. Design the system first, then build."

## 1. The problem

Today one app shows both sides of the business at once. An Installation Manager sees factory words (tax invoice, e-way bill, store check, IQC). A factory person sees site words (handover window, crew on site). The dispatch list mixes the factory's work with the site's work. This is **cognitive load**: people have to work out which half of the screen is theirs before they can act.

The fix: **two workspaces over one shared set of records.**
- Each person works in the workspace that matches their job. They see only that side's steps, words and buttons.
- A dispatch or a complaint is still ONE record. Each workspace shows it from its own side (IA principle: *multiple front doors* to the same object).

## 2. The two workspaces

| | **Installation** workspace | **Factory** workspace |
|---|---|---|
| Who it's for | Installation Managers, site supervisors, crew | Factory dispatch, Accounts, QC, Planning, Store, Purchase, Production, Packaging |
| Their question | "What has arrived, what do I install next, what's still missing?" | "What do I send, and what replacement do I make next?" |
| Starts at | The truck reaching site (Dispatched → Received) | The order being ready (Ready for dispatch) |
| Ends at | Final handover to the customer | Replacement dispatched |
| Complaint view | 5 plain phases: Planning → Purchase → QC → Production → Dispatched | The real 13 steps, grouped under the same 5 phases |
| Icon / label | Hard hat · "Installation" | Factory · "Factory" |

### 2.1 Installation workspace: menu and home

Menu (7 items, same groups as today minus factory-only screens):
1. **Home**:
   - The pipeline, 7 tiles: Ready for dispatch · Dispatched · Received · 1st installation (Carcass) · 2nd (Shutters) · 3rd (Countertop) · Final handover.
   - Tap a tile to list its orders, each with one next action.
   - The calendar.
   - Then "Needs you".
2. **Sites**: Installations · Planning · Projects.
3. **Dispatch**: today's Dispatch screen seen from site, with tabs *Coming to site* · *My steps* · *Complaints* (5-phase tracker).
4. **My work**: My day · My tasks · Attendance.
5. **Inbox**: To approve · My requests.
6. **Time & money**: Timesheets · Expenses.
7. **People** / **Reports**: as today.

Before Dispatched, the factory and accounts steps are shown as one quiet state, **"At the factory"**, with the detail on tap (*progressive disclosure*). The Installation Manager never sees an "E-way bill" button.

### 2.2 Factory workspace: menu and home

Menu (5 items):
1. **Home**: the factory pipeline, with tiles for:
   - **To send:** orders with items left to dispatch, with the button *Mark ready for dispatch*.
   - **Waiting for accounts:** tax invoice and e-way bill.
   - **Ready to load:** e-way bill done, not yet dispatched.
   - **On the truck:** dispatched, not yet received.
   - **Replacements:** open complaints, counted by phase (Planning, Purchase, QC, Production, Ready to send).

   Each tile opens its list, with one action per row for the person's own department.
2. **Dispatch**: *Ready for dispatch* (create, with or without the item list) · *Sent* (history).
3. **Complaints** (the factory's real work queue):
   - The phase chips sit on top: Planning · Purchase · QC · Production · Ready to send.
   - Inside each phase are the detailed steps (Costing, Management approval, Store check, IQC, Packaging…).
   - Each person lands on the phase that holds their step.
4. **Reports**: factory figures (on-time dispatch, complaints by cause, replacement cost to people allowed to see cost).
5. **Setup** (admins): dispatch types, flow steps, who holds which department role.

Personal things (attendance, expenses, my requests) are reached from the person's name menu in this workspace. Factory staff don't need Sites or Planning.

## 3. The switch (new pattern: `WorkspaceSwitch`)

### Problem it solves
People who work on both sides (admin, management, an Installation Manager who also watches factory progress) need to flip sides in one tap and always know which side they're on.

### Placement
- **Laptop:** the top of the side menu, under the Magppie wordmark. It's the first thing the eye meets, and the menu below it changes with the switch.
- **Phone:** at the top of the app bar, centred. The bottom bar's four slots change with the workspace.

### Design
A two-option segmented control (the existing pill style): **[ Installation | Factory ]**, each with its icon. The active side is filled. A short slide of the fill (existing sliding-indicator hook, 260 ms, none under reduced motion) confirms the change.

| Property | Values | Default |
|---|---|---|
| `current` | `installation` \| `factory` | from the person's roles (section 4) |
| `available` | which workspaces this person may open | from roles |
| variant | `switch` (both available) · `label` (one available: static chip, not a button) | – |

| State | Look | Behaviour |
|---|---|---|
| Default | Active side filled (ink), other side quiet | – |
| Hover (mouse only) | Quiet side darkens slightly | – |
| Pressed | scale(0.97) | – |
| Switching | Fill slides; the menu and home swap | Goes to that workspace's Home |
| Single workspace | A static chip "Installation" or "Factory" | Not clickable, so nobody wonders why it doesn't switch |

### Rules
- **Remembered** per person (a cookie, like the theme), so the app opens where they left off.
- **URLs don't change** and every existing link keeps working.
- **Links into the other side:** opening a page that belongs to the other workspace (for example a factory step from a notification) switches the workspace to match. A one-line notice says "Switched to Factory to show this", with a link back.
- **Permissions don't change.** The workspace only decides what's *shown*. Every page and action still checks rights on the server.

### Accessibility
- `role="radiogroup"` labelled "Workspace", with two `role="radio"` options. Arrow keys move between them, Enter or Space selects.
- On change, "Factory workspace" is announced through a polite live region.
- Each side is told apart by label + icon + position, never colour alone.

## 4. Who lands where

| Person | Workspaces | Opens in |
|---|---|---|
| Crew (installers, helpers, carpenters) | Installation only | Installation (static label) |
| Site supervisor | Installation only | Installation |
| Installation Manager | Installation, plus a view-only Factory complaint tracker | Installation (switch shown) |
| Factory dispatch, Accounts, QC, Planning, Store, Purchase, Production, Packaging | Factory only | Factory (static label) |
| Management | Both | Factory |
| Admin | Both | Installation |

Rules:
- Anyone with an Installation-side job (crew, supervisor, `installation_manager` role) gets Installation.
- Anyone with a factory department role gets Factory.
- Holding both, or being admin or management, gives the switch.

## 5. One vocabulary (same words everywhere)

| Record | Factory sees | Installation sees |
|---|---|---|
| Dispatch | Ready for dispatch → Tax invoice → E-way bill → Dispatched | **At the factory** (one state) → **Dispatched** |
| Dispatch at site | **On site** (read-only) | Received → 1st / 2nd / 3rd installation → Final handover |
| Complaint | Phase + exact step, e.g. "Planning · Costing" | Phase only, e.g. "Planning", with "Waiting for Planning team" |

Complaint phases (already built), the same five in both workspaces:
- **Planning:** QC review, Costing, Management approval, Replacement plan, Store check
- **Purchase:** Purchase
- **QC:** Incoming QC
- **Production:** Store issue, Production, Packaging
- **Dispatched:** Ready for dispatch, Replacement on its way

## 6. The handoffs between the workspaces

```
FACTORY                                         INSTALLATION
Ready for dispatch (with or without list)  ──▶  appears in "Ready for dispatch" tile ("At the factory")
Accounts: invoice, e-way bill                    (still "At the factory")
Dispatched (vehicle, driver)               ──▶  "Dispatched" tile, button: Mark received
                                                 Received: check the list / report items not on it
Complaint lands in "Planning" phase        ◀──  each missing or damaged item opens a complaint
Planning → Purchase → QC → Production            IM watches the 5-phase tracker (Complaints tab)
Replacement ready to send → Dispatched     ──▶  new "Dispatched" row tagged "Replacement – MND-xxxx"
                                                 Received OK → complaint closes in both workspaces
```

Notifications open in the workspace of the person receiving them, so a link never lands someone on the other side's screen.

## 7. What changes in today's app (for the build step)

- **Navigation:** `nav-config.ts` gains a workspace on each group. The rail, phone bar and section tabs filter by it. There's a new `WorkspaceSwitch` in the rail header and the phone app bar.
- **Home:** `/` renders the Installation home (today's) or the new Factory home, depending on the workspace.
- **Dispatch screens:**
  - `/dispatch` is called **Dispatch** in both workspaces, with different views.
  - Installation shows only site-relevant views.
  - Factory gets *Ready for dispatch* and *Sent*.
- **Complaints:** the existing 5-phase tracker serves Installation. Factory gets the phase chips with step queues.
- **No database change** except storing the chosen workspace (a cookie is enough; no table).
- **Tests to write first:**
  - each role lands in the right workspace;
  - the switch is a static label for single-workspace roles;
  - every old URL still opens and switches the workspace when needed;
  - menus show only their side's items;
  - no page scrolls sideways at 390 px.

## 8. Decisions (owner, 28 Oct 2026)

1. **Names:** the switch reads **[ Installation | Factory ]**. The dispatch screen is called **Dispatch** on both sides, with each side's own views.
2. **Installation Manager:** stays on Installation and has **no switch**. They follow complaints in the 5-phase tracker.
3. **Management** opens in **Factory** and has the switch.
4. **Factory staff** reach their attendance, expenses and requests **under their name menu**. The Factory menu holds only factory work.

**While the app is being built:** the owner wants to see both sides. While demo mode is on (the current "Demo data" setting), **everyone gets the switch** so both sides can be tried with any demo identity. It is labelled as a demo aid. When demo mode is switched off for real use, the rules in section 4 apply: crew, supervisors and Installation Managers get Installation only, factory departments get Factory only, and management and admin get the switch.
