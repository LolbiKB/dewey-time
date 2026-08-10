# DocType Controllers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `dewey_time`'s DocType controllers actually load, so the hooks written in them run — without waking seven DocTypes' worth of never-executed code blind.

**Architecture:** Flip `"custom": 1` → `0` in the seven DocType JSONs so Frappe stops substituting the base `Document` class. Delete the one hook that should not come back (deterministic AUTO flag naming) *before* the flip, so it is never briefly live. Guard the migration itself with a `pre_model_sync` patch that aborts if the reimport would de-register a field.

**Tech Stack:** Frappe v16 / ERPNext v16 / HRMS v16, Python 3.14, MariaDB 10.6.

**Spec:** `docs/superpowers/specs/2026-08-10-doctype-controllers-design.md` · **Punch list:** T3-11

## Global Constraints

- **The production site holds real employee data. This plan performs no writes against it.** Every bench command below runs on the local sandbox (`test_site`) unless a step is explicitly labelled *runbook* — those are for the human operator, not the implementer.
- **`schedule_change_log` is out of scope.** It is already standard and working, and is the in-repo control case. Do not touch it.
- **Bumping each JSON's `modified` is load-bearing, not hygiene.** `bench migrate` skips a DocType reimport when the timestamp has not moved, and does so with a green log. Use `2026-08-11 00:00:00.000000` — strictly later than every current value, three of which are already `2026-08-10`.
- **The mocked suite cannot prove any of this.** It injects a MagicMock as `frappe`, so it cannot observe whether a controller class loads. Every claim about controllers loading belongs in `dewey_time/tests/test_integration_pilot_matrix.py`, the real-bench module CI has enforced since #150.
- **Run the real-bench module with `--module` and no `--app`:** `bench --site test_site run-tests --module dewey_time.tests.test_integration_pilot_matrix`. The `--app` form makes Frappe's loader import every `test_*.py`, which installs a MagicMock over `sys.modules["frappe"]` and makes this module self-skip.
- **Report test counts as deltas, never absolutes.** The runner prints a total: `Ran 740 tests … OK (skipped=17)` is 740 total / 723 passing / 17 skipped. Baseline at the start of this plan: **740 local, 17 real-bench**.
- Commit trailers on every commit: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A`.

## The seven DocTypes

Referred to throughout as **the seven**. This exact list, in this order, is what every task uses:

```python
("Attendance Flag", "Attendance Flag Decision", "Device Sync Status",
 "Device Closeout Alert", "Dewey Time Push Subscription",
 "Dewey Time Settings", "Dewey Time Branch Rollout")
```

It already exists as `DOCTYPES` in `dewey_time/utils/doctype_drift_audit.py` — import it rather than retyping it.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `dewey_time/patches/guard_doctype_drift_before_flip.py` | *Create.* Aborts the migrate if the reimport would de-register a field. | 1 |
| `dewey_time/patches.txt` | *Modify.* Register the patch under `[pre_model_sync]`. | 1 |
| `dewey_time/tests/test_guard_doctype_drift.py` | *Create.* Unit tests for the guard. | 1 |
| `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py` | *Modify.* Delete deterministic AUTO naming and its four helpers. | 2 |
| `dewey_time/tests/test_absence_flags.py` | *Modify.* Delete the test class that pins the deleted naming. | 2 |
| `dewey_time/patches/non_primary_site_punch_severity_to_info.py` | *Modify.* One-line docstring correction. | 2 |
| The seven `*/[doctype].json` files | *Modify.* `"custom": 0` + `modified` bump. | 3 |
| `dewey_time/tests/test_integration_pilot_matrix.py` | *Modify.* Real-bench proof: controllers load (T3), hooks fire (T4). | 3, 4 |
| `docs/DEPLOY_RUNBOOK_T3_11.md` | *Create.* The operator's sequence, including the production audit. | 3 |
| `docs/ROLLOUT_PUNCH_LIST.md` | *Modify.* Close T3-11. | 4 |

---

### Task 1: The pre-migrate drift guard

The audit tool already exists and is tested (`dewey_time/utils/doctype_drift_audit.py`, commit `6a85d7a9`). This task wires it into `bench migrate` as a gate, so the destructive case cannot happen silently even if nobody remembers to run the audit by hand.

**Why a patch and not a `before_migrate` hook:** both run before `frappe.model.sync.sync_all()`, so both work. A `before_migrate` hook would run on *every* future migrate forever — a permanent tax for a one-time concern. A `pre_model_sync` patch runs once, at the migrate that performs the flip. `Migrate.run_schema_updates` is decorated `@atomic`, so a throw inside the patch rolls back and aborts before the schema is touched.

**Files:**
- Create: `dewey_time/patches/guard_doctype_drift_before_flip.py`
- Modify: `dewey_time/patches.txt` (append to the `[pre_model_sync]` section, after `dewey_time.patches.non_primary_site_punch_severity_to_info`)
- Test: `dewey_time/tests/test_guard_doctype_drift.py`

**Interfaces:**
- Consumes: `dewey_time.utils.doctype_drift_audit.audit_schema_drift() -> list[dict]`. Each dict has keys `doctype`, `custom`, `json_error`, `would_be_deregistered` (list of fieldnames), `would_be_added`, `custom_fields_unaffected`. A DocType absent from the site yields `{"doctype": ..., "status": "absent from this site"}` with **no** `would_be_deregistered` key — use `.get()`, not `[]`.
- Produces: `execute()` — the patch entrypoint Frappe calls. No return value; throws on drift.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_guard_doctype_drift.py`:

```python
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import frappe  # noqa: E402

from dewey_time.patches import guard_doctype_drift_before_flip as guard  # noqa: E402


def _clean(doctype):
    return {"doctype": doctype, "would_be_deregistered": [], "would_be_added": []}


def _drifted(doctype, fields):
    return {"doctype": doctype, "would_be_deregistered": list(fields), "would_be_added": []}


class TestGuardDoctypeDriftBeforeFlip(unittest.TestCase):
    def setUp(self):
        frappe.throw.reset_mock()

    def _run_with(self, report):
        with patch.object(guard, "audit_schema_drift", return_value=report):
            guard.execute()

    def test_a_field_only_in_the_database_aborts_the_migrate(self):
        self._run_with([_drifted("Attendance Flag", ["custom_note"])])
        self.assertTrue(frappe.throw.called)

    def test_the_message_names_the_doctype_and_the_field(self):
        # The operator reads this message mid-migrate with no other context, so
        # "drift detected" would send them hunting. It has to say what and where.
        self._run_with([_drifted("Device Sync Status", ["custom_note"])])
        message = frappe.throw.call_args[0][0]
        self.assertIn("Device Sync Status", message)
        self.assertIn("custom_note", message)

    def test_every_drifted_doctype_is_named_not_just_the_first(self):
        self._run_with(
            [_drifted("Attendance Flag", ["a"]), _drifted("Dewey Time Settings", ["b"])]
        )
        message = frappe.throw.call_args[0][0]
        self.assertIn("Attendance Flag", message)
        self.assertIn("Dewey Time Settings", message)

    def test_no_drift_lets_the_migrate_proceed(self):
        self._run_with([_clean("Attendance Flag"), _clean("Dewey Time Settings")])
        self.assertFalse(frappe.throw.called)

    def test_a_doctype_absent_from_the_site_is_not_drift(self):
        # A fresh site migrating for the first time has none of the seven yet.
        # Reading would_be_deregistered with [] instead of .get() would raise
        # KeyError here and abort a migrate that had nothing wrong with it.
        self._run_with([{"doctype": "Attendance Flag", "status": "absent from this site"}])
        self.assertFalse(frappe.throw.called)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_guard_doctype_drift
```

Expected: FAIL — `ModuleNotFoundError: No module named 'dewey_time.patches.guard_doctype_drift_before_flip'`.

- [ ] **Step 3: Write the patch**

Create `dewey_time/patches/guard_doctype_drift_before_flip.py`:

```python
import frappe

from dewey_time.utils.doctype_drift_audit import audit_schema_drift


def execute():
    """Abort this migrate if flipping the seven to standard would lose a field.

    Runs as a pre_model_sync patch, so it executes BEFORE
    frappe.model.sync.sync_all() reimports the DocType JSONs. Migrate.
    run_schema_updates is @atomic, so throwing here rolls back and leaves the
    schema exactly as it was.

    The failure this exists to prevent: making a DocType standard makes the
    app's JSON authoritative, so a field added to one of these in Desk on
    production is de-registered by the reimport. The column survives in
    MariaDB; Frappe stops knowing about it, and every read of that data
    silently returns nothing.

    Custom Fields are exempt and audit_schema_drift already excludes them --
    they live in their own table and are the supported way to extend a
    standard DocType.

    Idempotent and self-retiring: once the flip has happened with no drift,
    every later run finds nothing and returns.
    """
    blocked = {
        entry["doctype"]: entry["would_be_deregistered"]
        for entry in audit_schema_drift()
        # .get(), not [...]: a DocType absent from the site (a first migrate on
        # a fresh bench) yields a status entry with no such key.
        if entry.get("would_be_deregistered")
    }
    if not blocked:
        return

    detail = "; ".join(
        f"{doctype}: {', '.join(fields)}" for doctype, fields in sorted(blocked.items())
    )
    frappe.throw(
        "Migrate aborted: making these DocTypes standard would de-register fields "
        f"that exist in this site's database but not in the app's JSON -- {detail}. "
        "The data stays in MariaDB but becomes invisible to Frappe. Add the fields "
        "to the app JSON, or convert them to Custom Fields, then migrate again. "
        "Full report: bench --site <site> execute "
        "dewey_time.utils.doctype_drift_audit.run"
    )
```

- [ ] **Step 4: Register the patch**

In `dewey_time/patches.txt`, append one line to the **end of the `[pre_model_sync]` section** — immediately after `dewey_time.patches.non_primary_site_punch_severity_to_info` and before the blank line preceding `[post_model_sync]`:

```
dewey_time.patches.guard_doctype_drift_before_flip
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_guard_doctype_drift
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Mutation-check the guard**

A guard that cannot fail is not a guard. Apply each mutation, confirm the named test fails, then revert.

| Mutation | Test that must fail |
|---|---|
| `if entry.get("would_be_deregistered")` → `if False` | `test_a_field_only_in_the_database_aborts_the_migrate` |
| `entry.get("would_be_deregistered")` → `entry["would_be_deregistered"]` | `test_a_doctype_absent_from_the_site_is_not_drift` (KeyError) |
| Drop `{detail}` from the message | `test_the_message_names_the_doctype_and_the_field` |

Record the observed result of each in the task report. A mutation that does **not** fail is a finding, not a formality — report it rather than moving on.

- [ ] **Step 7: Run the full fast suite**

```bash
cd dev/sandbox && ./frappe-sandbox test --backend --fast
```

Expected: **+5 from the 740 baseline = 745**, 17 skipped, `OK`.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/patches/guard_doctype_drift_before_flip.py dewey_time/patches.txt dewey_time/tests/test_guard_doctype_drift.py
git commit -m "feat(patch): abort the migrate if the flip would de-register a field

Runs pre_model_sync, so it lands before sync_all() reimports the JSONs, and
run_schema_updates is @atomic -- throwing here leaves the schema untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 2: Delete the deterministic AUTO flag naming

This must land **before** Task 3. If the flag is flipped first, the naming goes live for the duration of one commit.

**Why deleted rather than revived** (from the spec, three independent reasons):

1. Idempotency already comes from the engine's delete-then-reinsert cycle.
2. Stable identity already comes from `flag_identity`, whose module docstring states that flag names are useless as keys because rows are hard-deleted and rebuilt on every punch. Deterministic docnames would be a second key scheme to keep in sync with the first, forever.
3. The controller's `_delivery_failed_key` leaves its suffix uncapped where `flag_identity` caps it at `[:80]` — a truncation-collision window on long `custom_supabase_log_id` values. Reviving the naming resurrects a bug `flag_identity` deliberately closed.

Nothing reads an AUTO flag by predicted name: `closeout.py:557`'s `protected` list comes from `delivery_failure_marker_names(...)`, a query over rows that exist.

**Files:**
- Modify: `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py`
- Modify: `dewey_time/tests/test_absence_flags.py` (delete one test class, around `:305-350`)
- Modify: `dewey_time/patches/non_primary_site_punch_severity_to_info.py` (docstring only)

**Interfaces:**
- Produces: `AttendanceFlag.before_insert` keeps setting `severity`, throwing on incomplete AUTO rows, and filling `company`. It no longer sets `self.name`. `FLAG_SEVERITY` is unchanged and still exported — `test_closeout.py:802-817` cross-references it against the engine's copy, and that test must keep passing.

- [ ] **Step 1: Delete the naming from the controller**

In `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py`, replace the whole `before_insert` method with:

```python
    def before_insert(self):
        if not self.severity and self.flag_code:
            self.severity = FLAG_SEVERITY.get(self.flag_code, "WARNING")

        # Redundant for engine writes -- closeout._insert_flag supplies severity,
        # company and every required field itself -- but it is the only guard a
        # Desk-side insert gets, and Desk is where an incomplete AUTO row would
        # come from.
        #
        # This block used to also assign a deterministic name. Deleted with the
        # custom:1 fix (T3-11): AUTO flags are hard-deleted and rebuilt on every
        # punch, so idempotency comes from that cycle, and stable identity comes
        # from flag_identity, which computes it from CONTENT precisely because
        # the name cannot be relied on. Two key schemes for one job is one too
        # many -- and the version that lived here carried an uncapped
        # _delivery_failed_key that flag_identity caps at [:80].
        if (self.source or "").upper() == "AUTO":
            if not (self.employee and self.attendance_date and self.flag_code):
                frappe.throw("AUTO flags require employee, attendance_date, and flag_code")

            if not self.company:
                self.company = frappe.db.get_value("Employee", self.employee, "company")
```

Then delete these four now-unused helper methods entirely: `_parsed_evidence`, `_delivery_failed_key`, `_missing_time_key`, `_attendance_issue_key`. Nothing outside this class calls them — verify with:

```bash
grep -rn "_parsed_evidence\|_delivery_failed_key\|_missing_time_key\|_attendance_issue_key" dewey_time | grep -v __pycache__
```

Expected after deletion: matches only inside `flag_identity.py` (which has its own private equivalents with different names) and no match in `attendance_flag.py`. If any other module calls them, **stop and report** — that contradicts this plan's premise.

The `import json` inside `_parsed_evidence` goes with it. Check whether `frappe.utils.now_datetime` is still needed (it is — `before_save` uses it) and leave the imports otherwise alone.

- [ ] **Step 2: Delete the test class that pins the deleted behaviour**

In `dewey_time/tests/test_absence_flags.py`, delete the entire test class containing `_name_for`, `test_provisional_and_final_do_not_share_a_name`, and `test_only_the_provisional_carries_the_marker` (approximately lines 305-350, including its docstring).

That class is itself an artifact of the defect: it does `AttendanceFlag.__new__(AttendanceFlag)` and calls `before_insert()` directly, bypassing Frappe — which is exactly how code that never runs in production stays green. It tests deleted behaviour and must go with it.

Deleting tests needs justification, and this is it. State it in the task report explicitly: *these tests were deleted because the behaviour they pin was deleted, not because they failed.*

- [ ] **Step 3: Correct the stale docstring**

`dewey_time/patches/non_primary_site_punch_severity_to_info.py` says severity is stamped "(see AttendanceFlag.before_insert)". That has never been where it came from — `closeout._insert_flag` sets it. Change that parenthetical to:

```python
    Severity is stamped once, at insert (see closeout._insert_flag), so
```

One line, and it stops the next reader inheriting the same wrong mental model.

- [ ] **Step 4: Run the full fast suite**

```bash
cd dev/sandbox && ./frappe-sandbox test --backend --fast
```

Expected: **745 − 2 deleted = 743**, 17 skipped, `OK`. If anything other than the two deleted tests changed count, stop and report.

- [ ] **Step 5: Confirm the engine still round-trips on a real bench**

```bash
docker exec sandbox-bench-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site test_site run-tests --module dewey_time.tests.test_integration_pilot_matrix'
```

Expected: `Ran 17 tests`, `OK`. The controller is still inert at this point, so this proves the deletion broke nothing — not that it took effect.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py dewey_time/tests/test_absence_flags.py dewey_time/patches/non_primary_site_punch_severity_to_info.py
git commit -m "refactor(flag): delete the deterministic AUTO naming before waking it

flag_identity already computes a stable key from content, and says in its
docstring why the name cannot serve as one. The version here also left
_delivery_failed_key uncapped where flag_identity caps it at [:80].

Deleted before the custom:1 flip so it is never briefly live.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 3: Flip the flag, and prove the controllers load

**Files:**
- Modify: the seven `dewey_time/dewey_time/doctype/<scrubbed>/<scrubbed>.json` files
- Modify: `dewey_time/tests/test_integration_pilot_matrix.py`
- Create: `docs/DEPLOY_RUNBOOK_T3_11.md`

**Interfaces:**
- Consumes: `dewey_time.utils.doctype_drift_audit.DOCTYPES` — the seven, as a tuple of display names.
- Produces: every one of the seven loads its own controller class. Task 4 depends on this and tests individual hooks.

- [ ] **Step 1: Write the failing test**

Add to `dewey_time/tests/test_integration_pilot_matrix.py`, inside `class TestPilotMatrix`:

```python
    def test_every_dewey_time_doctype_loads_its_own_controller(self):
        """The T3-11 regression test.

        Asserted on the controller CLASS, not on meta.custom, because the class
        is the thing that actually matters: `custom` is merely the flag that
        made Frappe substitute the base Document. import_controller reads that
        flag from tabDocType, so a JSON edit that never reached the database --
        a migrate that skipped the reimport because `modified` did not move --
        leaves this failing with a green migrate log behind it.
        """
        from frappe.model.base_document import get_controller

        from dewey_time.utils.doctype_drift_audit import DOCTYPES

        base = []
        for doctype in DOCTYPES:
            controller = get_controller(doctype)
            if controller.__module__.startswith("frappe."):
                base.append(f"{doctype} -> {controller.__module__}.{controller.__name__}")

        self.assertEqual(
            base,
            [],
            "these DocTypes still resolve to Frappe's base class, so their "
            "controllers are dead: " + "; ".join(base),
        )
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker exec sandbox-bench-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site test_site run-tests --module dewey_time.tests.test_integration_pilot_matrix'
```

Expected: FAIL, listing all seven as resolving to `frappe.model.document.Document`. **This failure is the T3-11 defect reproduced.** Paste the exact assertion output into the task report — it is the evidence the fix is real.

- [ ] **Step 3: Flip the flag in all seven JSONs**

In each of these files, set `"custom": 0` and `"modified": "2026-08-11 00:00:00.000000"`:

```
dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json
dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.json
dewey_time/dewey_time/doctype/device_sync_status/device_sync_status.json
dewey_time/dewey_time/doctype/device_closeout_alert/device_closeout_alert.json
dewey_time/dewey_time/doctype/dewey_time_push_subscription/dewey_time_push_subscription.json
dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json
dewey_time/dewey_time/doctype/dewey_time_branch_rollout/dewey_time_branch_rollout.json
```

Edit the two keys in place with the Edit tool — do **not** reserialize the JSON with `json.dump`, which would reorder and reformat every file and bury the two-line change in a thousand-line diff.

Verify all seven, and that nothing else moved:

```bash
python3 -c "
import json, glob
for p in sorted(glob.glob('dewey_time/dewey_time/doctype/*/*.json')):
    d = json.load(open(p))
    if 'custom' in d:
        print(f\"{d.get('custom')}  {d.get('modified')}  {p.split('/')[-1]}\")
"
git diff --stat
```

Expected: seven lines all reading `0  2026-08-11 00:00:00.000000`, and `git diff --stat` showing exactly 7 files with 14 insertions and 14 deletions.

- [ ] **Step 4: Migrate the sandbox and confirm the reimport happened**

```bash
docker exec sandbox-bench-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site test_site migrate' 2>&1 | tail -20
docker exec sandbox-bench-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site test_site execute dewey_time.utils.doctype_drift_audit.run' 2>&1 | grep -E '"custom"|DRIFT_AUDIT'
```

Expected: migrate succeeds, and every `"custom"` line reads `0`.

If any still reads `1`, the reimport was skipped — check the `modified` bump landed in that file. Do **not** work around it by editing `tabDocType` directly; the point is that the JSON drives the schema.

The drift guard from Task 1 runs during this migrate. On the sandbox it will report clear (the site was built from these JSONs). That is expected and proves the guard does not false-positive; it does not prove it catches drift, which Task 1's unit tests cover.

- [ ] **Step 5: Run the test to verify it passes**

```bash
docker exec sandbox-bench-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site test_site run-tests --module dewey_time.tests.test_integration_pilot_matrix'
```

Expected: `Ran 18 tests`, `OK` (17 baseline + 1).

- [ ] **Step 6: Run the full fast suite**

```bash
cd dev/sandbox && ./frappe-sandbox test --backend --fast
```

Expected: **743**, 18 skipped (the integration module self-skips, and it gained a test), `OK`.

- [ ] **Step 7: Write the deploy runbook**

Create `docs/DEPLOY_RUNBOOK_T3_11.md`:

````markdown
# Deploying T3-11 (DocType controllers)

This deploy changes how Frappe loads seven DocTypes. It is the first time any
of their controller hooks will execute against production data.

The production schema audit was **not** run before this was written, so step 2
is where it happens. Do not skip it: it is read-only, takes seconds, and is the
only thing standing between a Desk-added field and silent invisibility.

## 1. Deploy the code

Deploy as usual. Nothing changes until a migrate runs — the flip lives in the
DocType JSONs and the guard is a patch.

## 2. Audit production BEFORE migrating (read-only)

```bash
bench --site <production-site> execute dewey_time.utils.doctype_drift_audit.run
```

Read the last line:

| Verdict | Meaning | Action |
|---|---|---|
| `DRIFT_AUDIT_CLEAR (N rows audited)` | No field would be lost. | Continue to step 3. |
| `DRIFT_AUDIT_BLOCKED` | A field exists in the database but not the app JSON. | **Stop.** Add it to the JSON or convert it to a Custom Field, then re-audit. |
| `DRIFT_AUDIT_VACUOUS` | Every audited table is empty. | You are not on production. Check the site name. |

Also read `legacy_rows` in the JSON above that line. Non-empty
`device_sync_duplicates` or `push_subscription_duplicates` do not block the
migrate, but they are rows the newly-live validators will reject on their next
save — see step 5.

## 3. Migrate

```bash
bench --site <production-site> migrate
```

The `guard_doctype_drift_before_flip` patch re-runs the audit here and aborts
before any schema change if it finds drift. Step 2 is not redundant with it:
the patch tells you mid-migrate, step 2 tells you before you started.

## 4. Confirm the flip actually took

```bash
bench --site <production-site> execute dewey_time.utils.doctype_drift_audit.run | grep '"custom"'
```

Every line must read `0`. A `1` means the reimport was skipped and **nothing
has changed** — the migrate will have looked completely successful.

## 5. What is newly live

- `Dewey Time Settings` now rejects an incoherent rollout configuration. This
  is the fix's main point: before this, a reversed date pair or a duplicated
  branch could be saved silently.
- `Device Sync Status` now refuses a second row for one `(device_sn,
  local_date)`. If step 2 reported duplicates, run
  `device_sync.merge_device_sync_duplicates` for those keys first, or the next
  save of an affected row throws.
- `Attendance Flag` now stamps `status_changed_by` / `status_changed_at` when
  status changes. Rows changed before today keep their blanks.
- `Attendance Flag Decision` now rejects Desk edits to a recorded decision.
  The API path is unaffected — it already enforced the same rules.

## 6. Rollback

Revert the commit and migrate again. The JSONs go back to `"custom": 1`,
Frappe resumes substituting the base class, and the hooks go quiet. No data
written by the hooks needs undoing: `status_changed_by` and deterministic
names on new rows are additive.
````

- [ ] **Step 8: Commit**

```bash
git add dewey_time/dewey_time/doctype/*/*.json dewey_time/tests/test_integration_pilot_matrix.py docs/DEPLOY_RUNBOOK_T3_11.md
git commit -m "fix(doctype): flip the seven to standard so their controllers load

import_controller returns the base Document for any DocType marked custom, so
not one hook in this app has ever run. Flipping the JSON is only half of it --
the flag lives in tabDocType, so each modified timestamp is bumped to force the
reimport a migrate would otherwise skip with a green log.

Asserted on the controller class rather than meta.custom, because the class is
what actually matters and it catches a skipped reimport too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 4: Prove each revived hook actually fires

Task 3 proves the classes load. That is necessary and not sufficient: a loaded class whose hook never fires looks identical from the outside. Each test below asserts a *side effect only the hook can produce*.

**Files:**
- Modify: `dewey_time/tests/test_integration_pilot_matrix.py`
- Modify: `docs/ROLLOUT_PUNCH_LIST.md`

**Interfaces:**
- Consumes: `TestPilotMatrix.company` and `TestPilotMatrix.employee`, both set in `setUpClass`. `PRIMARY_BRANCH` is a module constant naming a `Branch` the fixtures create.

- [ ] **Step 1: Write the failing tests**

Add to `class TestPilotMatrix` in `dewey_time/tests/test_integration_pilot_matrix.py`:

```python
    def test_a_status_change_stamps_who_and_when(self):
        """AttendanceFlag.before_save. Nothing else writes these two fields."""
        flag = frappe.get_doc(
            {
                "doctype": "Attendance Flag",
                "employee": self.employee,
                "company": self.company,
                "attendance_date": "2026-03-02",
                "flag_code": "LATE_START",
                "source": "AUTO",
                "status": "OPEN",
                "day_closed": 1,
                "rollout_phase": "LIVE",
            }
        )
        flag.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "Attendance Flag", flag.name, force=True, ignore_permissions=True
        )

        self.assertFalse(flag.status_changed_by, "not stamped until status changes")

        # "CLOSED", not "RESOLVED": the Select options are
        # OPEN/EXPLAINED/APPROVED/REJECTED/CLOSED.
        flag.status = "CLOSED"
        flag.save(ignore_permissions=True)

        self.assertTrue(flag.status_changed_by)
        self.assertTrue(flag.status_changed_at)

    def test_the_severity_default_comes_from_the_controller(self):
        """AttendanceFlag.before_insert, with severity deliberately omitted.

        The engine always supplies severity itself, so this is the Desk-write
        path -- the only one the controller's default has ever been for.
        """
        flag = frappe.get_doc(
            {
                "doctype": "Attendance Flag",
                "employee": self.employee,
                "company": self.company,
                "attendance_date": "2026-03-03",
                "flag_code": "LATE_START",
                "source": "AUTO",
                "status": "OPEN",
                "day_closed": 1,
                "rollout_phase": "LIVE",
            }
        )
        flag.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "Attendance Flag", flag.name, force=True, ignore_permissions=True
        )
        self.assertEqual(flag.severity, "WARNING")

    def test_an_auto_flag_no_longer_gets_a_deterministic_name(self):
        """The Task 2 deletion, asserted where it actually takes effect.

        Before T3-11 this could not be tested at all: the controller did not
        load, so every AUTO flag got a hash name whether the code said so or
        not. Now the code runs, and this pins that it does not name the row.
        """
        flag = frappe.get_doc(
            {
                "doctype": "Attendance Flag",
                "employee": self.employee,
                "company": self.company,
                "attendance_date": "2026-03-04",
                "flag_code": "LATE_START",
                "source": "AUTO",
                "status": "OPEN",
                "day_closed": 1,
                "rollout_phase": "LIVE",
            }
        )
        flag.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "Attendance Flag", flag.name, force=True, ignore_permissions=True
        )
        self.assertNotIn("AUTO-", flag.name)

    def test_an_incoherent_rollout_configuration_is_now_rejected(self):
        """DeweyTimeSettings.validate -- the punch list's stated cost of T3-11.

        Restores the original values in cleanup: Dewey Time Settings is a
        Single, so leaving a test value behind would change what every later
        test on this site sees.
        """
        settings = frappe.get_single("Dewey Time Settings")
        before = (settings.rollout_testing_start, settings.rollout_go_live)

        def _restore():
            doc = frappe.get_single("Dewey Time Settings")
            doc.rollout_testing_start, doc.rollout_go_live = before
            doc.save(ignore_permissions=True)
            frappe.db.commit()

        self.addCleanup(_restore)

        settings.rollout_testing_start = "2026-06-01"
        settings.rollout_go_live = "2026-05-01"  # before the testing start
        with self.assertRaises(frappe.ValidationError):
            settings.save(ignore_permissions=True)

    def test_a_recorded_decision_cannot_be_edited(self):
        """AttendanceFlagDecision.validate, immutability half.

        The API path is unaffected -- it inserts, and the is_new() gate means
        validate's guard never sees an insert. This is the Desk-edit path,
        which HR User and HR Manager both have write access to reach.
        """
        decision = frappe.get_doc(
            {
                "doctype": "Attendance Flag Decision",
                "flag_identity": "pilot-matrix-immutability-probe",
                "employee": self.employee,
                "attendance_date": "2026-03-05",
                "flag_code": "LATE_START",
                "outcome": "EXCUSED",
                "reason": "DEVICE_OR_DATA_FAULT",
                "group_key": "pilot-matrix-probe",
                "decided_by": "Administrator",
                "decided_at": "2026-03-05 09:00:00",
            }
        )
        decision.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc,
            "Attendance Flag Decision",
            decision.name,
            force=True,
            ignore_permissions=True,
        )

        # Edit `reason` between two values that need no note, rather than
        # flipping `outcome` to UPHELD. Both raise ValidationError, so an
        # outcome edit would pass this test whether the immutability guard ran
        # or only the note-required rule did -- and the immutability guard is
        # what is under test.
        decision.reason = "MANAGER_APPROVED"
        with self.assertRaises(frappe.ValidationError):
            decision.save(ignore_permissions=True)

    def test_a_second_sync_row_for_one_device_day_is_rejected(self):
        """DeviceSyncStatus.autoname + validate.

        The dead autoname is why merge_device_sync_duplicates exists: without
        it, every write made another row. Both halves are asserted -- the
        canonical name, and the refusal of a second row.
        """
        from dewey_time.attendance_engine.device_sync import device_sync_doc_name

        first = frappe.get_doc(
            {
                "doctype": "Device Sync Status",
                "device_sn": "PM-PROBE-01",
                "local_date": "2026-03-06",
            }
        )
        first.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc,
            "Device Sync Status",
            first.name,
            force=True,
            ignore_permissions=True,
        )

        self.assertEqual(first.name, device_sync_doc_name("PM-PROBE-01", "2026-03-06"))

        duplicate = frappe.get_doc(
            {
                "doctype": "Device Sync Status",
                "device_sn": "PM-PROBE-01",
                "local_date": "2026-03-06",
            }
        )
        with self.assertRaises(Exception):
            duplicate.insert(ignore_permissions=True)
```

Note on the last test: it asserts `Exception` rather than a specific class deliberately. A second row with the same deterministic name can fail either as `frappe.ValidationError` from `validate` or as `frappe.DuplicateEntryError` from the unique-name constraint, depending on which fires first. Pinning one would make the test brittle about a detail it is not testing. If the implementer finds it consistently raises one specific type, tightening it is an improvement — say so in the report.

- [ ] **Step 2: Run to verify they pass**

```bash
docker exec sandbox-bench-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site test_site run-tests --module dewey_time.tests.test_integration_pilot_matrix'
```

Expected: `Ran 24 tests`, `OK` (18 after Task 3 + 6).

These pass immediately rather than failing first — the behaviour they test was enabled in Task 3. That inverts the usual TDD order, so **Step 3 is what makes them meaningful.** Do not skip it.

- [ ] **Step 3: Prove each test would catch the regression**

Revert the flip for one DocType at a time — set `"custom": 1` in that JSON, `bench migrate`, run the module, confirm the matching test fails, then restore and migrate back.

| Reverted DocType | Test that must fail |
|---|---|
| `Attendance Flag` | `test_a_status_change_stamps_who_and_when` |
| `Dewey Time Settings` | `test_an_incoherent_rollout_configuration_is_now_rejected` |
| `Attendance Flag Decision` | `test_a_recorded_decision_cannot_be_edited` |
| `Device Sync Status` | `test_a_second_sync_row_for_one_device_day_is_rejected` |

Each revert needs its own `modified` bump to force the reimport — use `2026-08-12 00:00:00.000000` going back and `2026-08-13 00:00:00.000000` restoring, since a timestamp that does not move is a skipped reimport and a test that appears to pass for the wrong reason.

Record all four observed failures in the task report. A test that still passes with its DocType reverted is not testing the hook, and is a finding.

After the last restore, confirm you are back to seven `"custom": 0` with `2026-08-13 00:00:00.000000`, and that `git diff` on the JSONs shows only the two intended keys changed per file.

- [ ] **Step 4: Close T3-11 in the punch list**

In `docs/ROLLOUT_PUNCH_LIST.md`, change T3-11's `- [ ]` to `- [x]` and append after its final paragraph:

```markdown
  **Fixed in this branch.** The seven flipped to `"custom": 0` with their
  `modified` timestamps bumped, since the flag lives in `tabDocType` and a
  migrate skips the reimport when the timestamp has not moved.

  Two decisions worth keeping:

  - **The deterministic AUTO flag naming was deleted, not revived.**
    `flag_identity` already computes a stable key from flag *content*, and its
    docstring explains why the name cannot serve as one: rows are hard-deleted
    and rebuilt on every punch. The controller's version also left
    `_delivery_failed_key` uncapped where `flag_identity` caps it at `[:80]`,
    so reviving it would have restored a bug that had already been fixed
    elsewhere.
  - **`override_doctype_class` cannot fix this**, and `doc_events` can.
    `import_controller` returns the base class at `base_document.py:106`,
    three lines before the override hook is consulted. `doc_events` are
    composed by doctype string with no controller involved, which is why
    `Attendance Flag Decision`'s cache invalidation worked all along while its
    controller was dead. Recorded so neither is re-derived.

  Guarded by a `pre_model_sync` patch that aborts the migrate if the reimport
  would de-register a field, and by six real-bench tests that each assert a
  side effect only a live hook can produce — every one verified to fail with
  its DocType reverted to `custom: 1`.
```

- [ ] **Step 5: Run both suites**

```bash
cd dev/sandbox && ./frappe-sandbox test --backend --fast
docker exec sandbox-bench-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site test_site run-tests --module dewey_time.tests.test_integration_pilot_matrix'
```

Expected: **743 local**, 24 skipped; **24 real-bench**, `OK`.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/tests/test_integration_pilot_matrix.py docs/ROLLOUT_PUNCH_LIST.md
git commit -m "test(doctype): prove each revived hook fires, not just that it loads

A loaded controller whose hook never runs looks identical from outside, so
each test asserts a side effect only the hook can produce. Every one verified
to fail with its own DocType reverted to custom:1 -- the tests are what make
the flip a fix rather than a claim.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

## Deferred, deliberately

**Legacy data cleanup.** Duplicate `Device Sync Status` rows, duplicate push endpoints, and an already-incoherent `Dewey Time Settings` are all possible on production and none is discoverable from here. The runbook's step 2 surfaces them before they matter; a migration is only worth designing once there is evidence there is something to migrate.

**`Device Closeout Alert` and `Dewey Time Push Subscription` hook tests.** Their hooks are revived and covered by Task 3's controller-loading assertion, but neither has a dedicated behaviour test. Both are lower-traffic than the four tested above and neither throws, so a silent failure costs a duplicate row rather than a rejected write. Worth adding if either turns out to matter.
