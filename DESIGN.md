---
name: Magppie Installations
description: Personal work queues and daily site operations on satin steel surfaces.
colors:
  ground: "#e8ebeb"
  plate: "#fbfbfa"
  plate-2: "#f1f3f3"
  plate-3: "#e3e7e8"
  ink: "#16181b"
  ink-2: "#474d55"
  ink-3: "#646a72"
  rule: "#d4d8db"
  rule-strong: "#a8aeb4"
  signal: "#c8102e"
  signal-ink: "#ffffff"
  signal-soft: "#fbe7ea"
  ok: "#1d6644"
  ok-soft: "#e1efe7"
  warn: "#855300"
  warn-soft: "#f7ecd6"
  chrome: "#16181b"
  chrome-ink: "#fbfbfa"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "16px"
  s4: "24px"
  s5: "32px"
  s6: "48px"
rounded:
  xs: "6px"
  sm: "10px"
  surface: "14px"
  large: "20px"
  pill: "999px"
---

# Design System: Magppie Installations

Source extraction updated 1 November 2026. This document records the existing visual language and the personal-workspace redesign. It replaces obsolete descriptions of uniform 4px corners and red next-action callouts. Source inspection is not a browser verification result.

## 1. Visual theme and atmosphere

Magppie is a practical operations desk: pale steel behind satin plates, graphite text, readable work rows and quiet dividers. Record identifiers retain the fittings-catalogue character, but the page hierarchy follows the person's responsibility. The first screen should explain whose work is shown, what needs attention and what opening an item allows.

The design is compact without squeezing explanatory text. A small personal introduction leads to one suggested starting point, followed by work grouped by responsibility and timing. Red is not the default colour of a task. Existing overview dashboards remain available for broader analysis; daily work does not require interpreting those dashboards first.

## 2. Colour palette and roles

| Role | CSS token | Light | Dark |
|---|---|---|---|
| Pale steel page ground | `--ground` | #e8ebeb | #0e1012 |
| Satin main surface | `--plate` | #fbfbfa | #17191c |
| Recessed surface | `--plate-2` | #f1f3f3 | #1d2024 |
| Deeper surface | `--plate-3` | #e3e7e8 | #262a2f |
| Graphite primary text/action | `--ink` | #16181b | #eceeef |
| Supporting explanation | `--ink-2` | #474d55 | #b6bbc1 |
| Quiet metadata | `--ink-3` | #646a72 | #9096a0 |
| Brushed divider | `--rule` | #d4d8db | #2b2f34 |
| Strong control border | `--rule-strong` | #a8aeb4 | #474d54 |
| Signal/blocking state | `--signal` | #c8102e | #ff5466 |
| Signal foreground | `--signal-ink` | #ffffff | #16181b |
| Signal surface | `--signal-soft` | #fbe7ea | #3a1c21 |
| Confirmed green | `--ok` | #1d6644 | #5cc690 |
| Confirmed surface | `--ok-soft` | #e1efe7 | #173326 |
| Caution amber | `--warn` | #855300 | #e7ad55 |
| Caution surface | `--warn-soft` | #f7ecd6 | #3a2c14 |
| Graphite navigation | `--chrome` | #16181b | #07080a |
| Navigation foreground | `--chrome-ink` | #fbfbfa | #eceeef |

`--focus` follows primary ink in each theme. Theme can follow the device or an explicit user choice. Use existing semantic tokens rather than adding page-specific hex values. New next-action panels use graphite primary controls. Older navigation indicators and badges retain their existing treatments. Always pair a state colour with words.

## 3. Typography rules

Archivo is the variable UI face, with condensed width for headings; Segoe UI and system sans are fallbacks. JetBrains Mono is the identifier and numeric face, with monospace fallbacks. Both load through `next/font/google` with `display: swap`; this redesign adds no fonts.

| Role | Personal workspace scale | Treatment |
|---|---|---|
| Page heading | 1.625rem / 1.25 | Archivo, weight 750, tracking -0.015em |
| Section heading | 1.125rem / 1.3 | Archivo, weight 700, tracking -0.01em |
| Task action title | 1rem / 1.4 | Archivo, weight 700 |
| Body | 0.9375rem / 1.5 | Archivo, weight 400 |
| Helper/outcome | 0.875rem / 1.5 | Supporting ink, full wrapping |
| Record code | Existing 12px mono | Personal pages increase line height to 1.5 |
| Search input | 1rem | Natural readable size, no transform scaling |

The rest of the app retains its existing base hierarchy: 26px headings on phones, 32px from 960px; 17px section headings, 15px body text, and 22px condensed plate titles. Personal-page overrides are scoped rather than a global typography migration. Limit explanations to approximately 68 characters per line. Use tabular figures for counts. Do not truncate the action, site name or click consequence to achieve density.

## 4. Component patterns

### Buttons and inputs

Primary controls are graphite with satin foreground; secondary controls use the surface and strong border. Buttons use the pill radius, 46px base minimum height, and existing 38px desktop minimum. New queue/jump links maintain a 44px minimum; personal-page labels wrap. Inputs use the 10px small radius, 46px phone minimum, and visible focus ring. Invalid inputs use signal borders and explanatory feedback. Preserve disabled, busy and error states.

### Plates and task rows

Plates use the 14px radius, 16px padding on phones and generally 20px from 760px. They carry a subtle ambient shadow: `0 1px 2px rgb(22 24 27 / 0.06), 0 8px 24px -12px rgb(22 24 27 / 0.18)`. Sheets and dialogs use a stronger lift and 20px radius. The next-action strip intentionally removes the shadow and uses a stronger hairline border.

Queue rows are separated by quiet dividers. Read each row as **action → record/site → why it is here → what opens next**. A trailing caret supports the link meaning; it does not replace the action text. Visits retain expandable assigned scope with accepted and remaining quantities. Quantity steppers, meters, evidence uploads and status stamps remain existing domain components.

### Personal queue

`/my-tasks` is the common sign-in destination, independent of whether the new operations flow is activated. An unfiltered `/` redirects here. The suggested starting point is a convenience, not an enforced order or an exhaustive priority calculation.

- **Needs your action:** current responsibilities from scoped queries, eligible reviews and relevant personal records.
- **Waiting for others or readiness:** held work, active plans and records awaiting another person.
- **Upcoming visits:** confirmed future bookings.

Empty copy must describe the displayed queue, not claim that the employee has no work anywhere. Department users should not receive a prominent no-visit message as a substitute for their dispatch work.

### Daily work

`/my-day` retains the canonical recording forms. Attendance starts/ends the working-day record; site check-in records arrival/departure at a site. They are different actions. **Daily checklist**, **Visit quantities** and **Time entries** describe different records and should never be used interchangeably.

Stable anchors include `#attendance`, `#site-check`, `#work`, `#time`, and `#progress` when a visit exists, including a visit without tasks. Conditional shortcuts only appear with their targets. Missing/damaged reporting, receiving, blockers and additional work remain available in their applicable states. Guidance reflects current data and does not automatically record anything.

### Navigation and identity

Desktop uses the graphite 248px rail; phones use a top identity/workspace bar and a bottom bar with up to four destinations plus More. Installation and Operations retain eight configured groups before permission filtering. Factory retains its smaller menu. Operations places My day beside My tasks in the personal group. The original overview remains available at `/?overview=1`; existing overview filter deep links still work.

The demo identity directory searches within the already limited roster: one administrator, four managers, three supervisors, all field crew and three separate HUB users. Search does not restore hidden demo identities. Role descriptions explain the work context; selecting a person opens their queue. This remains a demo selector, not production authentication.

## 5. Layout, behaviour and accessibility

The shell is mobile first: 16px page gutters, safe-area padding and a 64px bottom-bar token. At 960px, the rail replaces the phone bar and content padding becomes 32px 40px 56px. Main content caps at 1180px; daily work caps at 820px. Structured tables stack below 760px. New next-action controls become full width below 600px.

Spacing follows 4/8/16/24/32/48px. Use flex wrapping and `min-width: 0` to contain long names. Keep visible focus, semantic headings, labelled forms and live success/error feedback. Short press/loading transitions remain; the redesign adds no entrance animation. Existing motion styles and reduced-motion support remain part of the app.

**Navigation versus mutation:** “Open attendance” navigates to controls. “Clock in” records attendance. “Review time entries” opens the section; “Submit time entries” sends records for review. Opening dispatch or complaint details does not advance a stage. Never make a navigation label promise that a mutation already happened.

This is presentation and navigation work. Backend validation, permissions, approvals, policy snapshots and data records are not replaced by UI guidance. A visible queue is not authorization to bypass the form's checks.

## 6. Notes for future generation

Describe screens as “a compact personal operations queue on satin steel, with graphite actions, readable row outcomes and quiet record codes.” Ask for a named person's next responsibility, not a marketing hero or generic statistics grid.

Example directions:

- Create a manager queue with one suggested review, an action list and a separate waiting list. Show each site's name and the consequence of opening the record.
- Create a crew day with separate attendance and site-presence controls, then checklist, quantities and time records. Keep uncommon tools reachable without competing with the next step.
- Create a searchable demo-person directory with clear role context, existing roster groups and honest navigation labels.

Use the source tokens above, preserve existing forms and add no decorative motion. Verify each role, empty/held/future states, keyboard use, theme variants and phone-width wrapping before considering a screen finished.

## Source map

The authoritative implementation is `src/app/globals.css`, `src/app/layout.tsx`, `src/components/nav-config.ts`, `src/components/IdentityDirectory.tsx`, `src/app/(app)/my-tasks/page.tsx`, `src/app/(app)/my-day/page.tsx`, shared form components and `src/styles/motion.css`. See `docs/design-debate-2026-11-01.md` for design decisions. This document is kept at the existing project-root location; no Stitch publication is part of this work.
