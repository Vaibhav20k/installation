# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyone uses it phone first; desktop is the secondary layout (confirmed 21 Oct 2026).

- **Field crew** (carpenters, helpers, technicians, stone technicians) and **site supervisors** on site: record start/end and breaks, report progress against today's target, flag blockers.
- **Managers on the move** (three project managers, Installation Head role): approve plans, time, overtime eligibility and expenses; watch staffing conflicts and clearance blockers.
- **Administrator / Finance holders** set policies, rates, budgets and verify savings, mostly at a desk.

## Product Purpose

Run Magppie kitchen and wardrobe installations end to end: plan a visit from order scope, staff it with verified skills and a returning team, clear accounts/site/installation gates, execute daily targets, record actual time truthfully, reconcile monthly hours, and report the installation KRAs from the same records. Success: no double bookings, no unaccounted remaining scope, honest time and cost, and managers deciding from one screen.

## Positioning

An installation operations tool built around Magppie's own rules: original-target catch-up is never overtime, approved plans are immutable, skill levels count only when verified, and every KPI stays "Not rated" until its definition and target are approved.

## Operating Context

Customer → location-based project → orders → order items → components → installation tasks. Visits are fresh, follow-up or final; outstation visits carry travel legs. Timezone Asia/Kolkata, currency INR. Roughly 40 employees, 3 managers.

## Capabilities and Constraints

Implemented in Next.js 15 / React 19 / PostgreSQL (embedded PGlite by default). Plain CSS design tokens in `src/app/globals.css`; no CSS framework. All calculations live on the server; the UI only displays. Demo data is fictional and must stay labelled.

## Brand Commitments

Magppie branded (confirmed). No logo file or palette has been supplied yet; use the name as a wordmark and do not fabricate a logo or claim official brand colours. The experience should feel premium (user's explicit priority over constrained-device concerns).

## Evidence on Hand

Seeded fictional demo data only. No real customers, photos, testimonials or brand assets in the repository; none may be fabricated.

## Product Principles

1. Phone first: the most frequent actions (log time, record progress, approve) are thumb-reachable and one step away.
2. Truth over tidiness: actual time, remaining scope and unresolved policy are shown plainly, never hidden to look complete.
3. Every number is explainable: totals link to their records and definitions.
4. Premium through precision: calm, confident, crafted details rather than decoration.
