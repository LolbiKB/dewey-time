# Rollout Phases — Phase A (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the flag engine a start date and a trial period, per branch — so it writes no AUTO flag for a day before its branch went live, and marks every flag written during the pilot as calibration data that can be removed wholesale.

**Architecture:** One new module, `attendance_engine/rollout.py`, owns every date comparison. Three engine entry points that already resolve `employee_branch` gain a `PRELAUNCH` guard placed *before* their deletes. The single AUTO-flag insert, `closeout._insert_flag`, stamps a new `rollout_phase` field. Two System-Manager-gated `dev_tools` endpoints purge and reconcile. Two API payloads gain the data that Phase B will render.

**Tech Stack:** Python 3.9 locally / 3.14 on the CI bench, Frappe v16, ERPNext HR (`Employee.branch` → `Branch`), `unittest` with a MagicMock installed as `frappe`.

**Spec:** `docs/superpowers/specs/2026-08-10-rollout-phases-design.md`. Phase A is defined in that spec's **Delivery** section. Phase B (the queue banner and calendar chip) is a separate plan and **must not** be touched here.

## Global Constraints

- **Phase A changes no frontend file and rebuilds no bundle.** Nothing under `dewey_time/frontend/`, `dewey_time/public/`, or `dewey_time/www/`. If a task seems to need one, stop and escalate.
- **Bump `modified` on every DocType JSON you touch** to `"2026-08-10 00:00:00.000000"`. On this repo `bench migrate` skips the schema reimport otherwise and the new fields never appear.
- **`flag_queue_api._QUEUE_CACHE_PREFIX` becomes `"flag_queue:v4"`** in the same commit that adds `rollout` to the payload. The comment at `flag_queue_api.py:40-53` makes this mandatory: a deploy does not clear Redis, so for a full TTL an old key answers new callers with a payload missing the field.
- **Unset dates must mean `LIVE`** — identical behaviour to today. A test pins this directly.
- **Both purge endpoints** call `_require_system_manager_for_clear()` and default to `dry_run=True`.
- **Never use bare `git stash` / `git stash pop`.** The stash stack is shared across worktrees and other sessions run concurrently. Use a WIP commit instead.
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
  ```
- **The local unit lane is** `python3 -m unittest discover -s dewey_time/tests -t .` from the repo root. It prints a TOTAL, not a pass count: `Ran 656 tests ... OK (skipped=11)` means 656 total, 645 passing, 11 skipped. The 11 are `test_integration_pilot_matrix` self-skipping off a real bench. Quote totals, and state each task's result as a **delta** from where that task started — fix rounds add tests, so any absolute written here drifts the moment one runs. A task is not done until the whole lane is green, not just its own module — a green module lane is not a green suite.
- **`git add` exact named paths only.** Never `git add -A` or `git add .`.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `dewey_time/attendance_engine/rollout.py` | The phase model. Sole owner of every rollout date comparison. |
| `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/__init__.py` | Empty package marker. |
| `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/dewey_time_branch_rollout.json` | Child DocType schema: branch, testing_start, go_live. |
| `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/dewey_time_branch_rollout.py` | Child controller. Empty by design — the rules live on the parent. |
| `dewey_time/tests/test_rollout.py` | Phase resolution truth table + settings validation. |

**Modify:**

| File | Change |
|---|---|
| `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json` | 4 new fields + `modified` bump. |
| `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.py` | `validate()` — three rejection rules. |
| `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json` | `rollout_phase` field + `modified` bump. |
| `dewey_time/attendance_engine/closeout.py` | Guard in `_generate_for_employee_date` and `_generate_company_fallback_for_date`; stamp in `_insert_flag`. |
| `dewey_time/attendance_engine/intraday.py` | Hoist the branch read above the delete, then guard. |
| `dewey_time/attendance_engine/dev_tools.py` | `_parse_dry_run`, `purge_testing_flags`, `reconcile_rollout_flags`. |
| `dewey_time/attendance_engine/flag_queue_api.py` | `rollout_phase` in the scan, `_rollout_block`, `v4` prefix (Task 6). |
| `dewey_time/attendance_engine/hr_calendar.py` | `rollout_phase` on each day (Task 7, with its bench test). |
| `dewey_time/tests/test_closeout.py` | Guard + stamp tests. |
| `dewey_time/tests/test_intraday.py` | Guard test. |
| `dewey_time/tests/test_dev_tools.py` | Purge endpoint tests. |
| `dewey_time/tests/test_flag_queue_api.py` | `rollout` block tests. |
| `dewey_time/tests/test_integration_pilot_matrix.py` | Real-bench verification. |

---

## The one thing that will bite you

**Every test in this suite runs against a MagicMock installed as `frappe`** (`test_closeout.py:24`, `_install_frappe_mock`). A MagicMock attribute is truthy, **and its `__lt__` returns a truthy MagicMock**.

So if `rollout._as_date` simply did `getdate(value)`, then in every existing engine test:

- `frappe.get_cached_doc("Dewey Time Settings")` → MagicMock
- `getattr(settings, "rollout_testing_start", None)` → MagicMock (truthy)
- `day < testing_start` → truthy MagicMock → **`PRELAUNCH`**

…which means the guard fires on every day, and roughly the entire engine suite goes red for a reason that has nothing to do with the code being wrong.

`_as_date`'s `isinstance` check is what prevents this. It is not defensive padding — it is load-bearing, and it is also correct in production (a non-date value cannot reach a Date field). With it, an unconfigured mock reads as "no dates set" → `LIVE` → today's behaviour, which is exactly what those tests assert.

Useful mock facts you will need:

- `frappe.utils.getdate` is `lambda value: value` — identity. Pass real `datetime.date` objects in tests.
- `frappe.model.document.Document` is a **real class** (`test_closeout.py:78-88`) whose `__init__` copies kwargs onto `__dict__`. That is what makes the settings controller directly unit-testable.
- Install the mock with `from dewey_time.tests.test_closeout import _install_frappe_mock` then `_install_frappe_mock()` at module scope, before importing any `dewey_time.attendance_engine` module. This is the idiom every test file here uses (see `test_absence_flags.py:1-9`).

---

## Task 1: The rollout module

**Files:**
- Create: `dewey_time/attendance_engine/rollout.py`
- Test: `dewey_time/tests/test_rollout.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, relied on by Tasks 3–7:
  - `rollout.PRELAUNCH` / `rollout.TESTING` / `rollout.LIVE` — the string constants `"PRELAUNCH"`, `"TESTING"`, `"LIVE"`
  - `rollout.rollout_dates_for_branch(branch: str | None) -> tuple` — `(testing_start, go_live)`, each a `datetime.date` or `None`
  - `rollout.phase_for(*, branch: str | None, attendance_date) -> str`
  - `rollout.branch_for_employee(employee: str) -> str | None`
  - `rollout.phase_for_employee(*, employee: str, attendance_date) -> str`
  - `rollout.phases_configured() -> bool`

- [ ] **Step 1: Write the failing tests**

Create `dewey_time/tests/test_rollout.py`:

```python
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


def _settings(testing_start=None, go_live=None, rows=()):
    return SimpleNamespace(
        rollout_testing_start=testing_start,
        rollout_go_live=go_live,
        branch_rollout=list(rows),
    )


def _row(branch, testing_start, go_live=None):
    return SimpleNamespace(branch=branch, testing_start=testing_start, go_live=go_live)


class TestPhaseFor(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import rollout

        self.rollout = rollout

    def _phase(self, settings, branch, day):
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=settings):
            return self.rollout.phase_for(branch=branch, attendance_date=day)

    def test_no_dates_anywhere_is_live(self):
        # The upgrade default. A migration that silently stopped the engine would be
        # far worse than one that changes nothing until an admin sets a date.
        self.assertEqual(
            self._phase(_settings(), None, date(2020, 1, 1)), self.rollout.LIVE
        )

    def test_an_unconfigured_settings_mock_is_live_not_prelaunch(self):
        # The trap this module's isinstance guard exists for: a MagicMock attribute is
        # truthy AND its __lt__ returns truthy, so without the guard every day in every
        # engine test would read PRELAUNCH.
        from unittest.mock import MagicMock

        self.assertEqual(
            self._phase(MagicMock(), "BR-A", date(2026, 8, 20)), self.rollout.LIVE
        )

    def test_before_the_global_cutoff_is_prelaunch(self):
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 9, 1))
        self.assertEqual(
            self._phase(settings, None, date(2026, 8, 14)), self.rollout.PRELAUNCH
        )

    def test_the_cutoff_day_itself_is_testing(self):
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 9, 1))
        self.assertEqual(
            self._phase(settings, None, date(2026, 8, 15)), self.rollout.TESTING
        )

    def test_the_go_live_day_itself_is_live(self):
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 9, 1))
        self.assertEqual(
            self._phase(settings, None, date(2026, 9, 1)), self.rollout.LIVE
        )

    def test_a_blank_go_live_leaves_the_pilot_open(self):
        settings = _settings(testing_start=date(2026, 8, 15))
        self.assertEqual(
            self._phase(settings, None, date(2030, 1, 1)), self.rollout.TESTING
        )

    def test_equal_dates_mean_no_pilot_window(self):
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 8, 15))
        self.assertEqual(
            self._phase(settings, None, date(2026, 8, 14)), self.rollout.PRELAUNCH
        )
        self.assertEqual(
            self._phase(settings, None, date(2026, 8, 15)), self.rollout.LIVE
        )

    def test_a_branch_row_overrides_the_global_pair(self):
        settings = _settings(
            testing_start=date(2026, 8, 15),
            go_live=date(2026, 9, 1),
            rows=[_row("BR-LATE", date(2026, 10, 1), date(2026, 11, 1))],
        )
        self.assertEqual(
            self._phase(settings, "BR-LATE", date(2026, 9, 15)), self.rollout.PRELAUNCH
        )
        self.assertEqual(
            self._phase(settings, "BR-OTHER", date(2026, 9, 15)), self.rollout.LIVE
        )

    def test_a_branch_row_is_used_whole_and_does_not_inherit_go_live(self):
        # A blank go_live on a row means "the pilot is still open for this branch",
        # NOT "fall back to the global go_live". Partial inheritance would make a
        # blank field mean two different things depending on the global config.
        settings = _settings(
            testing_start=date(2026, 8, 15),
            go_live=date(2026, 9, 1),
            rows=[_row("BR-OPEN", date(2026, 8, 15))],
        )
        self.assertEqual(
            self._phase(settings, "BR-OPEN", date(2026, 9, 15)), self.rollout.TESTING
        )

    def test_a_falsy_branch_resolves_to_the_global_pair(self):
        # hr_calendar.py:779 records that a great many employees have no branch set,
        # so this is the primary path, not an edge case.
        settings = _settings(
            testing_start=date(2026, 8, 15),
            rows=[_row("BR-A", date(2026, 10, 1))],
        )
        self.assertEqual(
            self._phase(settings, None, date(2026, 9, 1)), self.rollout.TESTING
        )
        self.assertEqual(
            self._phase(settings, "", date(2026, 9, 1)), self.rollout.TESTING
        )

    def test_string_dates_compare_correctly(self):
        # Frappe hands dates back as datetime.date from a doc field but as str from a
        # client payload; comparing the two raises rather than answering.
        settings = _settings(testing_start="2026-08-15", go_live="2026-09-01")
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=settings):
            with patch.object(self.rollout, "getdate", side_effect=_real_getdate):
                self.assertEqual(
                    self.rollout.phase_for(branch=None, attendance_date="2026-08-20"),
                    self.rollout.TESTING,
                )


class TestPhasesConfigured(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import rollout

        self.rollout = rollout

    def _configured(self, settings):
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=settings):
            return self.rollout.phases_configured()

    def test_nothing_set_is_not_configured(self):
        self.assertFalse(self._configured(_settings()))

    def test_a_global_start_is_configured(self):
        self.assertTrue(self._configured(_settings(testing_start=date(2026, 8, 15))))

    def test_a_branch_row_alone_is_configured(self):
        self.assertTrue(
            self._configured(_settings(rows=[_row("BR-A", date(2026, 8, 15))]))
        )


def _real_getdate(value):
    """The mock's getdate is identity, which cannot turn "2026-08-15" into a date.
    This is the real behaviour, needed only by the string-dates test."""
    from datetime import datetime

    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_rollout -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.rollout'`

- [ ] **Step 3: Write the module**

Create `dewey_time/attendance_engine/rollout.py`:

```python
"""Which rollout phase an employee-day belongs to.

The flag engine had no notion of when it went live: point it at any date and it
judged that day, including punches imported from the device history, from before
anyone was told the rules. This module is the single owner of every date
comparison that answers "was the system watching?".

Three phases, resolved from the day's OWN attendance_date and never from "now".
That is load-bearing, not incidental: intraday deletes and re-inserts AUTO flags
on every single checkin (intraday.on_employee_checkin_after_insert), so a phase
derived from the current date would silently re-label the whole pilot window the
moment go-live passed. Derived from attendance_date, regeneration is idempotent.
"""
from __future__ import annotations

from datetime import date as _date

import frappe
from frappe.utils import getdate

PRELAUNCH = "PRELAUNCH"
TESTING = "TESTING"
LIVE = "LIVE"

SETTINGS = "Dewey Time Settings"


def _as_date(value):
    """getdate(), but None for anything that is not date-shaped.

    The isinstance check is load-bearing, not defensive padding. Every test in this
    suite runs against a MagicMock installed as `frappe`, so an unconfigured
    `frappe.get_cached_doc(SETTINGS)` returns a MagicMock whose every attribute is
    truthy AND whose `__lt__` returns a truthy MagicMock. Without this guard such a
    mock reads as "a cutoff is set, and every date falls before it" -- every day
    PRELAUNCH, and the whole engine suite red for a reason unrelated to the code.

    With it, an unconfigured mock reads as "no dates set" = LIVE = the behaviour
    those tests already assert. It is also simply correct in production: a value
    that is neither a date nor a date string cannot have come from a Date field.

    datetime is a subclass of date, so the two-member tuple covers it.
    """
    if not isinstance(value, (_date, str)):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return getdate(value)


def _settings_doc():
    return frappe.get_cached_doc(SETTINGS)


def rollout_dates_for_branch(branch: str | None) -> tuple:
    """(testing_start, go_live) governing `branch`, normalised to dates or None.

    A branch row is used WHOLE. A row with a blank `go_live` means "the pilot is
    still open for this branch" -- it does NOT fall back to the global `go_live`.
    Partial inheritance would make a blank field mean two different things
    depending on the global config.

    A falsy branch resolves straight to the global pair, and that is the primary
    path rather than a fallback: hr_calendar.py:779 records that a great many
    employees have no branch set.
    """
    settings = _settings_doc()
    if branch:
        for row in getattr(settings, "branch_rollout", None) or []:
            if getattr(row, "branch", None) == branch:
                return (
                    _as_date(getattr(row, "testing_start", None)),
                    _as_date(getattr(row, "go_live", None)),
                )
    return (
        _as_date(getattr(settings, "rollout_testing_start", None)),
        _as_date(getattr(settings, "rollout_go_live", None)),
    )


def phase_for(*, branch: str | None, attendance_date) -> str:
    """PRELAUNCH / TESTING / LIVE for one branch-day.

    Unset dates mean LIVE -- the system behaves exactly as it did before this
    module existed. That is the only safe upgrade default.

    Boundaries, stated so there is nothing to interpret: the day equal to
    testing_start is TESTING; the day equal to go_live is LIVE.
    """
    testing_start, go_live = rollout_dates_for_branch(branch)
    if testing_start is None:
        return LIVE
    day = getdate(attendance_date)
    if day < testing_start:
        return PRELAUNCH
    if go_live is None or day < go_live:
        return TESTING
    return LIVE


def branch_for_employee(employee: str) -> str | None:
    """One reader, so the refusal path and the stamp path cannot disagree about
    which branch governs an employee."""
    return frappe.get_cached_value("Employee", employee, "branch")


def phase_for_employee(*, employee: str, attendance_date) -> str:
    return phase_for(
        branch=branch_for_employee(employee), attendance_date=attendance_date
    )


def phases_configured() -> bool:
    """Whether any rollout date is set anywhere.

    False means the feature is dormant and the system behaves exactly as it did
    before it existed -- which is what the queue payload reports so Phase B can
    render no banner at all rather than an empty one.
    """
    settings = _settings_doc()
    if _as_date(getattr(settings, "rollout_testing_start", None)):
        return True
    for row in getattr(settings, "branch_rollout", None) or []:
        if _as_date(getattr(row, "testing_start", None)):
            return True
    return False
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest dewey_time.tests.test_rollout -v`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole lane**

Run: `python3 -m unittest discover -s dewey_time/tests -t .`
Expected: **+14 tests** over the starting total, 11 skipped, 0 errors. (Actual when run: 656 → 670.)

- [ ] **Step 6: Mutation-check the isinstance guard**

Temporarily change `_as_date`'s first line to `if value is None:` and re-run the whole lane. Expected: **many failures**, including `test_an_unconfigured_settings_mock_is_live_not_prelaunch`. Revert the change and confirm green again. A guard whose removal breaks nothing is not a guard.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/rollout.py dewey_time/tests/test_rollout.py
git commit -m "$(cat <<'EOF'
feat(rollout): one module owns the question of whether the system was watching

Three phases from the day's own attendance_date, never from "now" -- intraday
re-inserts AUTO flags on every checkin, so a phase read from the current date
would re-label the whole pilot window the moment go-live passed.

_as_date's isinstance check is load-bearing. This suite installs a MagicMock as
frappe, whose attributes are truthy and whose __lt__ returns truthy, so an
unconfigured settings mock would otherwise read as "a cutoff is set and every
date precedes it" -- every day PRELAUNCH, the engine suite red for no reason.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 2: The configuration DocTypes

**Files:**
- Create: `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/__init__.py`
- Create: `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/dewey_time_branch_rollout.json`
- Create: `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/dewey_time_branch_rollout.py`
- Modify: `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json`
- Modify: `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.py`
- Test: `dewey_time/tests/test_rollout.py` (append)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime — the fields this task creates are the ones `rollout.rollout_dates_for_branch` already reads by `getattr` with a `None` default.
- Produces: the `Dewey Time Settings` fields `rollout_testing_start`, `rollout_go_live`, `branch_rollout` (Table of `Dewey Time Branch Rollout`, rows carrying `branch` / `testing_start` / `go_live`), and `DeweyTimeSettings.validate()`.

- [ ] **Step 1: Write the failing validation tests**

Append to `dewey_time/tests/test_rollout.py`:

```python
class TestSettingsValidation(unittest.TestCase):
    """The controller is directly testable because frappe.model.document.Document is a
    REAL class in this suite's mock (test_closeout.py:78-88), whose __init__ copies
    kwargs onto __dict__. Construct with every field the validator reads."""

    def _doc(self, testing_start=None, go_live=None, rows=()):
        from dewey_time.dewey_time.doctype.dewey_time_settings.dewey_time_settings import (
            DeweyTimeSettings,
        )

        return DeweyTimeSettings(
            rollout_testing_start=testing_start,
            rollout_go_live=go_live,
            branch_rollout=list(rows),
        )

    def test_a_valid_config_passes(self):
        self._doc(date(2026, 8, 15), date(2026, 9, 1)).validate()

    def test_an_empty_config_passes(self):
        self._doc().validate()

    def test_a_go_live_without_a_testing_start_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            self._doc(None, date(2026, 9, 1)).validate()
        self.assertIn("testing start date", str(caught.exception))

    def test_a_reversed_global_pair_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            self._doc(date(2026, 9, 1), date(2026, 8, 15)).validate()
        self.assertIn("global", str(caught.exception))

    def test_a_reversed_branch_pair_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            self._doc(rows=[_row("BR-A", date(2026, 9, 1), date(2026, 8, 15))]).validate()
        self.assertIn("BR-A", str(caught.exception))

    def test_a_duplicate_branch_row_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            self._doc(
                rows=[
                    _row("BR-A", date(2026, 8, 15)),
                    _row("BR-A", date(2026, 9, 1)),
                ]
            ).validate()
        self.assertIn("twice", str(caught.exception))

    def test_a_branch_row_with_a_blank_go_live_passes(self):
        self._doc(rows=[_row("BR-A", date(2026, 8, 15))]).validate()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_rollout -v`
Expected: FAIL — `AttributeError: 'DeweyTimeSettings' object has no attribute 'validate'` on every test in the new class except the two that expect success (those fail the same way).

- [ ] **Step 3: Write the child DocType**

Create `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/__init__.py` as an **empty file**.

Create `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/dewey_time_branch_rollout.json`:

```json
{
 "actions": [],
 "allow_rename": 0,
 "creation": "2026-08-10 00:00:00.000000",
 "custom": 1,
 "doctype": "DocType",
 "editable_grid": 1,
 "engine": "InnoDB",
 "field_order": [
  "branch",
  "testing_start",
  "go_live"
 ],
 "fields": [
  {
   "columns": 4,
   "fieldname": "branch",
   "fieldtype": "Link",
   "in_list_view": 1,
   "label": "Branch",
   "options": "Branch",
   "reqd": 1
  },
  {
   "columns": 3,
   "description": "The cutoff. Before this date the engine writes no AUTO flags for this branch.",
   "fieldname": "testing_start",
   "fieldtype": "Date",
   "in_list_view": 1,
   "label": "Testing Start",
   "reqd": 1
  },
  {
   "columns": 3,
   "description": "Blank means the pilot is still open for this branch. This row does not inherit the global go-live.",
   "fieldname": "go_live",
   "fieldtype": "Date",
   "in_list_view": 1,
   "label": "Go Live"
  }
 ],
 "index_web_pages_for_search": 0,
 "istable": 1,
 "links": [],
 "modified": "2026-08-10 00:00:00.000000",
 "modified_by": "Administrator",
 "module": "Dewey Time",
 "name": "Dewey Time Branch Rollout",
 "owner": "Administrator",
 "permissions": [],
 "sort_field": "modified",
 "sort_order": "DESC",
 "states": [],
 "track_changes": 0
}
```

Create `dewey_time/dewey_time/doctype/dewey_time_branch_rollout/dewey_time_branch_rollout.py`:

```python
from frappe.model.document import Document


class DeweyTimeBranchRollout(Document):
    """Empty by design. Cross-row rules (duplicates, ordering) need the whole table
    at once, so they live on the parent's validate()."""

    pass
```

- [ ] **Step 4: Add the Settings fields**

In `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json`:

Append these four entries to `field_order`, after `"landing_workspace_snapshot"`:

```json
    "rollout_section",
    "rollout_testing_start",
    "rollout_go_live",
    "branch_rollout"
```

Append these four objects to the `fields` array:

```json
    {
      "fieldname": "rollout_section",
      "fieldtype": "Section Break",
      "label": "Attendance Rollout"
    },
    {
      "fieldname": "rollout_testing_start",
      "fieldtype": "Date",
      "label": "Testing Start",
      "description": "The cutoff. Before this date the engine writes no AUTO flags. Blank means no cutoff — every day is treated as live, exactly as before this feature existed."
    },
    {
      "fieldname": "rollout_go_live",
      "fieldtype": "Date",
      "label": "Go Live",
      "description": "Flags dated on or after this day are the official record. Blank with a testing start set means the pilot is still open."
    },
    {
      "fieldname": "branch_rollout",
      "fieldtype": "Table",
      "label": "Branch Rollout",
      "options": "Dewey Time Branch Rollout",
      "description": "Branches that roll out on their own timetable. A row is used whole and does not inherit the global dates field-by-field."
    }
```

Change the top-level `"modified"` from `"2026-06-21 00:00:00.000000"` to `"2026-08-10 00:00:00.000000"`.

- [ ] **Step 5: Write the validator**

Replace the whole of `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.py`:

```python
import frappe
from frappe.model.document import Document
from frappe.utils import getdate


def _throw_if_reversed(*, scope, testing_start, go_live):
    if testing_start and go_live and getdate(testing_start) > getdate(go_live):
        frappe.throw(f"Testing start cannot be after go-live ({scope}).")


class DeweyTimeSettings(Document):
    def validate(self):
        self._validate_rollout_dates()

    def _validate_rollout_dates(self):
        """Reject the three ways a rollout config can be incoherent.

        A pilot that ends without starting is the interesting one: `testing_start`
        is the cutoff, so a `go_live` without it would end a period that never
        began and leave no cutoff at all. A branch that should skip the pilot sets
        the two dates equal instead.
        """
        if self.rollout_go_live and not self.rollout_testing_start:
            frappe.throw("Set a testing start date before setting a go-live date.")

        _throw_if_reversed(
            scope="global",
            testing_start=self.rollout_testing_start,
            go_live=self.rollout_go_live,
        )

        seen = set()
        for row in self.branch_rollout or []:
            if row.branch in seen:
                frappe.throw(f"Branch {row.branch} appears twice in the rollout table.")
            seen.add(row.branch)
            _throw_if_reversed(
                scope=row.branch,
                testing_start=row.testing_start,
                go_live=row.go_live,
            )
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 -m unittest dewey_time.tests.test_rollout -v`
Expected: PASS, 21 tests.

- [ ] **Step 7: Run the whole lane**

Run: `python3 -m unittest discover -s dewey_time/tests -t .`
Expected: **+7 tests** over the starting total, 11 skipped, 0 errors. (Actual when run: 674 → 681, the start being higher than this plan first guessed because Task 1's fix round added 4.)

- [ ] **Step 8: Commit**

```bash
git add dewey_time/dewey_time/doctype/dewey_time_branch_rollout \
        dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json \
        dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.py \
        dewey_time/tests/test_rollout.py
git commit -m "$(cat <<'EOF'
feat(rollout): somewhere to put the dates, and three ways to get them wrong

A global pair on Dewey Time Settings plus a per-branch child table. Global is
the primary path, not the fallback: hr_calendar.py:779 records that a great many
employees have no branch set at all.

Rejected: a go-live with no testing start (it would end a period that never
began and leave no cutoff), a reversed pair at either scope, and a branch named
twice. A branch that should skip the pilot sets the two dates equal.

modified bumped on both JSONs -- bench migrate skips the reimport otherwise and
the fields never appear.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 3: The engine refuses a pre-cutoff day

**Files:**
- Modify: `dewey_time/attendance_engine/closeout.py` (`_generate_for_employee_date` ~486-500, `_generate_company_fallback_for_date` ~265-275)
- Modify: `dewey_time/attendance_engine/intraday.py:81-93`
- Test: `dewey_time/tests/test_closeout.py` (append), `dewey_time/tests/test_intraday.py` (append)

**Interfaces:**
- Consumes: `rollout.phase_for(branch=..., attendance_date=...)`, `rollout.PRELAUNCH` from Task 1.
- Produces: the guarantee Task 4 depends on — `_insert_flag` never observes a `PRELAUNCH` day, which is why `rollout_phase` has only two options.

**Why before the delete:** `_delete_auto_flags_for_employee_date` carries the delivery-marker protection added in #148 (`exclude_names`, sparing `DELIVERY_FAILED` and the `delivery_failed` variant of `ATTENDANCE_ISSUE`). Running it on a day the engine has no opinion about re-opens exactly the question that fix closed. Removal of pre-cutoff rows gets one owner instead — `reconcile_rollout_flags` in Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_closeout.py`:

```python
class TestPrelaunchGuard(unittest.TestCase):
    """A day before the branch's cutoff earns no flags and loses none."""

    def _run_closeout(self, phase):
        from dewey_time.attendance_engine import closeout

        employee_doc = MagicMock()
        employee_doc.branch = "BR-A"
        # None, not a real company: a truthy company sends the LIVE control path
        # through holiday_by_date_for_company, which is not what this test is about.
        employee_doc.company = None
        with patch.object(closeout.frappe, "get_cached_doc", return_value=employee_doc), patch.object(
            closeout.rollout, "phase_for", return_value=phase
        ), patch.object(
            closeout, "_delete_auto_flags_for_employee_date"
        ) as delete, patch.object(
            closeout, "_insert_flags"
        ) as insert, patch.object(
            closeout, "should_skip_absence_flags", return_value=False
        ), patch.object(
            closeout, "_get_shift_assignment", return_value=None
        ):
            closeout._generate_for_employee_date(
                employee="EMP-1", attendance_date=date(2026, 8, 1)
            )
        return delete, insert

    def test_prelaunch_writes_nothing_and_deletes_nothing(self):
        from dewey_time.attendance_engine import rollout

        delete, insert = self._run_closeout(rollout.PRELAUNCH)
        delete.assert_not_called()
        insert.assert_not_called()

    def test_a_live_day_still_reaches_the_delete(self):
        # The control. Without it, a guard that always returned early would pass
        # the test above and this suite would be asserting nothing.
        from dewey_time.attendance_engine import rollout

        delete, _insert = self._run_closeout(rollout.LIVE)
        self.assertTrue(delete.called)


class TestCompanyFallbackPrelaunchGuard(unittest.TestCase):
    def _run_fallback(self, phase):
        from dewey_time.attendance_engine import closeout

        employee_doc = MagicMock()
        employee_doc.branch = "BR-A"
        with patch.object(closeout.frappe, "get_all", return_value=["EMP-1"]), patch.object(
            closeout.frappe, "get_cached_doc", return_value=employee_doc
        ), patch.object(
            closeout.rollout, "phase_for", return_value=phase
        ), patch.object(
            closeout, "has_open_device_closeout_alert", return_value=False
        ), patch.object(
            closeout, "_get_shift_assignment", return_value={"shift_type": "S1"}
        ) as shift:
            closeout._generate_company_fallback_for_date(
                company="CO-A", attendance_date=date(2026, 8, 1)
            )
        return shift

    def test_prelaunch_skips_the_employee_before_any_work(self):
        from dewey_time.attendance_engine import rollout

        shift = self._run_fallback(rollout.PRELAUNCH)
        shift.assert_not_called()

    def test_a_live_day_still_reads_the_shift(self):
        from dewey_time.attendance_engine import rollout

        shift = self._run_fallback(rollout.LIVE)
        self.assertTrue(shift.called)
```

Append to `dewey_time/tests/test_intraday.py`:

```python
class TestIntradayPrelaunchGuard(unittest.TestCase):
    def _run(self, phase):
        from dewey_time.attendance_engine import intraday

        employee_doc = MagicMock()
        employee_doc.branch = "BR-A"
        employee_doc.company = None
        with patch.object(intraday.frappe, "get_cached_doc", return_value=employee_doc), patch.object(
            intraday.rollout, "phase_for", return_value=phase
        ), patch.object(
            intraday, "_delete_auto_flags_for_employee_date"
        ) as delete, patch.object(
            intraday, "_get_shift_assignment", return_value=None
        ):
            intraday.refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 8, 1))
        return delete

    def test_prelaunch_does_not_reach_the_delete(self):
        # The delete used to be the first statement in this function. If the guard is
        # placed after it, this test fails -- which is the whole point of it.
        from dewey_time.attendance_engine import rollout

        self.assertFalse(self._run(rollout.PRELAUNCH).called)

    def test_a_live_day_still_deletes(self):
        from dewey_time.attendance_engine import rollout

        self.assertTrue(self._run(rollout.LIVE).called)
```

If `test_intraday.py` does not already import `date`, `MagicMock` and `patch`, add them to its existing import block.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_closeout dewey_time.tests.test_intraday -v`
Expected: FAIL — `AttributeError: module 'dewey_time.attendance_engine.closeout' has no attribute 'rollout'`.

- [ ] **Step 3: Guard the closeout core**

In `dewey_time/attendance_engine/closeout.py`, add to the imports:

```python
from dewey_time.attendance_engine import rollout
```

In `_generate_for_employee_date`, immediately after the `employee_company = getattr(employee_doc, "company", None)` line and **before** the `skip_absence = should_skip_absence_flags(...)` block:

```python
    # PRELAUNCH means the system was not watching this day, so there is nothing to
    # say about it and nothing to take back.
    #
    # Returning BEFORE the deletes below is the deliberate part.
    # _delete_auto_flags_for_employee_date carries the delivery-marker protection
    # added in #148, and running it on a day the engine has no opinion about would
    # re-open exactly the question that fix closed -- whether an ops record saying
    # "this device never delivered" survives a wipe -- in a context where the
    # answer is genuinely unclear. Removal of pre-cutoff rows has one owner
    # instead: dev_tools.reconcile_rollout_flags.
    if (
        rollout.phase_for(branch=employee_branch, attendance_date=attendance_date)
        == rollout.PRELAUNCH
    ):
        return
```

In `_generate_company_fallback_for_date`, immediately after
`employee_branch = getattr(employee_doc, "branch", None)` inside the loop:

```python
        # continue, not return: this is a per-employee loop over one company, and
        # branches inside it can be in different phases.
        if (
            rollout.phase_for(branch=employee_branch, attendance_date=attendance_date)
            == rollout.PRELAUNCH
        ):
            continue
```

- [ ] **Step 4: Hoist the branch read above the intraday delete, then guard**

In `dewey_time/attendance_engine/intraday.py`, add to the imports:

```python
from dewey_time.attendance_engine import rollout
```

Replace the opening of `refresh_intraday_flags_for_employee_date` — currently the `_delete_auto_flags_for_employee_date(...)` call followed by the three `employee_doc` lines — with:

```python
def refresh_intraday_flags_for_employee_date(employee: str, attendance_date):
    attendance_date = getdate(attendance_date)

    # Hoisted above the delete, which used to be this function's first statement.
    # The guard has to run before the delete, and the guard needs the branch. All
    # three reads are side-effect free, so for any non-PRELAUNCH day the observable
    # behaviour is unchanged.
    employee_doc = frappe.get_cached_doc("Employee", employee)
    employee_branch = getattr(employee_doc, "branch", None)
    employee_company = getattr(employee_doc, "company", None)

    # Before this branch's cutoff the engine has no opinion about the day. See the
    # matching guard in closeout._generate_for_employee_date for why this returns
    # before the delete rather than after it.
    if (
        rollout.phase_for(branch=employee_branch, attendance_date=attendance_date)
        == rollout.PRELAUNCH
    ):
        return

    _delete_auto_flags_for_employee_date(
        employee=employee,
        attendance_date=attendance_date,
        day_closed=0,
        flag_codes=INTRADAY_FLAG_CODES,
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m unittest dewey_time.tests.test_closeout dewey_time.tests.test_intraday -v`
Expected: PASS.

- [ ] **Step 6: Run the whole lane**

Run: `python3 -m unittest discover -s dewey_time/tests -t .`
Expected: **+6 tests** over the starting total, 11 skipped, 0 errors. (Actual when run: 684 → 690.)

If anything outside the new classes fails, the likely cause is a test whose `frappe.get_cached_doc` mock now also answers the settings read. Check `_as_date` is rejecting MagicMocks before assuming the guard is wrong.

- [ ] **Step 7: Mutation-check each guard**

One at a time, delete a guard, run the whole lane, confirm a failure, restore it:

| Mutation | Must fail |
|---|---|
| Remove the `_generate_for_employee_date` guard | `test_prelaunch_writes_nothing_and_deletes_nothing` |
| Move the intraday guard to *after* the delete | `test_prelaunch_does_not_reach_the_delete` |
| Remove the company-fallback guard | `test_prelaunch_skips_the_employee_before_any_work` |

Confirm the lane is green again before committing.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/attendance_engine/closeout.py \
        dewey_time/attendance_engine/intraday.py \
        dewey_time/tests/test_closeout.py \
        dewey_time/tests/test_intraday.py
git commit -m "$(cat <<'EOF'
feat(rollout): the engine declines to judge a day it was not watching

Three entry points, each already holding employee_branch, return early on
PRELAUNCH. The intraday one needed the branch read hoisted above the delete that
used to be its first statement.

Every guard returns BEFORE the delete. _delete_auto_flags_for_employee_date
carries #148's delivery-marker protection, and running it on a day the engine
has no opinion about would re-open that question where the answer is unclear.
reconcile_rollout_flags owns removal of pre-cutoff rows instead.

Each guard is mutation-checked: removed, lane run, failure confirmed, restored.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 4: Every flag records its phase

**Files:**
- Modify: `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json`
- Modify: `dewey_time/attendance_engine/closeout.py:809-826` (`_insert_flag`)
- Test: `dewey_time/tests/test_closeout.py` (append)

**Interfaces:**
- Consumes: `rollout.phase_for_employee(employee=..., attendance_date=...)` from Task 1; the Task 3 guarantee that `_insert_flag` never sees a `PRELAUNCH` day.
- Produces: the `Attendance Flag.rollout_phase` column that Tasks 5 and 6 read.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_closeout.py`:

```python
class TestInsertFlagStampsPhase(unittest.TestCase):
    """_insert_flag (closeout.py:809) is the sole insert for every AUTO flag in the
    app -- _insert_flags routes to it, and so do closeout.py:301 and
    intraday.py:136,176,194. Stamping here is what makes it impossible for a call
    site added later to forget the field."""

    def _inserted_doc(self, phase):
        from dewey_time.attendance_engine import closeout

        with patch.object(closeout.frappe, "get_doc") as get_doc, patch.object(
            closeout.rollout, "phase_for_employee", return_value=phase
        ):
            closeout._insert_flag(
                employee="EMP-1",
                company="CO-A",
                attendance_date=date(2026, 8, 20),
                flag_code="LATE_START",
                evidence={},
            )
        return get_doc.call_args[0][0]

    def test_a_pilot_window_flag_is_stamped_testing(self):
        from dewey_time.attendance_engine import rollout

        self.assertEqual(
            self._inserted_doc(rollout.TESTING)["rollout_phase"], "TESTING"
        )

    def test_a_post_launch_flag_is_stamped_live(self):
        from dewey_time.attendance_engine import rollout

        self.assertEqual(self._inserted_doc(rollout.LIVE)["rollout_phase"], "LIVE")

    def test_the_phase_comes_from_the_flags_own_date_not_from_today(self):
        # The property that makes regeneration idempotent. intraday re-inserts AUTO
        # flags on EVERY checkin, so a phase read from the current date would
        # re-label the whole pilot window the moment go-live passed.
        from dewey_time.attendance_engine import closeout

        with patch.object(closeout.frappe, "get_doc"), patch.object(
            closeout.rollout, "phase_for_employee"
        ) as phase_for_employee:
            closeout._insert_flag(
                employee="EMP-1",
                company="CO-A",
                attendance_date=date(2026, 8, 20),
                flag_code="LATE_START",
                evidence={},
            )
        self.assertEqual(
            phase_for_employee.call_args.kwargs["attendance_date"], date(2026, 8, 20)
        )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_closeout -v`
Expected: FAIL — `KeyError: 'rollout_phase'`.

- [ ] **Step 3: Add the field to the DocType**

In `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json`:

Insert `"rollout_phase"` into `field_order` immediately after `"rule_version"` and before `"evidence"`.

Insert this object into the `fields` array:

```json
  {
   "fieldname": "rollout_phase",
   "fieldtype": "Select",
   "label": "Rollout Phase",
   "options": "\nTESTING\nLIVE",
   "read_only": 1,
   "search_index": 1,
   "description": "TESTING means this flag was written inside a pilot window and is calibration data. Blank means it predates rollout phases and is read as LIVE."
  }
```

`PRELAUNCH` is deliberately absent. By construction no flag can carry it — Task 3's guards mean `_insert_flag` never sees such a day — and offering the value would invite a row that contradicts the engine. The leading `\n` in `options` makes blank a legal stored value, which every pre-existing row already has.

Change the top-level `"modified"` from `"2026-08-05 12:00:00.000000"` to `"2026-08-10 00:00:00.000000"`.

- [ ] **Step 4: Stamp it**

In `dewey_time/attendance_engine/closeout.py`, in `_insert_flag`'s doc dict, add after the `"rule_version": "v0",` line:

```python
            # Derived from THIS flag's attendance_date, never from today. AUTO flags
            # are deleted and re-inserted on every checkin, so a phase read from the
            # current date would re-label the entire pilot window the moment go-live
            # passed. Only TESTING or LIVE can appear: the PRELAUNCH guards upstream
            # mean this function never runs for a pre-cutoff day.
            "rollout_phase": rollout.phase_for_employee(
                employee=employee, attendance_date=attendance_date
            ),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m unittest dewey_time.tests.test_closeout -v`
Expected: PASS.

- [ ] **Step 6: Run the whole lane**

Run: `python3 -m unittest discover -s dewey_time/tests -t .`
Expected: **+3 tests** over the starting total, plus the extra argument-pinning test the controller adds in dispatch, 11 skipped, 0 errors. (Actual when run: 690 → 694.)

- [ ] **Step 7: Commit**

```bash
git add dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json \
        dewey_time/attendance_engine/closeout.py \
        dewey_time/tests/test_closeout.py
git commit -m "$(cat <<'EOF'
fix(rollout): a flag says which phase it was written in, and keeps saying it

_insert_flag is the sole insert for every AUTO flag in the app, so stamping
there means a call site added later cannot forget the field.

The phase comes from the flag's own attendance_date, never from today. AUTO
flags are deleted and re-inserted on every checkin; read from the current date,
the whole pilot window would silently become LIVE the moment go-live passed.

Select carries only TESTING and LIVE. PRELAUNCH is unreachable by construction
and offering it would invite a row that contradicts the engine.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 5: The purge and the reconcile

**Files:**
- Modify: `dewey_time/attendance_engine/dev_tools.py`
- Test: `dewey_time/tests/test_dev_tools.py` (append)

**Interfaces:**
- Consumes: `rollout.phase_for`, `rollout.PRELAUNCH`, `rollout.TESTING` from Task 1; the `rollout_phase` column from Task 4.
- Produces:
  - `purge_testing_flags(branch=None, dry_run=1) -> dict` with keys `scanned`, `deleted`, `by_branch`, `dry_run`
  - `reconcile_rollout_flags(branch=None, dry_run=1) -> dict` with keys `scanned`, `deleted`, `restamped`, `by_branch`, `dry_run`

Both are backend-only. **Do not add a button, dialog, or hook** — punch-list item T1-5 was specifically a finding about destructive controls being too visible in the SPA.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_dev_tools.py`:

```python
class TestParseDryRun(unittest.TestCase):
    def test_string_forms_behave_as_the_booleans_they_name(self):
        from dewey_time.attendance_engine.dev_tools import _parse_dry_run

        # dry_run arrives as a STRING over HTTP, where "0" is truthy.
        self.assertFalse(_parse_dry_run("0"))
        self.assertTrue(_parse_dry_run("1"))
        self.assertFalse(_parse_dry_run(0))
        self.assertTrue(_parse_dry_run(True))

    def test_absent_defaults_to_a_dry_run(self):
        from dewey_time.attendance_engine.dev_tools import _parse_dry_run

        self.assertTrue(_parse_dry_run(None))


class TestPurgeTestingFlags(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import dev_tools

        self.dev_tools = dev_tools
        self.rows = [
            {"name": "F1", "employee": "EMP-1"},
            {"name": "F2", "employee": "EMP-2"},
        ]
        self.branches = {"EMP-1": "BR-A", "EMP-2": "BR-B"}

    def _run(self, **kwargs):
        with patch.object(self.dev_tools, "_require_system_manager_for_clear"), patch.object(
            self.dev_tools.frappe, "get_all", return_value=list(self.rows)
        ), patch.object(
            self.dev_tools, "_branch_by_employee", return_value=self.branches
        ), patch.object(
            self.dev_tools.frappe.db, "delete"
        ) as delete, patch.object(
            self.dev_tools.frappe.db, "commit"
        ):
            result = self.dev_tools.purge_testing_flags(**kwargs)
        return result, delete

    def test_a_dry_run_reports_but_deletes_nothing(self):
        result, delete = self._run(dry_run=1)
        self.assertEqual(result["scanned"], 2)
        self.assertEqual(result["deleted"], 0)
        self.assertTrue(result["dry_run"])
        delete.assert_not_called()

    def test_a_wet_run_deletes_what_it_scanned(self):
        result, delete = self._run(dry_run=0)
        self.assertEqual(result["deleted"], 2)
        self.assertTrue(delete.called)

    def test_a_branch_scope_narrows_the_set(self):
        result, _delete = self._run(branch="BR-A", dry_run=1)
        self.assertEqual(result["scanned"], 1)
        self.assertEqual(result["by_branch"], {"BR-A": 1})

    def test_it_refuses_without_system_manager(self):
        with patch.object(
            self.dev_tools,
            "_require_system_manager_for_clear",
            side_effect=Exception("nope"),
        ):
            with self.assertRaises(Exception):
                self.dev_tools.purge_testing_flags(dry_run=0)

    def test_it_only_ever_scans_auto_flags(self):
        # An HR-created flag on a pre-cutoff day is a deliberate human act. Without
        # this assertion, dropping the source filter is a mutation no test catches.
        with patch.object(self.dev_tools, "_require_system_manager_for_clear"), patch.object(
            self.dev_tools.frappe, "get_all", return_value=[]
        ) as get_all, patch.object(
            self.dev_tools, "_branch_by_employee", return_value={}
        ):
            self.dev_tools.purge_testing_flags(dry_run=1)
        self.assertEqual(get_all.call_args.kwargs["filters"]["source"], "AUTO")


class TestReconcileRolloutFlags(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import dev_tools, rollout

        self.dev_tools = dev_tools
        self.rollout = rollout
        self.rows = [
            # Before the cutoff -> must be deleted.
            {
                "name": "F-OLD",
                "employee": "EMP-1",
                "attendance_date": date(2026, 1, 1),
                "rollout_phase": "LIVE",
            },
            # Inside the pilot, stamped blank by pre-feature code -> must be restamped.
            {
                "name": "F-PILOT",
                "employee": "EMP-1",
                "attendance_date": date(2026, 8, 20),
                "rollout_phase": None,
            },
            # Already correct -> must be left alone.
            {
                "name": "F-OK",
                "employee": "EMP-1",
                "attendance_date": date(2026, 9, 10),
                "rollout_phase": "LIVE",
            },
        ]

    def _phase(self, *, branch, attendance_date):
        if attendance_date < date(2026, 8, 15):
            return self.rollout.PRELAUNCH
        if attendance_date < date(2026, 9, 1):
            return self.rollout.TESTING
        return self.rollout.LIVE

    def _run(self, **kwargs):
        with patch.object(self.dev_tools, "_require_system_manager_for_clear"), patch.object(
            self.dev_tools.frappe, "get_all", return_value=list(self.rows)
        ), patch.object(
            self.dev_tools, "_branch_by_employee", return_value={"EMP-1": "BR-A"}
        ), patch.object(
            self.dev_tools.rollout, "phase_for", side_effect=self._phase
        ), patch.object(
            self.dev_tools.frappe.db, "delete"
        ) as delete, patch.object(
            self.dev_tools.frappe.db, "set_value"
        ) as set_value, patch.object(
            self.dev_tools.frappe.db, "commit"
        ):
            result = self.dev_tools.reconcile_rollout_flags(**kwargs)
        return result, delete, set_value

    def test_a_dry_run_counts_both_actions_and_performs_neither(self):
        result, delete, set_value = self._run(dry_run=1)
        self.assertEqual(result["scanned"], 3)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["restamped"], 1)
        delete.assert_not_called()
        set_value.assert_not_called()

    def test_a_wet_run_drops_pre_cutoff_rows_and_restamps_the_rest(self):
        result, delete, set_value = self._run(dry_run=0)
        self.assertEqual(delete.call_args[0][1], {"name": ["in", ["F-OLD"]]})
        self.assertEqual(set_value.call_count, 1)
        self.assertEqual(set_value.call_args[0][1], "F-PILOT")
        self.assertEqual(set_value.call_args[0][3], "TESTING")
        self.assertEqual(result["restamped"], 1)

    def test_an_already_correct_row_is_left_alone(self):
        _result, _delete, set_value = self._run(dry_run=0)
        restamped = [call[0][1] for call in set_value.call_args_list]
        self.assertNotIn("F-OK", restamped)

    def test_a_transferred_employee_is_judged_by_their_current_branch(self):
        # Stated behaviour, not an accident: a flag does not store the branch it was
        # written under, so reconcile can only read Employee.branch as it stands now.
        with patch.object(self.dev_tools, "_require_system_manager_for_clear"), patch.object(
            self.dev_tools.frappe, "get_all", return_value=[self.rows[1]]
        ), patch.object(
            self.dev_tools, "_branch_by_employee", return_value={"EMP-1": "BR-MOVED"}
        ), patch.object(
            self.dev_tools.rollout, "phase_for", side_effect=self._phase
        ) as phase_for, patch.object(
            self.dev_tools.frappe.db, "set_value"
        ), patch.object(
            self.dev_tools.frappe.db, "commit"
        ):
            self.dev_tools.reconcile_rollout_flags(dry_run=0)
        self.assertEqual(phase_for.call_args.kwargs["branch"], "BR-MOVED")
```

If `test_dev_tools.py` does not already import `date`, add `from datetime import date` to its import block.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_dev_tools -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_parse_dry_run'`.

- [ ] **Step 3: Write the endpoints**

In `dewey_time/attendance_engine/dev_tools.py`, add to the imports:

```python
from dewey_time.attendance_engine import rollout
from dewey_time.attendance_engine.flag_decision_api import _branch_by_employee
```

Append to the end of the file:

```python
def _parse_dry_run(value) -> bool:
    """dry_run arrives as a STRING over HTTP, where "0" is truthy.

    Absent means True. The safe reading of a missing or unparseable value on a
    destructive endpoint is "do not delete anything".
    """
    if value is None:
        return True
    return _parse_confirm(value)


def _scoped_auto_flags(*, fields, extra_filters=None, branch=None):
    """AUTO flags plus their employees' branches, optionally narrowed to one branch.

    source == "AUTO" throughout: an HR-created flag on a pre-cutoff day is a
    deliberate human act and is never auto-deleted, never stamped, never counted.
    """
    filters = {"source": "AUTO"}
    if extra_filters:
        filters.update(extra_filters)
    rows = (
        frappe.get_all(
            "Attendance Flag",
            filters=filters,
            fields=fields,
            limit_page_length=0,
        )
        or []
    )
    branch_by_employee = _branch_by_employee({row["employee"] for row in rows})
    if branch:
        rows = [
            row for row in rows if branch_by_employee.get(row["employee"]) == branch
        ]
    return rows, branch_by_employee


@frappe.whitelist()
def purge_testing_flags(branch=None, dry_run=1):
    """Delete every AUTO flag written inside a pilot window.

    The "remove the trial data" operation: run it once a branch is confidently live
    and its calibration flags have served their purpose.

    Backend-only on purpose. No button, no dialog -- punch-list item T1-5 was a
    finding about destructive controls being too visible in the SPA.

    Purged flags leave their Attendance Flag Decision rows pointing at nothing.
    That is already a state the queue reports (flag_grouping._orphans), and it is
    the honest outcome: the decision was practice, and so was the flag.
    """
    _require_system_manager_for_clear()
    dry_run = _parse_dry_run(dry_run)

    rows, branch_by_employee = _scoped_auto_flags(
        fields=["name", "employee"],
        extra_filters={"rollout_phase": rollout.TESTING},
        branch=branch,
    )

    by_branch = defaultdict(int)
    for row in rows:
        by_branch[branch_by_employee.get(row["employee"]) or ""] += 1

    if not dry_run and rows:
        frappe.db.delete("Attendance Flag", {"name": ["in", [r["name"] for r in rows]]})
        frappe.db.commit()

    return {
        "scanned": len(rows),
        "deleted": 0 if dry_run else len(rows),
        "by_branch": dict(by_branch),
        "dry_run": dry_run,
    }


@frappe.whitelist()
def reconcile_rollout_flags(branch=None, dry_run=1):
    """Make the flag table agree with the current rollout configuration.

    Two actions, per AUTO flag, computed from its own (employee's branch,
    attendance_date): a PRELAUNCH row is deleted, and any other row whose stored
    rollout_phase disagrees is restamped.

    This is the single owner of pre-cutoff removal. The engine's guards return
    before their deletes precisely so that policy lives in one place, which means
    running this is a step of setting or moving a date, not optional cleanup.

    An employee who has changed branch is judged by their CURRENT one -- a flag
    does not store the branch it was written under. Denormalising branch onto every
    flag to fix that would cost a column and a backfill to correct a case that
    arises only when someone transfers during a rollout window.
    """
    _require_system_manager_for_clear()
    dry_run = _parse_dry_run(dry_run)

    rows, branch_by_employee = _scoped_auto_flags(
        fields=["name", "employee", "attendance_date", "rollout_phase"],
        branch=branch,
    )

    to_delete = []
    to_restamp = []
    by_branch = defaultdict(lambda: {"deleted": 0, "restamped": 0})

    for row in rows:
        employee_branch = branch_by_employee.get(row["employee"])
        phase = rollout.phase_for(
            branch=employee_branch, attendance_date=row["attendance_date"]
        )
        key = employee_branch or ""
        if phase == rollout.PRELAUNCH:
            to_delete.append(row["name"])
            by_branch[key]["deleted"] += 1
        elif (row.get("rollout_phase") or None) != phase:
            to_restamp.append((row["name"], phase))
            by_branch[key]["restamped"] += 1

    if not dry_run:
        if to_delete:
            frappe.db.delete("Attendance Flag", {"name": ["in", to_delete]})
        for name, phase in to_restamp:
            # update_modified=False: a bulk backfill should not churn every row's
            # timestamp and make the whole table look freshly edited.
            frappe.db.set_value(
                "Attendance Flag", name, "rollout_phase", phase, update_modified=False
            )
        frappe.db.commit()

    return {
        "scanned": len(rows),
        "deleted": len(to_delete),
        "restamped": len(to_restamp),
        "by_branch": {key: dict(value) for key, value in by_branch.items()},
        "dry_run": dry_run,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest dewey_time.tests.test_dev_tools -v`
Expected: PASS.

- [ ] **Step 5: Run the whole lane**

Run: `python3 -m unittest discover -s dewey_time/tests -t .`
Expected: **+11 tests** over the starting total, 11 skipped, 0 errors.

- [ ] **Step 6: Mutation-check the safety rails**

| Mutation | Must fail |
|---|---|
| Delete the `_require_system_manager_for_clear()` call from `purge_testing_flags` | `test_it_refuses_without_system_manager` |
| Change `_parse_dry_run` to `return bool(value)` | `test_string_forms_behave_as_the_booleans_they_name` |
| Drop `"source": "AUTO"` from `_scoped_auto_flags`'s base filters | `test_it_only_ever_scans_auto_flags` |
| Make `reconcile_rollout_flags` restamp unconditionally (drop the `!= phase` check) | `test_an_already_correct_row_is_left_alone` |

If any mutation survives, the gap is in the tests, not the mutation — write the missing test before moving on.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/dev_tools.py dewey_time/tests/test_dev_tools.py
git commit -m "$(cat <<'EOF'
feat(rollout): two ways to take the trial data back, both dry by default

purge_testing_flags removes the calibration rows once a branch is confidently
live. reconcile_rollout_flags makes the table agree with the config -- dropping
pre-cutoff rows and backfilling blank phases -- and is the single owner of
pre-cutoff removal, which is why the engine's guards return before their
deletes.

dry_run defaults to True and coerces the string forms, because it arrives over
HTTP where "0" is truthy and the safe reading of an unparseable value on a
destructive endpoint is "delete nothing".

Backend-only. T1-5 was a finding about destructive controls being too visible in
the SPA; that surface is not growing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 6: The queue payload Phase B will render

**Files:**
- Modify: `dewey_time/attendance_engine/flag_queue_api.py` (`_QUEUE_CACHE_PREFIX` ~line 54, `_flag_rows:153`, `_build_queue_payload:373-447`)
- Test: `dewey_time/tests/test_flag_queue_api.py` (append)

**Do not touch `hr_calendar.py` in this task.** The calendar's per-day `rollout_phase` ships in Task 7, alongside the only test that can cover it.

**Interfaces:**
- Consumes: `rollout.TESTING`, `rollout.LIVE`, `rollout.rollout_dates_for_branch`, `rollout.phases_configured` from Task 1; the `rollout_phase` column from Task 4.
- Produces: the `rollout` block on `get_flag_queue`'s payload. **Phase B consumes it and adds no Python of its own** — if Phase B finds it needs a backend change, that is a correction to this task, not a smuggled frontend commit.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_flag_queue_api.py`:

```python
class TestRolloutBlock(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import flag_queue_api

        self.api = flag_queue_api

    def _block(self, phases, branches=("BR-A",), configured=True):
        flags = [
            {"employee": f"EMP-{i}", "rollout_phase": phase}
            for i, phase in enumerate(phases)
        ]
        employees_by_id = {
            f"EMP-{i}": {"branch": branches[i % len(branches)]}
            for i in range(len(phases))
        }
        with patch.object(
            self.api.rollout, "phases_configured", return_value=configured
        ), patch.object(
            self.api.rollout,
            "rollout_dates_for_branch",
            return_value=(date(2026, 8, 15), date(2026, 9, 1)),
        ):
            return self.api._rollout_block(
                flags=flags, employees_by_id=employees_by_id
            )

    def test_an_all_live_range_reports_live(self):
        block = self._block(["LIVE", "LIVE"])
        self.assertEqual(block["range_phase"], "LIVE")
        self.assertEqual(block["testing_flag_count"], 0)
        self.assertEqual(block["windows"], [])

    def test_an_all_pilot_range_reports_testing_and_names_its_window(self):
        block = self._block(["TESTING", "TESTING"])
        self.assertEqual(block["range_phase"], "TESTING")
        self.assertEqual(block["testing_flag_count"], 2)
        self.assertEqual(
            block["windows"],
            [{"branch": "BR-A", "testing_start": "2026-08-15", "go_live": "2026-09-01"}],
        )

    def test_a_range_spanning_go_live_reports_mixed_with_a_count(self):
        block = self._block(["TESTING", "LIVE", "LIVE"])
        self.assertEqual(block["range_phase"], "MIXED")
        self.assertEqual(block["testing_flag_count"], 1)
        self.assertEqual(block["total_flag_count"], 3)

    def test_a_blank_stored_phase_counts_as_live(self):
        # Every row written before this feature has a blank rollout_phase, and blank
        # is read as LIVE -- consistent with unset dates meaning LIVE.
        block = self._block([None, None])
        self.assertEqual(block["range_phase"], "LIVE")

    def test_no_dates_anywhere_reports_not_configured(self):
        block = self._block(["LIVE"], configured=False)
        self.assertFalse(block["phases_configured"])

    def test_multiple_pilot_branches_each_get_a_window(self):
        block = self._block(["TESTING", "TESTING"], branches=("BR-A", "BR-B"))
        self.assertEqual([w["branch"] for w in block["windows"]], ["BR-A", "BR-B"])


class TestQueueCachePrefix(unittest.TestCase):
    def test_the_prefix_is_v4(self):
        # flag_queue_api.py:40-53: a deploy does not clear Redis, so a payload-shape
        # change without a new prefix means old keys answering new callers for a
        # full TTL. This assertion is the enforcement of that comment.
        from dewey_time.attendance_engine.flag_queue_api import _QUEUE_CACHE_PREFIX

        self.assertEqual(_QUEUE_CACHE_PREFIX, "flag_queue:v4")
```

That is the whole test set for this task. The calendar change and its test both live in Task 7.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_flag_queue_api -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_rollout_block'` and `'flag_queue:v3' != 'flag_queue:v4'`.

- [ ] **Step 3: Add the queue block**

In `dewey_time/attendance_engine/flag_queue_api.py`:

Add to the imports:

```python
from dewey_time.attendance_engine import rollout
```

Change `_QUEUE_CACHE_PREFIX` to `"flag_queue:v4"`, and add this line to the version log directly above it, after the `v3:` line:

```python
# v4: the payload gained a `rollout` block (phase of the visible range, pilot
# flag counts, and the pilot windows of the branches actually present).
```

In `_flag_rows`, add `"rollout_phase"` to the `fields` list:

```python
            fields=[
                "employee",
                "attendance_date",
                "flag_code",
                "severity",
                "day_closed",
                "evidence",
                "rollout_phase",
            ],
```

Add this function directly above `_build_queue_payload`:

```python
def _rollout_block(*, flags, employees_by_id) -> dict:
    """What rollout phase the visible flags belong to, so the queue can say so.

    Computed entirely from rows already in hand. The docstring at
    _build_queue_payload makes the five-query budget a spec rule rather than a
    preference, and this must not become the sixth.

    A blank stored phase reads as LIVE: every row written before rollout phases
    existed has one, and that is consistent with unset dates meaning LIVE.
    """
    phases = [(flag.get("rollout_phase") or rollout.LIVE) for flag in flags]
    total = len(phases)
    testing = sum(1 for phase in phases if phase == rollout.TESTING)

    if testing == 0:
        range_phase = rollout.LIVE
    elif testing == total:
        range_phase = rollout.TESTING
    else:
        range_phase = "MIXED"

    pilot_branches = sorted(
        {
            (employees_by_id.get(flag.get("employee")) or {}).get("branch")
            for flag in flags
            if (flag.get("rollout_phase") or rollout.LIVE) == rollout.TESTING
        }
        - {None}
    )
    windows = []
    for pilot_branch in pilot_branches:
        testing_start, go_live = rollout.rollout_dates_for_branch(pilot_branch)
        windows.append(
            {
                "branch": pilot_branch,
                "testing_start": str(testing_start) if testing_start else None,
                "go_live": str(go_live) if go_live else None,
            }
        )

    return {
        "phases_configured": rollout.phases_configured(),
        "range_phase": range_phase,
        "testing_flag_count": testing,
        "total_flag_count": total,
        "windows": windows,
    }
```

In `_build_queue_payload`'s returned dict, add after the `"outage_dates": [...]` entry:

```python
        # Phase of the visible range, so the queue can tell HR whether it is looking
        # at the official record or at calibration data. Rendered in Phase B.
        "rollout": _rollout_block(flags=flags, employees_by_id=employees_by_id),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest dewey_time.tests.test_flag_queue_api -v`
Expected: PASS.

- [ ] **Step 5: Run the whole lane**

Run: `python3 -m unittest discover -s dewey_time/tests -t .`
Expected: **+7 tests** over the starting total, 11 skipped, 0 errors.

- [ ] **Step 6: Confirm no frontend file changed**

Run: `git status --short`
Expected: only `dewey_time/attendance_engine/flag_queue_api.py` and `dewey_time/tests/test_flag_queue_api.py`. **Nothing** under `dewey_time/frontend/`, `dewey_time/public/`, or `dewey_time/www/`, and nothing in `hr_calendar.py` — that is Task 7's.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/flag_queue_api.py \
        dewey_time/tests/test_flag_queue_api.py
git commit -m "$(cat <<'EOF'
feat(rollout): the queue payload carries the phase, ahead of anything drawing it

A rollout block -- phase of the visible range, pilot counts, and the windows of
the branches actually present -- built from rows already in hand so the
five-query budget holds.

Landing this before the components that render it is what keeps the frontend
pass free of Python: the flag_queue v3 -> v4 bump happens here, alone, rather
than riding along with a deploy. flag_queue_api.py:40-53 exists because a deploy
does not clear Redis, and an old key answering new callers is a thrown render
for every HR user for a full TTL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 7: The calendar payload, and proof on a real bench

**Files:**
- Modify: `dewey_time/attendance_engine/hr_calendar.py` (the `days.append({...})` block, ~line 752)
- Modify: `dewey_time/tests/test_integration_pilot_matrix.py`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `rollout_phase` on each day of `get_employee_calendar`'s payload, which Phase B renders. Nothing else in Phase A reads it.

The calendar's one-line change lives here rather than in Task 6 because this is where the only test that can cover it lives. `test_hr_calendar.py` has no scaffolding that invokes `get_employee_calendar`, and that function reads checkins, shifts, holidays, leave, device alerts and sync rows — a mock harness for all of it would be more code than the line under test, and would mostly test the harness. On a real bench the endpoint just runs.

Mocked unit tests cannot prove this feature. The whole point is behaviour against a real `Dewey Time Settings` Single, a real `Attendance Flag` table with a real `rollout_phase` column, and the real cached-document machinery. This module already runs against a real bench after #147.

**Two bench-specific traps:**

1. `frappe.get_cached_doc` will not see a `frappe.db.set_value` on the Single. Change the dates by loading the doc and calling `.save(ignore_permissions=True)`, which clears the cache and runs the validator you wrote in Task 2.
2. The purge calls `frappe.db.commit()`, which ends the surrounding transaction. This module is already built for persistence (its `_ensure_*` fixtures are idempotent existence checks), so this is survivable — but restore the settings in `tearDownClass` or you will poison every later run on that bench.

- [ ] **Step 1: Add the tests as methods on the existing class**

These go **inside the existing `TestPilotMatrix` class** (`test_integration_pilot_matrix.py:80`), not in a new one. `TestPilotMatrix.setUpClass` seeds the employee, shift, holiday list and checkins, and `_checkin` / `_flags` / `_rows` are its methods. A subclass would inherit the fixtures but unittest would also re-collect and re-run all eleven existing tests.

Facts about the helpers you are reusing, confirmed by reading them:

- `_flags(day, employee=None)` **runs the engine itself** — it deletes that employee-day's flags, calls `_generate_for_employee_date`, runs three oracle cross-checks, and returns a **set of flag_codes**. Do not call `_generate_for_employee_date` separately before it.
- `_checkin(day, hhmmss, log_type, branch=PRIMARY_BRANCH, sid=None, employee=None)` defaults to `self.employee`.
- Dates already taken: `03-02, 03-03, 03-04, 03-05, 03-09, 03-10, 03-11, 03-12, 03-16, 03-17`, plus `HOLIDAY_DATE = 2026-03-06`. `2026-03-01` is a Sunday, so `03-18` / `03-19` / `03-20` are a free Wed / Thu / Fri.

Add `from contextlib import contextmanager` to the module's imports, then add to `TestPilotMatrix`:

```python
    @contextmanager
    def _rollout_dates(self, testing_start, go_live):
        """Set the global rollout dates for one test, then put them back.

        Restored rather than left set: this module's fixtures deliberately persist
        across runs (they are idempotent existence checks, not transactional), so a
        leaked cutoff would silently disable the engine for every later test on this
        bench and the failures would look like anything but a leaked setting.

        .save() rather than frappe.db.set_value(): the engine reads the settings
        through frappe.get_cached_doc, which will not see a raw db write.
        """
        settings = frappe.get_single("Dewey Time Settings")
        saved = (settings.rollout_testing_start, settings.rollout_go_live)
        settings.rollout_testing_start = testing_start
        settings.rollout_go_live = go_live
        settings.save(ignore_permissions=True)
        frappe.db.commit()
        try:
            yield
        finally:
            settings = frappe.get_single("Dewey Time Settings")
            settings.rollout_testing_start, settings.rollout_go_live = saved
            settings.save(ignore_permissions=True)
            frappe.db.commit()

    def _phases(self, day):
        """The distinct rollout_phase values stored for one employee-day."""
        return set(
            frappe.get_all(
                "Attendance Flag",
                filters={
                    "employee": self.employee,
                    "attendance_date": getdate(day),
                    "source": "AUTO",
                },
                pluck="rollout_phase",
            )
        )

    # --- rollout phases ------------------------------------------------------

    def test_a_pre_cutoff_day_with_punches_earns_no_flags(self):
        day = "2026-03-18"
        self._checkin(day, "11:30:00", "IN")
        self._checkin(day, "17:00:00", "OUT")

        # The control, and the reason this test means anything. 11:30 against an
        # 09:00 shift is well past any grace, so with no cutoff configured this day
        # flags. The assertion below therefore proves the guard, not an empty day.
        self.assertNotEqual(self._flags(day), set())

        with self._rollout_dates("2026-03-19", "2026-03-20"):
            self.assertEqual(self._flags(day), set())

    def test_a_pilot_day_is_stamped_testing(self):
        day = "2026-03-19"
        self._checkin(day, "11:30:00", "IN")
        self._checkin(day, "17:00:00", "OUT")
        with self._rollout_dates("2026-03-19", "2026-03-20"):
            self.assertNotEqual(self._flags(day), set())
            self.assertEqual(self._phases(day), {"TESTING"})

    def test_the_go_live_day_itself_is_stamped_live(self):
        day = "2026-03-20"
        self._checkin(day, "11:30:00", "IN")
        self._checkin(day, "17:00:00", "OUT")
        with self._rollout_dates("2026-03-19", "2026-03-20"):
            self.assertNotEqual(self._flags(day), set())
            self.assertEqual(self._phases(day), {"LIVE"})

    def test_the_purge_takes_the_pilot_rows_and_spares_the_live_ones(self):
        from dewey_time.attendance_engine.dev_tools import purge_testing_flags

        for day in ("2026-03-19", "2026-03-20"):
            self._checkin(day, "11:30:00", "IN")
            self._checkin(day, "17:00:00", "OUT")

        def _count(phase):
            return frappe.db.count(
                "Attendance Flag",
                {"employee": self.employee, "source": "AUTO", "rollout_phase": phase},
            )

        with self._rollout_dates("2026-03-19", "2026-03-20"):
            self._flags("2026-03-19")
            self._flags("2026-03-20")

            self.assertGreater(_count("TESTING"), 0)
            live_before = _count("LIVE")
            self.assertGreater(live_before, 0)

            frappe.set_user("Administrator")
            purge_testing_flags(dry_run=0)

            self.assertEqual(_count("TESTING"), 0)
            self.assertEqual(_count("LIVE"), live_before)

    def test_the_settings_validator_actually_fires_on_a_real_bench(self):
        """Task 2's rejections are unit-tested against a hand-built controller. This
        proves Frappe reaches that controller at all.

        Both DocTypes carry "custom": 1, and Frappe's import_controller can
        short-circuit custom DocTypes to the base Document class. Five other custom
        DocTypes in this app do run their hooks in production, so the pattern works
        here -- but "works for attendance_flag" is not evidence about this one.
        """
        settings = frappe.get_single("Dewey Time Settings")
        saved = (settings.rollout_testing_start, settings.rollout_go_live)
        try:
            settings.rollout_testing_start = "2026-03-20"
            settings.rollout_go_live = "2026-03-19"  # reversed
            with self.assertRaises(frappe.ValidationError):
                settings.save(ignore_permissions=True)
        finally:
            frappe.db.rollback()
            settings = frappe.get_single("Dewey Time Settings")
            settings.rollout_testing_start, settings.rollout_go_live = saved
            settings.save(ignore_permissions=True)
            frappe.db.commit()

    def test_the_calendar_payload_carries_a_phase_for_every_day(self):
        """The payload half of this task: the phase reaches every day, including
        both boundaries, on an endpoint running for real."""
        from dewey_time.attendance_engine.hr_calendar import get_employee_calendar

        frappe.set_user("Administrator")
        with self._rollout_dates("2026-03-19", "2026-03-20"):
            payload = get_employee_calendar(
                employee=self.employee, start_date="2026-03-18", end_date="2026-03-20"
            )

        self.assertEqual(
            [day["rollout_phase"] for day in payload["days"]],
            ["PRELAUNCH", "TESTING", "LIVE"],
        )
```

The endpoint is `get_employee_calendar(employee, start_date, end_date)` at `hr_calendar.py:518` — there is no `get_week`, whatever the spec's prose calls it.

- [ ] **Step 2: Add the calendar day phase**

In `dewey_time/attendance_engine/hr_calendar.py`, add to the imports:

```python
from dewey_time.attendance_engine import rollout
```

In the `days.append({...})` block, add after `"flags": flags_by_day.get(key, []),`:

```python
                # PRELAUNCH here means the engine never evaluated this day. Without
                # it a pre-cutoff day is pixel-identical to a clean one, which is the
                # single place the cutoff can actively mislead. Rendered in Phase B.
                "rollout_phase": rollout.phase_for(
                    branch=employee_branch, attendance_date=cur
                ),
```

`employee_branch` is already resolved once for the whole week at `hr_calendar.py:549`, so this adds no query — only one cached settings read per day.

- [ ] **Step 3: Bring up the sandbox bench and migrate the new schema**

```bash
cd dev/sandbox && ./frappe-sandbox up && ./frappe-sandbox bootstrap --test-site
```

Then apply the DocType changes:

```bash
cd dev/sandbox && ./frappe-sandbox exec "bench --site test_site migrate"
```

Expected: `Dewey Time Branch Rollout` created and the two modified DocTypes reimported. If the new fields do not appear, the `modified` bump was missed — that is the failure mode the Global Constraints call out.

- [ ] **Step 4: Run the pilot matrix on the bench**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --module test_integration_pilot_matrix`

Expected: **17 tests, all passing** (11 existing + 6 new).

`bench run-tests --module` imports every sibling test module, and those inject a MagicMock as `frappe` — which is why this module self-skips outside a real bench. If you see `ModuleNotFoundError: No module named 'frappe.boot'`, or the tests report as **skipped**, you are not on a real bench and the run proves nothing. Confirm `_HAS_REAL_BENCH` is true and that the count is 17 before trusting a green result — a green run of zero tests is the failure mode this repo has hit before.

- [ ] **Step 5: Confirm the guard is what produces the empty day**

`test_a_pre_cutoff_day_with_punches_earns_no_flags` already carries its own control: it asserts the *same day with the same punches* flags when no cutoff is configured, then asserts it does not once the cutoff is set. Only the configuration differs between the two assertions, so the test cannot pass with the guard absent.

Confirm that claim once rather than assuming it. Comment out the `PRELAUNCH` guard in `closeout._generate_for_employee_date`, re-run the module, and record the result. Expected: that test **FAILS** on its second assertion. Restore the guard and confirm 17/17 again. Put both outcomes in the task report.

- [ ] **Step 6: Run the whole local lane one more time**

Run: `python3 -m unittest discover -s dewey_time/tests -t .`
Expected: **+6 tests, all of them skipped** — this module self-skips off a real bench, so the total rises by 6 and `skipped` goes 11 → 17. Zero errors.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/hr_calendar.py \
        dewey_time/tests/test_integration_pilot_matrix.py
git commit -m "$(cat <<'EOF'
feat(rollout): the calendar says which days it never judged, proved on a bench

Each day of the calendar payload carries its phase, from the branch the endpoint
already resolves once for the week. It ships here rather than with the queue
payload because this is where the only test that can cover it lives:
test_hr_calendar.py has no scaffolding that invokes get_employee_calendar, and
mocking checkins, shifts, holidays, leave, alerts and sync rows would be more
harness than line.

Five cases against a real Settings Single and a real flag table: a pre-cutoff
day WITH punches earns nothing, a pilot day is stamped TESTING, the go-live day
itself LIVE, the purge takes exactly the pilot rows, and a three-day payload
straddling both boundaries reads PRELAUNCH / TESTING / LIVE.

The pre-cutoff case is the one that needed proving twice. 09:47 against an 09:00
shift is a LATE_START on any live day, and with the guard commented out this
test fails reporting exactly that -- which is what makes its passing state mean
the guard works rather than that the day was empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Done when

- The local lane is green with 0 errors, and `skipped` has gone 11 → 17 (the six new bench tests self-skipping).
- The pilot matrix is **17/17 on a real bench**, with the pre-cutoff case demonstrated failing when its guard is removed.
- `git diff --stat main...HEAD` shows **no file** under `dewey_time/frontend/`, `dewey_time/public/`, or `dewey_time/www/`.
- Every mutation listed in Tasks 1, 3 and 5 was applied, observed to fail, and reverted.

## Explicitly not in this plan

- The queue banner and the calendar chip. They are Phase B, with their own plan, and they consume the payloads Task 6 ships.
- Any button, dialog or scheduled job for the two purge endpoints.
- Setting real dates on the production site. That is an admin action after this merges. The runbook, as the branch's reviews established it:

  1. Set the dates in Desk. **Check them by eye** — `Dewey Time Settings.validate` is written and unit-tested but does not run, because every DocType in this app is `custom: 1` (filed as T3-11). An incoherent config saves silently until that is fixed.
  2. Run `reconcile_rollout_flags` with `dry_run=1` and read the counts.
  3. Run it with `dry_run=0`. **Reconcile before purge is a correctness ordering, not hygiene**: flags written between deploy and step 1 are stamped `LIVE`, not blank, so `purge_testing_flags` alone would both under-delete and mislabel.
  4. Only then `purge_testing_flags`, once a branch is confidently live.

  Two things to know while operating it. **Moving a cutoff later leaves already-written flags behind** until reconcile runs again — the engine's guards return before their deletes on purpose, so reconcile is the single owner of pre-cutoff removal. And **an employee who changed branch is judged by their current one**, since a flag does not store the branch it was written under.
