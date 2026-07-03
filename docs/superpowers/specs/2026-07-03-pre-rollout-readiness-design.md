# Pre-Rollout Readiness Pass — Design

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan

## Goal

Bring `dewey_time` — the HR attendance SPA (`/hr-attendance`, `/hr-schedule`), the
ADMS dashboard (`/adms`), and the flag engine — to a state where the whole system
can go live as Dewey's production system of record: used daily by HR, trusted by
admins, and presentable to stakeholders.

Rollout is **quality-gated, not date-gated**. There is no deadline; instead,
"ready" has a concrete definition (below) and we work until it is met.

## Readiness definition

Readiness is defined by a punch list, produced by the audit phase and maintained
at `docs/ROLLOUT_PUNCH_LIST.md`. Every finding is triaged into one of three
buckets:

| Bucket | Meaning | Gate |
|---|---|---|
| **Must fix** | Would embarrass, mislead, or break trust on day one | All closed before rollout |
| **Should fix** | Rough but survivable | Each one closed **or** explicitly deferred by the user — no silent drops |
| **Can wait** | Fine to fix after launch | Tracked, not gating |

The system is ready when the must-fix bucket is empty, every should-fix has a
recorded decision, and the launch checklist (final section) has passed once
end-to-end against prod.

Findings discovered after triage join the same list and are triaged the same way.

## Phase 1 — Audit (problem hunt)

Three tracks, matching the three risk areas chosen for this pass. Each track
produces findings entered into the punch list; every finding carries a
screenshot or a reproduction note so nothing is vague.

### Track 1: UI walk

Method: build the SPA (`npm run build` in `dewey_time/frontend/hr_attendance/`)
and serve it locally against a mocked API (the established XHR-mock harness used
for pre-deploy screenshots), so all states can be staged without touching prod.

- Walk **every screen** of `/hr-attendance` and `/hr-schedule`, plus the `/adms`
  entry (login gate and shell — the ADMS bundle itself is prebuilt and out of
  scope for code changes).
- Two viewport widths per screen: **375 px** (phone) and **1440 px** (laptop).
- Deliberately stage the awkward states: no employee selected, empty week,
  employee with no schedule, loading in progress, API error, long names /
  overflow, week with every flag type present.
- Output: annotated screenshots + one punch-list entry per issue.

### Track 2: Flag correctness on real data

Method: `frappe-sandbox seed --prod` with the latest anonymized prod backup
(same harness used for the import-saga verification), then run the flag engine
over at least **two full real weeks**.

- **Spot-check sample:** at least 5 employees per branch across all branches,
  each over both weeks (~100+ employee-days), chosen so every emitted flag type
  (`LATE_START`, `LEFT_EARLY`, `MISSING_TIME`, `ATTENDANCE_ISSUE`,
  `UNNOTIFIED_ABSENCE`, `OFF_SHIFT_PUNCH`, `NON_PRIMARY_SITE_PUNCH`,
  `LATE_FROM_LUNCH`) appears in the sample at least once where prod data allows.
  For each sampled day, verify by hand against raw punches: every flag emitted
  is real, and no deserved flag is missing.
- **Known leftovers folded into this track:**
  - The **ADMS Bridge service account** appears in the HR employee pickers.
    Decide and implement whether it should be excluded at the API level
    (`hr_calendar.py` employee list) rather than merely not polluting search.
  - Confirm the **re-run prod schedule import is clean**: the fresh problems CSV
    should contain only the known ~4 bad-badge `EMPLOYEE_NOT_FOUND` rows.
- Output: list of wrong, spurious, or missing flags + data-hygiene findings.

### Track 3: Failure visibility, permissions, deploy

- **Silent-failure tracing:** for each of (a) Bridge stops delivering punches,
  (b) a device's closeout webhook never arrives, (c) the intraday/daily
  scheduler stops running — trace the actual code path and answer: *does a
  human find out, and how fast?* Inventory what `Device Sync Status`,
  `Device Closeout Alert`, and web push actually do today versus what reaches a
  person.
- **Permissions audit:** enumerate who can reach what — the HR SPA pages and
  their APIs (`hr_calendar`, `schedule_api`, `api.get_my_week`, `dev_tools`),
  and the ADMS token exchange. Verify a logged-in non-HR user cannot read other
  employees' data or reach HR-only/admin-only endpoints. Pay attention to
  `dev_tools.py` (backfill API) being callable in prod.
- **Deploy/rollback sanity:** confirm the routine (frontend build → committed
  bundle → `bench migrate`) is documented, repeatable, and has a known rollback
  (previous commit's bundle). Confirm backup discipline on Frappe Cloud is
  intact.
- Output: one punch-list entry per gap.

## Phase 2 — Triage

The audit's findings are presented to the user with a proposed bucket for each.
The **user has final say** on bucket assignment, especially must-fix versus
deferred. The agreed list is committed as `docs/ROLLOUT_PUNCH_LIST.md` and
becomes the single source of truth for rollout progress.

## Phase 3 — Fix waves

- Fixes ship as **small, single-purpose PRs, merged when CI is green** — the
  workflow already established on this repo.
- **Verification before user testing (standing rule):** any change touching the
  engine, import, or wipe is proven against the real frappe-sandbox bench
  before handoff. UI changes are verified with screenshots from the local
  mocked build before the PR opens.
- Frontend PRs include the rebuilt committed bundle
  (`public/hr_attendance/…`) — CI runs tests only and does not rebuild it.
- Each merged fix updates its punch-list entry (done + PR number).

## Phase 4 — Launch checklist (go/no-go)

Run once, end-to-end, against prod, after the must-fix bucket is empty:

1. **Schedule data is clean** — the import problems CSV shows only the known
   bad-badge rows, nothing else.
2. **Flags look right on prod** — spot-check at least 10 live employee-days in
   the UI against their actual punches.
3. **A failure gets noticed** — simulate one silent failure (e.g. a device that
   never sends its closeout) and confirm an alert reaches a human.
4. **Permissions hold** — log in as a non-HR user; confirm HR-only screens and
   APIs are unreachable.
5. **Deploy is boring** — one standard deploy (build → commit → migrate)
   completes with no surprises, and the rollback step is known.

All five pass → roll out. Any fail → the failure becomes a must-fix and the
checklist is re-run after it closes.

## Out of scope

- **Onboarding & documentation** for HR users/admins (explicitly deferred by
  the user for this pass).
- **`dewey_portal` extraction** (launcher Phase 2) — unless the audit shows it
  blocking a must-fix.
- **ADMS dashboard internals** — the bundle is prebuilt outside this repo; only
  its gating/entry is audited here.

## Deliverables

1. `docs/ROLLOUT_PUNCH_LIST.md` — triaged findings, updated until rollout.
2. Audit artifacts — UI screenshots, sandbox flag-verification notes.
3. Fix PRs per punch-list item.
4. A completed launch-checklist record appended to the punch list.
