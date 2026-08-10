# DocType Controllers: waking the code that never ran

**Punch list:** T3-11 · **Found:** 2026-08-10, during the `feat/rollout-phases` whole-branch review

## The defect

Seven of `dewey_time`'s eight DocTypes carry `"custom": 1`. Frappe's
`import_controller` (`frappe/model/base_document.py:103-106`) reads that flag **from
the database** and returns the base `Document` class for anything marked custom — so
the app's controller modules are never imported, and not one hook in them has ever
executed in production.

```python
doctype_info = frappe.db.get_value("DocType", doctype, ("module", "custom", "is_tree"), as_dict=True)
if doctype_info:
    if doctype_info.custom:
        return NestedSet if doctype_info.is_tree else Document   # <- app controller never loaded
    module_name = doctype_info.module
```

Evidence: AUTO `Attendance Flag` rows on a bench are named `pjhg286ggs`, `pjhhrcf5tp`
— Frappe's random hash naming — where `AttendanceFlag.before_insert` is written to
assign a deterministic name. If the controller ran, no AUTO flag could carry a hash
name.

`schedule_change_log` is the exception: it has no `custom` key, so its controller
loads normally. It is the in-repo control case, and proof the app can host a standard
DocType without incident.

### What is dead

`AttendanceFlag.before_insert` and `.before_save`; `AttendanceFlagDecision.validate`;
`DeviceSyncStatus.autoname` and `.validate`; `DeviceCloseoutAlert.autoname` and
`.validate`; `DeweyTimePushSubscription.autoname`; `DeweyTimeSettings.validate`.

### Why it has not been catastrophic

Two mitigations, so the finding is not overstated. `closeout._insert_flag` supplies
`severity` and `company` itself rather than relying on the `before_insert` defaults,
and the engine's delete-then-reinsert cycle makes flag regeneration idempotent
without needing deterministic names.

### What it is costing

- **`DeweyTimeSettings.validate` is inert**, so an incoherent rollout configuration —
  a go-live with no testing start, a reversed pair, a duplicated branch — can be
  saved in Desk today. This is the concrete cost the rollout work left behind.
- **`DeviceSyncStatus.autoname` never ran**, so duplicate rows accumulated per
  `(device_sn, local_date)`. The app grew `device_sync.merge_device_sync_duplicates`
  specifically to clean them up after the fact — a compensating mechanism for a
  problem the dead `autoname` was written to prevent.
- **Several past "fixes" landed in dead code.** The duplicate-docname fix described in
  `_insert_flags`' docstring and the `-prov` naming fix in `attendance_flag.py:53-71`
  both modify code that has never executed. Whatever was observed, it was not those
  code paths misbehaving in production.

## Approach

Flip `"custom": 1` → `0` in the seven DocType JSONs, bump each file's `modified`
timestamp, and treat every waking hook as its own decision.

The `modified` bump is load-bearing, not hygiene: this repo has already been bitten by
`bench migrate` skipping a DocType reimport when the JSON's timestamp did not move.
Without it the flip is a silent no-op with a green migrate log.

Two alternatives were considered and rejected:

**Register the logic as `doc_events` in `hooks.py`, leaving `custom: 1`.** This
works — `Document.hook` (`frappe/model/document.py:1649-1657`) composes handlers by
doctype *string*, with no controller involved, and both `before_insert` and
`autoname` route through `run_method`. The app already relies on this for
`Attendance Flag Decision`, itself a custom DocType. Rejected because it leaves the
root cause in place: the next controller anyone adds to this app is dead on arrival
too, and the controller files remain as misleading dead code.

**Register the controller via the `override_doctype_class` hook.** Does not work.
`import_controller` returns at line 106, before the override is consulted at line
110. Recorded here so nobody re-derives it.

## The hook audit

| DocType | Hook | Ruling |
|---|---|---|
| Attendance Flag | `before_insert` — deterministic AUTO naming | **Delete** |
| | `before_insert` — severity default, AUTO required-field throw, company fill | Keep |
| | `before_save` — `status_changed_by` / `status_changed_at` | Revive |
| Attendance Flag Decision | `validate` — immutability + note-required | Revive |
| Device Sync Status | `autoname` + duplicate `validate` | Revive |
| Device Closeout Alert | `autoname` + `resolved_at` default | Revive |
| Dewey Time Push Subscription | `autoname` — one row per endpoint | Revive |
| Dewey Time Settings | `validate` — rollout coherence | Revive |
| Dewey Time Branch Rollout | (empty by design) | No-op |

### Deleting the AUTO flag naming

This is the only hook where reviving and deleting are both defensible, and it is
deleted for three independent reasons:

1. **Idempotency is already provided** by the engine's delete-then-reinsert cycle.
2. **Stable identity is already provided** by `flag_identity`, whose module docstring
   states the case directly: flag names are useless as a foreign key because rows are
   hard-deleted and rebuilt on every punch, so identity is recomputed from *content*
   instead. Deterministic docnames would be a second key scheme to keep in sync with
   the first, forever.
3. **The controller's version carries a bug `flag_identity` deliberately fixed.**
   `_delivery_failed_key` leaves its suffix uncapped where `flag_identity` caps it at
   `[:80]` — a truncation-collision window on long `custom_supabase_log_id` values.
   Reviving the naming resurrects it.

Nothing looks an AUTO flag up by predicted name: `closeout.py:557`'s `protected` list
comes from `delivery_failure_marker_names(...)`, a query over rows that exist, not a
constructed name.

The rest of `before_insert` stays. It is redundant for engine writes — `_insert_flag`
supplies `severity` and `company` — but it is the only guard a Desk-side write gets.

### Why the decision guard is safe to revive

`AttendanceFlagDecision.validate` adds two throws, and neither can reject the
feature's own writes:

- The note-required rule is **already enforced upstream** at
  `flag_decision_api._validate_decision` (`:112-113`), with identical wording, before
  `_write_decision` is reached.
- The immutability check is gated on `not self.is_new()`, so it never runs during
  insert. The only field that changes on an existing decision row is the `superseded`
  pointer, flipped through `frappe.db.set_value`, which bypasses `validate` entirely.

It therefore adds protection exactly where there is none today: Desk edits, which HR
User and HR Manager both have write access to perform.

## Unknowns to establish before the flip

Two questions must be answered against **real production data**, not reasoned about.
Both are settled by restoring the latest Frappe Cloud backup into the local sandbox
(`seed --prod`, which anonymizes on restore). Read-only with respect to production.

**1. Schema drift — the one destructive failure mode.** Making a DocType standard
makes the app's JSON authoritative. If a field was added to any of these seven in
Desk on production, the reimport de-registers it and its data becomes invisible.
The audit compares production's actual `tabDocField` rows against each app JSON.

**2. Legacy rows the newly-live validators would reject.** Each of these throws on the
row's *next save*, not at migrate time, so the failure would surface later and
somewhere else:

- duplicate `Device Sync Status` rows per `(device_sn, local_date)` → `validate` throws
- duplicate push subscriptions per endpoint → no throw, but the deterministic
  `autoname` means a re-subscribe writes a new canonical row alongside the legacy hash
  row, and the browser gets two pushes
- an already-incoherent `Dewey Time Settings` → `validate` throws on the next save of
  a document nobody edited

## Verification

The mocked suite is structurally blind to this defect: it injects a MagicMock as
`frappe`, so it cannot observe whether a controller class loads. Every existing unit
test of these hooks passes today *because* it calls the methods directly, bypassing
`import_controller` — which is exactly how correct-and-inert code stays green.

Proof therefore belongs in `tests/test_integration_pilot_matrix.py`, the real-bench
module, which CI has enforced on every PR since #150:

- `frappe.get_meta(dt).custom == 0` for each of the seven.
- At least one hook per DocType observably fires — the strongest being that an
  `Attendance Flag` saved with a changed `status` comes back with
  `status_changed_by` set, which is impossible unless the controller loaded.
- A `Dewey Time Settings` with a reversed rollout pair raises on save. This is the
  punch list's stated cost, so it is the one that should have a test naming it.

`bench migrate` must be observed to actually reimport. The `modified` bump is what
makes it do so, and a migrate that silently skips the reimport leaves `custom = 1`
with a green log — so the meta assertion above is the guard against that, not a
nicety.

## Scope

**This spec:** the flag flip, the hook audit above, and the real-bench tests.

**Deferred:** legacy data cleanup patches, and only if the production audit finds rows
that need them. Designing a migration before knowing whether there is anything to
migrate would be inventing requirements.

**Not in scope:** `schedule_change_log`, which is already standard and working.
