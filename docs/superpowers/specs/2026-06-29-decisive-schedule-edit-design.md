# Decisive schedule edit — design

**Date:** 2026-06-29
**Status:** Draft (revised after adversarial review; pending user sign-off)
**Suggested branch:** `feat/decisive-schedule-edit`

> Revision note: this spec was hardened after a 4-lens adversarial review. The
> load-bearing change versus the first draft is that the leaving/adding/unchanged
> diff is computed on **structural schedule identity** (day-set + full time
> profile, grace included), not on PAT name strings. See "The structural diff".

## Problem

Today there is no way to *change* an employee's set schedule. The weekly-schedule wizard
prefills the current pattern but then locks it: `get_employee_schedule_context` returns
`can_apply = (enabled_ssa_count == 0)`, and that flag gates editing in **three** places —
the read-only flags (`WeeklySchedulePage.tsx:154-156`), the `handleSave` early return
(`:200`), and `saveDisabled` (`:271`). Even a direct POST is rejected — `apply_weekly_schedule`
throws *"This employee already has an active Shift Schedule Assignment…"* (`schedule_api.py:359`).

The only path to a different schedule is the **dev "Clear employee schedule" tool**
(`dev_tools.clear_employee_schedule_api`). It is destructive — it deletes the employee's
Shift Schedule Assignments, **submitted Shift Assignments, and Attendance Flags**, and even
deletes the linked Employee Checkins / Attendance to force the cancels through
(`schedule_resolver.py:856-948`). It is **System-Manager-gated**, and it drops HR back to a
blank grid to re-enter everything by hand. That destroy-and-recreate dance is what we are
replacing.

## Goal

Make editing a set schedule a first-class, **non-destructive, effective-dated** operation
in the existing wizard: HR opens an employee, edits the prefilled grid, picks an effective
date, sees exactly what will change, and saves — with all history before the effective date
left untouched, and a clear post-save confirmation of what changed.

## Non-goals (YAGNI)

- **Retroactive correction.** Edits are forward-effective only (confirmed decision). We never
  regenerate past Shift Assignments or re-run the flag engine for past dates.
- **A second "Edit schedule" screen.** Editing happens in place in the wizard that already
  prefills the current pattern. No new route, no duplicated grid.
- **Removing or changing the destructive clear tool.** It stays as-is, System-Manager-gated,
  for the genuine "wipe and start over" case.
- **Bulk / multi-employee edits.** One employee at a time, like the wizard today.

## Engine alignment (frappe/hrms)

Verified against `frappe/hrms` source. The methods and fields this design depends on —
`SSA.create_shifts`, `process_auto_shift_creation`, `validate_existing_shift_assignments` /
`get_existing_shift_assignments`, `ShiftAssignment.on_cancel`, `on_update_after_submit`, the
`shift_schedule_assignment` back-link, `end_date`/`status` `allow_on_submit`, and
`get_overlapping_dates` / `validate_overlapping_shifts` — are **identical across
`version-15`, `version-16`, and `develop` (17.0.0-dev)**. (The branches do differ elsewhere —
the unrelated `overtime_type` feature added in v16, and auto-generated type-hint blocks in
develop — but none of that touches this design.) So the design holds regardless of the
version `dewey.frappehr.com` runs.

Findings that drive the design:

1. **SSA is a plain, mutable, non-submittable config row.** Its writable fields are
   `enabled`, `create_shifts_after`, `employee`, `company`, `shift_status`, `shift_schedule`,
   `shift_location` (plus a fetched read-only `employee_name`). **There is no `end_date`, no
   `frequency`, and no native swap/transfer.** `frequency` lives on **Shift Schedule**, not
   SSA. So "stop a schedule on a date" is not a field you set — it is `enabled = 0` plus
   retiring the already-generated future assignments yourself.

2. **`enabled` is the kill switch.** The rolling job `process_auto_shift_creation()` only
   extends SSAs where `enabled = 1`. Setting `enabled = 0` halts all *future* generation but
   does **not** retract already-created Shift Assignments. `shift_status` only stamps the
   `status` onto *newly* generated rows.

3. **`SSA.create_shifts(start, end=None)` is NOT idempotent.** It blindly generates and
   `submit()`s Shift Assignments (default window **90 days** when `end` omitted), advancing a
   `create_shifts_after` watermark. Re-running over a covered range does **not** skip — it
   raises via `validate_overlapping_shifts`:
   - **`MultipleShiftError`** when the HR Setting *Allow Multiple Shift Assignments for Same
     Date* is **OFF (the default)** — `validate_same_date_multiple_shifts` throws for any
     same-date overlap, before the timing check.
   - **`OverlappingShiftError`** when that setting is **ON** and timings overlap — and a
     re-generated identical PAT always self-overlaps, so it still throws.
   Neither is downgraded to a warning for the *submitted* rows `create_shifts` emits. Both are
   subclasses of `frappe.ValidationError`. **Implication: retire old future rows before
   generating, never regenerate a PAT the employee already holds, and catch BOTH exceptions.**

4. **`validate_existing_shift_assignments` guard is per-SSA.** On an *existing* SSA, changing
   `create_shifts_after` is rejected if **that SSA's own** generated Shift Assignments are
   `status == "Active"` with `end_date >= new create_shifts_after`
   (`get_existing_shift_assignments` INNER JOINs Shift Assignment to SSA on the
   `shift_schedule_assignment` back-link). We avoid tripping it by (a) not touching unchanged
   SSAs and (b) inactivating/trimming the relevant SSA's future Active rows *before* any
   `create_shifts_after` change.

5. **The back-link is the correct retirement scope.** Every generated Shift Assignment carries
   a read-only `shift_schedule_assignment` Link to the SSA that produced it. Retire future
   rows by filtering on **that link**, not on `shift_type`. This is the precise fix for the
   latent bug in the dead reconcile code (see "Bug being fixed").

6. **Retire via `allow_on_submit`, not `cancel`.** Both `end_date` and `status` are
   `allow_on_submit: 1`, and `on_update_after_submit` only re-validates dates + overlap — it
   does **not** re-run the `on_cancel` guards (`validate_employee_checkin`,
   `validate_attendance`, which block cancelling any assignment with a checkin/attendance in
   `[start_date, end_date]`). So:
   - **Straddling row** (`start < E <= end`, or open-ended `end IS NULL` with `start < E`):
     set `end_date = E - 1`.
   - **Pure-future row** (`start >= E`): set `status = "Inactive"`. Overlap math ignores
     Inactive rows, so this is both non-destructive and overlap-safe for the new generation.
     (Mirrors the engine's own `mark_expired_shift_assignments_as_inactive`.) No `cancel`.

7. **Our flag engine already assumes this.** `attendance_engine/shift_assignment.py` reads
   assignments as *"Live (today/future): status must be Active"* and *"Historical (past):
   Active first, then Inactive if no Active row (HRMS retired slices)"* (lines 27-28, 100-102).
   So an inactivated future row correctly drops out of future expectations, while trimmed
   past slices stay readable for historical attendance. Retire-by-status is the contract the
   engine was built around.

**Net:** disable leaving SSAs, trim/inactivate only their future assignments (scoped by
back-link), create SSAs for genuinely new schedules and generate from `E`, leave unchanged
schedules alone — exactly the engine-blessed cutover. No newer native mechanism exists.

## The structural diff

The leaving/adding/unchanged classification is computed on **structural schedule identity**,
defined as:

```
_group_identity(days, profile) = (
  tuple of weekday names sorted by weekday index,
  profile_key(profile)        # (start, end, lunch_start, lunch_end, grace_minutes)
)
```

`profile_key` (already in `schedule_resolver.py:122-129`) includes grace and lunch, so two
schedules are "the same" only when their days **and** full time profile match. We compare
identities, **not PAT name strings**, because PAT/Shift-Type names drop `grace_minutes`
(`proposed_shift_type_name` = `FT_{start}_{end}`) and an employee's SSA may point at a
non-canonical/aliased PAT for a structure the resolver would name differently. Keying on
names would (a) silently skip a grace-only edit as "unchanged" and (b) mark a structurally
identical schedule as leaving+adding when names differ.

- **current identities** — for each *enabled* SSA, resolve its `(repeat_days, profile)` from
  the submitted PAT + Shift Type (the same resolution `week_pattern_from_ssas` already does),
  then `_group_identity(...)`.
- **target identities** — `_group_identity(group["days"], group["profile"])` for each plan
  group from `group_week_pattern`.

| Bucket | Definition | Action |
|---|---|---|
| **Leaving** | enabled SSA whose identity ∉ target identities | disable SSA (`enabled=0`, `shift_status=Inactive`); retire its future assignments (≥ E) by back-link |
| **Adding** | target group whose identity ∉ current identities | create/reuse PAT + SSA; `create_shifts(E, generate_through)` |
| **Unchanged** | target group whose identity ∈ current identities | **leave entirely alone** — no retire, no regenerate (prevents the overlap throw) |

"Unchanged" is what makes overlap impossible and churn minimal: if HR only changes Friday's
hours, the Mon–Thu identity is unchanged and untouched; only the old Friday schedule leaves
and the new Friday schedule is added. If a day-regroup forces the Mon–Thu identity to change
(e.g. they were bundled with Friday in one profile), the whole bundle correctly lands in
leaving+adding and is retired-then-regenerated — no overlap, because the leaving rows are
inactivated first.

## Design — backend

The hard gate in `apply_weekly_schedule` is removed and replaced with an **edit-aware** path.
The create case becomes the degenerate edit case (no enabled SSAs → nothing leaving, nothing
unchanged, every group adding → identical to today's behavior), so the change is
backward-compatible.

### Functions (`schedule_resolver.py`)

- **`_group_identity(days, profile) -> tuple`** — new pure helper, as defined above.

- **`_current_schedule_identities(employee) -> dict[tuple, dict]`** — new. For each enabled
  SSA, resolve `(repeat_days, profile)` from its submitted PAT + Shift Type and map
  `_group_identity(...) -> {"ssa": <name>, "shift_schedule": <pat>, "shift_type": <type>}`.

- **`_future_assignments_for_ssa(ssa_name, effective_from) -> list[dict]`** — replaces
  `_future_assignments_for_shift_type`. Filters `Shift Assignment` by
  `shift_schedule_assignment == ssa_name`, `docstatus == 1`, `status == "Active"`,
  `end_date >= effective_from`. Classifies: `start_date >= E` → `{"action": "inactivate"}`;
  `start_date < E` (incl. open-ended) → `{"action": "end_before", "proposed_end_date": E-1}`.
  **Fail closed:** if the `shift_schedule_assignment` column is absent, `frappe.throw` a clear
  error rather than falling back to shift_type scoping (which is the very bug being fixed). The
  column exists on all supported versions, so this never fires in practice.

- **`build_reconcile_preview(employee, plan, effective_from) -> dict`** — pure read, no
  writes. Computes the structural diff and returns:
  ```python
  {
    "effective_from": "YYYY-MM-DD",
    "disable_ssas": [{"name", "shift_schedule", "shift_type"}],   # leaving
    "add_identities": ["<json identity key>", …],                 # adding (for the apply loop)
    "unchanged_identities": ["<json identity key>", …],           # skipped
    "add_labels": ["MON-FRI 08:00–17:00", …],                     # adding, human (display)
    "leaving_labels": ["…"],                                      # leaving, human (display)
    "affected_assignments": [                                     # from _future_assignments_for_ssa
      {"name", "shift_type", "start_date", "end_date", "action", "proposed_end_date"}
    ],
  }
  ```
  Identity keys are the `_group_identity` tuple rendered as a stable JSON string so they
  survive the JSON round-trip to the apply loop and the frontend.

- **`reconcile_orphan_ssas(employee, plan, effective_from) -> dict`** — executes the leaving
  bucket: `_disable_ssa(name)` for each leaving SSA (reuses the existing helper); for each
  affected assignment, `end_before` → set `end_date` and save (allow_on_submit), `inactivate`
  → set `status = "Inactive"` and save. **No `cancel`.** Returns
  `{disabled_ssas, trimmed_assignments, inactivated_assignments}`.

### `apply_weekly_schedule` changes (`schedule_api.py`)

1. **Delete** the `employee_has_enabled_ssas` throw (lines 359-365). Keep the import — it is
   reused for the forward-only guard below.
2. **Forward-only guard (edits only):** if `employee_has_enabled_ssas(employee)` and the
   resolved effective date `<= today`, throw *"Editing a schedule requires an effective date
   in the future."* (Fresh creates / the importer keep today's behavior — no guard.)
3. Build the plan (as today) and `reconcile = build_reconcile_preview(...)`.
4. **Confirm step — gate on ANY change set:** return `{needs_confirm: True, plan, reconcile}`
   when `plan.needs_create` **or** `reconcile.disable_ssas` **or** `reconcile.add_identities`
   **or** `reconcile.affected_assignments` is non-empty. (This closes the pure-add bypass:
   adding a day whose PAT already exists on site is `action="use"`, so `needs_create` is
   False, but `add_identities` is non-empty.) For fresh creates with nothing pre-existing this
   still reduces to today's `needs_create` behavior.
5. **On confirm**, inside the existing transaction, in this order:
   a. `reconcile_orphan_ssas(...)` — retire leaving SSAs + their future rows first.
   b. Loop `plan["groups"]`; for each group compute `key = _group_identity(group["days"],
      group["profile"])` rendered to the same JSON string. **`continue` if `key` is in
      `reconcile.unchanged_identities`.** Otherwise (adding): create/reuse Shift Type +
      Shift Schedule, `upsert_ssa`, `generate_shifts_for_ssa(ssa, E, generation_end)`.
   c. `frappe.db.commit()`.
6. Wrap the loop's `except` to catch **both** `MultipleShiftError` and `OverlappingShiftError`
   (alongside the existing duplicate-PAT / `validate_existing_shift_assignments` handling) and
   surface a clear message.
7. Return `{ok, ssas, created, reconciled: {disabled_ssas, trimmed_assignments,
   inactivated_assignments}, assignments_generated_through, …}` — but set
   `assignments_generated_through`/`assignments_open_ended` to `null` when the adding bucket
   is empty (pure-removal edit), so the success UI never claims generation that didn't happen.

### Cache + hooks

`apply_weekly_schedule` already mutates SSAs; the existing `Shift Schedule Assignment`
doc-event hook (`coverage_api.invalidate_coverage_cache`) keeps the Schedule Coverage page
fresh. The schedule-templates cache is TTL-based (300s); no new invalidation needed.

## Design — frontend

1. **Remove the `can_apply` editing lock in all three places** — the derived
   `scheduleReadOnly`/`previewOnly` flags (`WeeklySchedulePage.tsx:154-156`), the `!canApply`
   early return in `handleSave` (`:200`), and `!canApply` in `saveDisabled` (`:271`). Editing
   is gated only on validity (`validationIssues`, `effectiveFrom`, `hasWorkingDays`,
   `generateThrough`). Remove the stale "read-only preview — clear existing SSAs" card
   (`:375-382`).
2. **Edit affordance.** When `enabled_ssa_count > 0`, the page reads as editing
   ("Editing {name}'s schedule") and the Save button reads "Review changes" (edits always
   route through the confirm step because step 4 above always returns `needs_confirm` when
   anything changes). `effective_from` date-picker `min` clamps to tomorrow for edits.
3. **Reconcile preview in the confirm step.** Extend `ReconcilePreview`
   (`types/schedule.ts:54-69`): change `action` to `"inactivate" | "end_before"`, add
   `add_labels: string[]`, `leaving_labels: string[]`, `add_identities`/`unchanged_identities`
   (string[]). Extend `ApplyScheduleResult` (`:111-123`) with
   `reconcile?: ReconcilePreview` and `reconciled?: { disabled_ssas: string[];
   trimmed_assignments: string[]; inactivated_assignments: string[] }`. The confirm dialog
   (`:569-602`) gains a "What changes on {E}" section driven by the summary lib: *"Retiring
   MON–FRI 09–17 · 3 future shifts inactivated · 1 trimmed to end {E-1}"* and *"Adding MON–SAT
   08–17 from {E}"*, in addition to the existing created-records list.
4. **Pure, unit-tested summary logic** in `src/lib/scheduleEdit.ts` (under the `test:web`
   glob): `summarizeReconcile(reconcile) -> { hasChanges, leavingLabels, addingLabels,
   inactivatedCount, trimmedCount, lines }`.
5. **Post-save success state.** On `ok`, the success card reports what happened using
   `reconciled` counts: *"Schedule updated — N future shifts inactivated, M trimmed to {E-1};
   new pattern effective {E}."* For a fresh create (empty `reconciled`), keep today's
   "Schedule saved" copy. Do not show "generated through X" when nothing was added.
6. **Re-fetch + re-derive after a successful edit.** Keep the `refreshContext()` call on `ok`
   (`:237`), and fix the prefill effect so a second same-session edit starts from fresh server
   state: the effect that derives the grid + dates (`:135-142`) is currently keyed on
   `[context?.employee]` only, so it does not re-run after a same-employee refetch. Add a
   `savedNonce` state bumped on `ok` and include it in the effect deps, so on save the grid,
   `effective_from`, and `generate_through` re-derive from the refreshed context.

## Data flow / contract

```
Apply (preview):  apply_weekly_schedule(employee, week_pattern, create_shifts_after=E, …,
                    confirm_create=0)
                    → { needs_confirm: true, plan, reconcile }    # when anything changes
Apply (commit):   apply_weekly_schedule(…, confirm_create=1)
                    → { ok: true, ssas, created,
                        reconciled: { disabled_ssas, trimmed_assignments,
                                      inactivated_assignments },
                        assignments_generated_through, assignments_open_ended, … }
```

## Permissions

Editing stays `_require_hr_role()` — same gate as creating a schedule. It is non-destructive
of history (forward-only, no deletes, no cancels of worked days), so it does **not** require
System Manager. The destructive **clear** tool keeps its `_require_system_manager_for_clear()`
gate, untouched.

## Bug being fixed

The dormant `_future_assignments_for_shift_type` (`schedule_resolver.py:504`) selects future
assignments to retire by **`shift_type` alone**. If a leaving schedule and a *kept* schedule
share a Shift Type (e.g. both use `FT_0900_1700`), it would retire shifts belonging to the
schedule being kept. The fix is to scope by the engine's `shift_schedule_assignment` back-link
(per-SSA). The replacement **fails closed** (throws) if the back-link column is absent rather
than reverting to the buggy scoping. This code currently has **zero test coverage** — wiring
it up includes writing its tests.

## Testing

**Python `unittest`** — new `dewey_time/tests/test_schedule_reconcile.py` (mock `frappe` per
the `test_closeout._install_frappe_mock` pattern):
- `_group_identity`: equal day-set + profile → equal key; **grace difference → different
  key** (regression guard for the grace-only bug); day-order independence.
- `_future_assignments_for_ssa`: scopes by back-link (a kept SSA sharing a `shift_type` is NOT
  returned); classifies `inactivate` vs `end_before` by start vs E; open-ended (`end IS NULL`,
  `start < E`) → `end_before` with `proposed_end_date = E-1`; ignores rows with
  `end_date < E`; ignores non-Active; **throws when the back-link column is absent** (fail
  closed).
- `build_reconcile_preview` (structural): (a) pure add (no current SSAs) → all adding; (b)
  full swap; (c) one-day-hours change with a shared unchanged identity; (d) reorder that keeps
  the same identities → nothing leaves/adds; (e) **grace-only edit → leaving+adding, not
  unchanged**; (f) **employee on a non-canonical PAT name for a structure that stays → still
  classified unchanged** (no spurious churn).
- `reconcile_orphan_ssas`: disables leaving SSAs; trims straddling (`end_date = E-1`);
  inactivates pure-future (`status = "Inactive"`); never calls `cancel`.

**Python `unittest`** — `dewey_time/tests/test_apply_weekly_schedule.py` (new):
- Edit path no longer throws on existing SSAs (and **replace** the now-obsolete
  `test_apply_blocked_when_employee_has_enabled_ssa` in `test_schedule_resolver.py:447`, which
  asserted the deleted throw — it must now assert `needs_confirm` + a `reconcile` payload).
- Confirm step returns `reconcile`; **pure-add edit (reused existing PAT) also returns
  `needs_confirm`** (closes the bypass).
- On confirm, generates only for adding groups; **unchanged identities are not regenerated**
  (assert no call to `generate_shifts_for_ssa` for them → no overlap).
- **Re-adding a previously-disabled identity**: an SSA disabled in a prior edit (its future
  rows already Inactive) is re-enabled and regenerated from E without tripping
  `validate_existing_shift_assignments`.
- Forward-only guard throws on `E <= today` for an employee with enabled SSAs.
- The overlap-failure path asserts a clear message for **both** `MultipleShiftError` and
  `OverlappingShiftError`.

**Frontend `node:test`** — `src/lib/scheduleEdit.test.ts`: `summarizeReconcile` —
inactivated/trimmed counts + pluralization, leaving/adding labels, empty reconcile →
`hasChanges:false` and no lines.

**Playwright e2e** — extend the schedule spec + `e2e/fixtures.ts`: an employee with
`enabled_ssa_count > 0`, an `apply_weekly_schedule` stub returning `needs_confirm` + a
`reconcile` payload. Assert: Save reads "Review changes"; the confirm dialog's "What changes
on E" section renders leaving + adding + counts; on confirm-success the success card shows the
reconciled summary.

All gated by existing CI jobs (`tests`, `unit-web`, `e2e`).

## Risks / edge cases

- **Overlap on regenerate.** Mitigated by the unchanged bucket (never regenerate a held
  identity) + retire-before-generate ordering + inactivating (not leaving Active) old future
  rows. Covered by the "one-day change with shared unchanged identity" and "no regeneration of
  unchanged" tests.
- **`validate_existing_shift_assignments` trip.** It is per-SSA (back-link join) and filters
  Active only; we inactivate a leaving/reused SSA's future rows before any
  `create_shifts_after` change, and `upsert_ssa` only ever moves the watermark earlier. The
  re-add-disabled-identity test guards this.
- **Effective date in the past.** Edits throw if `E <= today`; the picker `min` is tomorrow.
  Fresh creates are unaffected.
- **`shift_schedule_assignment` column missing.** Fail closed (throw) — never silently
  mis-scope. Covered by a test; unreachable on supported versions.
- **Concurrent auto-job.** `process_auto_shift_creation` filters `enabled=1`; our disable is
  inside the committed transaction, so the job sees the final state.

## Deploy

Standard: `npm run build` then `bench migrate` on Frappe Cloud (rebuilt bundle + updated
whitelisted `apply_weekly_schedule`). No new DocType, no new patch, no new hook.
