# Design review and debate — 1 November 2026

The user requested one subagent per named design skill and a debate before implementation. Ten dedicated skill agents reviewed the existing app in batches within the concurrency limit. This is a record of their recommendations and resolved tradeoffs, not a claim that ten independent designs were built or that an objectively optimal design was proven.

## Shared direction

Make each person's work understandable: whose queue is this, what needs them, why, and what happens when they click. Preserve existing features and backend rules. Keep the existing satin steel/graphite/Archivo system. Use one suggested starting point and plain work rows rather than a new visual theme or KPI hero.

## Skill contributions

| Skill / dedicated agent | Source | Contribution |
|---|---|---|
| Frontend Design / `frontend_design` | [SKILL.md](C:/Users/vkpal/.agents/skills/frontend-design/SKILL.md) | Personal front door, task verbs and click consequences; rejected dashboard decoration. |
| Impeccable / `impeccable` | [SKILL.md](C:/Users/vkpal/.agents/skills/impeccable/SKILL.md) | Challenged the extra crew click and misleading empty states; separated attendance, site presence and daily records. |
| Taste Skill / `taste_skill` | [SKILL.md](C:/Users/vkpal/.agents/skills/design-taste-frontend/SKILL.md) | Applied restrained variance/motion/density to an operations app; rejected landing-page prescriptions. |
| Hallmark / `hallmark` | [SKILL.md](C:/Users/vkpal/.codex/skills/hallmark/SKILL.md) | Used its app-screen exceptions; queue as main object, stable anchors and clear responsibility. |
| UI UX Pro Max / `ui_ux_pro_max` | [SKILL.md](C:/Users/vkpal/.agents/skills/ui-ux-pro-max/SKILL.md) | Identified missing/conditional anchor targets and overlapping daily labels; keyboard, wrapping and touch targets. |
| Hue / `hue` | [SKILL.md](C:/Users/vkpal/.codex/skills/hue/SKILL.md) | Extracted existing brand tokens; separated responsibility from warning colour. |
| Extract DESIGN.md / `extract_design_md` | [SKILL.md](C:/Users/vkpal/.codex/skills/extract-design-md/SKILL.md) | Updated the existing design-system document against real CSS and markup; corrected obsolete corner and red-action guidance. |
| shadcn/ui / `shadcn` | [SKILL.md](C:/Users/vkpal/.codex/skills/shadcn/SKILL.md) | Reused existing native/shared controls; clarified My day and fixed exact anchors without a library migration. |
| Interface Design / `interface_design` | [SKILL.md](C:/Users/vkpal/.codex/skills/interface-design/SKILL.md) | Implemented scoped personal queues and challenged assignment-as-action assumptions. |
| Better Typography / `better_typography` | [SKILL.md](C:/Users/vkpal/.codex/skills/better-typography/SKILL.md) | Scoped type hierarchy, readable helpers, wrapping rows and mobile controls; no new font. |

Skill guidance was applied in context. Conflicting or irrelevant suggestions were discussed rather than mechanically combined.

## Debates and decisions

### One home versus a separate crew landing

Frontend Design and Taste supported a shared personal queue. Impeccable preferred My day as the crew landing to reduce navigation. Frontend Design also raised embedding attendance on the queue as a way to remove a click; Taste and Impeccable challenged duplicated mutation surfaces.

**Decision:** use `/my-tasks` as the predictable front door and keep canonical attendance forms on My day. Exact links say “Open attendance,” with explanation that recording happens on the next screen. My day remains prominent in personal navigation and shortcuts. This accepts one deliberate navigation step in exchange for one consistent recording flow.

### Assignment versus current responsibility

Interface Design challenged the idea that every assignment belongs under Needs your action. The reviewers agreed: a held dispatch, future visit or a plan waiting on an approver is not necessarily actionable now.

**Decision:** show Needs your action / Waiting for others or readiness / Upcoming visits using existing scoped data and current state. The starting suggestion is not an enforced workflow or a complete SLA ranking. Empty messages remain limited to the queue shown.

### A new theme versus the existing brand

Hallmark, Hue, Taste and UI UX rejected marketing heroes, decorative imagery, cinematic motion and generic KPI tiles. Hallmark's app guidance and Taste's operational context superseded unrelated landing-page patterns. Hue's full skill-generation package would create unrelated output here.

**Decision:** preserve current steel, graphite and typography tokens. Use graphite primary actions; “Needs you” does not automatically mean red or urgent. Hue supplied source-based design-language guidance rather than generating another skill package.

### Library replacement versus component reuse

The app uses native/shared React components, not an installed shadcn component system. A dependency migration would add scope without solving the stated confusion.

**Decision:** the shadcn reviewer applied relevant composition and accessibility guidance to the existing forms. Attendance, site check-in, quantity entry, evidence handling and mutation hooks stay canonical.

### Density versus reading effort

Better Typography challenged shrinking or truncating helpers to fit compact layouts. Extract DESIGN.md found old documentation still prescribing 4px corners and red next actions, contrary to actual CSS and the agreed design.

**Decision:** achieve compactness with spacing and hierarchy; keep full action outcomes readable. Update the existing root DESIGN.md to reflect the current token system and scoped personal-page type scale. Preserve existing source patterns rather than inventing a second design language.

## Implementation boundaries

- Consistent sign-in destination, searchable demo directory and explanatory role copy.
- Personal queue with record context, click outcomes, waiting states and retained expandable visit scope.
- My day next-step guidance, stable section targets and distinct checklist/quantity/time terminology.
- Existing overview, reports, planning, dispatch, complaints, people, approvals, settings and temporary tutorials remain available.
- Backend services and permission rules remain authoritative. No automatic status advancement is introduced by navigation.

## Verification status

Verified on 1 November 2026:

- Production build and TypeScript checks passed.
- 252 unit cases validated. The initial unit run found one outdated Factory home expectation; the affected 8-test file passed after updating it for My tasks plus Overview.
- 23 browser scenarios validated: 21 passed in the full run; two old navigation assertions needed the new redirect/query behavior. Both passed on targeted rerun, together with the admin phone-width check (3 passed).
- New browser coverage: find Sanjay, open his personal queue and daily controls without an attendance POST; manager/department personal queues and retained Overview; no-result identity search and roster recovery.
- Existing installation journey, revised operations publication/site-plan flow, temporary tutorials, role switching, settings, permissions, keyboard navigation, reduced motion and mobile route coverage passed.
- Policy-save regression check: one POST, zero extra page GETs, 268 ms in this run. This is a test observation, not a general performance guarantee.
- Visually inspected crew mobile and manager desktop screens, plus My day in dark mode. Additional local smoke checks for supervisor, Finance, QA, Sunita and Sanjay returned no page errors or horizontal overflow at 390px.
- Visit task links open the named visit's execution page, avoiding ambiguity when multiple visits exist; daily recording controls remain on My day.

Browser test mutations used the disposable database on port 3310. The production preview is running locally on port 3300. This review does not claim every possible data state or every button has been exhaustively tested.
