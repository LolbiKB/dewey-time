# Decisive Schedule Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let HR change an employee's set schedule in place, effective-dated and non-destructive, instead of the System-Manager-only destroy-and-recreate.

**Architecture:** Make `apply_weekly_schedule` edit-aware. Diff the target pattern against the employee's current enabled schedules on **structural identity** (day-set + full time profile) into leaving / adding / unchanged. Retire leaving schedules (disable SSA, trim/inactivate only their future Shift Assignments scoped by the `shift_schedule_assignment` back-link), generate only adding schedules from the effective date, leave unchanged alone. The wizard unlocks for editing and shows a "what changes on E" confirmation.

**Tech Stack:** Python (Frappe, `unittest`), React 19 + TypeScript + Vite, frappe-react-sdk, Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-decisive-schedule-edit-design.md` — read it first.
- Forward-effective only. Never mutate Shift Assignments / Attendance / Attendance Flags dated before the effective date `E`. Never `cancel`; retire via `end_date` trim (straddling) or `status = "Inactive"` (pure-future) — both `allow_on_submit`, both skip HRMS `on_cancel` guards.
- Retirement is scoped by the engine back-link `Shift Assignment.shift_schedule_assignment` (per-SSA), never by `shift_type`. If that column is absent, **fail closed** (throw) — never fall back to shift_type scoping.
- The diff keys on **structural identity** (`_group_identity` = ordered weekdays + `profile_key`, which includes `grace_minutes`/lunch), never on PAT name strings.
- Editing stays `_require_hr_role()` (not System Manager). The destructive clear tool is untouched.
- Python tests are `unittest`, run from repo root: `python3 -m unittest dewey_time.tests.<module>`. `_install_frappe_mock()` (from `dewey_time.tests.test_closeout`) provides the frappe mock and working `frappe.utils` date helpers (existing `test_schedule_resolver.py` relies on this).
- Frontend unit tests: `npm run test:web` (node:test). Pure logic lives under `src/lib/` to be inside the test glob. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Stage explicitly by path; never `git add -A`. Branch: `feat/decisive-schedule-edit` (create off `main` before the first commit).
- All frontend commands run from `dewey_time/frontend/hr_attendance/`. After frontend changes: `npm run build`, then deploy is `bench migrate` (user-side).

---

### Task 1: Structural identity helpers

**Files:**
- Modify: `dewey_time/attendance_engine/schedule_resolver.py` (add `import json` if absent; add `_group_identity`, `_identity_key`, `group_identity_key`)
- Test: `dewey_time/tests/test_schedule_reconcile.py` (create)

**Interfaces:**
- Produces:
  - `_group_identity(days: list[str], profile: dict) -> tuple` — `(ordered_weekday_names, profile_key(profile))`.
  - `_identity_key(identity: tuple) -> str` — stable JSON string of an identity.
  - `group_identity_key(group: dict) -> str` — `_identity_key(_group_identity(group["days"], group["profile"]))`; consumed by Task 5's apply loop.
- Consumes: existing `profile_key` (`schedule_resolver.py:122`), `WEEKDAY_TO_INDEX` (`:30`).

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_schedule_reconcile.py`:

```python
import unittest

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


def _profile(start, end, lunch_start=None, lunch_end=None, grace=10):
    return {
        "start_time": start,
        "end_time": end,
        "lunch_start": lunch_start,
        "lunch_end": lunch_end,
        "grace_minutes": grace,
    }


class TestGroupIdentity(unittest.TestCase):
    def test_same_days_and_profile_are_equal(self):
        from dewey_time.attendance_engine.schedule_resolver import _group_identity

        a = _group_identity(["Monday", "Tuesday"], _profile("09:00:00", "17:00:00"))
        b = _group_identity(["Tuesday", "Monday"], _profile("09:00:00", "17:00:00"))
        self.assertEqual(a, b)

    def test_grace_difference_changes_identity(self):
        from dewey_time.attendance_engine.schedule_resolver import _group_identity

        a = _group_identity(["Monday"], _profile("09:00:00", "17:00:00", grace=10))
        b = _group_identity(["Monday"], _profile("09:00:00", "17:00:00", grace=20))
        self.assertNotEqual(a, b)

    def test_identity_key_is_stable_string(self):
        from dewey_time.attendance_engine.schedule_resolver import (
            _group_identity,
            _identity_key,
        )

        key = _identity_key(_group_identity(["Monday"], _profile("09:00:00", "17:00:00")))
        self.assertIsInstance(key, str)
        # Day order in input must not change the key.
        key2 = _identity_key(_group_identity(["Monday"], _profile("09:00:00", "17:00:00")))
        self.assertEqual(key, key2)

    def test_group_identity_key_reads_group_dict(self):
        from dewey_time.attendance_engine.schedule_resolver import (
            _identity_key,
            _group_identity,
            group_identity_key,
        )

        group = {"days": ["Monday", "Friday"], "profile": _profile("08:00:00", "16:00:00")}
        self.assertEqual(
            group_identity_key(group),
            _identity_key(_group_identity(group["days"], group["profile"])),
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest dewey_time.tests.test_schedule_reconcile -v`
Expected: FAIL — `ImportError: cannot import name '_group_identity'`.

- [ ] **Step 3: Write minimal implementation**

In `dewey_time/attendance_engine/schedule_resolver.py`, ensure `import json` is present near the top imports. Then add, after `profile_key` (around line 130):

```python
def _group_identity(days, profile):
    """Structural identity of a schedule group: ordered weekday names + full time profile.
    Compared instead of PAT name strings, because PAT/Shift Type names drop grace_minutes and
    may be non-canonical for the same structure."""
    ordered = tuple(
        sorted(
            (d for d in (days or []) if d in WEEKDAY_TO_INDEX),
            key=lambda d: WEEKDAY_TO_INDEX[d],
        )
    )
    return (ordered, profile_key(profile or {}))


def _identity_key(identity) -> str:
    days, pkey = identity
    return json.dumps([list(days), list(pkey)], separators=(",", ":"))


def group_identity_key(group) -> str:
    return _identity_key(_group_identity(group.get("days") or [], group.get("profile") or {}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_schedule_reconcile -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/schedule_resolver.py dewey_time/tests/test_schedule_reconcile.py
git commit -m "feat(schedule): structural identity helpers for schedule diff

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Future-assignment classifier + back-link lookup

**Files:**
- Modify: `dewey_time/attendance_engine/schedule_resolver.py` (add `_classify_future_assignment`; replace `_future_assignments_for_shift_type` at `:504-543` with `_future_assignments_for_ssa`)
- Test: `dewey_time/tests/test_schedule_reconcile.py`

**Interfaces:**
- Produces:
  - `_classify_future_assignment(start_date, end_date, effective_from) -> tuple[str | None, str | None]` — pure; returns `(action, proposed_end_date)`, action ∈ `"inactivate" | "end_before" | None`.
  - `_future_assignments_for_ssa(*, ssa_name, effective_from) -> list[dict]` — rows `{name, shift_type, start_date, end_date, action, proposed_end_date}`; scoped by back-link; throws if back-link column absent.
- Consumes: `_classify_future_assignment`; existing `getdate`, `add_days`, `timedelta` (already imported).

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/tests/test_schedule_reconcile.py` (before the `if __name__` block):

```python
from datetime import date
from unittest.mock import patch


class TestClassifyFutureAssignment(unittest.TestCase):
    E = date(2026, 7, 1)

    def test_pure_future_is_inactivated(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, proposed = _classify_future_assignment(date(2026, 7, 5), date(2026, 7, 10), self.E)
        self.assertEqual(action, "inactivate")
        self.assertIsNone(proposed)

    def test_straddling_is_trimmed_to_day_before_E(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, proposed = _classify_future_assignment(date(2026, 6, 1), date(2026, 7, 10), self.E)
        self.assertEqual(action, "end_before")
        self.assertEqual(proposed, "2026-06-30")

    def test_open_ended_straddling_is_trimmed(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, proposed = _classify_future_assignment(date(2026, 6, 1), None, self.E)
        self.assertEqual(action, "end_before")
        self.assertEqual(proposed, "2026-06-30")

    def test_starts_on_E_is_inactivated(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, _ = _classify_future_assignment(date(2026, 7, 1), date(2026, 7, 9), self.E)
        self.assertEqual(action, "inactivate")

    def test_entirely_past_is_skipped(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, proposed = _classify_future_assignment(date(2026, 5, 1), date(2026, 6, 30), self.E)
        self.assertIsNone(action)
        self.assertIsNone(proposed)


class TestFutureAssignmentsForSsa(unittest.TestCase):
    def test_throws_when_backlink_column_absent(self):
        import frappe
        from dewey_time.attendance_engine import schedule_resolver

        frappe.db.table_exists.return_value = True
        frappe.db.has_column.side_effect = lambda dt, col: col != "shift_schedule_assignment"
        with self.assertRaises(Exception):
            schedule_resolver._future_assignments_for_ssa(ssa_name="SSA-1", effective_from=date(2026, 7, 1))
        frappe.db.has_column.side_effect = None

    def test_scopes_by_backlink_and_classifies(self):
        import frappe
        from dewey_time.attendance_engine import schedule_resolver

        frappe.db.table_exists.return_value = True
        frappe.db.has_column.return_value = True
        rows = [
            {"name": "SA-PAST", "start_date": date(2026, 5, 1), "end_date": date(2026, 6, 30), "shift_type": "FT"},
            {"name": "SA-STRADDLE", "start_date": date(2026, 6, 1), "end_date": date(2026, 7, 9), "shift_type": "FT"},
            {"name": "SA-FUTURE", "start_date": date(2026, 7, 10), "end_date": date(2026, 7, 20), "shift_type": "FT"},
        ]
        with patch.object(schedule_resolver.frappe, "get_all", return_value=rows) as get_all:
            out = schedule_resolver._future_assignments_for_ssa(
                ssa_name="SSA-1", effective_from=date(2026, 7, 1)
            )
        # Scoped by the back-link, not shift_type.
        _, kwargs = get_all.call_args
        self.assertEqual(kwargs["filters"]["shift_schedule_assignment"], "SSA-1")
        by_name = {r["name"]: r for r in out}
        self.assertNotIn("SA-PAST", by_name)
        self.assertEqual(by_name["SA-STRADDLE"]["action"], "end_before")
        self.assertEqual(by_name["SA-STRADDLE"]["proposed_end_date"], "2026-06-30")
        self.assertEqual(by_name["SA-FUTURE"]["action"], "inactivate")
```

> Note: `_install_frappe_mock` makes `frappe.db` a MagicMock; `frappe.db.table_exists` / `has_column` return truthy mocks by default, so the tests set explicit return values. `frappe.utils.getdate` returns `date` inputs unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest dewey_time.tests.test_schedule_reconcile -v`
Expected: FAIL — `AttributeError: ... has no attribute '_classify_future_assignment'`.

- [ ] **Step 3: Write minimal implementation**

In `schedule_resolver.py`, **delete** `_future_assignments_for_shift_type` (`:504-543`) and add in its place:

```python
def _classify_future_assignment(start_date, end_date, effective_from):
    """Pure: how to retire one assignment relative to the effective date.
    Returns (action, proposed_end_date). action is 'inactivate' (whole row is on/after E),
    'end_before' (row straddles E — trim its tail), or None (entirely before E — leave it)."""
    if not start_date:
        return None, None
    if end_date and end_date < effective_from:
        return None, None
    if start_date >= effective_from:
        return "inactivate", None
    return "end_before", str(effective_from - timedelta(days=1))


def _future_assignments_for_ssa(*, ssa_name, effective_from):
    """Future Active Shift Assignments generated by ONE SSA, classified for retirement.
    Scoped by the engine's shift_schedule_assignment back-link so a shared Shift Type cannot
    drag a kept schedule's assignments into retirement."""
    if not ssa_name or not frappe.db.table_exists("Shift Assignment"):
        return []
    if not frappe.db.has_column("Shift Assignment", "shift_schedule_assignment"):
        frappe.throw(
            "Shift Assignment lacks the shift_schedule_assignment back-link; cannot safely "
            "scope schedule retirement on this engine version."
        )

    effective_from = getdate(effective_from)
    filters = {"shift_schedule_assignment": ssa_name, "docstatus": 1}
    if frappe.db.has_column("Shift Assignment", "status"):
        filters["status"] = "Active"

    rows = frappe.get_all(
        "Shift Assignment",
        filters=filters,
        fields=["name", "start_date", "end_date", "shift_type"],
        order_by="start_date asc",
    ) or []

    out = []
    for row in rows:
        start_date = getdate(row.get("start_date")) if row.get("start_date") else None
        end_date = getdate(row.get("end_date")) if row.get("end_date") else None
        action, proposed_end_date = _classify_future_assignment(start_date, end_date, effective_from)
        if action is None:
            continue
        out.append(
            {
                "name": row.get("name"),
                "shift_type": row.get("shift_type"),
                "start_date": str(start_date),
                "end_date": str(end_date) if end_date else None,
                "action": action,
                "proposed_end_date": proposed_end_date,
            }
        )
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_schedule_reconcile -v`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/schedule_resolver.py dewey_time/tests/test_schedule_reconcile.py
git commit -m "feat(schedule): retire future assignments by SSA back-link, fail closed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Structural three-bucket reconcile preview

**Files:**
- Modify: `dewey_time/attendance_engine/schedule_resolver.py` (add `_identity_label`, `_current_schedule_identities`; rewrite `build_reconcile_preview` at `:468-501`)
- Test: `dewey_time/tests/test_schedule_reconcile.py`

**Interfaces:**
- Produces:
  - `_current_schedule_identities(employee: str) -> dict[str, dict]` — `identity_key -> {ssa, shift_schedule, shift_type, label}` for each enabled SSA.
  - `build_reconcile_preview(*, employee, plan, effective_from) -> dict` — `{effective_from, disable_ssas, add_identities, unchanged_identities, add_labels, leaving_labels, affected_assignments}`.
- Consumes: `_group_identity`, `_identity_key`, `_future_assignments_for_ssa`, existing `compact_days_label` (`:206`), `list_employee_ssas`, `is_ssa_enabled`, `_repeat_days_set`, `normalize_time`.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/tests/test_schedule_reconcile.py`:

```python
class TestBuildReconcilePreview(unittest.TestCase):
    def _plan(self, groups):
        return {"groups": groups}

    def _group(self, days, profile):
        return {"days": days, "profile": profile, "shift_type": {}, "shift_schedule": {}}

    def _run(self, current, plan, affected=None):
        from dewey_time.attendance_engine import schedule_resolver

        affected = affected or []
        with patch.object(schedule_resolver, "_current_schedule_identities", return_value=current), patch.object(
            schedule_resolver, "_future_assignments_for_ssa", return_value=affected
        ):
            return schedule_resolver.build_reconcile_preview(
                employee="EMP-1", plan=plan, effective_from=date(2026, 7, 1)
            )

    def _identity(self, days, profile):
        from dewey_time.attendance_engine.schedule_resolver import _group_identity, _identity_key

        return _identity_key(_group_identity(days, profile))

    def test_pure_add_when_no_current(self):
        plan = self._plan([self._group(["Monday"], _profile("09:00:00", "17:00:00"))])
        out = self._run({}, plan)
        self.assertEqual(len(out["add_identities"]), 1)
        self.assertEqual(out["unchanged_identities"], [])
        self.assertEqual(out["disable_ssas"], [])

    def test_one_day_change_keeps_other_unchanged(self):
        mon_thu = self._identity(
            ["Monday", "Tuesday", "Wednesday", "Thursday"], _profile("09:00:00", "17:00:00")
        )
        old_fri = self._identity(["Friday"], _profile("09:00:00", "17:00:00"))
        current = {
            mon_thu: {"ssa": "SSA-A", "shift_schedule": "PAT_A", "shift_type": "FT", "label": "MON-THU"},
            old_fri: {"ssa": "SSA-B", "shift_schedule": "PAT_B", "shift_type": "FT", "label": "FRI"},
        }
        plan = self._plan(
            [
                self._group(["Monday", "Tuesday", "Wednesday", "Thursday"], _profile("09:00:00", "17:00:00")),
                self._group(["Friday"], _profile("09:00:00", "14:00:00")),  # Friday hours changed
            ]
        )
        out = self._run(current, plan)
        self.assertIn(mon_thu, out["unchanged_identities"])
        self.assertEqual([d["name"] for d in out["disable_ssas"]], ["SSA-B"])
        self.assertEqual(len(out["add_identities"]), 1)  # new Friday only

    def test_grace_only_edit_is_leaving_plus_adding_not_unchanged(self):
        old = self._identity(["Monday"], _profile("09:00:00", "17:00:00", grace=10))
        current = {old: {"ssa": "SSA-A", "shift_schedule": "PAT_A", "shift_type": "FT", "label": "MON"}}
        plan = self._plan([self._group(["Monday"], _profile("09:00:00", "17:00:00", grace=20))])
        out = self._run(current, plan)
        self.assertEqual([d["name"] for d in out["disable_ssas"]], ["SSA-A"])
        self.assertEqual(len(out["add_identities"]), 1)
        self.assertEqual(out["unchanged_identities"], [])

    def test_noop_when_target_matches_current(self):
        same = self._identity(["Monday"], _profile("09:00:00", "17:00:00"))
        current = {same: {"ssa": "SSA-A", "shift_schedule": "PAT_A", "shift_type": "FT", "label": "MON"}}
        plan = self._plan([self._group(["Monday"], _profile("09:00:00", "17:00:00"))])
        out = self._run(current, plan)
        self.assertEqual(out["disable_ssas"], [])
        self.assertEqual(out["add_identities"], [])
        self.assertEqual(out["unchanged_identities"], [same])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest dewey_time.tests.test_schedule_reconcile -v`
Expected: FAIL — `build_reconcile_preview` lacks `add_identities` / different shape.

- [ ] **Step 3: Write minimal implementation**

In `schedule_resolver.py`, add the label + current-identities helpers (near `_group_identity`):

```python
def _identity_label(days, profile):
    start = (normalize_time(profile.get("start_time")) or "—")[:5]
    end = (normalize_time(profile.get("end_time")) or "—")[:5]
    day_label = compact_days_label(days, profile) if days else "—"
    return f"{day_label} {start}–{end}"


def _current_schedule_identities(employee):
    """identity_key -> {ssa, shift_schedule, shift_type, label} for each ENABLED SSA."""
    out = {}
    for ssa in list_employee_ssas(employee):
        if not is_ssa_enabled(ssa):
            continue
        pat = ssa.get("shift_schedule")
        if not pat or not frappe.db.exists("Shift Schedule", pat):
            continue
        pat_doc = frappe.get_doc("Shift Schedule", pat)
        if getattr(pat_doc, "docstatus", 0) != 1:
            continue
        shift_type_name = pat_doc.shift_type
        meta = frappe.get_doc("Shift Type", shift_type_name) if shift_type_name else None
        if not meta:
            continue
        profile = {
            "start_time": normalize_time(meta.start_time),
            "end_time": normalize_time(meta.end_time),
            "lunch_start": normalize_time(getattr(meta, "custom_lunch_start", None)),
            "lunch_end": normalize_time(getattr(meta, "custom_lunch_end", None)),
            "grace_minutes": int(getattr(meta, "custom_grace_minutes", None) or 0),
        }
        days = sorted(_repeat_days_set(pat_doc), key=lambda d: WEEKDAY_TO_INDEX.get(d, 99))
        key = _identity_key(_group_identity(days, profile))
        out[key] = {
            "ssa": ssa.get("name"),
            "shift_schedule": pat,
            "shift_type": shift_type_name,
            "label": _identity_label(days, profile),
        }
    return out
```

Then **replace** `build_reconcile_preview` (`:468-501`) with:

```python
def build_reconcile_preview(*, employee, plan, effective_from):
    effective_from = getdate(effective_from)
    current = _current_schedule_identities(employee)

    target_keys = set()
    target_label_by_key = {}
    for group in plan.get("groups") or []:
        key = group_identity_key(group)
        target_keys.add(key)
        target_label_by_key[key] = _identity_label(group.get("days") or [], group.get("profile") or {})

    current_keys = set(current.keys())
    unchanged_keys = sorted(current_keys & target_keys)
    add_keys = sorted(target_keys - current_keys)
    leaving_keys = sorted(current_keys - target_keys)

    disable_ssas = []
    affected_assignments = []
    leaving_labels = []
    for key in leaving_keys:
        info = current[key]
        disable_ssas.append(
            {
                "name": info.get("ssa"),
                "shift_schedule": info.get("shift_schedule"),
                "shift_type": info.get("shift_type"),
            }
        )
        leaving_labels.append(info.get("label") or info.get("shift_schedule") or "schedule")
        affected_assignments.extend(
            _future_assignments_for_ssa(ssa_name=info.get("ssa"), effective_from=effective_from)
        )

    return {
        "effective_from": str(effective_from),
        "disable_ssas": disable_ssas,
        "add_identities": add_keys,
        "unchanged_identities": unchanged_keys,
        "add_labels": [target_label_by_key[k] for k in add_keys],
        "leaving_labels": leaving_labels,
        "affected_assignments": affected_assignments,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_schedule_reconcile -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/schedule_resolver.py dewey_time/tests/test_schedule_reconcile.py
git commit -m "feat(schedule): structural three-bucket reconcile preview

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Execute reconcile (disable, trim, inactivate — no cancel)

**Files:**
- Modify: `dewey_time/attendance_engine/schedule_resolver.py` (rewrite `reconcile_orphan_ssas` at `:546-584`)
- Test: `dewey_time/tests/test_schedule_reconcile.py`

**Interfaces:**
- Produces: `reconcile_orphan_ssas(*, employee, plan, effective_from) -> dict` — `{disabled_ssas, trimmed_assignments, inactivated_assignments}`.
- Consumes: `build_reconcile_preview`, existing `_disable_ssa` (`:827`), `getdate`.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/tests/test_schedule_reconcile.py`:

```python
class TestReconcileOrphanSsas(unittest.TestCase):
    def test_disables_trims_inactivates_never_cancels(self):
        import frappe
        from dewey_time.attendance_engine import schedule_resolver

        preview = {
            "effective_from": "2026-07-01",
            "disable_ssas": [{"name": "SSA-B", "shift_schedule": "PAT_B", "shift_type": "FT"}],
            "add_identities": [],
            "unchanged_identities": [],
            "add_labels": [],
            "leaving_labels": ["FRI"],
            "affected_assignments": [
                {"name": "SA-STRADDLE", "action": "end_before", "proposed_end_date": "2026-06-30"},
                {"name": "SA-FUTURE", "action": "inactivate", "proposed_end_date": None},
            ],
        }
        frappe.db.has_column.return_value = True

        docs = {"SA-STRADDLE": type("D", (), {"end_date": None})(), "SA-FUTURE": type("D", (), {"status": "Active"})()}
        for d in docs.values():
            d.save = lambda **kw: None
        cancel_called = {"n": 0}

        def fake_get_doc(doctype, name):
            doc = docs[name]
            doc.cancel = lambda: cancel_called.__setitem__("n", cancel_called["n"] + 1)
            return doc

        with patch.object(schedule_resolver, "build_reconcile_preview", return_value=preview), patch.object(
            schedule_resolver, "_disable_ssa"
        ) as disable, patch.object(schedule_resolver.frappe, "get_doc", side_effect=fake_get_doc):
            out = schedule_resolver.reconcile_orphan_ssas(
                employee="EMP-1", plan={"groups": []}, effective_from=date(2026, 7, 1)
            )

        disable.assert_called_once_with("SSA-B")
        self.assertEqual(out["disabled_ssas"], ["SSA-B"])
        self.assertEqual(out["trimmed_assignments"], ["SA-STRADDLE"])
        self.assertEqual(out["inactivated_assignments"], ["SA-FUTURE"])
        self.assertEqual(docs["SA-FUTURE"].status, "Inactive")
        self.assertEqual(cancel_called["n"], 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest dewey_time.tests.test_schedule_reconcile -v`
Expected: FAIL — `reconcile_orphan_ssas` still returns old keys / calls `cancel`.

- [ ] **Step 3: Write minimal implementation**

**Replace** `reconcile_orphan_ssas` (`:546-584`) with:

```python
def reconcile_orphan_ssas(*, employee, plan, effective_from):
    preview = build_reconcile_preview(employee=employee, plan=plan, effective_from=effective_from)

    disabled = []
    trimmed = []
    inactivated = []

    for ssa_info in preview.get("disable_ssas") or []:
        ssa_name = ssa_info.get("name")
        if not ssa_name:
            continue
        _disable_ssa(ssa_name)
        disabled.append(ssa_name)

    has_status = frappe.db.has_column("Shift Assignment", "status")
    for item in preview.get("affected_assignments") or []:
        name = item.get("name")
        if not name:
            continue
        doc = frappe.get_doc("Shift Assignment", name)
        if item.get("action") == "end_before" and item.get("proposed_end_date"):
            doc.end_date = getdate(item["proposed_end_date"])
            doc.save(ignore_permissions=True)
            trimmed.append(name)
        elif item.get("action") == "inactivate":
            if has_status:
                doc.status = "Inactive"
                doc.save(ignore_permissions=True)
            inactivated.append(name)

    return {
        "disabled_ssas": disabled,
        "trimmed_assignments": trimmed,
        "inactivated_assignments": inactivated,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_schedule_reconcile -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/schedule_resolver.py dewey_time/tests/test_schedule_reconcile.py
git commit -m "feat(schedule): execute reconcile via inactivate/trim, never cancel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Make `apply_weekly_schedule` edit-aware

**Files:**
- Modify: `dewey_time/attendance_engine/schedule_api.py` (imports `:21-35`; rewrite `:359-447`)
- Modify: `dewey_time/tests/test_schedule_resolver.py:447` (replace `test_apply_blocked_when_employee_has_enabled_ssa`)
- Test: `dewey_time/tests/test_apply_weekly_schedule.py` (create)

**Interfaces:**
- Consumes: `build_reconcile_preview`, `reconcile_orphan_ssas`, `group_identity_key` (Tasks 3-4-1); existing `build_resolve_plan`, `upsert_ssa`, `generate_shifts_for_ssa`, `employee_has_enabled_ssas`, `create_shift_type`, `create_shift_schedule`, `shift_generation_end_date`.
- Produces: apply response now carries `reconcile` (on `needs_confirm`) and `reconciled` (on `ok`), with `assignments_generated_through` `None` when nothing is added.

- [ ] **Step 1: Write the failing test**

First, **replace** `test_apply_blocked_when_employee_has_enabled_ssa` in `dewey_time/tests/test_schedule_resolver.py` (find it at/around `:447`). New version asserts the edit path returns `needs_confirm` instead of raising:

```python
    def test_apply_edit_returns_needs_confirm_instead_of_blocking(self):
        from dewey_time.attendance_engine import schedule_api

        plan = {"groups": [{"days": ["Monday"], "profile": {}, "shift_type": {}, "shift_schedule": {}}],
                "needs_create": False, "warnings": []}
        reconcile = {"effective_from": "2026-07-01", "disable_ssas": [{"name": "SSA-X"}],
                     "add_identities": [], "unchanged_identities": [], "add_labels": [],
                     "leaving_labels": ["MON"], "affected_assignments": []}

        with patch.object(schedule_api, "_require_hr_role"), patch.object(
            schedule_api, "_employee_header", return_value={"employee": "EMP-1", "company": "C", "employment_type": "Full-time"}
        ), patch.object(schedule_api, "validate_week_pattern", return_value=[]), patch.object(
            schedule_api, "employee_has_enabled_ssas", return_value=True
        ), patch.object(schedule_api, "build_resolve_plan", return_value=plan), patch.object(
            schedule_api, "build_reconcile_preview", return_value=reconcile
        ):
            result = schedule_api.apply_weekly_schedule(
                employee="EMP-1",
                week_pattern={"frequency": "Every Week", "days": [{"weekday": "Monday", "works": True,
                              "start_time": "09:00:00", "end_time": "17:00:00"}]},
                create_shifts_after="2026-07-01",
                confirm_create=False,
            )
        self.assertTrue(result.get("needs_confirm"))
        self.assertEqual(result.get("reconcile"), reconcile)
```

Then create `dewey_time/tests/test_apply_weekly_schedule.py`:

```python
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

VALID_PATTERN = {
    "frequency": "Every Week",
    "days": [{"weekday": "Monday", "works": True, "start_time": "09:00:00", "end_time": "17:00:00"}],
}


def _ctx(**over):
    base = {"employee": "EMP-1", "employee_name": "A", "company": "C", "branch": "B", "employment_type": "Full-time"}
    base.update(over)
    return base


class TestApplyEditPath(unittest.TestCase):
    def _apply(self, *, enabled, plan, reconcile, confirm, today="2026-06-01"):
        import frappe
        from dewey_time.attendance_engine import schedule_api

        frappe.session = type("S", (), {"user": "Administrator"})()
        with patch.object(schedule_api, "_require_hr_role"), patch.object(
            schedule_api, "_employee_header", return_value=_ctx()
        ), patch.object(schedule_api, "validate_week_pattern", return_value=[]), patch.object(
            schedule_api, "resolve_apply_employment_type", return_value=("noop", None)
        ), patch.object(schedule_api, "employee_has_enabled_ssas", return_value=enabled), patch.object(
            schedule_api, "build_resolve_plan", return_value=plan
        ), patch.object(schedule_api, "build_reconcile_preview", return_value=reconcile), patch.object(
            schedule_api, "reconcile_orphan_ssas",
            return_value={"disabled_ssas": [], "trimmed_assignments": [], "inactivated_assignments": []},
        ) as recon, patch.object(schedule_api, "nowdate", return_value=today), patch.object(
            schedule_api, "create_shift_type", return_value="FT"
        ), patch.object(schedule_api, "create_shift_schedule", return_value="PAT_NEW"), patch.object(
            schedule_api, "upsert_ssa", return_value="SSA-NEW"
        ), patch.object(schedule_api, "generate_shifts_for_ssa") as gen, patch.object(
            schedule_api, "shift_generation_end_date", return_value="2026-09-29"
        ):
            result = schedule_api.apply_weekly_schedule(
                employee="EMP-1", week_pattern=VALID_PATTERN,
                create_shifts_after="2026-07-01", confirm_create=confirm,
            )
        return result, recon, gen

    def test_pure_add_edit_still_needs_confirm(self):
        # Existing PAT reused (needs_create False), but a new identity is added.
        plan = {"groups": [{"days": ["Monday"], "profile": {"start_time": "09:00:00", "end_time": "17:00:00"},
                            "shift_type": {"action": "use", "name": "FT"},
                            "shift_schedule": {"action": "use", "name": "PAT_USE"}}],
                "needs_create": False, "warnings": []}
        reconcile = {"effective_from": "2026-07-01", "disable_ssas": [], "add_identities": ["k1"],
                     "unchanged_identities": [], "add_labels": ["MON 09–17"], "leaving_labels": [],
                     "affected_assignments": []}
        result, _, _ = self._apply(enabled=True, plan=plan, reconcile=reconcile, confirm=False)
        self.assertTrue(result.get("needs_confirm"))

    def test_confirm_skips_unchanged_and_retires_first(self):
        from dewey_time.attendance_engine.schedule_resolver import group_identity_key

        unchanged_group = {"days": ["Monday"], "profile": {"start_time": "09:00:00", "end_time": "17:00:00"},
                           "shift_type": {"action": "use", "name": "FT"},
                           "shift_schedule": {"action": "use", "name": "PAT_KEEP"}}
        add_group = {"days": ["Friday"], "profile": {"start_time": "09:00:00", "end_time": "14:00:00"},
                     "shift_type": {"action": "use", "name": "FT2"},
                     "shift_schedule": {"action": "create", "proposed_name": "PAT_FRI"}}
        plan = {"groups": [unchanged_group, add_group], "needs_create": True, "warnings": []}
        reconcile = {"effective_from": "2026-07-01", "disable_ssas": [], "add_identities": [group_identity_key(add_group)],
                     "unchanged_identities": [group_identity_key(unchanged_group)], "add_labels": ["FRI 09–14"],
                     "leaving_labels": [], "affected_assignments": []}
        result, recon, gen = self._apply(enabled=True, plan=plan, reconcile=reconcile, confirm=True)
        self.assertTrue(result.get("ok"))
        recon.assert_called_once()  # retire-first
        # Generated only for the adding group, not the unchanged one.
        self.assertEqual(gen.call_count, 1)
        self.assertIn("reconciled", result)

    def test_forward_only_guard_blocks_past_effective_date_on_edit(self):
        import frappe
        from dewey_time.attendance_engine import schedule_api

        plan = {"groups": [], "needs_create": False, "warnings": []}
        with self.assertRaises(Exception):
            self._apply(enabled=True, plan=plan,
                        reconcile={"disable_ssas": [], "add_identities": [], "unchanged_identities": [],
                                   "affected_assignments": []},
                        confirm=True, today="2026-07-01")  # E == today -> blocked


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest dewey_time.tests.test_apply_weekly_schedule dewey_time.tests.test_schedule_resolver -v`
Expected: FAIL — apply still throws on enabled SSAs / has no `reconcile` / does not skip unchanged.

- [ ] **Step 3: Write minimal implementation**

Update the imports in `schedule_api.py` (`:21-35`) to add `build_reconcile_preview`, `reconcile_orphan_ssas`, `group_identity_key`:

```python
from dewey_time.attendance_engine.schedule_resolver import (
    build_resolve_plan,
    build_reconcile_preview,
    reconcile_orphan_ssas,
    group_identity_key,
    create_shift_schedule,
    create_shift_type,
    employee_has_enabled_ssas,
    validate_week_pattern,
    DEFAULT_SHIFT_GENERATION_DAYS,
    generate_shifts_for_ssa,
    group_week_pattern,
    is_ssa_enabled,
    shift_generation_end_date,
    list_employee_ssas,
    upsert_ssa,
    week_pattern_from_ssas,
)
```

In `apply_weekly_schedule`, **delete** the throw (`:359-365`) and **replace** the region from the (now-deleted) throw through the end of the function with:

```python
    is_edit = employee_has_enabled_ssas(employee)

    effective = getdate(
        create_shifts_after or frappe.form_dict.get("create_shifts_after") or add_days(nowdate(), 1)
    )
    if is_edit and effective <= getdate(nowdate()):
        frappe.throw(
            "Editing a schedule requires an effective date in the future.",
            exc=frappe.ValidationError,
        )

    through_raw = (
        generate_through
        if generate_through is not None
        else frappe.form_dict.get("generate_through")
    )
    through = through_raw if through_raw is not None and str(through_raw).strip() else None
    generation_end = shift_generation_end_date(effective, through)

    confirm = confirm_create
    if isinstance(confirm, str):
        confirm = confirm.strip().lower() in ("1", "true", "yes")
    confirm = bool(confirm)

    plan = build_resolve_plan(employee=employee, week_pattern=pattern)
    reconcile = build_reconcile_preview(employee=employee, plan=plan, effective_from=effective)
    edit_changes = bool(
        reconcile.get("disable_ssas")
        or reconcile.get("add_identities")
        or reconcile.get("affected_assignments")
    )
    if (plan.get("needs_create") or (is_edit and edit_changes)) and not confirm:
        return {"needs_confirm": True, "plan": plan, "reconcile": reconcile}

    # Persist the derived employment type only now that the row is committed to apply.
    if employment_to_set:
        frappe.db.set_value("Employee", employee, "employment_type", employment_to_set)
        employee_info["employment_type"] = employment_to_set

    created_shift_types: list[str] = []
    created_shift_schedules: list[str] = []
    ssas_out: list[dict] = []
    unchanged = set(reconcile.get("unchanged_identities") or [])
    generated_any = False

    try:
        # Retire leaving schedules + their future assignments FIRST (overlap-safe).
        reconciled = reconcile_orphan_ssas(employee=employee, plan=plan, effective_from=effective)

        for group in plan.get("groups") or []:
            if group_identity_key(group) in unchanged:
                continue  # employee already on this schedule — do not regenerate

            profile = group.get("profile") or {}
            shift_type_info = group.get("shift_type") or {}
            shift_schedule_info = group.get("shift_schedule") or {}

            shift_type_name = shift_type_info.get("name")
            if shift_type_info.get("action") == "create":
                shift_type_name = create_shift_type(profile, name=shift_type_info.get("proposed_name"))
                created_shift_types.append(shift_type_name)
            elif not shift_type_name:
                frappe.throw("Shift Type match failed for a group")

            pat_name = shift_schedule_info.get("name")
            if shift_schedule_info.get("action") == "create":
                pat_name = create_shift_schedule(
                    days=group.get("days") or [],
                    shift_type=shift_type_name,
                    profile=profile,
                    name=shift_schedule_info.get("proposed_name"),
                )
                created_shift_schedules.append(pat_name)
            elif not pat_name:
                frappe.throw("Shift Schedule match failed for a group")

            ssa_name = upsert_ssa(
                employee=employee,
                shift_schedule=pat_name,
                create_shifts_after=effective,
                company=employee_info.get("company"),
            )
            generate_shifts_for_ssa(ssa_name, effective, generation_end)
            generated_any = True
            ssas_out.append({"name": ssa_name, "shift_schedule": pat_name})

        frappe.db.commit()
    except frappe.ValidationError as exc:
        frappe.db.rollback()
        message = str(exc)
        lowered = message.lower()
        if "overlap" in lowered or "multiple shift" in lowered:
            frappe.throw(
                "This schedule change overlaps existing future shifts. Re-open Review and pick "
                f"a later effective date. ({message})"
            )
        if "validate_existing_shift_assignments" in lowered:
            frappe.throw(
                "Cannot move the effective date earlier while later assignments exist. "
                "Pick a later effective date or adjust assignments in Desk."
            )
        raise
    except Exception as exc:
        frappe.db.rollback()
        message = str(exc)
        if "duplicate" in message.lower() or "already exists" in message.lower():
            frappe.throw(
                f"Pattern may already exist on site. Re-run Preview and use the existing PAT. ({message})"
            )
        raise

    return {
        "ok": True,
        "employee": employee,
        "ssas": ssas_out,
        "created": {
            "shift_types": created_shift_types,
            "shift_schedules": created_shift_schedules,
        },
        "reconciled": reconciled,
        "assignments_generated_through": str(generation_end) if generated_any else None,
        "assignments_open_ended": (through is None) if generated_any else None,
        "attendance_url": f"/hr-attendance?employee={employee}",
    }
```

> Note: the old code computed `effective`/`through`/`generation_end`/`confirm`/`plan` after the throw; this replacement re-includes them in the correct order. Ensure no duplicate definitions remain above.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_apply_weekly_schedule dewey_time.tests.test_schedule_resolver dewey_time.tests.test_schedule_reconcile -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/schedule_api.py dewey_time/tests/test_apply_weekly_schedule.py dewey_time/tests/test_schedule_resolver.py
git commit -m "feat(schedule): edit-aware apply — reconcile, skip unchanged, forward-only

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Frontend types + reconcile summary lib

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/types/schedule.ts` (`ReconcilePreview` `:54-69`, `ApplyScheduleResult` `:111-123`)
- Create: `dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.test.ts`

**Interfaces:**
- Produces:
  - `ReconcilePreview` (extended): `action: "inactivate" | "end_before"`; adds `add_labels: string[]`, `leaving_labels: string[]`, `add_identities: string[]`, `unchanged_identities: string[]`.
  - `ApplyScheduleResult` (extended): `reconcile?: ReconcilePreview`, `reconciled?: { disabled_ssas: string[]; trimmed_assignments: string[]; inactivated_assignments: string[] }`.
  - `summarizeReconcile(reconcile: ReconcilePreview | null | undefined) -> ScheduleChangeSummary`.
- Consumes: types only.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { summarizeReconcile } from "@/lib/scheduleEdit";
import type { ReconcilePreview } from "@/types/schedule";

const EMPTY: ReconcilePreview = {
  effective_from: "2026-07-01",
  disable_ssas: [],
  add_identities: [],
  unchanged_identities: [],
  add_labels: [],
  leaving_labels: [],
  affected_assignments: [],
};

test("empty reconcile reports no changes", () => {
  const s = summarizeReconcile(EMPTY);
  assert.equal(s.hasChanges, false);
  assert.deepEqual(s.lines, []);
});

test("null reconcile is safe", () => {
  const s = summarizeReconcile(null);
  assert.equal(s.hasChanges, false);
});

test("counts inactivated and trimmed with pluralization", () => {
  const r: ReconcilePreview = {
    ...EMPTY,
    disable_ssas: [{ name: "SSA-B", shift_schedule: "PAT_B" }],
    leaving_labels: ["FRI 09–17"],
    add_labels: ["SAT 08–12"],
    affected_assignments: [
      { name: "A1", start_date: "2026-07-05", action: "inactivate" },
      { name: "A2", start_date: "2026-07-12", action: "inactivate" },
      { name: "A3", start_date: "2026-06-20", action: "end_before", proposed_end_date: "2026-06-30" },
    ],
  };
  const s = summarizeReconcile(r);
  assert.equal(s.hasChanges, true);
  assert.equal(s.inactivatedCount, 2);
  assert.equal(s.trimmedCount, 1);
  assert.deepEqual(s.leavingLabels, ["FRI 09–17"]);
  assert.deepEqual(s.addingLabels, ["SAT 08–12"]);
  assert.ok(s.lines.some((l) => l.includes("2 future shifts inactivated")));
  assert.ok(s.lines.some((l) => l.includes("1 shift trimmed")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `dewey_time/frontend/hr_attendance/`): `npm run test:web`
Expected: FAIL — `Cannot find module '@/lib/scheduleEdit'`.

- [ ] **Step 3: Write minimal implementation**

Edit `src/types/schedule.ts` — replace `ReconcilePreview` (`:54-69`) with:

```ts
export type ReconcilePreview = {
  effective_from: string;
  disable_ssas: Array<{
    name: string;
    shift_schedule: string;
    shift_type?: string | null;
  }>;
  add_identities: string[];
  unchanged_identities: string[];
  add_labels: string[];
  leaving_labels: string[];
  affected_assignments: Array<{
    name: string;
    shift_type?: string;
    start_date: string;
    end_date?: string | null;
    action: "inactivate" | "end_before";
    proposed_end_date?: string | null;
  }>;
};
```

In `ApplyScheduleResult` (`:111-123`), add two fields before the closing brace:

```ts
  reconcile?: ReconcilePreview;
  reconciled?: {
    disabled_ssas: string[];
    trimmed_assignments: string[];
    inactivated_assignments: string[];
  };
```

Create `src/lib/scheduleEdit.ts`:

```ts
import type { ReconcilePreview } from "@/types/schedule";

export type ScheduleChangeSummary = {
  hasChanges: boolean;
  leavingLabels: string[];
  addingLabels: string[];
  inactivatedCount: number;
  trimmedCount: number;
  lines: string[];
};

export function summarizeReconcile(
  reconcile: ReconcilePreview | null | undefined,
): ScheduleChangeSummary {
  const disable = reconcile?.disable_ssas ?? [];
  const affected = reconcile?.affected_assignments ?? [];
  const addingLabels = reconcile?.add_labels ?? [];
  const leavingLabels = reconcile?.leaving_labels ?? [];

  const inactivatedCount = affected.filter((a) => a.action === "inactivate").length;
  const trimmedCount = affected.filter((a) => a.action === "end_before").length;

  const lines: string[] = [];
  for (const label of leavingLabels) lines.push(`Retiring ${label}`);
  for (const label of addingLabels) {
    lines.push(`Adding ${label} from ${reconcile?.effective_from ?? "the effective date"}`);
  }
  if (inactivatedCount) {
    lines.push(`${inactivatedCount} future shift${inactivatedCount === 1 ? "" : "s"} inactivated`);
  }
  if (trimmedCount) {
    const end = reconcile?.affected_assignments.find((a) => a.action === "end_before")
      ?.proposed_end_date;
    lines.push(
      `${trimmedCount} shift${trimmedCount === 1 ? "" : "s"} trimmed${end ? ` to end ${end}` : ""}`,
    );
  }

  const hasChanges =
    disable.length > 0 ||
    affected.length > 0 ||
    addingLabels.length > 0 ||
    (reconcile?.add_identities?.length ?? 0) > 0;

  return { hasChanges, leavingLabels, addingLabels, inactivatedCount, trimmedCount, lines };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/types/schedule.ts dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.ts dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.test.ts
git commit -m "feat(schedule): reconcile preview types + change-summary lib

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Unlock the wizard for editing + e2e

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeeklySchedulePage.tsx`
- Modify: `dewey_time/frontend/hr_attendance/e2e/fixtures.ts`
- Create: `dewey_time/frontend/hr_attendance/e2e/schedule-edit.spec.ts`

**Interfaces:**
- Consumes: `summarizeReconcile` (Task 6), `ReconcilePreview`, `ApplyScheduleResult`.

- [ ] **Step 1: Write the failing test**

Add an editing context branch to `e2e/fixtures.ts`. Inside `stubFrappe`'s `page.route` handler, change the `get_employee_schedule_context` branch to report an existing schedule, and add an `apply_weekly_schedule` branch. Replace the `get_employee_schedule_context` block (`:149-173`) with:

```ts
    } else if (p.includes("get_employee_schedule_context")) {
      message = {
        employee: "EMP-001",
        employee_name: "Jane Doe",
        company: "DIS",
        branch: "BRANCH-A",
        ssas: [{ name: "HR-SHSA-1", shift_schedule: "PAT_MON-FRI", enabled: 1, repeat_days: WEEKDAYS.slice(0, 5), shift_type: "FT_0900_1700" }],
        enabled_ssa_count: 1,
        can_apply: false,
        assignment_summary: { earliest_start_date: "2026-01-01", latest_end_date: "2026-12-31" },
        week_pattern: {
          frequency: "Every Week",
          days: WEEKDAYS.map((w) => ({
            weekday: w,
            works: w !== "Saturday" && w !== "Sunday",
            start_time: "09:00",
            end_time: "17:00",
            lunch_start: "12:00",
            lunch_end: "13:00",
            grace_minutes: 10,
          })),
        },
        default_effective_from: "2026-07-01",
        default_generate_through: "2026-09-29",
      };
    } else if (p.includes("resolve_weekly_schedule_plan")) {
      message = { employee: "EMP-001", groups: [], warnings: [], needs_create: false };
    } else if (p.includes("apply_weekly_schedule")) {
      message = {
        needs_confirm: true,
        plan: { employee: "EMP-001", groups: [], warnings: [], needs_create: false },
        reconcile: {
          effective_from: "2026-07-01",
          disable_ssas: [{ name: "HR-SHSA-1", shift_schedule: "PAT_MON-FRI", shift_type: "FT_0900_1700" }],
          add_identities: ["k-new"],
          unchanged_identities: [],
          add_labels: ["MON-SAT 09–17"],
          leaving_labels: ["MON-FRI 09–17"],
          affected_assignments: [
            { name: "A1", start_date: "2026-07-05", action: "inactivate" },
            { name: "A2", start_date: "2026-06-20", action: "end_before", proposed_end_date: "2026-06-30" },
          ],
        },
      };
    }
```

Create `e2e/schedule-edit.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

import { stubFrappe } from "./fixtures";

test.describe("schedule edit", () => {
  test("editing an existing schedule shows the reconcile review", async ({ page }) => {
    await stubFrappe(page);
    await page.goto("/hr-schedule?employee=EMP-001");

    // Save reads "Review changes" for an employee with an existing schedule.
    const save = page.getByRole("button", { name: /Review changes|Save schedule/ });
    await expect(save).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();

    // The confirm dialog surfaces the "what changes on E" reconcile section.
    await expect(page.getByText(/Retiring MON-FRI 09–17/)).toBeVisible();
    await expect(page.getByText(/Adding MON-SAT 09–17 from 2026-07-01/)).toBeVisible();
    await expect(page.getByText(/1 future shift inactivated/)).toBeVisible();
    await expect(page.getByText(/1 shift trimmed to end 2026-06-30/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `dewey_time/frontend/hr_attendance/`): `npx playwright test schedule-edit --project=desktop`
Expected: FAIL — Save is disabled (still gated by `can_apply`) / reconcile text absent.

- [ ] **Step 3: Write minimal implementation**

In `WeeklySchedulePage.tsx`:

(a) Add imports near the other lib imports (`:52`):

```ts
import { summarizeReconcile } from "@/lib/scheduleEdit";
import type { ApplyScheduleResult, ReconcilePreview } from "@/types/schedule";
```

(b) Add state alongside the others (`:90`):

```ts
  const [pendingReconcile, setPendingReconcile] = useState<ReconcilePreview | null>(null);
  const [savedNonce, setSavedNonce] = useState(0);
```

(c) Add `savedNonce` to the prefill effect deps (`:142`) — change `}, [context?.employee]);` to:

```ts
  }, [context?.employee, savedNonce]);
```

(d) Replace the `canApply`/`previewOnly`/`scheduleReadOnly` block (`:154-156`) with:

```ts
  const isEditing = (context?.enabled_ssa_count ?? 0) > 0;
  const scheduleReadOnly = false;
  const previewOnly = false;
```

(e) In `handleSave`, change the guard (`:200`) from `if (validationIssues.length || !canApply) return;` to:

```ts
    if (validationIssues.length) return;
```

(f) In `handleSave`'s `needs_confirm` branch, capture the reconcile. After `setPendingConfirmPlan(creates);` (`:230`) add:

```ts
      setPendingReconcile((result as ApplyScheduleResult).reconcile ?? null);
```

(g) In `handleSave`'s success branch (`:235-238`), bump the nonce:

```ts
    if (result.ok) {
      setSaveSuccessUrl(result.attendance_url ?? `/hr-attendance?employee=${scheduleEmployeeId}`);
      setSavedNonce((n) => n + 1);
      void refreshContext();
    }
```

(h) Remove `!canApply` from `saveDisabled` (`:271`):

```ts
  const saveDisabled =
    !scheduleEmployeeId ||
    applying ||
    validationIssues.length > 0 ||
    !effectiveFrom ||
    !hasWorkingDays ||
    (limitGenerateThrough && !generateThrough);
```

(i) Delete the `previewOnly` read-only card (`:375-382`).

(j) Effective-from min for edits — change the "Effective from" `DatePickerInput` (`:475-481`) to add a `min`:

```tsx
                  <DatePickerInput
                    id="effective-from"
                    label="Effective from"
                    value={effectiveFrom}
                    onChange={setEffectiveFrom}
                    min={isEditing ? addDays(new Date(), 1) : undefined}
                  />
```

(k) Save button label (`:545-549`) — replace the `previewOnly ? "Preview only" : "Save schedule"` ternary:

```tsx
                    ) : isEditing ? (
                      "Review changes"
                    ) : (
                      "Save schedule"
                    )}
```

(l) Add the reconcile section to the confirm dialog. Inside the `<Dialog open={confirmOpen}>` `DialogContent`, after the `<ul>` of `pendingConfirmPlan` (`:585`), insert:

```tsx
          {(() => {
            const summary = summarizeReconcile(pendingReconcile);
            if (!summary.hasChanges) return null;
            return (
              <div className="mt-1 space-y-1 rounded-md border border-border/60 bg-muted/30 p-3">
                <p className="text-xs font-medium text-foreground">
                  What changes on {pendingReconcile?.effective_from}
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {summary.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            );
          })()}
```

(m) Success card — surface the reconciled summary. Replace the success `<Card>` body (`:384-393`) so the message reflects an edit when reconcile counts exist. Track the last result's reconciled counts by storing them on save; minimal approach — add state `const [lastReconciled, setLastReconciled] = useState<ApplyScheduleResult["reconciled"] | null>(null);` (near `:90`), set it in the success branch (`setLastReconciled(result.reconciled ?? null);`), and render:

```tsx
            {saveSuccessUrl ? (
              <Card className="border-primary/30 bg-muted/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="text-primary">
                    {lastReconciled &&
                    (lastReconciled.inactivated_assignments.length ||
                      lastReconciled.trimmed_assignments.length)
                      ? `Schedule updated — ${lastReconciled.inactivated_assignments.length} inactivated, ${lastReconciled.trimmed_assignments.length} trimmed.`
                      : "Schedule saved successfully."}
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link to={saveSuccessUrl}>Open attendance</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test schedule-edit --project=desktop`
Expected: PASS. Then run the full suites:

```bash
npm run test:web
npx playwright test --project=desktop
```

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add dewey_time/frontend/hr_attendance/src/ui/WeeklySchedulePage.tsx dewey_time/frontend/hr_attendance/e2e/fixtures.ts dewey_time/frontend/hr_attendance/e2e/schedule-edit.spec.ts dewey_time/public/hr_attendance dewey_time/www/hr-schedule.html dewey_time/www/hr-attendance.html
git commit -m "feat(schedule): unlock wizard for in-place editing with reconcile review

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Structural diff (grace + non-canonical) → Tasks 1, 3 (incl. grace + identity tests). ✓
- Back-link scoping + fail-closed → Task 2. ✓
- Inactivate/trim, never cancel → Task 4. ✓
- Edit-aware apply, confirm-on-any-change incl. pure-add, skip unchanged, forward-only guard, MultipleShiftError/OverlappingShiftError → Task 5. ✓
- Replace obsolete throw test → Task 5. ✓
- Types (`ReconcilePreview` + `ApplyScheduleResult`) + summary lib → Task 6. ✓
- Unlock in all three places (154-156, 200, 271), reconcile in confirm, success copy, re-fetch + prefill nonce, effective-from min, edit affordance → Task 7. ✓
- Permissions unchanged (`_require_hr_role`); clear tool untouched → no task touches them. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**3. Type consistency:** `_group_identity`/`_identity_key`/`group_identity_key` (T1) used identically in T3/T5. `build_reconcile_preview` keys (`add_identities`, `unchanged_identities`, `add_labels`, `leaving_labels`, `disable_ssas`, `affected_assignments`) match across T3 (Python), T5 (consumer), T6 (`ReconcilePreview` TS), and T7 (fixtures/spec). `reconciled` shape matches between T5 return and T6 `ApplyScheduleResult`. `action` union `"inactivate" | "end_before"` consistent T2/T4/T6. ✓

**Open implementation note (not a blocker):** Task 7 step (m) adds `lastReconciled` state — ensure it is declared once (near `:90`) and set only in the success branch. If `DatePickerInput` does not accept a `min` as a `Date`, pass it in the same form the existing `generate-through` picker uses (`min={effectiveFrom ? parseISO(effectiveFrom) : undefined}` shows `Date` is accepted).
