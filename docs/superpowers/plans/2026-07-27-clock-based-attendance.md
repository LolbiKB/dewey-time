# Clock-Based Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees whose employment type sits outside the Weekly-Schedule allowlist and who have no Shift Assignment on a date get a "clock day" — neutral rendering, net worked hours, and only punch-integrity flags — instead of being treated as an error.

**Architecture:** A single Frappe-free predicate `is_clock_based(employment_type)` in `employment_type.py` is the one source of policy. The engine consults it in exactly one branch of `closeout.py` (`intraday.py` already returns early for unscheduled days and needs no change). The calendar API exposes the boolean once per employee; the frontend ANDs it with the existing per-day `shift_assigned` to decide clock days, so the employment-type rule never gets reimplemented in TypeScript.

**Tech Stack:** Python 3 + Frappe (backend, `unittest`), React 19 + TypeScript + Vite + TailwindCSS v4 (frontend, `tsx --test`).

**Spec:** `docs/superpowers/specs/2026-07-27-clock-based-attendance-design.md`

## Global Constraints

- Package root for frontend commands: `dewey_time/frontend/hr_attendance`. There is no repo-root `package.json`.
- Frontend unit tests run with `npm run test:web`. Its glob only covers `src/lib/*.test.ts`, `src/brand/*.test.ts(x)`, `src/pwa/*.test.ts(x)`, `src/components/*.test.tsx`, `src/ui/*.test.tsx`. **A test placed anywhere else will not run.**
- Typecheck with `npx tsc --noEmit`. A pre-existing `TS5101` warning is expected and is not a regression.
- Python tests are `unittest`, not pytest. `employment_type.py` is deliberately Frappe-free and its tests run with plain `python3 -m unittest` from the repo root; everything else needs the frappe mock harness already present in `dewey_time/tests/test_closeout.py`.
- The allowlist constant is `WEEKLY_SCHEDULE_EMPLOYMENT_TYPES = ("Full-time", "Part-time Fixed", "Intern")` in `dewey_time/attendance_engine/employment_type.py`.
- Flag codes are exact strings: `OFF_SHIFT_PUNCH`, `ATTENDANCE_ISSUE`, `NON_PRIMARY_SITE_PUNCH`, `LATE_START`.
- Commit after every task. Do not squash tasks together.

## File Structure

| File | Responsibility |
|---|---|
| `dewey_time/attendance_engine/employment_type.py` | **Modify.** Add `is_clock_based` — the single source of the policy. |
| `dewey_time/attendance_engine/closeout.py` | **Modify.** Split the `not on_shift` branch; extract the non-primary-branch helper so both paths share it. |
| `dewey_time/attendance_engine/record_issue_flags.py` | **Modify.** Docstring correction only — it claims on-shift-only, but its body is shift-agnostic. |
| `dewey_time/attendance_engine/hr_calendar.py` | **Modify.** Expose `is_clock_based` on nav meta + picker rows. |
| `dewey_time/frontend/hr_attendance/src/lib/clockDay.ts` | **Create.** `isClockDay` + `netWorkedMinutes` — pure, testable, no React. |
| `dewey_time/frontend/hr_attendance/src/types/calendar.ts` | **Modify.** `is_clock_based` on `CalendarEmployee` and the calendar response. |
| `dewey_time/frontend/hr_attendance/src/ui/App.tsx` | **Modify.** Stop the "No schedule configured" card from swallowing clock-based employees; thread the flag down. |
| `dewey_time/frontend/hr_attendance/src/ui/WeekView.tsx` | **Modify.** Neutral styling on clock days. |
| `dewey_time/frontend/hr_attendance/src/ui/WeekDayView.tsx` | **Modify.** Same, plus pip tone. |
| `dewey_time/frontend/hr_attendance/src/lib/weekDayView.ts` | **Modify.** `dayPipState` becomes clock-aware. |
| `dewey_time/frontend/hr_attendance/src/ui/DayChips.tsx` | **Modify.** Add the "Clock" chip. |
| `dewey_time/docs/CALENDAR_DATA_CONTRACT.md` | **Modify.** Document the field + policy table. |

---

### Task 1: The `is_clock_based` predicate

**Files:**
- Modify: `dewey_time/attendance_engine/employment_type.py`
- Test: `dewey_time/tests/test_employment_type.py`

**Interfaces:**
- Consumes: `is_weekly_schedule_eligible(employment_type) -> bool` and `WEEKLY_SCHEDULE_EMPLOYMENT_TYPES`, both already in this module.
- Produces: `is_clock_based(employment_type: str | None) -> bool`. Tasks 2 and 3 import this exact name from `dewey_time.attendance_engine.employment_type`.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/tests/test_employment_type.py`:

```python
class IsClockBasedTests(unittest.TestCase):
    def test_allowlist_types_are_not_clock_based(self):
        for value in WEEKLY_SCHEDULE_EMPLOYMENT_TYPES:
            self.assertFalse(is_clock_based(value), value)

    def test_types_outside_the_allowlist_are_clock_based(self):
        self.assertTrue(is_clock_based("Contract"))
        self.assertTrue(is_clock_based("Casual"))
        self.assertTrue(is_clock_based("Part-time Flexible"))

    def test_blank_is_not_clock_based(self):
        # A blank type is an unclassified employee, not a policy decision.
        self.assertFalse(is_clock_based(None))
        self.assertFalse(is_clock_based(""))
        self.assertFalse(is_clock_based("   "))

    def test_allowlist_match_ignores_case_and_whitespace(self):
        self.assertFalse(is_clock_based("  full-time  "))
        self.assertFalse(is_clock_based("INTERN"))

    def test_non_string_is_not_clock_based(self):
        # Fail toward keeping enforcement: anything that is not a real string
        # (None-like sentinels, test mocks, bad data) must never silently
        # switch off schedule enforcement for a real employee.
        self.assertFalse(is_clock_based(object()))
        self.assertFalse(is_clock_based(123))
```

Add `is_clock_based` to the existing import block at the top of the file:

```python
from dewey_time.attendance_engine.employment_type import (
    WEEKLY_SCHEDULE_EMPLOYMENT_TYPES,
    derive_employment_type,
    is_clock_based,
    is_weekly_schedule_eligible,
    resolve_apply_employment_type,
    weekly_scheduled_minutes,
)
```

- [ ] **Step 2: Run test to verify it fails**

Run from the repo root:
```bash
python3 -m unittest dewey_time.tests.test_employment_type -v
```
Expected: FAIL — `ImportError: cannot import name 'is_clock_based'`.

- [ ] **Step 3: Write minimal implementation**

Add to `dewey_time/attendance_engine/employment_type.py`, directly below `is_weekly_schedule_eligible`:

```python
def is_clock_based(employment_type: str | None) -> bool:
    """True when this employee clocks in/out rather than working to a schedule.

    The complement of the Weekly-Schedule allowlist, with two deliberate
    exceptions, both of which fail toward *keeping* schedule enforcement:

    - A blank type is NOT clock-based. Blank means nobody has classified this
      employee yet — a data gap that should stay visible as OFF_SHIFT_PUNCH
      noise rather than be silently reinterpreted as a policy decision.
    - A non-string is NOT clock-based. ``Employee.employment_type`` is a Frappe
      Data field, so a non-string is bad data or a test double; treating it as
      clock-based would silently disable late/absence detection for someone who
      really is scheduled.
    """
    if not isinstance(employment_type, str):
        return False
    if not employment_type.strip():
        return False
    return not is_weekly_schedule_eligible(employment_type)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest dewey_time.tests.test_employment_type -v
```
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/employment_type.py dewey_time/tests/test_employment_type.py
git commit -m "feat(attendance): add is_clock_based employment-type predicate"
```

---

### Task 2: Closeout emits clock-day flags instead of OFF_SHIFT_PUNCH

**Files:**
- Modify: `dewey_time/attendance_engine/closeout.py` (imports; `_generate_for_employee_date` at 465-477; the non-primary block at 540-556)
- Modify: `dewey_time/attendance_engine/record_issue_flags.py` (docstring at line 14)
- Test: `dewey_time/tests/test_closeout.py`

**Interfaces:**
- Consumes: `is_clock_based` from Task 1.
- Produces: `_non_primary_site_punch_flag(*, checkins, employee_branch) -> tuple[str, dict] | None` — a module-level helper in `closeout.py`. No later task imports it; it exists so the scheduled path and the clock path cannot drift.

**Context the implementer needs:** the branch being changed is the `if not on_shift:` block. Today it appends a single `OFF_SHIFT_PUNCH` and returns. `intraday.py` needs no change — it already does `if not on_shift: return` at line 87, so `OFF_SHIFT_PUNCH` is closeout-only.

- [ ] **Step 1: Write the failing tests**

Add to `dewey_time/tests/test_closeout.py`, inside the same test class that holds the existing off-shift tests. Note every mock employee sets `employment_type` explicitly — without it, `getattr` on a `MagicMock` returns a truthy mock.

```python
    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_employee_gets_no_off_shift_punch(
        self, get_cached_doc, _get_shift, get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-A"},
            {"time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertNotIn("OFF_SHIFT_PUNCH", codes)
        self.assertEqual(codes, [])

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_single_punch_still_flags_attendance_issue(
        self, get_cached_doc, _get_shift, get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("ATTENDANCE_ISSUE", codes)
        self.assertNotIn("OFF_SHIFT_PUNCH", codes)

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_foreign_branch_still_flags_non_primary(
        self, get_cached_doc, _get_shift, get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-B"},
            {"time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-B"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("NON_PRIMARY_SITE_PUNCH", codes)
        self.assertNotIn("OFF_SHIFT_PUNCH", codes)

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_no_punches_creates_nothing(
        self, get_cached_doc, _get_shift, _get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        insert_flag.assert_not_called()

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_blank_employment_type_still_gets_off_shift_punch(
        self, get_cached_doc, _get_shift, get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = ""
        get_cached_doc.return_value = employee
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-A"},
            {"time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertEqual(codes, ["OFF_SHIFT_PUNCH"])
```

Ensure `datetime` is imported at the top of the test file (`from datetime import date, datetime, time as dt_time`).

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3 -m unittest dewey_time.tests.test_closeout -v
```
Expected: the four `clock_based` tests FAIL (they currently produce `["OFF_SHIFT_PUNCH"]` or, for the no-punches case, pass trivially); `test_blank_employment_type_still_gets_off_shift_punch` PASSES already. Every pre-existing test must still pass — if any pre-existing test now fails, stop and report it rather than editing that test.

- [ ] **Step 3: Extract the shared non-primary-branch helper**

In `closeout.py`, add this module-level function directly above `_generate_for_employee_date`:

```python
def _non_primary_site_punch_flag(*, checkins: list[dict], employee_branch: str | None):
    """NON_PRIMARY_SITE_PUNCH when punches land on a branch that isn't the employee's.

    Pure branch arithmetic with no shift input, which is why the scheduled path
    and the clock-day path can share it.
    """
    if not employee_branch:
        return None
    non_primary_hits = sum(
        1
        for c in checkins
        if c.get("custom_device_branch") and c.get("custom_device_branch") != employee_branch
    )
    if non_primary_hits <= 0:
        return None
    return (
        "NON_PRIMARY_SITE_PUNCH",
        {
            "employee_branch": employee_branch,
            "non_primary_checkins": non_primary_hits,
        },
    )
```

Then replace the existing block at lines 540-556 — this exact text:

```python
    non_primary_hits = 0
    if employee_branch:
        non_primary_hits = sum(
            1
            for c in checkins
            if c.get("custom_device_branch") and c.get("custom_device_branch") != employee_branch
        )
    if non_primary_hits > 0:
        flags_to_create.append(
            (
                "NON_PRIMARY_SITE_PUNCH",
                {
                    "employee_branch": employee_branch,
                    "non_primary_checkins": non_primary_hits,
                },
            )
        )
```

with:

```python
    non_primary_flag = _non_primary_site_punch_flag(
        checkins=checkins, employee_branch=employee_branch
    )
    if non_primary_flag:
        flags_to_create.append(non_primary_flag)
```

- [ ] **Step 4: Add the import**

Add to the import block at the top of `closeout.py`, alongside the other `attendance_engine` imports:

```python
from dewey_time.attendance_engine.employment_type import is_clock_based
```

- [ ] **Step 5: Split the `not on_shift` branch**

Replace this exact block (lines 465-477):

```python
    if not on_shift:
        if checkins_count == 0:
            return
        flags_to_create.append(("OFF_SHIFT_PUNCH", {"reason": "off_shift_has_checkins"}))
        for flag_code, extra_evidence in flags_to_create:
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code=flag_code,
                evidence={**evidence, **extra_evidence},
            )
        return
```

with:

```python
    if not on_shift:
        if checkins_count == 0:
            return
        if is_clock_based(getattr(employee_doc, "employment_type", None)):
            # Clock day: no schedule exists to judge against, so only punch-integrity
            # and location flags apply. LATE_START / LEFT_EARLY / MISSING_TIME /
            # LATE_FROM_LUNCH / UNNOTIFIED_ABSENCE / OFF_SHIFT_PUNCH are all defined
            # relative to a shift and are deliberately absent here.
            # Spec: docs/superpowers/specs/2026-07-27-clock-based-attendance-design.md
            evidence["clock_based"] = True
            non_primary_flag = _non_primary_site_punch_flag(
                checkins=checkins, employee_branch=employee_branch
            )
            if non_primary_flag:
                flags_to_create.append(non_primary_flag)
            flags_to_create.extend(
                evaluate_record_issue_flags(
                    checkins=checkins,
                    shift_meta=None,
                    attendance_date=attendance_date,
                    undelivered_items=undelivered_items,
                )
            )
        else:
            flags_to_create.append(("OFF_SHIFT_PUNCH", {"reason": "off_shift_has_checkins"}))
        for flag_code, extra_evidence in flags_to_create:
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code=flag_code,
                evidence={**evidence, **extra_evidence},
            )
        return
```

- [ ] **Step 6: Correct the record_issue_flags docstring**

In `dewey_time/attendance_engine/record_issue_flags.py`, replace line 14:

```python
    """Returns ATTENDANCE_ISSUE rows (on-shift only — caller must gate off-shift)."""
```

with:

```python
    """Returns ATTENDANCE_ISSUE rows. The caller decides when these apply.

    The body is shift-agnostic — it never reads ``shift_meta`` or
    ``grace_minutes`` — so it has two legitimate callers: the on-shift closeout
    path, and the clock-day path for employees with no schedule. Both reasons it
    can emit (unpaired punches, unknown device branch) are pure punch arithmetic.
    """
```

- [ ] **Step 7: Run the full backend suite**

```bash
python3 -m unittest dewey_time.tests.test_closeout dewey_time.tests.test_record_issue_flags dewey_time.tests.test_intraday dewey_time.tests.test_absence_flags -v
```
Expected: PASS, all tests, including every pre-existing one.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/attendance_engine/closeout.py dewey_time/attendance_engine/record_issue_flags.py dewey_time/tests/test_closeout.py
git commit -m "feat(engine): clock days emit punch-integrity flags, not OFF_SHIFT_PUNCH"
```

---

### Task 3: Expose `is_clock_based` on the calendar API

**Files:**
- Modify: `dewey_time/attendance_engine/hr_calendar.py` (`_employee_nav_meta` at 430-437; picker row dict at 401-419)
- Modify: `dewey_time/docs/CALENDAR_DATA_CONTRACT.md`
- Test: `dewey_time/tests/test_hr_calendar.py`

**Interfaces:**
- Consumes: `is_clock_based` from Task 1.
- Produces: the JSON key `is_clock_based` (boolean) at the top level of `get_employee_calendar`'s response and on every row of `list_calendar_employees`. Tasks 4-7 consume exactly this key name.

- [ ] **Step 1: Write the failing test**

Add to `dewey_time/tests/test_hr_calendar.py`:

```python
class EmployeeNavMetaClockBasedTests(unittest.TestCase):
    def test_nav_meta_reports_clock_based_for_contract(self):
        from dewey_time.attendance_engine import hr_calendar

        with patch.object(hr_calendar, "first_checkin_date_by_employee", return_value={}), \
             patch.object(hr_calendar, "shift_assignment_bounds_by_employee", return_value={}), \
             patch.object(hr_calendar.frappe.db, "get_value", return_value="Contract"):
            meta = hr_calendar._employee_nav_meta("EMP-1")

        self.assertTrue(meta["is_clock_based"])

    def test_nav_meta_reports_not_clock_based_for_full_time(self):
        from dewey_time.attendance_engine import hr_calendar

        with patch.object(hr_calendar, "first_checkin_date_by_employee", return_value={}), \
             patch.object(hr_calendar, "shift_assignment_bounds_by_employee", return_value={}), \
             patch.object(hr_calendar.frappe.db, "get_value", return_value="Full-time"):
            meta = hr_calendar._employee_nav_meta("EMP-1")

        self.assertFalse(meta["is_clock_based"])
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m unittest dewey_time.tests.test_hr_calendar -v
```
Expected: FAIL with `KeyError: 'is_clock_based'`.

- [ ] **Step 3: Implement**

In `hr_calendar.py`, add the import beside the existing `employment_type` usage:

```python
from dewey_time.attendance_engine.employment_type import is_clock_based
```

Replace `_employee_nav_meta` (lines 430-437) with:

```python
def _employee_nav_meta(employee: str) -> dict:
    checkin = first_checkin_date_by_employee([employee]).get(employee, {})
    bounds = shift_assignment_bounds_by_employee([employee]).get(employee, {})
    employment_type = frappe.db.get_value("Employee", employee, "employment_type")
    return {
        "first_checkin_date": checkin.get("first_checkin_date"),
        "schedule_max_date": bounds.get("schedule_max_date"),
        "has_shift_assignment": bool(bounds.get("has_shift_assignment")),
        "is_clock_based": is_clock_based(employment_type),
    }
```

In the picker row dict, add one line directly after `"is_full_time": is_full_time_employment(employment_type),` (line 411):

```python
                "is_clock_based": is_clock_based(employment_type),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m unittest dewey_time.tests.test_hr_calendar -v
```
Expected: PASS.

- [ ] **Step 5: Document the contract**

In `dewey_time/docs/CALENDAR_DATA_CONTRACT.md`, add `"is_clock_based": false` to the `list_calendar_employees` JSON example, and add this section immediately after the `get_employee_calendar` per-day example:

```markdown
### Clock-based employees

`is_clock_based` appears on `list_calendar_employees` rows and at the top level of
`get_employee_calendar`. It is `true` when `Employee.employment_type` is set and is
**not** one of `Full-time`, `Part-time Fixed`, `Intern`.

A **clock day** is `is_clock_based && !day.shift.shift_assigned`. On a clock day the
engine emits only `ATTENDANCE_ISSUE` and `NON_PRIMARY_SITE_PUNCH`; `LATE_START`,
`LEFT_EARLY`, `MISSING_TIME`, `LATE_FROM_LUNCH`, `UNNOTIFIED_ABSENCE` and
`OFF_SHIFT_PUNCH` are all suppressed.

| Employment type | Shift Assignment on date | Result |
|---|---|---|
| Outside the allowlist | no | Clock day |
| Outside the allowlist | yes | Scheduled day — full logic |
| Full-time / Part-time Fixed / Intern | no | `OFF_SHIFT_PUNCH` |
| Blank / unset | no | `OFF_SHIFT_PUNCH` |

A blank employment type stays on the scheduled path deliberately: it is an
unclassified employee, not a policy decision, and should remain visible.
```

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/hr_calendar.py dewey_time/tests/test_hr_calendar.py dewey_time/docs/CALENDAR_DATA_CONTRACT.md
git commit -m "feat(hr-calendar): expose is_clock_based on calendar + picker payloads"
```

---

### Task 4: Frontend clock-day helpers

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/lib/clockDay.ts`
- Create: `dewey_time/frontend/hr_attendance/src/lib/clockDay.test.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/types/calendar.ts`

**Interfaces:**
- Produces:
  - `isClockDay(isClockBased: boolean | undefined, day: Day | undefined): boolean`
  - `netWorkedMinutes(segments: Array<{ minutes: number | null }>): number | null`
  - `clockDayMinutes(segments, grossMinutes): { minutes: number | null; unverified: boolean }`
- Tasks 5, 6 and 7 import these exact names from `@/lib/clockDay`.

**Why `clockDayMinutes` exists:** `deriveSegments` (`attendancePunches.ts:97`) skips any run whose first punch has no device branch, so punches with missing branch data yield **zero segments**. Rendering `0h` there would be wrong — the employee worked, the data is incomplete. `clockDayMinutes` falls back to the gross span and marks it `unverified`.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/frontend/hr_attendance/src/lib/clockDay.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { clockDayMinutes, isClockDay, netWorkedMinutes } from "./clockDay";

const scheduled = { shift: { shift_assigned: true } } as never;
const unscheduled = { shift: { shift_assigned: false } } as never;

test("isClockDay requires both clock-based employee and no shift", () => {
  assert.equal(isClockDay(true, unscheduled), true);
  assert.equal(isClockDay(true, scheduled), false);
  assert.equal(isClockDay(false, unscheduled), false);
  assert.equal(isClockDay(undefined, unscheduled), false);
});

test("isClockDay treats a missing day as unscheduled", () => {
  assert.equal(isClockDay(true, undefined), true);
});

test("netWorkedMinutes sums segments and ignores nulls", () => {
  assert.equal(netWorkedMinutes([{ minutes: 120 }, { minutes: 180 }]), 300);
  assert.equal(netWorkedMinutes([{ minutes: 120 }, { minutes: null }]), 120);
});

test("netWorkedMinutes returns null when there are no segments", () => {
  assert.equal(netWorkedMinutes([]), null);
});

test("clockDayMinutes prefers net worked", () => {
  assert.deepEqual(clockDayMinutes([{ minutes: 120 }], 480), {
    minutes: 120,
    unverified: false,
  });
});

test("clockDayMinutes falls back to gross when segments are empty", () => {
  // deriveSegments drops runs with no device branch — never render 0h there.
  assert.deepEqual(clockDayMinutes([], 480), { minutes: 480, unverified: true });
});

test("clockDayMinutes returns null when there is nothing at all", () => {
  assert.deepEqual(clockDayMinutes([], null), { minutes: null, unverified: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

From `dewey_time/frontend/hr_attendance`:
```bash
npm run test:web
```
Expected: FAIL — cannot resolve `./clockDay`.

- [ ] **Step 3: Implement**

Create `dewey_time/frontend/hr_attendance/src/lib/clockDay.ts`:

```ts
import type { Day } from "@/types/calendar";

/**
 * A clock day: an employee who works to the clock rather than a schedule, on a
 * date with no Shift Assignment. Schedule wins when present — if a shift is
 * assigned the day is scheduled and keeps full late/early/absence logic.
 */
export function isClockDay(isClockBased: boolean | undefined, day: Day | undefined): boolean {
  if (!isClockBased) return false;
  return day?.shift?.shift_assigned !== true;
}

/** Sum of paired in/out segment minutes. Null when there are no usable segments. */
export function netWorkedMinutes(segments: Array<{ minutes: number | null }>): number | null {
  const usable = segments.filter((s) => s.minutes != null);
  if (!usable.length) return null;
  return usable.reduce((total, s) => total + (s.minutes ?? 0), 0);
}

/**
 * The figure to display on a clock day.
 *
 * Net worked is the payable number, but `deriveSegments` drops any run whose
 * first punch has no device branch, so missing branch data yields zero segments.
 * Showing `0h` would be wrong — they worked, the data is incomplete — so fall
 * back to the gross span and mark it unverified. That same condition already
 * raises ATTENDANCE_ISSUE (unknown_device_branch), which explains the gap.
 */
export function clockDayMinutes(
  segments: Array<{ minutes: number | null }>,
  grossMinutes: number | null | undefined
): { minutes: number | null; unverified: boolean } {
  const net = netWorkedMinutes(segments);
  if (net != null) return { minutes: net, unverified: false };
  if (grossMinutes != null) return { minutes: grossMinutes, unverified: true };
  return { minutes: null, unverified: false };
}
```

- [ ] **Step 4: Add the types**

In `src/types/calendar.ts`, add to `CalendarEmployee` directly after `is_full_time?: boolean;` (line 113):

```ts
  /** Employment type is set and outside the Weekly-Schedule allowlist — clocks in/out. */
  is_clock_based?: boolean;
```

And add to the calendar response type, directly after `has_shift_assignment?: boolean;` (line 100):

```ts
  is_clock_based?: boolean;
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npm run test:web && npx tsc --noEmit
```
Expected: all tests PASS; `tsc` clean apart from the pre-existing `TS5101`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/clockDay.ts src/lib/clockDay.test.ts src/types/calendar.ts
git commit -m "feat(hr-attendance): clock-day helpers (isClockDay, net worked minutes)"
```

---

### Task 5: Stop the "No schedule configured" card swallowing clock-based employees

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/App.tsx:350`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeekView.tsx` (props)
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeekDayView.tsx` (props)
- Test: `dewey_time/frontend/hr_attendance/src/ui/clockDayGate.test.tsx` (create)

**Interfaces:**
- Consumes: `is_clock_based` on `CalendarEmployee` (Task 4).
- Produces: `isClockBased?: boolean` prop on both `WeekViewProps` and `WeekDayViewProps`. Task 6 reads it.

**Why this task is load-bearing:** `App.tsx:350` currently renders a "No schedule configured" card *instead of* the week view whenever `selectedEmployee?.has_shift_assignment === false`. A clock-based employee has no Shift Schedule Assignment by definition, so without this change they never reach the grid and every other frontend change in this plan is invisible.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/frontend/hr_attendance/src/ui/clockDayGate.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Source assertion: the empty-state gate must not fire for clock-based employees.
// A rendering test would need the whole App data stack; the gate is a single
// condition, so pin it at the source.
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

test("the no-schedule card is skipped for clock-based employees", () => {
  assert.match(
    app,
    /selectedEmployee\?\.has_shift_assignment === false &&\s*!selectedEmployee\?\.is_clock_based/
  );
});

test("WeekView and WeekDayView both receive isClockBased", () => {
  const matches = app.match(/isClockBased=\{/g) ?? [];
  assert.equal(matches.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:web
```
Expected: FAIL on both assertions.

- [ ] **Step 3: Implement the gate change**

In `App.tsx`, replace this condition on line 350:

```tsx
                  ) : selectedEmployee?.has_shift_assignment === false ? (
```

with:

```tsx
                  ) : selectedEmployee?.has_shift_assignment === false &&
                    !selectedEmployee?.is_clock_based ? (
```

- [ ] **Step 4: Thread the prop through both call sites**

In `App.tsx`, add `isClockBased={selectedEmployee?.is_clock_based}` to both the `WeekDayView` (line 361) and `WeekView` (line 370) elements, so they read:

```tsx
                  ) : isMobile ? (
                    <WeekDayView
                      weekDates={weekDates}
                      daysByDate={daysByDate}
                      alertsByDate={alertsByDate}
                      syncByDate={syncByDate}
                      isClockBased={selectedEmployee?.is_clock_based}
                      onInspectDay={handleInspectDay}
                      onInspectFlag={handleInspectFlag}
                    />
                  ) : (
                    <WeekView
                      weekDates={weekDates}
                      daysByDate={daysByDate}
                      alertsByDate={alertsByDate}
                      syncByDate={syncByDate}
                      isClockBased={selectedEmployee?.is_clock_based}
                      onInspectDay={handleInspectDay}
                      onInspectFlag={handleInspectFlag}
                    />
                  )}
```

- [ ] **Step 5: Accept the prop in both components**

In `WeekView.tsx`, add to `WeekViewProps` (after `syncByDate`):

```ts
  isClockBased?: boolean;
```

In `WeekDayView.tsx`, add the identical line to `WeekDayViewProps`.

- [ ] **Step 6: Run tests and typecheck**

```bash
npm run test:web && npx tsc --noEmit
```
Expected: PASS; `tsc` clean apart from pre-existing `TS5101`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/App.tsx src/ui/WeekView.tsx src/ui/WeekDayView.tsx src/ui/clockDayGate.test.tsx
git commit -m "fix(hr-attendance): let clock-based employees reach the week view"
```

---

### Task 6: Neutral clock-day rendering + the "Clock" chip

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeekView.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeekDayView.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/weekDayView.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/DayChips.tsx`
- Test: `dewey_time/frontend/hr_attendance/src/lib/weekDayView.test.ts` (exists — extend)
- Test: `dewey_time/frontend/hr_attendance/src/ui/DayChips.test.tsx` (create)

**Interfaces:**
- Consumes: `isClockDay` from Task 4; `isClockBased` prop from Task 5.
- Produces: `dayPipState(day, isToday, isClockBased?)` — a third optional parameter. `DayChipsProps` gains `isClockDay?: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/weekDayView.test.ts`:

```ts
test("dayPipState returns normal for a clock day, not off", () => {
  const day = { shift: { shift_assigned: false }, flags: [] } as never;
  assert.equal(dayPipState(day, false, true), "normal");
});

test("dayPipState still returns off for an unscheduled non-clock employee", () => {
  const day = { shift: { shift_assigned: false }, flags: [] } as never;
  assert.equal(dayPipState(day, false, false), "off");
});

test("dayPipState still flags a clock day that has flags", () => {
  const day = {
    shift: { shift_assigned: false },
    flags: [{ flag_code: "ATTENDANCE_ISSUE" }],
  } as never;
  assert.equal(dayPipState(day, false, true), "flagged");
});

test("holiday still wins over clock", () => {
  const day = { shift: { shift_assigned: false }, holiday: { description: "X" } } as never;
  assert.equal(dayPipState(day, false, true), "holiday");
});
```

Create `src/ui/DayChips.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DayChips } from "./DayChips";

test("renders a Clock chip on a clock day", () => {
  const html = renderToStaticMarkup(<DayChips isClockDay />);
  assert.match(html, /Clock/);
});

test("renders nothing when there is nothing to show", () => {
  const html = renderToStaticMarkup(<DayChips />);
  assert.equal(html, "");
});

test("a clock day carries no destructive styling", () => {
  const html = renderToStaticMarkup(<DayChips isClockDay />);
  assert.doesNotMatch(html, /destructive/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:web
```
Expected: FAIL — `dayPipState` takes two parameters; `DayChips` has no `isClockDay` prop.

- [ ] **Step 3: Make `dayPipState` clock-aware**

In `src/lib/weekDayView.ts`, replace `dayPipState` with:

```ts
// Matches the desktop grid's off-day rule (holiday wins; no assigned shift == off),
// except for clock-based employees, whose unscheduled days are normal working days.
export function dayPipState(
  day: Day | undefined,
  isToday: boolean,
  isClockBased?: boolean
): PipState {
  if (isToday) return "today";
  if (day?.holiday != null) return "holiday";
  const unscheduled = day?.shift?.shift_assigned !== true;
  if (unscheduled && !isClockBased) return "off";
  if ((day?.flags ?? []).length > 0) return "flagged";
  return "normal";
}
```

- [ ] **Step 4: Add the Clock chip**

In `src/ui/DayChips.tsx`, add to `DayChipsProps`:

```ts
  isClockDay?: boolean;
```

Change the early return so the chip row renders when a clock day is present:

```tsx
  if (!onLeave && !offShiftFlag && !hasAlert && !props.isClockDay) return null;
```

And add this block as the first child inside the wrapper `<div className="flex flex-wrap items-center gap-1.5">`:

```tsx
      {props.isClockDay ? (
        <AppTooltip content="Clock in/out — no schedule, no lateness rules" side="bottom">
          <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
            Clock
          </span>
        </AppTooltip>
      ) : null}
```

- [ ] **Step 5: Wire the neutral styling in WeekView**

In `WeekView.tsx`, add the import:

```ts
import { isClockDay } from "@/lib/clockDay";
```

Inside the day-header `map`, immediately after the existing `const holiday = info?.holiday ?? null;` line, add:

```tsx
          const clockDay = isClockDay(props.isClockBased, info);
```

Then change the `isOffDay` line so a clock day is not an off day:

```tsx
          const isOffDay = holiday != null || (!clockDay && info?.shift?.shift_assigned !== true);
```

Pass the chip through — replace the existing `<DayChips ... />` block with:

```tsx
                <DayChips
                  day={info}
                  alerts={props.alertsByDate.get(key) ?? []}
                  isClockDay={clockDay}
                  onInspectFlag={(flag) => props.onInspectFlag(key, flag)}
                />
```

- [ ] **Step 6: Wire the same into WeekDayView**

In `WeekDayView.tsx`, add the import:

```ts
import { isClockDay } from "@/lib/clockDay";
```

Pass `props.isClockBased` into the pip state — change the `dayPipState` call inside the pip `map`:

```tsx
          const state = dayPipState(props.daysByDate.get(key), isToday, props.isClockBased);
```

And pass the chip flag on the selected-day `DayChips`:

```tsx
        <DayChips
          day={selectedInfo}
          alerts={props.alertsByDate.get(selectedKey) ?? []}
          isClockDay={isClockDay(props.isClockBased, selectedInfo)}
          onInspectFlag={(flag) => props.onInspectFlag(selectedKey, flag)}
        />
```

- [ ] **Step 7: Run tests and typecheck**

```bash
npm run test:web && npx tsc --noEmit
```
Expected: PASS; `tsc` clean apart from pre-existing `TS5101`.

- [ ] **Step 8: Commit**

```bash
git add src/ui/WeekView.tsx src/ui/WeekDayView.tsx src/lib/weekDayView.ts src/lib/weekDayView.test.ts src/ui/DayChips.tsx src/ui/DayChips.test.tsx
git commit -m "feat(hr-attendance): neutral clock-day rendering + Clock chip"
```

---

### Task 7: Net worked hours on the clock-day cell

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeekView.tsx`
- Test: `dewey_time/frontend/hr_attendance/src/lib/clockDay.test.ts` (extend)

**Interfaces:**
- Consumes: `clockDayMinutes` from Task 4; `deriveSegments` from `@/lib/attendancePunches`.
- Produces: nothing consumed downstream — this is the last task.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/clockDay.test.ts`:

```ts
import { formatClockDayTotal } from "./clockDay";

test("formatClockDayTotal renders hours and minutes", () => {
  assert.equal(formatClockDayTotal({ minutes: 462, unverified: false }), "7h 42m");
  assert.equal(formatClockDayTotal({ minutes: 120, unverified: false }), "2h");
  assert.equal(formatClockDayTotal({ minutes: 45, unverified: false }), "45m");
});

test("formatClockDayTotal marks an unverified fallback", () => {
  assert.equal(formatClockDayTotal({ minutes: 480, unverified: true }), "~8h");
});

test("formatClockDayTotal renders nothing when there is no figure", () => {
  assert.equal(formatClockDayTotal({ minutes: null, unverified: false }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:web
```
Expected: FAIL — `formatClockDayTotal` is not exported.

- [ ] **Step 3: Implement the formatter**

Append to `src/lib/clockDay.ts`:

```ts
/**
 * Display string for a clock day's worked total. The `~` prefix marks a gross-span
 * fallback (segments were unusable), so an approximate figure never reads as exact.
 */
export function formatClockDayTotal(total: {
  minutes: number | null;
  unverified: boolean;
}): string | null {
  if (total.minutes == null) return null;
  const hours = Math.floor(total.minutes / 60);
  const mins = total.minutes % 60;
  const body = hours === 0 ? `${mins}m` : mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
  return total.unverified ? `~${body}` : body;
}
```

- [ ] **Step 4: Render it in the week cell**

In `WeekView.tsx`, add the imports:

```ts
import { clockDayMinutes, formatClockDayTotal } from "@/lib/clockDay";
import { deriveSegments } from "@/lib/segmentInspector";
```

**Use the `segmentInspector` one, not `attendancePunches`.** There are two functions with this name: `attendancePunches.ts:97` takes a `helpers` object, and `segmentInspector.ts:48` is a single-argument wrapper that supplies those helpers (`parseDateTimeLocal`, `minutesFromDateTime`, `clamp`). `DayTimeline.tsx:175` already uses the wrapper; match it. Its return type carries `minutes: number | null`, which is exactly what `clockDayMinutes` expects.

Before returning the cell JSX, inside the same `map` and after the `clockDay` line from Task 6, add:

```tsx
          const clockTotal = clockDay
            ? formatClockDayTotal(
                clockDayMinutes(deriveSegments(info?.checkins ?? []), info?.gross_minutes ?? null)
              )
            : null;
```

Then render it directly above the existing `timeRange` block, replacing:

```tsx
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {timeRange ? (
```

with:

```tsx
              {clockTotal ? (
                <div className="mt-0.5 truncate text-[10px] font-semibold tabular-nums text-foreground">
                  {clockTotal}
                </div>
              ) : null}

              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {timeRange ? (
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npm run test:web && npx tsc --noEmit
```
Expected: PASS; `tsc` clean apart from pre-existing `TS5101`.

- [ ] **Step 6: Run the e2e suite to confirm nothing regressed**

```bash
npm run test:e2e
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/WeekView.tsx src/lib/clockDay.ts src/lib/clockDay.test.ts
git commit -m "feat(hr-attendance): net worked hours on clock days"
```

---

## Verification

After all tasks, from the repo root:

```bash
python3 -m unittest discover -s dewey_time/tests -t . -v
```

From `dewey_time/frontend/hr_attendance`:

```bash
npm run test:web && npx tsc --noEmit && npm run test:e2e
```

On a bench, the authoritative backend run is:

```bash
bench --site <site> run-tests --app dewey_time
```

## Out of scope

- No self-service punch UI. Punches still arrive only from ZKTeco devices via the Bridge.
- No backfill patch. Past `OFF_SHIFT_PUNCH` rows persist; re-run `run_engine_for_employee` (`dev_tools.py`) over a window to clean a specific employee's history.
- `list_calendar_employees` still sorts shift-coverage-first, so clock-based employees sort low in the picker. The "Clock" chip makes that read as intentional. Changing the sort is a separate decision.
