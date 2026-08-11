# Biometric Enrollment Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give HR one page that answers "who cannot clock in, and who still can after leaving?", grouped by branch or department.

**Architecture:** The ADMS bridge POSTs a full-roster enrollment snapshot to a new whitelisted endpoint (the third feed to reuse `validate_bridge_request`). It lands in a per-employee register DocType. A read API joins that register to `Employee` at request time, classifies each person into one of four buckets with a pure function, and returns flat rows. The client does all grouping and filtering.

**Tech Stack:** Frappe v16 (Python 3.11+), React 19 + TypeScript + TanStack Query + Tailwind v4 (`hr_attendance` SPA), `node:test` + `node:assert/strict` run by `tsx --test` (there is NO vitest and NO @testing-library/react in this SPA; components are exercised with `renderToStaticMarkup`), Python `unittest` with the repo's shared frappe mock.

**Spec:** `docs/superpowers/specs/2026-08-11-biometric-enrollment-register-design.md`

**Scope:** dewey_time only. The bridge-side `maybeSnapshotEnrollmentOnPoll` task lives in `zkteco-adms-bridg` and gets its own plan. Everything here is testable and shippable without it — until the bridge sends, the page correctly reports that the feed is not connected.

## Global Constraints

- **Never accept a partial snapshot.** A full-snapshot payload asserts that every absent employee is unenrolled. Reject when `len(linked_users) < 0.5 × previous_registered_count` and that previous count was `>= 20`, unless the payload sets `allow_shrink: 1`.
- **`ENROLLMENT_SNAPSHOT_MAX_USERS = 2000`** — hard ceiling on a single snapshot payload.
- **`ENROLLMENT_EMPLOYEE_LIMIT = 2000`** — Employee scan cap, matching `COVERAGE_EMPLOYEE_LIMIT`.
- **`NOT_PUNCHING_WINDOW_DAYS = 14`** — a module constant, never a setting.
- **Reported population is `Employee.status in ("Active", "Left")` only.** `Inactive` and `Suspended` are counted as `excluded_status` and shown as a footnote, never silently dropped.
- **Branch and department are never stored on the register.** They are joined from `Employee` at read time.
- **If no snapshot has ever arrived the page refuses to render the list** and says the feed is not connected.
- **Query budget for the read API is three:** one Employee scan, one register read, one `Employee Checkin` aggregate with `GROUP BY employee`. Never a query per employee.
- **The API groups nothing.** It returns flat rows plus counts; the client groups.
- **`face_count` is carried in every payload but gets no UI column** (0 users have face templates).
- **Cache prefix is `enrollment_report:v1`.** Bump the version whenever the payload shape changes.
- Every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
  ```
- Backend tests run with `python3 -m unittest discover -s dewey_time/tests -t .` from the repo root. Baseline before this plan: **751 tests, 24 skipped, green.**
- Frontend tests run with `npm run test:web` from `dewey_time/frontend/hr_attendance` (there is no `npm test` script here). Baseline: **711 tests green.** The script is an explicit glob list, not a recursive scan — a test placed in a directory it does not name passes locally and never runs in CI.

## File Structure

**Backend**

| File | Responsibility |
|---|---|
| `dewey_time/attendance_engine/enrollment_buckets.py` | **Create.** Pure classification. No `frappe` import at all. |
| `dewey_time/dewey_time/doctype/employee_biometric_enrollment/employee_biometric_enrollment.json` | **Create.** The register schema. |
| `dewey_time/dewey_time/doctype/employee_biometric_enrollment/employee_biometric_enrollment.py` | **Create.** Bare `Document` subclass. |
| `dewey_time/dewey_time/doctype/employee_biometric_enrollment/__init__.py` | **Create.** Empty. |
| `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json` | **Modify.** Add `last_enrollment_snapshot_at`. |
| `dewey_time/attendance_engine/enrollment.py` | **Create.** Ingest endpoint, upsert, shrink guard. |
| `dewey_time/attendance_engine/enrollment_api.py` | **Create.** Read API, the `enrollment_status` seam, cache. |
| `dewey_time/hooks.py` | **Modify.** Cache invalidation on register writes. |

**Frontend** (all paths under `dewey_time/frontend/hr_attendance/`)

| File | Responsibility |
|---|---|
| `src/lib/enrollmentReport.ts` | **Create.** Types, feed-connected gate, staleness copy, filter, group. All pure. |
| `src/lib/enrollmentCsv.ts` | **Create.** Rows → CSV string. Pure. |
| `src/services/enrollment.ts` | **Create.** `frappeCall` wrapper. |
| `src/hooks/useEnrollmentReport.ts` | **Create.** TanStack Query hook. |
| `src/lib/queryKeys.ts` | **Modify.** Add the `enrollment` family. |
| `src/ui/schedule-coverage/CoverageViewNav.tsx` | **Create.** Two-item sub-nav shared by both coverage views. |
| `src/ui/schedule-coverage/BiometricEnrollmentPage.tsx` | **Create.** The page. |
| `src/ui/schedule-coverage/ScheduleCoveragePage.tsx` | **Modify.** Render the sub-nav. One line; no other change. |
| `src/main.tsx` | **Modify.** Add the route. |

`HrAppShell.activeTab` needs **no change**: it already returns `"coverage"` for anything under `/hr-schedule/coverage` (`HrAppShell.tsx:29`), and `hooks.py:88` already wildcards `/hr-schedule/<path:app_path>`. Verify both rather than assuming.

---

### Task 1: Pure bucket classification

The only place the four-state logic lives. No database, so every state is testable directly — which is where the real risk is.

**Files:**
- Create: `dewey_time/attendance_engine/enrollment_buckets.py`
- Test: `dewey_time/tests/test_enrollment_buckets.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `classify(*, status: str, is_registered: bool, checkin_count: int) -> str | None`; `days_since(relieving_date, today) -> int | None`; the four bucket constants `NEEDS_ENROLLMENT`, `ENROLLED_NOT_PUNCHING`, `OK`, `LEAVER_STILL_ENROLLED`; and `REPORTED_STATUSES`.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_enrollment_buckets.py`:

```python
"""Pure bucket classification for the biometric enrollment register.

This module imports no frappe, so these run with no mock installed — the
point of keeping the logic pure.
"""

import unittest
from datetime import date

from dewey_time.attendance_engine import enrollment_buckets as mod


class ClassifyTest(unittest.TestCase):
    def test_an_active_employee_with_no_template_needs_enrolling(self):
        self.assertEqual(
            mod.classify(status="Active", is_registered=False, checkin_count=0),
            mod.NEEDS_ENROLLMENT,
        )

    def test_an_active_employee_who_is_enrolled_and_punching_is_ok(self):
        self.assertEqual(
            mod.classify(status="Active", is_registered=True, checkin_count=3),
            mod.OK,
        )

    def test_enrolled_but_no_punches_in_the_window_is_its_own_state(self):
        """A template that exists but produces nothing is a different problem
        from no template at all: a bad enrollment, or a long absence."""
        self.assertEqual(
            mod.classify(status="Active", is_registered=True, checkin_count=0),
            mod.ENROLLED_NOT_PUNCHING,
        )

    def test_a_leaver_who_is_still_enrolled_is_the_security_finding(self):
        self.assertEqual(
            mod.classify(status="Left", is_registered=True, checkin_count=0),
            mod.LEAVER_STILL_ENROLLED,
        )

    def test_a_leaver_with_no_template_is_not_reported(self):
        """Nothing to action: they left and their template is gone."""
        self.assertIsNone(
            mod.classify(status="Left", is_registered=False, checkin_count=0)
        )

    def test_a_leavers_punch_history_does_not_make_them_ok(self):
        """The regression guard: a departed employee has check-ins by
        definition. Ordering the status test before the registration test is
        what keeps their live template visible."""
        self.assertEqual(
            mod.classify(status="Left", is_registered=True, checkin_count=500),
            mod.LEAVER_STILL_ENROLLED,
        )

    def test_statuses_outside_the_population_are_excluded(self):
        for status in ("Inactive", "Suspended"):
            with self.subTest(status=status):
                self.assertIsNone(
                    mod.classify(status=status, is_registered=True, checkin_count=0)
                )


class DaysSinceTest(unittest.TestCase):
    def test_it_counts_whole_days(self):
        self.assertEqual(mod.days_since(date(2026, 8, 1), date(2026, 8, 11)), 10)

    def test_a_missing_relieving_date_yields_none_not_zero(self):
        """Zero would render as "left today", which is a fabrication. The row
        still appears; only the day count is withheld."""
        self.assertIsNone(mod.days_since(None, date(2026, 8, 11)))

    def test_a_future_relieving_date_clamps_to_zero(self):
        self.assertEqual(mod.days_since(date(2026, 8, 20), date(2026, 8, 11)), 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_buckets
```

Expected: `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.enrollment_buckets'`.

- [ ] **Step 3: Write the implementation**

Create `dewey_time/attendance_engine/enrollment_buckets.py`:

```python
"""Bucket classification for the biometric enrollment register.

Deliberately imports no frappe: all four states are then testable without a
database, which is where the logic risk in this feature actually lives.
"""

from __future__ import annotations

#: An active employee with no biometric template. The worklist.
NEEDS_ENROLLMENT = "NEEDS_ENROLLMENT"
#: A template exists but produced no check-ins in the window: a bad enrollment,
#: or a long absence. Distinct from having no template at all.
ENROLLED_NOT_PUNCHING = "ENROLLED_NOT_PUNCHING"
#: Enrolled and producing check-ins. Nothing to do.
OK = "OK"
#: Left the company, template still live on the device. A security finding.
LEAVER_STILL_ENROLLED = "LEAVER_STILL_ENROLLED"

#: Employee statuses the report covers. "Inactive" and "Suspended" are excluded:
#: neither is a state where "should this person be able to clock in?" has an
#: obvious answer, and guessing would put unactionable rows in front of HR.
REPORTED_STATUSES = ("Active", "Left")


def classify(*, status: str, is_registered: bool, checkin_count: int) -> str | None:
    """The bucket for one employee, or None when they are out of population.

    The status test comes FIRST and deliberately so. A departed employee has
    check-ins by definition, so testing registration first would classify them
    OK and hide the live template this report exists to surface.
    """
    if status not in REPORTED_STATUSES:
        return None

    if status == "Left":
        return LEAVER_STILL_ENROLLED if is_registered else None

    if not is_registered:
        return NEEDS_ENROLLMENT

    return OK if checkin_count > 0 else ENROLLED_NOT_PUNCHING


def days_since(relieving_date, today) -> int | None:
    """Whole days from relieving_date to today, or None when it is unknown.

    None rather than 0: a missing relieving date must not render as "left
    today". Callers omit the count instead of fabricating one. A future date
    clamps to 0 rather than going negative.
    """
    if not relieving_date:
        return None
    return max(0, (today - relieving_date).days)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_buckets
```

Expected: `Ran 10 tests ... OK`.

- [ ] **Step 5: Mutation check**

Swap the order so registration is tested before status:

```python
    if not is_registered:
        return NEEDS_ENROLLMENT
    if status == "Left":
        return LEAVER_STILL_ENROLLED
```

Re-run. Expected: `test_a_leavers_punch_history_does_not_make_them_ok` FAILS. Then revert and confirm green again. Record the result in the task report.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/enrollment_buckets.py dewey_time/tests/test_enrollment_buckets.py
git commit -m "feat(enrollment): pure bucket classification for the register

Status is tested before registration: a departed employee has check-ins by
definition, so the other order classifies them OK and hides exactly the live
template this report exists to surface. Mutation-checked."
```

---

### Task 2: The register DocType and its upsert

**Files:**
- Create: `dewey_time/dewey_time/doctype/employee_biometric_enrollment/__init__.py` (empty)
- Create: `dewey_time/dewey_time/doctype/employee_biometric_enrollment/employee_biometric_enrollment.json`
- Create: `dewey_time/dewey_time/doctype/employee_biometric_enrollment/employee_biometric_enrollment.py`
- Modify: `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json`
- Create: `dewey_time/attendance_engine/enrollment.py`
- Test: `dewey_time/tests/test_enrollment_ingest.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `upsert_enrollment_row(*, employee, pin, is_registered, fingerprint_count, face_count, synced_at, bridge_env) -> str` (returns the docname, which equals `employee`); `ENROLLMENT_DOCTYPE = "Employee Biometric Enrollment"`.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_enrollment_ingest.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import enrollment as mod  # noqa: E402


class UpsertTest(unittest.TestCase):
    def test_the_docname_is_the_employee_id(self):
        """One row per employee, name-keyed, so the upsert needs no lookup."""
        doc = MagicMock()
        with patch.object(mod.frappe.db, "exists", return_value=False), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ) as get_doc:
            name = mod.upsert_enrollment_row(
                employee="HR-EMP-0042",
                pin="1042",
                is_registered=True,
                fingerprint_count=2,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )

        get_doc.assert_called_once_with(
            {"doctype": mod.ENROLLMENT_DOCTYPE, "name": "HR-EMP-0042"}
        )
        self.assertEqual(doc.employee, "HR-EMP-0042")
        self.assertEqual(doc.fingerprint_count, 2)
        self.assertEqual(name, "HR-EMP-0042")
        doc.save.assert_called_once()

    def test_an_existing_row_is_loaded_not_recreated(self):
        doc = MagicMock()
        with patch.object(mod.frappe.db, "exists", return_value=True), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ) as get_doc:
            mod.upsert_enrollment_row(
                employee="HR-EMP-0042",
                pin="1042",
                is_registered=False,
                fingerprint_count=0,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )

        get_doc.assert_called_once_with(mod.ENROLLMENT_DOCTYPE, "HR-EMP-0042")
        self.assertEqual(doc.is_registered, 0)

    def test_is_registered_is_stored_as_an_int_not_a_bool(self):
        """Frappe Check fields are 0/1. A Python bool round-trips through the
        ORM but compares badly in db filters like {"is_registered": 1}."""
        doc = MagicMock()
        with patch.object(mod.frappe.db, "exists", return_value=False), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ):
            mod.upsert_enrollment_row(
                employee="HR-EMP-0042",
                pin="1042",
                is_registered=True,
                fingerprint_count=1,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )
        self.assertIs(doc.is_registered, 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_ingest
```

Expected: `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.enrollment'`.

- [ ] **Step 3: Create the DocType**

`dewey_time/dewey_time/doctype/employee_biometric_enrollment/__init__.py` — empty file.

`dewey_time/dewey_time/doctype/employee_biometric_enrollment/employee_biometric_enrollment.json`:

```json
{
 "actions": [],
 "allow_copy": 0,
 "allow_guest_to_view": 0,
 "allow_import": 0,
 "autoname": "field:employee",
 "creation": "2026-08-11 00:00:00.000000",
 "custom": 0,
 "docstatus": 0,
 "doctype": "DocType",
 "document_type": "Document",
 "editable_grid": 1,
 "engine": "InnoDB",
 "field_order": [
  "employee",
  "pin",
  "is_registered",
  "column_break_1",
  "fingerprint_count",
  "face_count",
  "synced_at",
  "bridge_env"
 ],
 "fields": [
  {
   "fieldname": "employee",
   "fieldtype": "Link",
   "in_list_view": 1,
   "label": "Employee",
   "options": "Employee",
   "reqd": 1,
   "unique": 1
  },
  {
   "fieldname": "pin",
   "fieldtype": "Data",
   "label": "Device PIN"
  },
  {
   "default": "0",
   "fieldname": "is_registered",
   "fieldtype": "Check",
   "in_list_view": 1,
   "label": "Registered on Device"
  },
  {
   "fieldname": "column_break_1",
   "fieldtype": "Column Break"
  },
  {
   "fieldname": "fingerprint_count",
   "fieldtype": "Int",
   "in_list_view": 1,
   "label": "Fingerprint Templates"
  },
  {
   "fieldname": "face_count",
   "fieldtype": "Int",
   "label": "Face Templates"
  },
  {
   "fieldname": "synced_at",
   "fieldtype": "Datetime",
   "label": "Snapshot Taken At"
  },
  {
   "fieldname": "bridge_env",
   "fieldtype": "Data",
   "label": "Bridge Environment"
  }
 ],
 "index_web_pages_for_search": 0,
 "links": [],
 "modified": "2026-08-16 00:00:00.000000",
 "modified_by": "Administrator",
 "module": "Dewey Time",
 "name": "Employee Biometric Enrollment",
 "naming_rule": "By fieldname",
 "owner": "Administrator",
 "permissions": [
  {
   "create": 1,
   "delete": 1,
   "email": 1,
   "export": 1,
   "print": 1,
   "read": 1,
   "report": 1,
   "role": "System Manager",
   "share": 1,
   "write": 1
  },
  {
   "create": 0,
   "delete": 0,
   "email": 0,
   "export": 1,
   "print": 1,
   "read": 1,
   "report": 1,
   "role": "HR Manager",
   "share": 0,
   "write": 0
  },
  {
   "create": 0,
   "delete": 0,
   "email": 0,
   "export": 1,
   "print": 1,
   "read": 1,
   "report": 1,
   "role": "HR User",
   "share": 0,
   "write": 0
  }
 ],
 "sort_field": "modified",
 "sort_order": "DESC",
 "states": [],
 "track_changes": 0
}
```

`dewey_time/dewey_time/doctype/employee_biometric_enrollment/employee_biometric_enrollment.py`:

```python
from frappe.model.document import Document


class EmployeeBiometricEnrollment(Document):
    """One row per employee, named by employee id.

    Deliberately has no controller hooks. The register is written only by the
    bridge snapshot ingest, which owns all of its validation; a hook here would
    fire once per row on a 237-row snapshot for no benefit.
    """

    pass
```

- [ ] **Step 4: Add the settings field**

In `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json`, append `"last_enrollment_snapshot_at"` to the end of `field_order`, add this to `fields`, and **bump `modified` to `"2026-08-16 00:00:00.000000"`** — without that bump `bench migrate` skips the schema reimport, silently and with a green log:

```json
  {
   "description": "Set by the bridge enrollment snapshot ingest. Distinct from the per-row synced_at: a snapshot in which nothing changed still proves the feed is alive.",
   "fieldname": "last_enrollment_snapshot_at",
   "fieldtype": "Datetime",
   "label": "Last Enrollment Snapshot At",
   "read_only": 1
  }
```

- [ ] **Step 5: Write the upsert**

Create `dewey_time/attendance_engine/enrollment.py`:

```python
"""Bridge webhook: biometric enrollment snapshot ingest.

The third bridge -> Frappe feed, after device_sync and closeout, and it reuses
their authentication unchanged.
"""

from __future__ import annotations

import frappe

ENROLLMENT_DOCTYPE = "Employee Biometric Enrollment"
SETTINGS_DOCTYPE = "Dewey Time Settings"


def upsert_enrollment_row(
    *,
    employee: str,
    pin=None,
    is_registered: bool = False,
    fingerprint_count=None,
    face_count=None,
    synced_at=None,
    bridge_env=None,
) -> str:
    """Create or update one register row. The docname IS the employee id."""
    values = {
        "employee": employee,
        "pin": pin,
        # Frappe Check fields are 0/1. A bool round-trips through the ORM but
        # compares badly in db filters such as {"is_registered": 1}.
        "is_registered": 1 if is_registered else 0,
        "fingerprint_count": int(fingerprint_count or 0),
        "face_count": int(face_count or 0),
        "synced_at": synced_at,
        "bridge_env": bridge_env,
    }

    if frappe.db.exists(ENROLLMENT_DOCTYPE, employee):
        doc = frappe.get_doc(ENROLLMENT_DOCTYPE, employee)
    else:
        doc = frappe.get_doc({"doctype": ENROLLMENT_DOCTYPE, "name": employee})

    for field, value in values.items():
        setattr(doc, field, value)

    doc.save(ignore_permissions=True)
    return doc.name
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_ingest
```

Expected: `Ran 3 tests ... OK`.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/dewey_time/doctype/employee_biometric_enrollment dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json dewey_time/attendance_engine/enrollment.py dewey_time/tests/test_enrollment_ingest.py
git commit -m "feat(enrollment): the register DocType and its upsert

One row per employee, named by employee id so the upsert is name-keyed and
needs no lookup. Branch and department are deliberately absent — they join
from Employee at read time so a transfer cannot leave the report stale.

Settings gains last_enrollment_snapshot_at, separate from the per-row
synced_at because an unchanged snapshot still proves the feed is alive.
Settings' modified is bumped so bench migrate actually reimports it."
```

---

### Task 3: The snapshot ingest endpoint

**Files:**
- Modify: `dewey_time/attendance_engine/enrollment.py`
- Modify: `dewey_time/tests/test_enrollment_ingest.py`

**Interfaces:**
- Consumes: `upsert_enrollment_row` from Task 2.
- Produces: whitelisted `notify_enrollment_snapshot(bridge_env=None, scanned_at=None, users=None, allow_shrink=0)` at the dotted path `dewey_time.attendance_engine.enrollment.notify_enrollment_snapshot`. Returns `{"ok": True, "registered": int, "cleared": int, "skipped_unlinked": int, "scanned_at": str}`.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_enrollment_ingest.py` (before the `if __name__` block):

```python
def _user(emp, registered=True, fp=1):
    return {
        "pin": "1000",
        "frappe_employee_id": emp,
        "is_registered": registered,
        "fingerprint_count": fp,
        "face_count": 0,
    }


class SnapshotTest(unittest.TestCase):
    #: The frappe mock is shared process-wide by every test module, so anything
    #: this class rebinds MUST be restored. test_bridge_auth.py:47-49 records
    #: what happens otherwise: a leaked `throw` broke five unrelated
    #: dashboard_auth tests when the suite ran together.
    _PATCHED = ("throw",)
    _MISSING = object()

    def setUp(self):
        self._saved = {
            name: getattr(mod.frappe, name, self._MISSING) for name in self._PATCHED
        }
        mod.frappe.throw = self._throw
        self.upserts = []
        self.cleared = []

    def tearDown(self):
        for name, value in self._saved.items():
            if value is self._MISSING:
                try:
                    delattr(mod.frappe, name)
                except AttributeError:
                    pass
            else:
                setattr(mod.frappe, name, value)

    def _throw(self, msg, exc=None):
        raise AssertionError("threw: %s" % msg)

    def _run(self, users, *, existing_registered=(), previous_count=None, **kwargs):
        """Drive notify_enrollment_snapshot with the DB stubbed out."""
        if previous_count is None:
            previous_count = len(existing_registered)

        def _get_all(doctype, filters=None, fields=None, pluck=None, **_):
            return list(existing_registered)

        with patch.object(mod, "validate_bridge_request"), patch.object(
            mod, "upsert_enrollment_row", side_effect=lambda **kw: self.upserts.append(kw)
        ), patch.object(
            mod, "_clear_absent_rows", side_effect=lambda absent, **kw: self.cleared.extend(absent)
        ), patch.object(
            mod, "_registered_employee_ids", return_value=set(existing_registered)
        ), patch.object(
            mod, "_previous_registered_count", return_value=previous_count
        ), patch.object(
            mod, "_record_snapshot_time"
        ), patch.object(mod.frappe.db, "commit"):
            return mod.notify_enrollment_snapshot(
                bridge_env="prod",
                scanned_at="2026-08-11 09:14:03",
                users=users,
                **kwargs,
            )

    def test_auth_runs_before_anything_else(self):
        """The gate must not be reachable around — assert it is called."""
        with patch.object(mod, "validate_bridge_request") as gate:
            with self.assertRaises(Exception):
                mod.notify_enrollment_snapshot(users=None)
        gate.assert_called_once()

    def test_each_linked_user_is_upserted(self):
        result = self._run([_user("E1"), _user("E2")])
        self.assertEqual({u["employee"] for u in self.upserts}, {"E1", "E2"})
        self.assertEqual(result["registered"], 2)

    def test_bridge_only_users_are_skipped_not_failed(self):
        """The device admin has no frappe_employee_id. It is not an error."""
        users = [_user("E1"), {"pin": "9999", "frappe_employee_id": None}]
        result = self._run(users)
        self.assertEqual([u["employee"] for u in self.upserts], ["E1"])
        self.assertEqual(result["skipped_unlinked"], 1)

    def test_an_employee_absent_from_the_snapshot_is_cleared(self):
        """Snapshot semantics: absent means not enrolled. This is the whole
        offboarding signal, and a delta could not express it."""
        self._run([_user("E1")], existing_registered=("E1", "E2"))
        self.assertEqual(self.cleared, ["E2"])

    def test_a_users_json_string_is_parsed(self):
        """Frappe hands form-encoded bodies through as strings."""
        import json

        result = self._run(json.dumps([_user("E1")]))
        self.assertEqual(result["registered"], 1)

    def test_a_halved_roster_is_rejected_as_a_partial_snapshot(self):
        """9 users where 30 were registered is far more likely a truncated read
        than 21 simultaneous departures. Rejecting leaves the previous snapshot
        authoritative rather than marking 21 people unenrolled."""
        mod.frappe.throw = self._raise
        with self.assertRaises(_Rejected) as ctx:
            self._run([_user("E%d" % i) for i in range(9)], previous_count=30)
        self.assertIn("partial snapshot", str(ctx.exception).lower())
        self.assertEqual(self.upserts, [])

    def test_allow_shrink_permits_a_genuine_mass_offboarding(self):
        mod.frappe.throw = self._raise
        result = self._run(
            [_user("E%d" % i) for i in range(9)], previous_count=30, allow_shrink=1
        )
        self.assertEqual(result["registered"], 9)

    def test_the_shrink_guard_does_not_fire_on_a_small_roster(self):
        """Below the floor, ordinary churn trips a ratio test constantly."""
        mod.frappe.throw = self._raise
        result = self._run([_user("E1")], previous_count=5)
        self.assertEqual(result["registered"], 1)

    def test_an_oversized_payload_is_rejected(self):
        mod.frappe.throw = self._raise
        with self.assertRaises(_Rejected):
            self._run([_user("E%d" % i) for i in range(mod.ENROLLMENT_SNAPSHOT_MAX_USERS + 1)])

    def _raise(self, msg, exc=None):
        raise _Rejected(str(msg))
```

And define the sentinel exception **once, immediately below the imports** at the
top of the file:

```python
class _Rejected(Exception):
    """What frappe.throw becomes for the tests that assert a rejection."""
```

- [ ] **Step 2: Run to verify they fail**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_ingest
```

Expected: failures on `AttributeError: module ... has no attribute 'notify_enrollment_snapshot'`.

- [ ] **Step 3: Implement the endpoint**

Append to `dewey_time/attendance_engine/enrollment.py`:

```python
from frappe.utils import cint

from dewey_time.attendance_engine.bridge_auth import validate_bridge_request

#: Hard ceiling on one snapshot payload. Production carries 237 bridge users.
ENROLLMENT_SNAPSHOT_MAX_USERS = 2000
#: Reject a snapshot that lost more than half its roster...
SNAPSHOT_SHRINK_RATIO = 0.5
#: ...but only once the roster is big enough that a ratio test means anything.
SNAPSHOT_SHRINK_FLOOR = 20


def _registered_employee_ids() -> set:
    return set(
        frappe.get_all(
            ENROLLMENT_DOCTYPE,
            filters={"is_registered": 1},
            pluck="employee",
        )
    )


def _previous_registered_count() -> int:
    return frappe.db.count(ENROLLMENT_DOCTYPE, {"is_registered": 1})


def _clear_absent_rows(absent, *, synced_at=None, bridge_env=None) -> int:
    """Mark rows absent from the snapshot as unenrolled.

    Cleared rather than deleted: is_registered = 0 IS the "not enrolled" fact,
    and keeping the row preserves the pin and the last-seen counts for anyone
    investigating why a template disappeared.
    """
    for employee in absent:
        upsert_enrollment_row(
            employee=employee,
            pin=frappe.db.get_value(ENROLLMENT_DOCTYPE, employee, "pin"),
            is_registered=False,
            fingerprint_count=0,
            face_count=0,
            synced_at=synced_at,
            bridge_env=bridge_env,
        )
    return len(absent)


def _record_snapshot_time(scanned_at):
    frappe.db.set_single_value(SETTINGS_DOCTYPE, "last_enrollment_snapshot_at", scanned_at)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def notify_enrollment_snapshot(bridge_env=None, scanned_at=None, users=None, allow_shrink=0):
    """Bridge webhook: the complete biometric enrollment roster.

    Auth: API key (Authorization: token key:secret) + optional X-Bridge-Secret,
    identical to notify_device_sync_status.

    This is a SNAPSHOT, never a delta. A delta cannot express "this template was
    deleted", which is precisely the offboarding signal the report exists for.
    Any employee absent from `users` is therefore recorded as not enrolled --
    which is also why a truncated payload is dangerous enough to reject.
    """
    validate_bridge_request()

    if isinstance(users, str):
        users = frappe.parse_json(users)
    if not isinstance(users, list):
        frappe.throw("users must be a list")

    if len(users) > ENROLLMENT_SNAPSHOT_MAX_USERS:
        frappe.throw(
            f"Refusing a partial snapshot: {len(users)} users exceeds the "
            f"{ENROLLMENT_SNAPSHOT_MAX_USERS} ceiling"
        )

    linked = [u for u in users if (u or {}).get("frappe_employee_id")]
    skipped_unlinked = len(users) - len(linked)

    previous = _previous_registered_count()
    if (
        not cint(allow_shrink)
        and previous >= SNAPSHOT_SHRINK_FLOOR
        and len(linked) < previous * SNAPSHOT_SHRINK_RATIO
    ):
        frappe.throw(
            f"Refusing a partial snapshot: {len(linked)} linked users against "
            f"{previous} previously registered. A halved roster is far more likely "
            f"a truncated read than a mass departure. Set allow_shrink=1 if it is real."
        )

    seen = set()
    for user in linked:
        employee = user["frappe_employee_id"]
        seen.add(employee)
        upsert_enrollment_row(
            employee=employee,
            pin=user.get("pin"),
            is_registered=bool(user.get("is_registered")),
            fingerprint_count=user.get("fingerprint_count"),
            face_count=user.get("face_count"),
            synced_at=scanned_at,
            bridge_env=bridge_env,
        )

    absent = sorted(_registered_employee_ids() - seen)
    cleared = _clear_absent_rows(absent, synced_at=scanned_at, bridge_env=bridge_env)

    _record_snapshot_time(scanned_at)
    frappe.db.commit()

    return {
        "ok": True,
        "registered": len(linked),
        "cleared": cleared,
        "skipped_unlinked": skipped_unlinked,
        "scanned_at": str(scanned_at),
    }
```

Move the two new imports to the top of the file with the existing `import frappe`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_ingest
```

Expected: `Ran 12 tests ... OK`.

- [ ] **Step 5: Mutation check**

Delete the shrink guard's whole `if` block. Re-run. Expected: `test_a_halved_roster_is_rejected_as_a_partial_snapshot` FAILS. Revert, confirm green, record it.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/enrollment.py dewey_time/tests/test_enrollment_ingest.py
git commit -m "feat(enrollment): snapshot ingest with a partial-payload guard

A full-snapshot payload asserts that every absent employee is unenrolled, so a
truncated read would mark the whole roster as needing enrolment. Rejected when
the linked count falls below half the previously-registered count and that
count was at least 20, with allow_shrink=1 for a genuine mass offboarding.

Absent rows are cleared, not deleted: is_registered = 0 IS the fact, and the
row keeps the pin for anyone investigating a vanished template.
Mutation-checked."
```

---

### Task 4: The read API and the integration seam

**Files:**
- Create: `dewey_time/attendance_engine/enrollment_api.py`
- Modify: `dewey_time/hooks.py`
- Test: `dewey_time/tests/test_enrollment_api.py`

**Interfaces:**
- Consumes: `classify`, `days_since`, the bucket constants and `REPORTED_STATUSES` from Task 1; `ENROLLMENT_DOCTYPE` from Task 2.
- Produces: whitelisted `get_enrollment_report()`; `enrollment_status(employee: str) -> dict`; `invalidate_enrollment_cache(doc=None, method=None)`. Payload shape — this is exactly what Task 5's TypeScript types must mirror:

```python
{
  "rows": [
    {"id": "HR-EMP-0042", "employee_name": "Ana Reyes", "branch": "ACES",
     "department": "Ops", "status": "Active", "bucket": "NEEDS_ENROLLMENT",
     "is_registered": False, "fingerprint_count": 0, "face_count": 0,
     "days_since_relieving": None}
  ],
  "counts": {"reported": 236, "needs_enrollment": 4, "enrolled_not_punching": 1,
             "ok": 229, "leaver_still_enrolled": 2, "excluded_status": 3,
             "truncated": False},
  "last_snapshot_at": "2026-08-11 09:14:03",
  "window_days": 14,
}
```

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_enrollment_api.py`:

```python
import unittest
from datetime import date
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import enrollment_api as mod  # noqa: E402
from dewey_time.attendance_engine import enrollment_buckets as buckets  # noqa: E402


def _emp(emp_id, *, status="Active", branch="ACES", dept="Ops", relieving=None):
    return {
        "name": emp_id,
        "employee_name": "Name %s" % emp_id,
        "status": status,
        "branch": branch,
        "department": dept,
        "relieving_date": relieving,
    }


def _reg(emp_id, *, registered=True, fp=1):
    return {
        "employee": emp_id,
        "pin": "1000",
        "is_registered": 1 if registered else 0,
        "fingerprint_count": fp,
        "face_count": 0,
    }


class BuildPayloadTest(unittest.TestCase):
    def _build(self, employees, register, checkins, *, snapshot="2026-08-11 09:14:03"):
        with patch.object(mod, "_list_employees", return_value=employees), patch.object(
            mod, "_register_rows", return_value=register
        ), patch.object(
            mod, "_checkin_counts", return_value=checkins
        ), patch.object(
            mod, "_last_snapshot_at", return_value=snapshot
        ), patch.object(
            mod, "_today", return_value=date(2026, 8, 11)
        ):
            return mod._build_enrollment_payload()

    def test_an_unenrolled_active_employee_lands_in_the_worklist(self):
        payload = self._build([_emp("E1")], [], {})
        self.assertEqual(payload["rows"][0]["bucket"], buckets.NEEDS_ENROLLMENT)
        self.assertEqual(payload["counts"]["needs_enrollment"], 1)

    def test_branch_and_department_come_from_employee_not_the_register(self):
        """Joined at read time so a transfer cannot leave the report stale."""
        payload = self._build([_emp("E1", branch="DIU", dept="Finance")], [_reg("E1")], {"E1": 2})
        row = payload["rows"][0]
        self.assertEqual(row["branch"], "DIU")
        self.assertEqual(row["department"], "Finance")

    def test_a_leaver_with_a_live_template_reports_days_since(self):
        payload = self._build(
            [_emp("E1", status="Left", relieving=date(2026, 8, 1))], [_reg("E1")], {"E1": 400}
        )
        row = payload["rows"][0]
        self.assertEqual(row["bucket"], buckets.LEAVER_STILL_ENROLLED)
        self.assertEqual(row["days_since_relieving"], 10)

    def test_out_of_population_employees_are_counted_not_dropped(self):
        """Silently omitting them makes the totals not add up, which reads as
        a bug in the report rather than a deliberate exclusion."""
        payload = self._build(
            [_emp("E1"), _emp("E2", status="Suspended"), _emp("E3", status="Inactive")], [], {}
        )
        self.assertEqual(len(payload["rows"]), 1)
        self.assertEqual(payload["counts"]["excluded_status"], 2)

    def test_a_never_synced_feed_reports_a_null_snapshot(self):
        """The client refuses to render a list on this. Without it every
        employee reads as unenrolled and HR acts on a plumbing failure."""
        payload = self._build([_emp("E1")], [], {}, snapshot=None)
        self.assertIsNone(payload["last_snapshot_at"])

    def test_the_scan_cap_sets_truncated(self):
        employees = [_emp("E%d" % i) for i in range(mod.ENROLLMENT_EMPLOYEE_LIMIT)]
        payload = self._build(employees, [], {})
        self.assertTrue(payload["counts"]["truncated"])

    def test_the_window_is_reported_so_the_ui_need_not_hardcode_it(self):
        payload = self._build([_emp("E1")], [], {})
        self.assertEqual(payload["window_days"], mod.NOT_PUNCHING_WINDOW_DAYS)


class SeamTest(unittest.TestCase):
    def test_enrollment_status_answers_for_one_employee(self):
        """The seam a future onboarding checklist calls, without the page."""
        with patch.object(mod.frappe.db, "get_value", return_value={
            "employee": "E1", "is_registered": 1, "fingerprint_count": 2,
            "face_count": 0, "synced_at": "2026-08-11 09:14:03",
        }), patch.object(mod, "_last_snapshot_at", return_value="2026-08-11 09:14:03"):
            status = mod.enrollment_status("E1")
        self.assertTrue(status["is_registered"])
        self.assertEqual(status["fingerprint_count"], 2)

    def test_an_employee_with_no_register_row_is_not_registered(self):
        with patch.object(mod.frappe.db, "get_value", return_value=None), patch.object(
            mod, "_last_snapshot_at", return_value="2026-08-11 09:14:03"
        ):
            status = mod.enrollment_status("E404")
        self.assertFalse(status["is_registered"])

    def test_the_seam_reports_feed_health_so_callers_cannot_misread_absence(self):
        """Without last_snapshot_at, "not registered" and "we have never heard
        from the bridge" are indistinguishable to a caller."""
        with patch.object(mod.frappe.db, "get_value", return_value=None), patch.object(
            mod, "_last_snapshot_at", return_value=None
        ):
            status = mod.enrollment_status("E1")
        self.assertIsNone(status["last_snapshot_at"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_api
```

Expected: `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.enrollment_api'`.

- [ ] **Step 3: Implement the read API**

Create `dewey_time/attendance_engine/enrollment_api.py`:

```python
"""Biometric enrollment read API.

Backs the HR-only Biometric Enrollment view (/hr-schedule/coverage/biometrics).

Shaped after coverage_api: HR role gate, a briefly-cached payload, and FLAT
rows plus counts. This module groups nothing -- the client does -- which is what
makes adding a third grouping axis a one-line change rather than a payload
redesign.
"""

from __future__ import annotations

import frappe
from frappe.utils import getdate

from dewey_time.attendance_engine.enrollment import ENROLLMENT_DOCTYPE, SETTINGS_DOCTYPE
from dewey_time.attendance_engine.enrollment_buckets import (
    ENROLLED_NOT_PUNCHING,
    LEAVER_STILL_ENROLLED,
    NEEDS_ENROLLMENT,
    OK,
    REPORTED_STATUSES,
    classify,
    days_since,
)
from dewey_time.attendance_engine.hr_calendar import _require_hr_role

_CACHE_KEY = "enrollment_report:v1"
_CACHE_TTL_SECONDS = 120

#: Matches COVERAGE_EMPLOYEE_LIMIT: this is meant to be an exhaustive roster.
ENROLLMENT_EMPLOYEE_LIMIT = 2000

#: How far back a check-in counts as "this template works". Two weeks clears
#: ordinary leave. Deliberately a constant and not a setting -- an unused
#: setting is a config surface someone must reason about forever.
NOT_PUNCHING_WINDOW_DAYS = 14

_BUCKET_COUNT_KEYS = {
    NEEDS_ENROLLMENT: "needs_enrollment",
    ENROLLED_NOT_PUNCHING: "enrolled_not_punching",
    OK: "ok",
    LEAVER_STILL_ENROLLED: "leaver_still_enrolled",
}


def _today():
    return getdate()


def _list_employees() -> list[dict]:
    return frappe.get_all(
        "Employee",
        filters={"status": ["in", list(REPORTED_STATUSES) + ["Inactive", "Suspended"]]},
        fields=["name", "employee_name", "status", "branch", "department", "relieving_date"],
        limit_page_length=ENROLLMENT_EMPLOYEE_LIMIT,
        order_by="employee_name asc",
    )


def _register_rows() -> list[dict]:
    return frappe.get_all(
        ENROLLMENT_DOCTYPE,
        fields=["employee", "pin", "is_registered", "fingerprint_count", "face_count"],
        limit_page_length=0,
    )


def _checkin_counts(since) -> dict:
    """One aggregate for the whole roster -- never a query per employee."""
    rows = frappe.get_all(
        "Employee Checkin",
        filters={"time": [">=", since]},
        fields=["employee", "count(name) as n"],
        group_by="employee",
        limit_page_length=0,
    )
    return {row["employee"]: row["n"] for row in rows}


def _last_snapshot_at():
    return frappe.db.get_single_value(SETTINGS_DOCTYPE, "last_enrollment_snapshot_at")


def _build_enrollment_payload() -> dict:
    employees = _list_employees()
    register = {row["employee"]: row for row in _register_rows()}
    today = _today()
    counts = {key: 0 for key in _BUCKET_COUNT_KEYS.values()}
    counts["excluded_status"] = 0

    since = frappe.utils.add_days(today, -NOT_PUNCHING_WINDOW_DAYS)
    checkins = _checkin_counts(since)

    rows = []
    for employee in employees:
        reg = register.get(employee["name"]) or {}
        is_registered = bool(reg.get("is_registered"))
        bucket = classify(
            status=employee.get("status") or "",
            is_registered=is_registered,
            checkin_count=checkins.get(employee["name"], 0),
        )
        if bucket is None:
            # Counted, never silently dropped: totals that do not add up read
            # as a bug in the report rather than a deliberate exclusion.
            if employee.get("status") not in REPORTED_STATUSES:
                counts["excluded_status"] += 1
            continue

        counts[_BUCKET_COUNT_KEYS[bucket]] += 1
        rows.append(
            {
                "id": employee["name"],
                "employee_name": employee.get("employee_name"),
                "branch": employee.get("branch"),
                "department": employee.get("department"),
                "status": employee.get("status"),
                "bucket": bucket,
                "is_registered": is_registered,
                "fingerprint_count": int(reg.get("fingerprint_count") or 0),
                "face_count": int(reg.get("face_count") or 0),
                "days_since_relieving": days_since(
                    getdate(employee["relieving_date"]) if employee.get("relieving_date") else None,
                    today,
                ),
            }
        )

    counts["reported"] = len(rows)
    counts["truncated"] = len(employees) >= ENROLLMENT_EMPLOYEE_LIMIT

    return {
        "rows": rows,
        "counts": counts,
        "last_snapshot_at": _last_snapshot_at(),
        "window_days": NOT_PUNCHING_WINDOW_DAYS,
    }


def invalidate_enrollment_cache(doc=None, method=None):
    """Drop the cached payload. Wired to register doc events so a fresh
    snapshot shows up immediately rather than after the TTL."""
    frappe.cache().delete_value(_CACHE_KEY)


@frappe.whitelist()
def get_enrollment_report():
    """HR-only: every reported employee with their enrollment bucket."""
    _require_hr_role()

    cached = frappe.cache().get_value(_CACHE_KEY)
    if cached:
        return cached

    payload = _build_enrollment_payload()
    frappe.cache().set_value(_CACHE_KEY, payload, expires_in_sec=_CACHE_TTL_SECONDS)
    return payload


def enrollment_status(employee: str) -> dict:
    """Enrollment facts for one employee.

    The integration seam. The page is one consumer; a future onboarding or
    offboarding checklist is another, and it must be able to ask without
    building a whole report.

    `last_snapshot_at` is part of the answer on purpose: without it a caller
    cannot tell "this person is not enrolled" from "we have never heard from
    the bridge".
    """
    row = frappe.db.get_value(
        ENROLLMENT_DOCTYPE,
        employee,
        ["employee", "is_registered", "fingerprint_count", "face_count", "synced_at"],
        as_dict=True,
    )
    return {
        "employee": employee,
        "is_registered": bool(row and row.get("is_registered")),
        "fingerprint_count": int((row or {}).get("fingerprint_count") or 0),
        "face_count": int((row or {}).get("face_count") or 0),
        "synced_at": (row or {}).get("synced_at"),
        "last_snapshot_at": _last_snapshot_at(),
    }
```

- [ ] **Step 4: Wire cache invalidation**

In `dewey_time/hooks.py`, inside the existing `doc_events` dict (next to the `Shift Schedule Assignment` block at `:130`), add:

```python
    # Keep the Biometric Enrollment view fresh: a snapshot rewrites many rows,
    # so drop the cached payload rather than serve a stale one for the TTL.
    "Employee Biometric Enrollment": {
        "after_insert": "dewey_time.attendance_engine.enrollment_api.invalidate_enrollment_cache",
        "on_update": "dewey_time.attendance_engine.enrollment_api.invalidate_enrollment_cache",
        "on_trash": "dewey_time.attendance_engine.enrollment_api.invalidate_enrollment_cache",
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_api
python3 -m unittest discover -s dewey_time/tests -t .
```

Expected: the module's 10 tests OK, and the full suite at **773 tests, 24 skipped, green** (751 baseline + 10 + 12).

- [ ] **Step 6: Mutation check**

In `_build_enrollment_payload`, change the `excluded_status` increment to `pass`. Re-run. Expected: `test_out_of_population_employees_are_counted_not_dropped` FAILS. Revert, confirm green, record it.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/enrollment_api.py dewey_time/hooks.py dewey_time/tests/test_enrollment_api.py
git commit -m "feat(enrollment): read API and the enrollment_status seam

Three queries flat: one Employee scan, one register read, one Employee Checkin
aggregate grouped by employee. Branch and department join from Employee at read
time so a transfer cannot leave the report asserting something stale.

Returns flat rows and counts; the client groups. That is what keeps a third
grouping axis a one-line change.

enrollment_status(employee) is the seam a future onboarding/offboarding
checklist calls. It reports last_snapshot_at because otherwise a caller cannot
tell 'not enrolled' from 'the bridge has never reported'. Mutation-checked."
```

---

### Task 5: Frontend types, report logic, and CSV

All pure. No React, no network.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/lib/enrollmentReport.ts`
- Create: `dewey_time/frontend/hr_attendance/src/lib/enrollmentCsv.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/enrollmentReport.test.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/enrollmentCsv.test.ts`

**Interfaces:**
- Consumes: the payload shape from Task 4.
- Produces: types `EnrollmentBucket`, `EnrollmentRow`, `EnrollmentCounts`, `EnrollmentPayload`, `EnrollmentFilters`, `GroupBy`, `EnrollmentGroup`; functions `isFeedConnected`, `snapshotNotice`, `filterRows`, `groupRows`, `BUCKET_LABELS`; and `toEnrollmentCsv`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/enrollmentReport.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  filterRows,
  groupRows,
  isFeedConnected,
  snapshotNotice,
  type EnrollmentPayload,
  type EnrollmentRow,
} from "@/lib/enrollmentReport";

// LOCAL, deliberately — no trailing Z. Frappe datetimes are site-local and
// parseFrappeDatetime reads them as local, so a UTC `now` here would compare
// two different frames. Measured: that mistake yields 466 minutes at UTC+07
// and 46 on a UTC CI runner — a test that passes in CI and fails on a laptop.
const NOW = new Date("2026-08-11T10:00:00").getTime();

function row(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "E1",
    employee_name: "Ana Reyes",
    branch: "ACES",
    department: "Ops",
    status: "Active",
    bucket: "NEEDS_ENROLLMENT",
    is_registered: false,
    fingerprint_count: 0,
    face_count: 0,
    days_since_relieving: null,
    ...over,
  };
}

function payload(over: Partial<EnrollmentPayload> = {}): EnrollmentPayload {
  return {
    rows: [],
    counts: {
      reported: 0,
      needs_enrollment: 0,
      enrolled_not_punching: 0,
      ok: 0,
      leaver_still_enrolled: 0,
      excluded_status: 0,
      truncated: false,
    },
    last_snapshot_at: "2026-08-11 09:14:03",
    window_days: 14,
    ...over,
  };
}

describe("isFeedConnected", () => {
  it("is false when no snapshot has ever arrived", () => {
    // The load-bearing one. Without this the page renders every employee as
    // unenrolled and HR responds to a plumbing failure as though it were data.
    expect(isFeedConnected(payload({ last_snapshot_at: null }))).toBe(false);
  });

  it("is false while the payload is still undefined", () => {
    expect(isFeedConnected(undefined)).toBe(false);
  });

  it("is true once a snapshot exists", () => {
    expect(isFeedConnected(payload())).toBe(true);
  });
});

describe("snapshotNotice", () => {
  it("reports a fresh snapshot in minutes without alarming", () => {
    const notice = snapshotNotice(payload(), NOW);
    expect(notice?.stale).toBe(false);
    expect(notice?.text).toContain("46 minutes ago");
  });

  it("marks a snapshot older than a day as stale", () => {
    const notice = snapshotNotice(payload({ last_snapshot_at: "2026-08-09 09:00:00" }), NOW);
    expect(notice?.stale).toBe(true);
  });

  it("returns null when there is nothing to date", () => {
    expect(snapshotNotice(payload({ last_snapshot_at: null }), NOW)).toBeNull();
  });

  it("returns null rather than NaN on an unparseable timestamp", () => {
    expect(snapshotNotice(payload({ last_snapshot_at: "not a date" }), NOW)).toBeNull();
  });
});

describe("filterRows", () => {
  const rows = [
    row({ id: "E1", branch: "ACES", department: "Ops", bucket: "NEEDS_ENROLLMENT" }),
    row({ id: "E2", branch: "DIU", department: "Finance", bucket: "OK" }),
    row({ id: "E3", branch: "ACES", department: "Finance", bucket: "LEAVER_STILL_ENROLLED" }),
  ];

  it("returns everything when no filter is set", () => {
    expect(filterRows(rows, { branches: [], departments: [], buckets: [] })).toHaveLength(3);
  });

  it("narrows by branch", () => {
    const out = filterRows(rows, { branches: ["ACES"], departments: [], buckets: [] });
    expect(out.map((r) => r.id)).toEqual(["E1", "E3"]);
  });

  it("ANDs across axes and ORs within one", () => {
    const out = filterRows(rows, {
      branches: ["ACES"],
      departments: ["Finance"],
      buckets: ["LEAVER_STILL_ENROLLED", "OK"],
    });
    expect(out.map((r) => r.id)).toEqual(["E3"]);
  });
});

describe("groupRows", () => {
  const rows = [
    row({ id: "E1", branch: "DIU" }),
    row({ id: "E2", branch: "ACES" }),
    row({ id: "E3", branch: null }),
  ];

  it("groups by branch, alphabetically", () => {
    const groups = groupRows(rows, "branch");
    expect(groups.map((g) => g.key)).toEqual(["ACES", "DIU", "Unassigned"]);
  });

  it("collects rows with no value under one explicit group, never dropping them", () => {
    const groups = groupRows(rows, "branch");
    expect(groups.at(-1)?.rows.map((r) => r.id)).toEqual(["E3"]);
  });
});
```

Create `src/lib/enrollmentCsv.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { toEnrollmentCsv } from "@/lib/enrollmentCsv";
import type { EnrollmentRow } from "@/lib/enrollmentReport";

const ROWS: EnrollmentRow[] = [
  {
    id: "E1",
    employee_name: "Ana Reyes",
    branch: "ACES",
    department: "Ops",
    status: "Active",
    bucket: "NEEDS_ENROLLMENT",
    is_registered: false,
    fingerprint_count: 0,
    face_count: 0,
    days_since_relieving: null,
  },
];

describe("toEnrollmentCsv", () => {
  it("puts the snapshot time in the file, not only the filename", () => {
    // A CSV outlives its context. Without this row, stale enrollment data
    // looks current three weeks later.
    const csv = toEnrollmentCsv(ROWS, {
      snapshotAt: "2026-08-11 09:14:03",
      filterLabel: "All branches",
    });
    expect(csv.split("\n")[0]).toBe("Snapshot taken,2026-08-11 09:14:03");
  });

  it("records the filter so a partial export cannot read as the whole roster", () => {
    const csv = toEnrollmentCsv(ROWS, { snapshotAt: null, filterLabel: "Branch: ACES" });
    expect(csv).toContain("Filter,Branch: ACES");
  });

  it("says so explicitly when no snapshot exists", () => {
    const csv = toEnrollmentCsv(ROWS, { snapshotAt: null, filterLabel: "All" });
    expect(csv.split("\n")[0]).toBe("Snapshot taken,never — feed not connected");
  });

  it("quotes fields containing a comma", () => {
    const csv = toEnrollmentCsv(
      [{ ...ROWS[0], employee_name: "Reyes, Ana" }],
      { snapshotAt: null, filterLabel: "All" },
    );
    expect(csv).toContain('"Reyes, Ana"');
  });

  it("doubles embedded quotes", () => {
    const csv = toEnrollmentCsv(
      [{ ...ROWS[0], employee_name: 'Ana "Nan" Reyes' }],
      { snapshotAt: null, filterLabel: "All" },
    );
    expect(csv).toContain('"Ana ""Nan"" Reyes"');
  });

  it("emits an empty cell for an unknown leaving date rather than 0", () => {
    const csv = toEnrollmentCsv(ROWS, { snapshotAt: null, filterLabel: "All" });
    expect(csv.trimEnd().split("\n").at(-1)).toMatch(/,$/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/enrollmentReport.test.ts src/lib/enrollmentCsv.test.ts
```

Expected: `Failed to resolve import "@/lib/enrollmentReport"`.

- [ ] **Step 3: Write `enrollmentReport.ts`**

```ts
// Pure presentation logic for the Biometric Enrollment view. The backend
// returns flat rows and counts; every grouping, filtering and copy decision
// lives here so it stays unit-testable and adjustable without a backend deploy.

export type EnrollmentBucket =
  | "NEEDS_ENROLLMENT"
  | "ENROLLED_NOT_PUNCHING"
  | "OK"
  | "LEAVER_STILL_ENROLLED";

export type EnrollmentRow = {
  id: string;
  employee_name: string | null;
  branch: string | null;
  department: string | null;
  status: string;
  bucket: EnrollmentBucket;
  is_registered: boolean;
  fingerprint_count: number;
  /** Carried because the bridge computes it; no UI column — nobody enrolls faces. */
  face_count: number;
  days_since_relieving: number | null;
};

export type EnrollmentCounts = {
  reported: number;
  needs_enrollment: number;
  enrolled_not_punching: number;
  ok: number;
  leaver_still_enrolled: number;
  excluded_status: number;
  truncated: boolean;
};

/** Shape returned by the get_enrollment_report whitelisted method. */
export type EnrollmentPayload = {
  rows: EnrollmentRow[];
  counts: EnrollmentCounts;
  last_snapshot_at: string | null;
  window_days: number;
};

export const BUCKET_LABELS: Record<EnrollmentBucket, string> = {
  NEEDS_ENROLLMENT: "Needs enrolling",
  ENROLLED_NOT_PUNCHING: "Enrolled, not punching",
  OK: "Enrolled and punching",
  LEAVER_STILL_ENROLLED: "Left — still enrolled",
};

export type EnrollmentFilters = {
  branches: string[];
  departments: string[];
  buckets: EnrollmentBucket[];
};

export type GroupBy = "branch" | "department";

export type EnrollmentGroup = {
  key: string;
  rows: EnrollmentRow[];
};

/** Rows with no branch/department collect here rather than vanishing. */
const UNGROUPED = "Unassigned";

/** Older than this and the snapshot notice escalates from informational. */
const STALE_AFTER_MINUTES = 24 * 60;

/**
 * Has the bridge EVER reported? Gates the whole list.
 *
 * With no snapshot, every employee correctly computes as unenrolled — and that
 * is exactly the problem: a plumbing failure would render as 236 findings. The
 * page must say the feed is not connected instead.
 */
export function isFeedConnected(payload: EnrollmentPayload | undefined): boolean {
  return Boolean(payload?.last_snapshot_at);
}

/** Frappe datetimes are "YYYY-MM-DD HH:MM:SS" in site-local time. */
function parseFrappeDatetime(value: string): number | null {
  const ms = Date.parse(value.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}

function humaniseAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function snapshotNotice(
  payload: EnrollmentPayload | undefined,
  nowMs: number,
): { text: string; stale: boolean } | null {
  const raw = payload?.last_snapshot_at;
  if (!raw) return null;
  const at = parseFrappeDatetime(raw);
  if (at === null) return null;

  const minutes = Math.max(0, Math.round((nowMs - at) / 60000));
  return {
    text: `Device data as of ${humaniseAge(minutes)}.`,
    stale: minutes > STALE_AFTER_MINUTES,
  };
}

/** AND across axes, OR within one. An empty axis means "no constraint". */
export function filterRows(rows: EnrollmentRow[], filters: EnrollmentFilters): EnrollmentRow[] {
  return rows.filter((row) => {
    if (filters.branches.length && !filters.branches.includes(row.branch ?? UNGROUPED)) return false;
    if (filters.departments.length && !filters.departments.includes(row.department ?? UNGROUPED)) {
      return false;
    }
    if (filters.buckets.length && !filters.buckets.includes(row.bucket)) return false;
    return true;
  });
}

/** Group alphabetically, with the value-less group always last. */
export function groupRows(rows: EnrollmentRow[], by: GroupBy): EnrollmentGroup[] {
  const groups = new Map<string, EnrollmentRow[]>();
  for (const row of rows) {
    const key = (by === "branch" ? row.branch : row.department) || UNGROUPED;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .map(([key, groupRows_]) => ({ key, rows: groupRows_ }))
    .sort((a, b) => {
      if (a.key === UNGROUPED) return 1;
      if (b.key === UNGROUPED) return -1;
      return a.key.localeCompare(b.key);
    });
}
```

- [ ] **Step 4: Write `enrollmentCsv.ts`**

```ts
import { BUCKET_LABELS, type EnrollmentRow } from "@/lib/enrollmentReport";

const HEADERS = [
  "Employee ID",
  "Name",
  "Branch",
  "Department",
  "Employment status",
  "Enrollment state",
  "Fingerprints",
  "Days since leaving",
];

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export type CsvContext = {
  /** Frappe datetime of the snapshot, or null when the feed never reported. */
  snapshotAt: string | null;
  /** Human description of the active filters, e.g. "Branch: ACES". */
  filterLabel: string;
};

/**
 * Rows → CSV.
 *
 * The snapshot time is a ROW in the file, not just the filename: a CSV outlives
 * its context, and without it stale enrollment data reads as current three
 * weeks later. The filter is recorded for the same reason — a narrowed export
 * must not be mistaken for the whole roster.
 */
export function toEnrollmentCsv(rows: EnrollmentRow[], context: CsvContext): string {
  const lines = [
    `Snapshot taken,${cell(context.snapshotAt ?? "never — feed not connected")}`,
    `Filter,${cell(context.filterLabel)}`,
    "",
    HEADERS.join(","),
  ];

  for (const row of rows) {
    lines.push(
      [
        cell(row.id),
        cell(row.employee_name),
        cell(row.branch),
        cell(row.department),
        cell(row.status),
        cell(BUCKET_LABELS[row.bucket]),
        cell(row.fingerprint_count),
        cell(row.days_since_relieving),
      ].join(","),
    );
  }

  return lines.join("\n");
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/enrollmentReport.test.ts src/lib/enrollmentCsv.test.ts
```

Expected: 20 tests passing.

- [ ] **Step 6: Mutation check**

Change `isFeedConnected` to `return true;`. Re-run. Expected: two tests FAIL. Revert, confirm green, record it.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/enrollmentReport.ts dewey_time/frontend/hr_attendance/src/lib/enrollmentCsv.ts dewey_time/frontend/hr_attendance/src/lib/enrollmentReport.test.ts dewey_time/frontend/hr_attendance/src/lib/enrollmentCsv.test.ts
git commit -m "feat(enrollment): pure report logic, staleness copy, and CSV

isFeedConnected gates the whole list. With no snapshot every employee
correctly computes as unenrolled, which is exactly the danger: a plumbing
failure would render as 236 findings.

The CSV carries the snapshot time and the active filter as rows in the file,
not just the filename — a CSV outlives its context. Mutation-checked."
```

---

### Task 6: Service, hook, and query key

**Test tooling reality — read before writing any test.** This SPA has **no vitest, no @testing-library/react, no jsdom**. `package.json` declares `test:web` as `tsx --test <glob list>`, and all 78 existing test files use `node:test` + `node:assert/strict`. Components are exercised with `renderToStaticMarkup` from `react-dom/server`; call sites are pinned with `readFileSync` source-text assertions (see `src/ui/DayChips.test.tsx`). There is no module mocking and no async render, so a `useQuery` hook cannot be driven to a resolved state in a test here. Do not attempt it.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/services/enrollment.ts`
- Create: `dewey_time/frontend/hr_attendance/src/hooks/useEnrollmentReport.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/queryKeys.ts`
- Modify: `dewey_time/frontend/hr_attendance/package.json` (extend the `test:web` glob — see Step 1)
- Test: `dewey_time/frontend/hr_attendance/src/lib/enrollmentWiring.test.ts`

**Interfaces:**
- Consumes: `EnrollmentPayload` from Task 5 (`@/lib/enrollmentReport`).
- Produces: `getEnrollmentReport()`; `useEnrollmentReport(): { payload, isLoading, error, refresh }`; `queryKeys.enrollment.all`.

- [ ] **Step 1: Confirm where a test file is allowed to live**

```bash
cd dewey_time/frontend/hr_attendance && grep -n '"test:web"' package.json
```

The glob lists directories explicitly. `src/lib/*.test.ts` is covered; **`src/hooks/` is not**. That is why this task's test lives in `src/lib/enrollmentWiring.test.ts` rather than beside the hook: a test outside the glob passes locally and never runs in CI. Do not add a `src/hooks/*.test.ts` entry to the glob — a glob that matches nothing makes `tsx --test` fail on the literal path once the file is later moved or removed.

- [ ] **Step 2: Write the failing test**

Create `src/lib/enrollmentWiring.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { queryKeys } from "@/lib/queryKeys";

const service = readFileSync(new URL("../services/enrollment.ts", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useEnrollmentReport.ts", import.meta.url), "utf8");

// The dotted path is a string handed to the server. A typo does not fail to
// compile -- it 404s at runtime. This system lost two bridge feeds for eleven
// days to exactly that, so the literal is pinned here rather than derived.
test("the service calls the exact whitelisted method path", () => {
  assert.match(
    service,
    /"dewey_time\.attendance_engine\.enrollment_api\.get_enrollment_report"/,
  );
});

test("the enrollment query key is its own family", () => {
  assert.deepEqual(queryKeys.enrollment.all, ["enrollment"]);
});

test("the enrollment key does not collide with the coverage key", () => {
  // Two queries sharing one key share one cache entry, and whichever mounted
  // first would hand the other its payload.
  assert.notDeepEqual(queryKeys.enrollment.all, queryKeys.coverage.all);
});

test("the hook returns the payload undefined rather than defaulting it", () => {
  // An empty payload would render as "nobody is enrolled" -- the exact
  // misreading isFeedConnected exists to prevent. There is no DOM in this
  // suite, so the contract is pinned in source instead of by rendering.
  assert.doesNotMatch(hook, /payload:\s*data\s*\?\?/);
  assert.match(hook, /payload:\s*data\b/);
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/enrollmentWiring.test.ts
```

Expected: failure reading `../services/enrollment.ts` — the file does not exist yet.

- [ ] **Step 4: Add the query key**

In `src/lib/queryKeys.ts`, after the `coverage` block:

```ts
  enrollment: {
    all: ["enrollment"] as const,
  },
```

- [ ] **Step 5: Write the service and hook**

`src/services/enrollment.ts`:

```ts
import { frappeCall } from "@/lib/frappe";
import type { EnrollmentPayload } from "@/lib/enrollmentReport";

export function getEnrollmentReport() {
  return frappeCall<EnrollmentPayload>(
    "dewey_time.attendance_engine.enrollment_api.get_enrollment_report",
  );
}
```

`src/hooks/useEnrollmentReport.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { EnrollmentPayload } from "@/lib/enrollmentReport";
import { queryKeys } from "@/lib/queryKeys";
import { getEnrollmentReport } from "@/services/enrollment";

export type EnrollmentReport = {
  /** Undefined until loaded, and undefined on error -- deliberately NOT an
   *  empty payload, which would render as "nobody is enrolled". */
  payload: EnrollmentPayload | undefined;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
};

export function useEnrollmentReport(): EnrollmentReport {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.enrollment.all,
    queryFn: getEnrollmentReport,
  });

  return useMemo(
    () => ({ payload: data, isLoading, error, refresh: () => void refetch() }),
    [data, isLoading, error, refetch],
  );
}
```

- [ ] **Step 6: Run the tests and the typecheck**

```bash
cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/enrollmentWiring.test.ts && npm run test:web && npm run typecheck
```

Expected: 4 new tests pass, the full `test:web` count rises by 4, typecheck clean.

- [ ] **Step 7: Mutation check**

Change the service's method path to `...get_enrollment_reportX`. Re-run. Expected: the path test FAILS. Revert and confirm green. Record the observed output for both.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/services/enrollment.ts \
        dewey_time/frontend/hr_attendance/src/hooks/useEnrollmentReport.ts \
        dewey_time/frontend/hr_attendance/src/lib/queryKeys.ts \
        dewey_time/frontend/hr_attendance/src/lib/enrollmentWiring.test.ts
git commit -m "feat(enrollment): service, hook, and query key

The dotted method path is pinned against a literal. A typo there does not
fail to compile, it 404s at runtime -- which is how this system lost two
bridge feeds for eleven days.

payload stays undefined on error rather than defaulting to an empty payload;
an empty one renders as 'nobody is enrolled', the exact misreading the feed
gate exists to prevent. No DOM in this suite, so that contract is pinned in
source rather than by rendering."
```

---

### Task 7: The view, the page, the sub-nav, and the route

**Why this task splits the component.** There is no DOM and no module mocking in this suite, so a component that calls `useEnrollmentReport` internally cannot be rendered in a test at all. The fix is the split this repo already uses for the flag queue: a **pure view** that takes the payload as props and is statically renderable, and a **thin page** that calls the hook and passes it down. All behaviour is tested on the view; the page is pinned by source text.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/ui/schedule-coverage/CoverageViewNav.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/BiometricEnrollmentView.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/schedule-coverage/BiometricEnrollmentPage.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/schedule-coverage/ScheduleCoveragePage.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/main.tsx`
- Test: `dewey_time/frontend/hr_attendance/src/ui/biometricEnrollmentView.test.tsx`

The view lives at `src/ui/` (not the subdirectory) because `test:web` globs `src/ui/*.test.tsx` one level only; its test must sit beside it to run in CI.

**Interfaces:**
- Consumes: `useEnrollmentReport` (Task 6); `isFeedConnected`, `snapshotNotice`, `filterRows`, `groupRows`, `BUCKET_LABELS`, `toEnrollmentCsv` (Task 5).
- Produces: route `/hr-schedule/coverage/biometrics`.

- [ ] **Step 1: Verify the two routing assumptions before writing anything**

```bash
grep -n 'startsWith("/hr-schedule/coverage")' dewey_time/frontend/hr_attendance/src/ui/HrAppShell.tsx
grep -n 'hr-schedule/<path:app_path>' dewey_time/hooks.py
```

Both must already match, which is why no new `www/` page or `website_route_rules` entry is needed. If either does not, stop and report.

- [ ] **Step 2: Write the failing test**

Create `src/ui/biometricEnrollmentView.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { BiometricEnrollmentView } from "@/ui/BiometricEnrollmentView";
import type { EnrollmentPayload, EnrollmentRow } from "@/lib/enrollmentReport";

const page = readFileSync(
  new URL("./schedule-coverage/BiometricEnrollmentPage.tsx", import.meta.url),
  "utf8",
);

function row(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "E1", employee_name: "Ana Reyes", branch: "ACES", department: "Ops",
    status: "Active", bucket: "NEEDS_ENROLLMENT", is_registered: false,
    fingerprint_count: 0, face_count: 0, days_since_relieving: null, ...over,
  };
}

function payload(over: Partial<EnrollmentPayload> = {}): EnrollmentPayload {
  return {
    rows: [row()],
    counts: { reported: 1, needs_enrollment: 1, enrolled_not_punching: 0, ok: 0,
              leaver_still_enrolled: 0, excluded_status: 0, truncated: false },
    last_snapshot_at: "2026-08-11 09:14:03",
    window_days: 14,
    ...over,
  };
}

const NOW = new Date("2026-08-11T10:00:00").getTime();

function markup(p: EnrollmentPayload | undefined) {
  return renderToStaticMarkup(<BiometricEnrollmentView payload={p} nowMs={NOW} />);
}

test("it refuses to render the list when the feed has never reported", () => {
  // The load-bearing one: otherwise a plumbing failure renders as every
  // employee needing enrolment.
  const html = markup(payload({ last_snapshot_at: null }));
  assert.match(html, /feed is not connected/i);
  assert.doesNotMatch(html, /Ana Reyes/);
});

test("it renders the roster once a snapshot exists", () => {
  const html = markup(payload());
  assert.match(html, /Ana Reyes/);
  assert.doesNotMatch(html, /feed is not connected/i);
});

test("it shows the snapshot age so the list is never read as live", () => {
  assert.match(markup(payload()), /Device data as of/i);
});

test("a leaver with a live template gets its own prominence", () => {
  const html = markup(payload({
    rows: [row({ id: "E9", employee_name: "Sam Okafor", status: "Left",
                 bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
                 fingerprint_count: 2, days_since_relieving: 10 })],
  }));
  assert.match(html, /Left — still enrolled/);
  assert.match(html, /10 days/);
});

test("export is disabled while the roster is truncated", () => {
  // A partial CSV that looks complete is worse than no CSV.
  const html = markup(payload({
    counts: { reported: 1, needs_enrollment: 1, enrolled_not_punching: 0, ok: 0,
              leaver_still_enrolled: 0, excluded_status: 0, truncated: true },
  }));
  assert.match(html, /disabled/);
});

test("employees excluded by status are footnoted, not hidden", () => {
  const html = markup(payload({
    counts: { reported: 1, needs_enrollment: 1, enrolled_not_punching: 0, ok: 0,
              leaver_still_enrolled: 0, excluded_status: 3, truncated: false },
  }));
  assert.match(html, /3 employees are not shown/i);
});

test("the page holds no copy or logic of its own", () => {
  // A second formatting site would drift from the tested one in silence.
  assert.doesNotMatch(page, /feed is not connected/i);
  assert.doesNotMatch(page, /Device data as of/i);
  assert.match(page, /BiometricEnrollmentView/);
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance && npx tsx --test src/ui/biometricEnrollmentView.test.tsx
```

Expected: cannot resolve `@/ui/BiometricEnrollmentView`.

- [ ] **Step 4: Write the sub-nav**

`src/ui/schedule-coverage/CoverageViewNav.tsx`:

```tsx
import { Link, useLocation } from "react-router-dom";

// Both coverage views are "observed readiness" checks -- the system looks,
// rather than a human ticking a box. They share one tab-bar entry because a
// fifth top-level tab does not fit the phone bar, and because grouping them is
// the honest information architecture.
const VIEWS = [
  { href: "/hr-schedule/coverage", label: "Schedule" },
  { href: "/hr-schedule/coverage/biometrics", label: "Biometrics" },
] as const;

export function CoverageViewNav() {
  const { pathname } = useLocation();
  // Longest match wins: "/hr-schedule/coverage" is a prefix of the other.
  const active = [...VIEWS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((view) => pathname.startsWith(view.href))?.href;

  return (
    <div className="flex gap-1" role="navigation" aria-label="Coverage views">
      {VIEWS.map((view) => (
        <Link
          key={view.href}
          to={view.href}
          aria-current={active === view.href ? "page" : undefined}
          className={
            active === view.href
              ? "rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground"
              : "rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          }
        >
          {view.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write the pure view**

`src/ui/BiometricEnrollmentView.tsx` — takes the payload and the clock as props so it is fully statically renderable:

```tsx
import { FingerprintIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { toEnrollmentCsv } from "@/lib/enrollmentCsv";
import {
  BUCKET_LABELS,
  filterRows,
  groupRows,
  isFeedConnected,
  snapshotNotice,
  type EnrollmentBucket,
  type EnrollmentFilters,
  type EnrollmentPayload,
  type GroupBy,
} from "@/lib/enrollmentReport";

const NO_FILTERS: EnrollmentFilters = { branches: [], departments: [], buckets: [] };

function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type BiometricEnrollmentViewProps = {
  payload: EnrollmentPayload | undefined;
  /** Injected so the snapshot age is deterministic in tests. */
  nowMs: number;
};

export function BiometricEnrollmentView(props: BiometricEnrollmentViewProps) {
  const [filters, setFilters] = useState<EnrollmentFilters>(NO_FILTERS);
  const [groupBy, setGroupBy] = useState<GroupBy>("branch");

  const notice = useMemo(
    () => snapshotNotice(props.payload, props.nowMs),
    [props.payload, props.nowMs],
  );
  const visible = useMemo(
    () => filterRows(props.payload?.rows ?? [], filters),
    [props.payload, filters],
  );
  const groups = useMemo(() => groupRows(visible, groupBy), [visible, groupBy]);

  // The gate. Without a snapshot every employee computes as unenrolled, so
  // rendering the list would turn a plumbing failure into a roster-sized
  // worklist. FailureBlock, not a strip: this IS broken, and it already
  // carries role="alert".
  if (!isFeedConnected(props.payload)) {
    return (
      <div className="flex h-full flex-col p-4">
        <FailureBlock
          title="The device feed is not connected"
          cause="No enrollment snapshot has ever been received. Until the bridge reports, this page cannot tell who is enrolled — every employee would read as unenrolled."
        />
      </div>
    );
  }

  const payload = props.payload!;
  const counts = payload.counts;
  const filterLabel =
    filters.branches.length || filters.departments.length || filters.buckets.length
      ? [
          filters.branches.length ? `Branch: ${filters.branches.join(", ")}` : null,
          filters.departments.length ? `Department: ${filters.departments.join(", ")}` : null,
          filters.buckets.length
            ? `State: ${filters.buckets.map((b) => BUCKET_LABELS[b]).join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join(" | ")
      : "All employees";

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {notice ? (
        <AttentionStrip
          tone={notice.stale ? "amber" : "accent"}
          icon={<FingerprintIcon className="size-4" aria-hidden="true" />}
        >
          {notice.text}
        </AttentionStrip>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(BUCKET_LABELS) as EnrollmentBucket[]).map((bucket) => (
          <button
            key={bucket}
            type="button"
            aria-pressed={filters.buckets.includes(bucket)}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                buckets: prev.buckets.includes(bucket)
                  ? prev.buckets.filter((b) => b !== bucket)
                  : [...prev.buckets, bucket],
              }))
            }
            className="rounded-full border border-border px-2.5 py-1 text-xs aria-pressed:bg-muted"
          >
            {BUCKET_LABELS[bucket]}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGroupBy(groupBy === "branch" ? "department" : "branch")}
            className="rounded-full border border-border px-2.5 py-1 text-xs"
          >
            Group by {groupBy === "branch" ? "branch" : "department"}
          </button>
          <Button
            size="sm"
            variant="outline"
            disabled={counts.truncated}
            title={
              counts.truncated
                ? "The roster is partial — exporting would produce a file that looks complete"
                : undefined
            }
            onClick={() =>
              download(
                toEnrollmentCsv(visible, {
                  snapshotAt: payload.last_snapshot_at,
                  filterLabel,
                }),
                `biometric-enrollment-${payload.last_snapshot_at?.slice(0, 10) ?? "unknown"}.csv`,
              )
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {groups.map((group) => (
          <section key={group.key} className="mb-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.key} · {group.rows.length}
            </h3>
            <ul className="divide-y divide-border rounded-md border border-border">
              {group.rows.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1 truncate">{entry.employee_name}</span>
                  <span
                    className={
                      entry.bucket === "LEAVER_STILL_ENROLLED"
                        ? "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {BUCKET_LABELS[entry.bucket]}
                  </span>
                  {entry.days_since_relieving !== null ? (
                    <span className="text-xs tabular-nums text-destructive">
                      {entry.days_since_relieving} days
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {counts.excluded_status > 0 ? (
        <p className="text-xs text-muted-foreground">
          {counts.excluded_status} employees are not shown — their status is Inactive or
          Suspended, where "should they be able to clock in?" has no clear answer.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Write the thin page**

`src/ui/schedule-coverage/BiometricEnrollmentPage.tsx` — no copy, no logic, nothing the view already owns:

```tsx
import { useEnrollmentReport } from "@/hooks/useEnrollmentReport";
import { BiometricEnrollmentView } from "@/ui/BiometricEnrollmentView";
import { CoverageViewNav } from "@/ui/schedule-coverage/CoverageViewNav";

export function BiometricEnrollmentPage() {
  const { payload, isLoading, error } = useEnrollmentReport();

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4">
        <CoverageViewNav />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="p-6 text-sm text-destructive">
          Could not load the enrollment report.
        </div>
      ) : (
        <BiometricEnrollmentView payload={payload} nowMs={Date.now()} />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Mount the sub-nav and the route**

In `ScheduleCoveragePage.tsx`, import `CoverageViewNav` and render `<CoverageViewNav />` as the first child of the page's outermost `<div>`. Change nothing else in that file.

In `main.tsx`, add the import and the route **after** the existing coverage route:

```tsx
import { BiometricEnrollmentPage } from "./ui/schedule-coverage/BiometricEnrollmentPage";
```

```tsx
<Route path="/hr-schedule/coverage/biometrics" element={<BiometricEnrollmentPage />} />
```

- [ ] **Step 8: Run everything**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web && npm run typecheck
```

Expected: 7 new tests, the `test:web` count up by 7, typecheck clean. Report the actual numbers.

- [ ] **Step 9: Mutation check**

Delete the `if (!isFeedConnected(props.payload))` block from the view. Re-run. Expected: the "refuses to render" test FAILS. Revert and confirm green. Record the observed output for both.

Restore with both caches cleared, or a correctly-restored file will keep failing:

```bash
rm -rf ~/Library/Caches/com.apple.python
find . -name __pycache__ -type d -prune -exec rm -rf {} \;
```

- [ ] **Step 10: Build the SPA assets and commit them**

Built assets ARE the deployed artifact in this repo — Frappe Cloud never builds these SPAs because `@lolbikb/dewey-ui` is a private dependency. A code-only commit ships nothing.

```bash
cd dewey_time/frontend/hr_attendance && npm run build
cd ../../..
git add dewey_time/frontend/hr_attendance/src dewey_time/public dewey_time/www
git status --short   # confirm dewey_time/public/** and www/*.html are staged
git commit -m "feat(enrollment): the Biometric Enrollment view

Split into a pure view and a thin page because this suite has no DOM and no
module mocking: a component that calls the hook internally cannot be rendered
in a test at all. All behaviour is asserted on the view via
renderToStaticMarkup; a source-text test pins that the page carries no copy of
its own, since a second formatting site would drift from the tested one in
silence.

The view refuses to render the list when no snapshot has ever arrived. Every
employee correctly computes as unenrolled in that state, so rendering would
turn a plumbing failure into a roster-sized worklist.

Export is disabled while the roster is truncated — a partial CSV that looks
complete is worse than no CSV."
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| Bridge pushes; Frappe never pulls | 3 (endpoint); bridge side out of scope by design |
| Full snapshot, never a delta | 3 |
| Never accept a partial snapshot (both guards) | 3 |
| `Employee Biometric Enrollment`, one row per employee | 2 |
| Branch/department joined at read time, never stored | 2 (absent from schema), 4 (join + test) |
| `last_enrollment_snapshot_at` on settings | 2 |
| Read API modelled on `coverage_api`, HR gate, versioned cache | 4 |
| API groups nothing; client groups | 4 (flat rows), 5 (`groupRows`) |
| Four buckets, pure function | 1 |
| 14-day window as a constant | 4 |
| Leaver: no grace period, days-since, null-safe | 1, 4 |
| Population `Active`/`Left`; excluded counted | 1, 4, 7 (footnote) |
| Three-query budget | 4 |
| `enrollment_status` seam | 4 |
| Sub-view under Coverage, no new route rule | 7 (verified in Step 1) |
| Filter by branch/department/bucket; group by one | 5, 7 |
| Staleness shown; refusal when never synced | 5, 7 |
| CSV with snapshot row, refused while truncated | 5, 7 |
| `face_count` carried, no column | 5 (type), 7 (no column) |
| Mutation checks on the load-bearing guards | 1, 3, 4, 5, 7 |

No gaps.

**2. Placeholder scan** — every code step carries complete code. No "TBD", no "add error handling", no "similar to Task N".

**3. Type consistency**

- Backend payload keys (Task 4 Interfaces) ↔ `EnrollmentPayload`/`EnrollmentRow` (Task 5): `rows`, `counts`, `last_snapshot_at`, `window_days`; row keys `id`, `employee_name`, `branch`, `department`, `status`, `bucket`, `is_registered`, `fingerprint_count`, `face_count`, `days_since_relieving`. Match.
- Count keys ↔ `EnrollmentCounts`: `reported`, `needs_enrollment`, `enrolled_not_punching`, `ok`, `leaver_still_enrolled`, `excluded_status`, `truncated`. Match.
- Bucket string constants (Task 1) ↔ `EnrollmentBucket` union (Task 5) ↔ `BUCKET_LABELS` keys. Match.
- `ENROLLMENT_DOCTYPE` and `SETTINGS_DOCTYPE` defined in Task 2, imported by Task 4. Match.
- `upsert_enrollment_row` signature (Task 2 Produces) ↔ both call sites in Task 3. Match.

**One correction found and applied during review:** Task 4 imports `SETTINGS_DOCTYPE` from `enrollment.py`, so Task 2 must define it — the constant has been moved into Task 2's module body rather than introduced in Task 3.
