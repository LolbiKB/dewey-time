# Rollout Phases — Design

**Date:** 2026-08-10
**Status:** Approved design, pending implementation plan

## Goal

Give the attendance system a start date and a trial period, per branch.

Today the flag engine has no notion of when it went live. Point
`closeout.generate_auto_flags_for_date` or `dev_tools`' bulk regenerator at any
date and it will judge that day — including days imported from the ADMS device
history, before anyone was told the rules, before the engine was trusted. This
adds the missing date axis that `2026-07-03-pre-rollout-readiness-design.md`
deliberately left out when it declared rollout *"quality-gated, not date-gated"*.

Two things follow from it:

1. A **cutoff**: before a branch's start date, the engine has no opinion. No AUTO
   flags exist for those days.
2. A **trial period**: between the start date and go-live, the engine runs for
   real on real punches, but every flag it writes is marked as calibration data
   and can be removed wholesale later.

## Delivery: two phases, two plans

This design ships in two passes, each with its own implementation plan.

**Phase A — backend.** The rollout module, the three DocType changes, the engine
guard and stamp, the two purge endpoints, **and both API payload additions** (the
`rollout` block on `get_flag_queue`, `rollout_phase` on each calendar day). Every
backend test. No frontend files, no rebuilt bundle.

**Phase B — surfaces.** The queue banner and the calendar chip that render what
Phase A already returns, their frontend tests, and the rebuilt bundle.

> **Shipped 2026-08-11.** Both surfaces built as specified, with two additions
> the banner table below did not cover: a window with `go_live: null` renders
> "Aug 15 onward is the pilot period" (an ongoing pilot is TESTING
> indefinitely per `rollout.phase_for`, so this is the normal state before a
> go-live date is chosen — the table as written would have rendered "Aug 15 –
> null"), and a window whose dates were cleared renders "This range falls in
> the pilot period" rather than dropping the banner, since the flags in range
> are still real pilot flags. Copy lives in `src/lib/rolloutBanner.ts`, tested
> exhaustively there.

The payload deliberately lands in Phase A rather than with the components that
consume it. That makes **Phase B touch no Python at all** — no second DocType
migration, no second `bench migrate`, and the `flag_queue:v3` → `v4` cache-prefix
bump happens exactly once, in the pass that changes the payload shape. Splitting
it the other way would mean coordinating a cache bump with a frontend deploy,
which is the shape of the bug that comment at `flag_queue_api.py:40-53` was
written to prevent.

### What Phase A alone leaves open

Between the two passes, the phase is real in the data and invisible on screen.
Two consequences, stated so they are chosen rather than discovered:

- During a pilot, the flag queue gives HR no on-screen signal that they are
  looking at calibration data. Whoever is running the pilot knows; someone
  brought in mid-way does not.
- Once a cutoff is set and `reconcile_rollout_flags` has run, pre-cutoff days
  show zero flags with no explanation. An unevaluated day is pixel-identical to a
  clean day, and unlike the banner gap this one does not end when the pilot does.

Neither blocks Phase A from shipping or from a pilot running on it. Both are the
reason Phase B exists, and the second is the stronger argument for not leaving a
long gap between them.

## The model

Every employee-day resolves to exactly one phase, computed from the day's **own
`attendance_date`** against the dates governing that employee's **branch**:

| Phase | Window | Meaning |
|---|---|---|
| `PRELAUNCH` | `attendance_date < testing_start` | The system was not watching. No AUTO flags, ever. |
| `TESTING` | `testing_start <= attendance_date < go_live` | Real punches, real flags, marked as calibration. |
| `LIVE` | `attendance_date >= go_live` | The official record. |

Boundary days, stated so there is nothing to interpret: the day equal to
`testing_start` is `TESTING`; the day equal to `go_live` is `LIVE`.

The phase is a function of the flag's own date and never of "now". This is
load-bearing, not incidental: the engine deletes and re-inserts AUTO flags on
**every single checkin** (`intraday.on_employee_checkin_after_insert`), so a
phase derived from the current date would silently re-label the whole pilot
window the moment go-live passed. Derived from `attendance_date`, regeneration
is idempotent — a pilot-window day still reads `TESTING` when regenerated a year
after launch.

### Resolution

Both functions normalise through `getdate()` before comparing. Frappe hands dates
back as `datetime.date` from a doc field but as `str` from a client payload, and
`"2026-08-15" < date(2026, 8, 15)` raises rather than answering.

```
rollout_dates_for_branch(branch) -> (testing_start, go_live)   # getdate()-normalised or None
    if branch is falsy:                  return the global pair
    if a branch row exists for `branch`: return that row's pair, used whole
    otherwise:                           return the global pair

phase_for(branch, attendance_date) -> str
    testing_start, go_live = rollout_dates_for_branch(branch)
    if testing_start is None:            return LIVE
    d = getdate(attendance_date)
    if d < testing_start:                return PRELAUNCH
    if go_live is None:                  return TESTING
    if d < go_live:                      return TESTING
    return LIVE
```

Three rules that carry weight:

- **Unset means `LIVE`.** No global dates and no branch row: every day is live,
  exactly as the system behaves today. This is the only safe upgrade default. A
  migration that silently stopped the engine would be far worse than one that
  changes nothing until an admin sets a date.
- **A branch row is used whole; it does not inherit field-by-field.** A branch row
  with a blank `go_live` means "the pilot is still open for this branch" — it does
  **not** fall back to the global `go_live`. Partial inheritance would make a blank
  field mean two different things depending on the global config.
- **The global pair is the primary path, not the fallback.** `hr_calendar.py:779`
  records that *"a great many employees have no branch set"*, and `branch` being
  falsy resolves straight to the global pair. Per-branch rows are for the branches
  that genuinely roll out on their own timetable; most employees will never touch
  one.

A branch that should skip the pilot entirely gets a row with
`testing_start == go_live`: `PRELAUNCH` before that date, a zero-length `TESTING`
window, `LIVE` from the date on.

## Data model

### `Dewey Time Settings` (existing Single)

Three new fields, appended to `field_order` after `landing_workspace_snapshot`:

| Field | Type | Notes |
|---|---|---|
| `rollout_section` | Section Break | Label "Attendance Rollout". |
| `rollout_testing_start` | Date | Global pilot start — the cutoff. Blank means no cutoff: every day is treated as live. |
| `rollout_go_live` | Date | Global go-live. Blank with a testing start set means the pilot is still open. |
| `branch_rollout` | Table | Options `Dewey Time Branch Rollout`. Per-branch overrides. |

### `Dewey Time Branch Rollout` (new child DocType)

`istable: 1`, module `Dewey Time`, `custom: 1` — matching how
`Dewey Time Settings` itself is declared.

| Field | Type | Notes |
|---|---|---|
| `branch` | Link → `Branch` | `reqd: 1`, `in_list_view: 1` |
| `testing_start` | Date | `reqd: 1`, `in_list_view: 1` |
| `go_live` | Date | `in_list_view: 1`. Blank = pilot still open for this branch. |

`testing_start` is required on a child row, so "a `go_live` with no
`testing_start`" cannot be expressed at branch level at all.

### Validation

On `Dewey Time Settings.validate`:

- Global: `rollout_go_live` set with `rollout_testing_start` blank → throw
  `"Set a testing start date before setting a go-live date."`
- Global and each row: both dates set and `testing_start > go_live` → throw
  `"Testing start cannot be after go-live (<branch or 'global'>)."`
- Two rows naming the same branch → throw
  `"Branch <name> appears twice in the rollout table."`

### `Attendance Flag` (existing)

One new field, inserted after `rule_version`:

| Field | Type | Notes |
|---|---|---|
| `rollout_phase` | Select | Options `TESTING\nLIVE`. `read_only: 1`, `search_index: 1`. |

`PRELAUNCH` is deliberately **not** an option: by construction no flag can carry
it, because the engine refuses to write one. Offering the value would invite a
row that contradicts the engine.

The *day*-level `rollout_phase` added to the calendar payload (below) is the same
concept over the full three-value domain — a day can be `PRELAUNCH`, a flag
cannot. The two never collide in one object: the calendar's per-flag field list
(`hr_calendar.py:617`) is not extended, so `days[].flags[]` carries no
`rollout_phase` at all.

The field is blank on every row that exists before this ships. Blank is read as
`LIVE`, consistent with the unset-means-live default, and
`reconcile_rollout_flags` (below) backfills it when an admin actually sets dates.

## Engine integration

One new module, `dewey_time/attendance_engine/rollout.py`, owning every date
comparison in the feature:

```python
PRELAUNCH = "PRELAUNCH"
TESTING = "TESTING"
LIVE = "LIVE"

def rollout_dates_for_branch(branch: str | None) -> tuple[date | None, date | None]
def phase_for(*, branch: str | None, attendance_date) -> str
def branch_for_employee(employee: str) -> str | None
def phase_for_employee(*, employee: str, attendance_date) -> str
```

`rollout_dates_for_branch` reads `frappe.get_cached_doc("Dewey Time Settings")` —
the pattern `webpush.py:31` already uses — and walks the child table on each
call. **No additional memo layer.** The doc read is already cached, branch counts
are small (well under the per-request employee-day count at which parsing would
matter), and a module-level or `frappe.local` memo would be a live trap in this
test suite: `_install_frappe_mock()` replaces `sys.modules["frappe"]` with a
MagicMock whose every attribute is truthy, so a memo guarded by
`if frappe.local.x:` would read a MagicMock as a populated cache.

`branch_for_employee` exists so the refusal path and the stamp path cannot read
the branch two different ways.

### The refusal — three entry points

Each already resolves `employee_branch`, so nothing new is plumbed through:

| Entry point | Branch already at |
|---|---|
| `closeout._generate_for_employee_date` | `closeout.py:497` |
| `intraday.refresh_intraday_flags_for_employee_date` | `intraday.py:91` |
| `closeout._generate_company_fallback_for_date` | `closeout.py:271` |

Each returns early when `phase_for(...)` is `PRELAUNCH`, **before calling
`_delete_auto_flags_for_employee_date`**.

Returning before the delete is a decision, not an accident.
`_delete_auto_flags_for_employee_date` carries the delivery-marker protection
added in #148 (`exclude_names`, sparing `DELIVERY_FAILED` and the
`delivery_failed` variant of `ATTENDANCE_ISSUE` unless the caller is about to
rebuild them). Running that delete on a day the engine has no opinion about would
re-open exactly the question #148 closed — whether an ops marker recording "this
device never delivered" should survive a wipe — in a context where the answer is
genuinely unclear. Removal of pre-cutoff rows gets one owner instead
(`reconcile_rollout_flags`), where the policy can be stated once and explicitly.

The cost of this choice is stated plainly: **moving a cutoff later leaves
already-written flags behind.** They are removed by running the reconcile, which
is a documented step of changing a date, not an optional cleanup.

### The stamp — one place

`closeout._insert_flag` (`closeout.py:809`) is the sole insert for every AUTO
flag in the app. Verified: `_insert_flags` routes to it, and the other call sites
(`closeout.py:301`, `intraday.py:136,176,194`) call it directly. Nothing else
constructs an `Attendance Flag` with `source: "AUTO"`.

It gains one key in the doc dict:

```python
"rollout_phase": rollout.phase_for_employee(
    employee=employee, attendance_date=attendance_date
),
```

A single choke point means a call site added later cannot forget the field. The
extra `frappe.get_cached_value("Employee", employee, "branch")` per insert is
paid against a path that is already constructing and inserting a document.

Because the refusal runs upstream, `_insert_flag` only ever observes `TESTING` or
`LIVE` — which is why those are the only two Select options.

## The two purge operations

Both live in `dev_tools.py` beside the existing destructive operations, both are
`@frappe.whitelist()`, both call `_require_system_manager_for_clear()`
(`dev_tools.py:230`), and both default to `dry_run=1` and report what they *would*
do without doing it.

Both filter `source = "AUTO"`. An HR-created flag on a pre-cutoff day is a
deliberate human act — never auto-deleted, never stamped, never counted.

`dry_run` and `branch` arrive as **strings** over HTTP, so `dry_run="0"` is
truthy and would silently turn a real purge into a no-op — or worse, the inverse.
Both endpoints coerce through the same helper shape as
`dev_tools._parse_include_all_active` (`dev_tools.py:273`), which exists for
exactly this hazard. A test pins `dry_run="0"` executing and `dry_run="1"` not.

### `purge_testing_flags(branch=None, dry_run=1)`

Deletes AUTO flags where `rollout_phase = "TESTING"`, optionally scoped to the
employees of one branch. This is the "remove the trial data" operation: run it
once a branch is confidently live and the calibration flags have served their
purpose.

Returns `{"scanned": n, "deleted": n, "by_branch": {...}, "dry_run": bool}`.

### `reconcile_rollout_flags(branch=None, dry_run=1)`

Makes the flag table agree with the current configuration. For every AUTO flag in
scope, computed from the flag's own `(employee's branch, attendance_date)`:

- `PRELAUNCH` → delete the row
- otherwise → write `rollout_phase` if it differs from what is stored

Run it after setting the dates for the first time (it clears the historical
pre-cutoff flags and backfills the blank `rollout_phase` values), and again any
time a date moves.

Returns `{"scanned": n, "deleted": n, "restamped": n, "by_branch": {...},
"dry_run": bool}`.

The employee → branch map is loaded in one query, reusing the denormalisation
helper at `flag_decision_api.py:180` that already exists so the queue never has to
join `Employee`.

**An employee who has changed branch is judged by their current one.** The flag
does not store the branch it was written under, so reconcile can only read
`Employee.branch` as it stands now. A person who moved from a branch that was
live to one still in its pilot will have their older flags re-stamped `TESTING`.
This is stated rather than solved: denormalising branch onto every flag to fix it
would cost a column and a backfill to correct a case that arises only when
someone transfers *during* a rollout window.

### No buttons

Both operations are backend-only, reached by `bench execute` or a direct API
call. They are rollout-day admin actions, not routine HR work, and punch-list item
T1-5 was specifically a finding about destructive controls being too visible in
the SPA. That surface is not growing.

### Orphaned decisions

Purging a flag leaves any `Attendance Flag Decision` that referenced it pointing
at nothing. This is already a state the queue handles — `flag_grouping._orphans`
(`flag_grouping.py:521`, surfaced as `orphans` in the grouping payload at
`flag_grouping.py:151`) exists precisely to report decisions whose flag is gone.
Purging a pilot flag therefore surfaces its decision as an orphan rather than
corrupting anything, which is the honest outcome: the decision was practice, and
so was the flag.

## What HR sees

Two surfaces. Both are included because they prevent a **misreading**, not to
decorate. Both live in the single `hr_attendance` Vite app, which serves
`/hr-attendance`, `/hr-schedule` and `/hr-flags` — one rebuild covers both.

Each is split across the two passes: the payload is **Phase A**, the rendering is
**Phase B**.

### 1. Phase banner on the flag queue

**Phase A.** `get_flag_queue` gains a `rollout` block:

```json
"rollout": {
  "phases_configured": true,
  "range_phase": "TESTING",
  "testing_flag_count": 34,
  "total_flag_count": 91,
  "windows": [
    {"branch": "Northgate", "testing_start": "2026-08-15", "go_live": "2026-09-01"}
  ]
}
```

`range_phase` is one of `TESTING`, `LIVE`, `MIXED`, computed from the
`rollout_phase` values actually present in the result set. `windows` lists only
the branches appearing in that result set, so the banner can name them without
dumping the whole config. `phases_configured` is false when no dates are set
anywhere.

**A window can have `"branch": null`.** That is the global pair, and it appears
whenever any pilot flag in the result set belongs to an employee with no branch
set — which, per *"the global pair is the primary path, not the fallback"*
above, is the likeliest rollout of all rather than an edge case. Without it the
common case would report `range_phase: "TESTING"` with an empty `windows`, and
the banner would have nothing to name. The null-branch window is **appended
after** the branch-named ones, which are sorted by name; `null` has no place in
that sort, so its position is fixed here rather than left to fall out.

Both dates in a window can also be `null` — a branch whose flags are pilot flags
but whose configured dates were cleared between the writing and the reading.
Phase B gets the nulls rather than a fabricated range.

**Phase B.** `FlagQueuePage.tsx` renders a banner above the queue:

| State | Banner |
|---|---|
| `phases_configured: false`, or `range_phase: "LIVE"` | none — there is nothing to say |
| `"TESTING"`, one window, `branch` set | *"Aug 15 – Sep 1 is the pilot period for Northgate — calibration data, not the official record."* |
| `"TESTING"`, one window, `branch: null` | *"Aug 15 – Sep 1 is the pilot period — calibration data, not the official record."* |
| `"TESTING"`, more than one window | *"This range falls in the pilot period for 3 branches — calibration data, not the official record."* |
| `"MIXED"` | *"This range spans go-live. 34 of 91 flags are from the pilot period."* |

The one-window and many-window split matters because branches roll out on
different timetables by design; naming four date ranges in a banner would be
worse than naming none.

The `branch: null` row is the same sentence with the "for Northgate" clause
dropped — there is no branch to name, so naming none is the honest form, and the
dates are the part HR needs either way. It is a distinct row rather than a
rendering detail because it is the case a global rollout over a branchless
roster produces, i.e. the one most likely to be on screen first. When a null
window appears *alongside* named ones the many-window row applies as written;
its count includes the null window, which is correct — those are people in the
pilot on the global timetable.

The queue's cache prefix goes `flag_queue:v3` → `flag_queue:v4`. This is
mandatory, not hygiene: the comment at `flag_queue_api.py:40-53` records that a
deploy does not clear Redis, so for a full TTL afterwards a key written by the old
code would answer the new frontend with a payload missing `rollout` — a thrown
render for every HR user in the first minute after release.

### 2. Pre-cutoff marker on calendar days

**Phase A.** `hr_calendar.get_week` already resolves `employee_branch` once for
the whole week (`hr_calendar.py:549`). Each entry in `days` gains
`"rollout_phase": <phase>`, computed per day from that single branch value plus
one cached settings read.

**Phase B.** `DayChips` renders a muted "Before go-live" chip on a `PRELAUNCH`
day instead of an empty flag area. This is the one place the cutoff can
actively mislead: an
unevaluated day is otherwise pixel-identical to a clean day, and an HR user
reviewing a week has no way to tell the difference.

`hr_calendar` has no payload cache prefix, so nothing to bump there.

### Deliberately not built: a per-row "Pilot" badge

In the common case the entire selected range sits in one phase, so a badge would
appear on every row and say nothing. The mixed-range case — the only one where
per-row identity matters — is carried by the banner's `34 of 91` count. The queue
row already carries person, cause, tier and counts.

## Out of scope

- **Employee-facing behaviour.** `api.get_my_week` returns flags to the employee
  and will carry `rollout_phase` along with the rest of the row, but there is no
  employee-facing flag UI in this repo, so nothing else changes. Whether employees
  should see pilot flags is a policy question for whenever that UI is built.
- **Phasing `Attendance Flag Decision`.** Decisions are not marked, not gated, and
  not purged; a decision on a pilot flag becomes an orphan when the flag goes.
- **The dates themselves.** They are configuration an admin sets in Desk. Nothing
  in this design hard-codes a date.
- **`Device Closeout Alert` and `Device Sync Status`.** These record device
  health, not employee conduct. A device that failed to deliver before the cutoff
  still failed, and that record stays.

## Testing

### Unit — Phase A (mocked frappe, the `test_closeout.py` pattern)

- `phase_for` truth table: global set / unset × branch row present / absent ×
  `go_live` set / blank, plus both boundary days (`date == testing_start` →
  `TESTING`, `date == go_live` → `LIVE`), unset → `LIVE`, and
  `testing_start == go_live` → no pilot window.
- A branch row with a blank `go_live` does **not** inherit the global `go_live`.
- A falsy branch resolves to the global pair.
- Each of the three entry points writes nothing and deletes nothing on
  `PRELAUNCH`. Each assertion is mutation-checked by removing its guard and
  confirming the test fails.
- `_insert_flag` stamps the phase; a pilot-window day regenerated after go-live is
  still stamped `TESTING`.
- Settings validation: each of the three throw conditions fires, and a valid
  config does not.
- Both purge endpoints throw without System Manager; `dry_run=1` writes nothing
  while still returning non-zero counts; and the string forms `"1"` / `"0"`
  behave as the booleans they name.
- `reconcile_rollout_flags` re-stamps by the employee's **current** branch — a
  test pins the transfer case so the behaviour is a recorded choice rather than a
  discovered surprise.
- `get_flag_queue` returns a `rollout` block whose `range_phase` is `TESTING`,
  `LIVE` and `MIXED` for the three corresponding result sets, and whose `windows`
  lists only branches present in that result set. Phase B has no backend to lean
  on if this is wrong, so it is pinned here, not there.
- Each calendar day carries its `rollout_phase`, including a week straddling a
  cutoff where the same payload holds both `PRELAUNCH` and `TESTING` days.

### Real bench — Phase A (`test_integration_pilot_matrix.py`)

This module actually runs now, after #147 fixed the Company bootstrap. Four cases
against real Frappe:

- A pre-cutoff day **with punches present** produces zero AUTO flags — proving
  the refusal, not merely an empty day.
- A pilot-window day produces flags stamped `TESTING`.
- A post-go-live day produces flags stamped `LIVE`.
- `purge_testing_flags` removes exactly the pilot rows and leaves the live ones,
  verified by count before and after.

### Frontend — Phase B

- `flagQueuePage.test.tsx`: all-live and `phases_configured: false` render no
  banner; single-window pilot names the branch and its dates; multi-window pilot
  gives the branch count instead; mixed gives the `N of M` count.
- A calendar test asserting the `PRELAUNCH` chip renders and that a `LIVE` day
  with no flags still renders as it does today.

## Global constraints

**Phase A:**

- **Bump `modified` on every DocType JSON touched** (`Attendance Flag`,
  `Dewey Time Settings`, and the new `Dewey Time Branch Rollout`). On this repo
  `bench migrate` skips the schema reimport otherwise, and the new fields simply
  never appear.
- **Bump the flag-queue cache prefix to `flag_queue:v4`** in the same pass that
  adds `rollout` to the payload.
- Both purge endpoints must be gated by `_require_system_manager_for_clear()` and
  must default to `dry_run=1`.
- No behaviour changes when no dates are configured. A test must pin this
  directly.
- No frontend files change, and no bundle is rebuilt.

**Phase B:**

- **Commit the rebuilt SPA bundle** (`dewey_time/public/hr_attendance/**` and the
  `dewey_time/www/*.html` entry). Frappe Cloud never builds these SPAs, because of
  the private `@lolbikb/dewey-ui` dependency — the committed bundle *is* the
  deployed artifact.
- No Python changes, and no DocType JSON changes. If Phase B finds it needs
  either, that is a signal Phase A's payload was wrong and the fix belongs in a
  correction to Phase A, not smuggled into the frontend pass.
