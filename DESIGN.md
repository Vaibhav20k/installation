---
name: Magppie Installations
description: Phone-first installation management for Magppie crews and managers, built as a fittings catalogue.
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
  signal-soft: "#fbe7ea"
  ok: "#1d6644"
  warn: "#855300"
  warn-soft: "#f7ecd6"
  chrome: "#16181b"
  chrome-ink: "#fbfbfa"
typography:
  headline:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 88"
  title:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 760
    lineHeight: 1.12
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 86"
  body:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "10.5px"
    fontWeight: 700
    letterSpacing: "0.06em"
  figure:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "'tnum'"
rounded:
  plate: "4px"
  stamp: "3px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "16px"
  s4: "24px"
  s5: "32px"
  s6: "48px"
components:
  button:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "0 16px"
    height: "46px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.plate}"
    rounded: "{rounded.plate}"
    padding: "0 16px"
    height: "46px"
  plate:
    backgroundColor: "{colors.plate}"
    rounded: "{rounded.plate}"
    padding: "16px"
  input:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "10px 12px"
    height: "46px"
  callout-number:
    backgroundColor: "{colors.signal}"
    textColor: "#ffffff"
    size: "28px"
  tabbar:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.chrome-ink}"
    height: "64px"
---

# Design System: Magppie Installations

## Overview

**Creative North Star: "The Fittings Catalogue"**

Every record is a part on a satin plate. A visit, task or plan carries its part code in mono at the top of the plate, its name as a condensed Archivo title, and its state printed onto it as a stamp. The ground is pale steel, the ink is graphite, the hairlines are brushed steel, and the only colour that shouts is one signal red. Red marks what to do next and what is blocking. Nothing else uses it.

The surface is phone first. On a phone, the plate's next actions are numbered red callouts (1, 2, 3) above a graphite bottom bar with five sections. On a desk, the same graphite becomes an index rail on the left. Figures read as a specification table: label on the left, tabular mono value on the right, and each row opens the records behind it. Density is moderate. Plates breathe, tables stay compact.

Light and dark follow `prefers-color-scheme`. The chrome (bar and rail) stays graphite in both.

**Key Characteristics:**
- Part codes in JetBrains Mono on every record (`VIS-005`, `TSK-010`, `EMP-015`).
- States are outlined uppercase mono stamps, never coloured dots.
- Numbered red callouts are the primary action surface on the phone.
- Hardware steppers (minus, value, plus) for quantities, with the value bumping on change.
- One 4px corner everywhere; stamps are 3px.

## Colors

Cool steel neutrals with a single signal red; no warm tints.

### Primary
- **Signal Red** (#c8102e; dark #ff5466): numbered callouts, the active tab indicator, the approvals count, `bad` stamps, and blocking states. Never decorative.

### Neutral
- **Pale Steel Ground** (#e8ebeb; dark #0e1012): page background.
- **Satin Plate** (#fbfbfa; dark #17191c): plates, inputs, secondary buttons. `plate-2` and `plate-3` are pressed and recessed steps.
- **Graphite Ink** (#16181b; dark #eceeef): text, primary buttons, quiet callouts, confirmed board segments. `ink-2` for secondary text, `ink-3` for labels and meta.
- **Brushed Hairline** (#d4d8db) and **Strong Hairline** (#a8aeb4): row dividers, control borders, dashed proposed segments.
- **Graphite Chrome** (#16181b; dark #07080a): tab bar and index rail, in both schemes.

### Status
- **Fitted Green** (#1d6644): `ok` stamps. **Amber** (#855300): `warn` stamps and approved leave.

### Named Rules
**The One Red Rule.** Signal red appears only on next-action callouts, counts, the current-tab indicator and blocking or rejected states. A destructive action that is not blocking (removing a break) is a neutral button.

## Typography

**UI Font:** Archivo (variable, `wdth` axis), falling back to Segoe UI or the system UI font.
**Code and Figure Font:** JetBrains Mono, used with tabular numerals.

**Character:** a condensed industrial grotesk for names, set against a mono that reads like stamped part numbers.

### Hierarchy
- **Headline** (750, 26px, 1.15, `wdth` 88): page titles such as "Today, Manoj".
- **Title** (760, 22px, 1.12, `wdth` 86): the plate title (project or record name).
- **Section** (700, 17px): plate headings.
- **Body** (400, 15px, 1.5): running text, callout meta at 13px in `ink-2`.
- **Code tag** (600, 12px mono): part codes in plate heads.
- **Label** (700, 10.5px mono, uppercase, 0.06em): stamps and stacked-table labels.
- **Figure** (700, 20px mono, tabular): spec-table values.

### Named Rules
**The Part Code Rule.** Identifiers, quantities, dates and money are set in mono with tabular numerals; names and sentences are never set in mono.

## Layout

The phone layout is a single column of plates with a 16px gutter, a sticky app bar (wordmark plus identity chip), and a fixed graphite tab bar of 64px plus the bottom safe-area inset. Content is padded to clear the bar.

From 960px, the tab bar is replaced by a fixed graphite index rail on the left, and the main column is capped at 1180px. Tables become stacked label and value rows below 760px (`.rows-mobile`). Tabs and step lists scroll horizontally with scroll-snap.

Spacing steps are 4, 8, 16, 24, 32 and 48px. Viewport units are `dvh`, and all fixed chrome uses `env(safe-area-inset-*)`.

## Elevation & Depth

Mostly flat with a soft lift. Plates sit on the ground with one ambient shadow, and hierarchy inside a plate comes from hairlines rather than nested boxes.

### Shadow Vocabulary
- **Plate** (`0 1px 2px rgb(22 24 27 / 0.06), 0 8px 24px -12px rgb(22 24 27 / 0.18)`): every plate, card and board.
- **Lift** (`0 2px 4px rgb(22 24 27 / 0.08), 0 18px 40px -16px rgb(22 24 27 / 0.28)`): sheets and dialogs.

### Named Rules
**The No Nested Plate Rule.** A plate never holds a bordered box. Records inside a plate are hairline-separated rows.

## Shapes

One 4px radius for plates, buttons, inputs and boards; 3px for stamps; full circles only for callout numbers and monograms. Borders are 1px hairlines; stamps use a 1.5px border (2px for the hero stamp). Proposed bookings are dashed, held bookings are outlined, confirmed bookings are solid ink.

## Components

### Buttons
- **Shape:** 4px, minimum height 46px on phones (40px from 960px). The label wraps on phones and stays on one line on desktop.
- **Default:** satin plate with a strong hairline border and ink text.
- **Primary:** graphite fill with plate text and a faint inset highlight.
- **Disabled primary:** a hairline outline with an `ink-3` label, filled only once it can be pressed.
- **Press:** `scale(0.97)` in 110ms. Hover darkens the border, but only under `(hover: hover) and (pointer: fine)`.

### Stamps
- **Style:** outlined uppercase mono, coloured by tone (ok green, warn amber, bad red, accent ink, neutral `ink-3`). The text label always carries the meaning.
- **Hero stamp:** the plate's own state at 13px with a 2px border, rotated -3deg, pressed in with the `stamp` keyframes (520ms, scale 1.9 to 1) when the plate loads or an action succeeds.

### Plates
- **Head:** a code tag on the left and a stamp on the right, over a hairline.
- **Body:** title, a sub line with an icon, then callouts, spec rows or task rows.
- **Padding:** 16px.

### Callouts
Rows of a 28px numbered disc (red, or ink when quiet), a bold title, a meta line and a trailing Phosphor icon. The rows are separated by hairlines, have a minimum height of 60px, and press to `scale(0.985)`.

### Spec table
A label, a tabular mono figure (red when bad, amber when warn), and a caret. A "How it is counted" disclosure uses a Phosphor plus that rotates 45deg when open.

### Stepper
Minus and plus buttons around a mono output that bumps on change. It pairs with a 3px meter animated by `scaleX`.

### Navigation
- **Phone:** a graphite tab bar with five slots, the last being More, which opens a sheet with a grabber. The current tab has a 2px red indicator and counts sit in red pills.
- **Desktop:** a graphite rail with icon and label rows. The current row is outlined in red at the left, and counts are shown in mono.

### Inputs
16px text on phones (no iOS zoom), a strong hairline border, and a focus state that turns the border ink with a 3px translucent ink ring. Invalid fields get a signal-red border.

## Do's and Don'ts

### Do:
- **Do** give every record its part code in mono at the top of its plate.
- **Do** put a phone screen's next actions in numbered callouts, at most three.
- **Do** gate every hover rule behind `(hover: hover) and (pointer: fine)` and give every control an `:active` press.
- **Do** use Phosphor icons only, with `aria-hidden` when they are decorative.
- **Do** animate with transform and opacity, using `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`), and honour reduced motion.

### Don't:
- **Don't** use signal red for anything that is not a next action or a blocking state.
- **Don't** show state as a coloured dot; print a stamp.
- **Don't** nest a bordered box inside a plate.
- **Don't** use unicode arrows or glyphs in place of icons, or em-dashes in copy.
- **Don't** add warm cream or brass tones; the world is cool steel.
