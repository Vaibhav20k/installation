# Installation process implementation

This extends the existing application. The original audit and implementation plan are in the adjacent documents. No operational database has been reset or converted during development.

## Delivered phases

| Phase | Changes | Verification |
|---|---|---|
| A — Model and state machines | Additive migration 019; separate Factory/Dispatch/Finance/QA/Installation Head/Founder’s Office/Owners roles; designation master; policy settings; sequence, gate, approval and QA evidence; regularization and confirmation fields. New versioned workflows retain legacy configurations. | Both graphs validate; existing migrations and legacy service tests run in fresh test databases. Protected workflow structure rejects removal of required gates. |
| B — Normal installation | Explicit site IM; packing-list requirement for new flows; readiness hold/reminder; payment request and Finance decision; both gates enforced on server; separate receipt and MND; damaged evidence required; completion notice and next-dispatch link for Factory. | Order progresses through RFD, readiness, unpaid hold, paid confirmation, existing invoice/e-way stages, clearance, dispatch, receipt, MND and installation. Role queues and missing-photo rejection are tested. |
| C — Workforce | Multi-site draft creation reuses separate existing plan/visit/reservation records linked by batch; configurable designation filter; approval and budget; location on new-plan site entry/exit; approved whole-team/person day exclusions; planned/actual/budget comparison; final hours confirmation. | Draft → review → active → regularization → complete → hours confirmed; self-approval denial, mandatory location, preserved actual time, excluded-day punch denial and budget comparison. |
| D — Complaints | Configurable cost tiers with policy snapshot; QC handoff; stock, purchase/Store receipt and production/packaging paths; mandatory QA cause/action; replacement dispatch; repeat MND lineage; installation plan required before closure; preventive projects extend existing issues with independent QA verification. | All three supply branches; tier routing; wrong-role denial; missing QA rejection; received replacement stays open; repeat damaged replacements keep the predecessor open until the successful successor is installed; linked plan and installation completion close the chain; preventive steps cannot be skipped. |
| E — Tasks and reports | Operations My Tasks landing; role-based navigation; actionable notifications for owners/observers; canonical plan and preventive records; complaint history and step durations; QA mismatch, recurrence, workforce variance and open preventive reports. | Task queries, notifications and report integration are exercised by the operations integration suite. Browser verification is recorded below when complete. |

## Rollout and migration

1. Deploy/run the updated application using the normal environment. Migration 019 is additive and is applied by the existing migration runner.
2. As Admin, open **Dispatch setup → Operations policy**. Enter actual Tier 1/2 cost limits, plan/regularization approver roles, reminder offset and normal/complaint daily minutes and labour rates. Test fixture amounts are not production defaults.
3. Assign the separate department roles, including Factory, Dispatch, Finance, QA, Installation Head and tier approvers. Existing Accounts still owns invoice/e-way documents. Confirm each site’s active Installation Manager.
4. Publish the revised workflows from Setup. Publication is transactional for the pair of flows. New records use the new version; existing records keep their pinned configuration and remain visible with a legacy label.
5. New dispatches need a packing list. Historical no-list dispatches and unlisted-item reporting are preserved. New complaint closure means installed; historical received/superseded closures are not rewritten.

No blanket conversion of in-flight legacy records is provided: that would require reconciling real payment, QA, receipt and installation evidence. Their old history is retained rather than fabricated.

## Configurable choices and boundaries

- Tier maximums are inclusive, Tier 3 is above Tier 2. A complaint snapshots the policy at costing. Cost changes return through approval. Comments are required on approval/rejection; rejection returns to costing.
- Site Not Ready holds dispatch until the IM confirms Ready. Expected date and reminder offset are recorded. Finance Not received remains at payment review with a note.
- Workforce plans snapshot policy. Planned minutes are selected person-days multiplied by the configured daily minutes, minus approved exclusions. Dated reservations start at 09:00 site time. Actual minutes are elapsed closed site-presence intervals; they are not payroll or break-adjusted shift calculations. Labour cost is minutes ÷ 60 × configured hourly rate. Normal and complaint plans have separate settings.
- A requested labour budget becomes approved with the site plan. Plans exceeding that budget cannot be submitted/approved. Completion and final confirmation require resolved punches. Approved exclusions retain original reservations/history and never erase actual presence.
- Geographic capture records coordinates, reported accuracy and timestamp. It does not claim geofencing or spoof detection. A denied/unavailable location blocks a live new-plan punch; existing supervisor corrections remain available with a reason. Confirmed hours are protected against direct attendance edits.
- An initial missing/damaged issue is different from a suspected cause. Mismatch reporting compares optional IM suspected cause against QA final cause; absent suspected causes show Unknown.
- Multi-site creation uses a batch of canonical per-site plans, retaining existing project foreign keys and independent site approvals. Dates and staff can differ per site to avoid double booking.
- Existing tax invoice/e-way, incoming-QC legacy flows, financial reports, uploads, customer records, skill cards and existing visits remain available.
- Real GPS on physical devices and external PostgreSQL deployment still require environment-specific acceptance testing. Development verification uses embedded PostgreSQL and local browser tests with disposable data.

## Verification record

- Full Vitest regression run: **53 files, 470 tests passed**.
- Subsequent focused regression after integration refinements: **5 files, 39 tests passed** (operations, workforce, site operations, planning and complaint tracker).
- TypeScript checking passed before browser verification.
- Final focused operations/workforce run: **2 files, 11 tests passed**, including repeated replacement damage and eventual chain closure.
- Final production build: **passed**, including TypeScript and route generation.
- Final Playwright regression: **16 tests passed**, covering legacy workflows and the new policy publication, My Tasks routing, dispatch gates, mobile site-plan creation and operations reports.
- After the spacing correction, production build passed again and the focused mobile operations browser test passed.
- Visual review caught overlapping lifecycle labels on mobile; the labels now stack with spacing, and the browser check verifies that the rows do not overlap.
- Mobile screenshot: `test-results/operations-site-plan-mobile.png` (generated test artifact).
- Browser verification found and corrected missing navigation icons for the new Site Plans and Team groups. This was a rendering fault, not a database migration failure.

All test data is isolated. No live thresholds, approvals, memberships or in-flight operations were changed as part of these tests.
