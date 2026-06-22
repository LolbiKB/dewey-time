"""Real-DB integration test: the automated pilot matrix.

Unlike the rest of the suite (which injects a MagicMock as ``frappe`` into
``sys.modules`` at import time and therefore tests pure logic only), this module
exercises the **real** closeout engine against a **real** Frappe bench DB:
it seeds Employee + submitted Shift Assignment + Holiday List + Employee Checkins,
runs ``_generate_for_employee_date`` (the closeout core), and asserts the actual
``Attendance Flag.flag_code`` rows produced — the "expected vs actual flag_code"
matrix the MVP sign-off calls for (FLAG_ENGINE_MVP.md).

Because the rest of the suite globally monkeypatches ``frappe`` at import, this
module MUST be run in isolation against a real bench:

    frappe-sandbox test --backend --module test_integration_pilot_matrix
    # = bench --site <site> run-tests --module dewey_time.tests.test_integration_pilot_matrix

In the no-Docker fast lane (``unittest discover``) and in a full
``run-tests --app dewey_time`` run, ``frappe`` is either absent or a MagicMock (the
other modules inject one at import) — so these tests **self-skip** there rather
than erroring. See the readiness report for the global-mock-leak follow-up.
"""

import unittest
from unittest.mock import MagicMock as _MagicMock

try:
    import frappe

    _HAS_REAL_BENCH = not isinstance(frappe, _MagicMock)
except ImportError:  # no frappe on PYTHONPATH (fast lane)
    frappe = None
    _HAS_REAL_BENCH = False

if _HAS_REAL_BENCH:
    from frappe.tests.utils import FrappeTestCase
    from frappe.utils import getdate

    from dewey_time.attendance_engine.closeout import _generate_for_employee_date
    from dewey_time.attendance_engine.intraday import (
        refresh_intraday_flags_for_employee_date,
    )
    from dewey_time.utils.sandbox_verify import (
        mutual_exclusion_violations,
        no_duplicate_flags,
        provisional_after_closeout,
    )

    _Base = FrappeTestCase
else:  # pragma: no cover - skipped when no real bench is available
    _Base = unittest.TestCase

PRIMARY_BRANCH = "PM Primary Branch"
ALT_BRANCH = "PM Alt Branch"
SHIFT = "PM Day 0900-1700"
HOLIDAY_LIST = "PM Holiday List 2026"
HOLIDAY_DATE = "2026-03-06"  # a Friday inside the window, marked as a holiday


def _ensure(doctype, name, payload):
    if frappe.db.exists(doctype, name):
        return name
    doc = frappe.get_doc({"doctype": doctype, **payload})
    doc.insert(ignore_permissions=True)
    return doc.name


@unittest.skipUnless(
    _HAS_REAL_BENCH,
    "requires a real Frappe bench — run via: frappe-sandbox test --backend --module test_integration_pilot_matrix",
)
class TestPilotMatrix(_Base):
    """Each test is one employee-day scenario → asserted flag set."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = frappe.db.get_value("Company", {}, "name")

        _ensure("Branch", PRIMARY_BRANCH, {"branch": PRIMARY_BRANCH})
        _ensure("Branch", ALT_BRANCH, {"branch": ALT_BRANCH})

        # Empty-by-default holiday list (one holiday added for the holiday scenario).
        _ensure(
            "Holiday List",
            HOLIDAY_LIST,
            {
                "holiday_list_name": HOLIDAY_LIST,
                "from_date": "2026-01-01",
                "to_date": "2026-12-31",
                "holidays": [{"holiday_date": HOLIDAY_DATE, "description": "PM Test Holiday"}],
            },
        )

        _ensure(
            "Shift Type",
            SHIFT,
            {"name": SHIFT, "start_time": "09:00:00", "end_time": "17:00:00"},
        )

        # Employee — capture the auto-generated name.
        existing = frappe.db.get_value("Employee", {"employee_name": "Pilot Matrix One"}, "name")
        if existing:
            cls.employee = existing
        else:
            emp = frappe.get_doc(
                {
                    "doctype": "Employee",
                    "employee_name": "Pilot Matrix One",
                    "first_name": "Pilot",
                    "last_name": "Matrix",
                    "company": cls.company,
                    "status": "Active",
                    "branch": PRIMARY_BRANCH,
                    "gender": "Male",
                    "date_of_birth": "1990-01-01",
                    "date_of_joining": "2020-01-01",
                    "holiday_list": HOLIDAY_LIST,
                }
            )
            emp.insert(ignore_permissions=True)
            cls.employee = emp.name

        # Submitted, active Shift Assignment covering the whole window.
        if not frappe.get_all(
            "Shift Assignment",
            filters={"employee": cls.employee, "shift_type": SHIFT, "docstatus": 1},
            pluck="name",
        ):
            sa = frappe.get_doc(
                {
                    "doctype": "Shift Assignment",
                    "employee": cls.employee,
                    "shift_type": SHIFT,
                    "company": cls.company,
                    "start_date": "2026-01-01",
                    "status": "Active",
                }
            )
            sa.insert(ignore_permissions=True)
            sa.submit()

        frappe.db.commit()

    # --- helpers -------------------------------------------------------------

    def _checkin(self, day, hhmmss, log_type, branch=PRIMARY_BRANCH, sid=None):
        sid = sid or f"pm-{day}-{hhmmss}-{log_type}"
        frappe.get_doc(
            {
                "doctype": "Employee Checkin",
                "employee": self.employee,
                "time": f"{day} {hhmmss}",
                "log_type": log_type,
                "custom_supabase_log_id": sid,
                "custom_device_branch": branch,
            }
        ).insert(ignore_permissions=True)

    def _flags(self, day):
        """Run the real closeout core for one day; return the set of flag_codes."""
        d = getdate(day)
        frappe.db.delete("Attendance Flag", {"employee": self.employee, "attendance_date": d})
        _generate_for_employee_date(
            employee=self.employee, attendance_date=d, include_unnotified_absence=True
        )
        rows = frappe.get_all(
            "Attendance Flag",
            filters={"employee": self.employee, "attendance_date": d},
            fields=["employee", "attendance_date", "flag_code", "day_closed", "source"],
        )
        # Oracle cross-check: closed-day rows must never self-contradict.
        self.assertEqual(no_duplicate_flags(rows), [], f"duplicate flags on {day}: {rows}")
        self.assertEqual(
            mutual_exclusion_violations(rows), [], f"mutually-exclusive flags on {day}: {rows}"
        )
        self.assertEqual(
            provisional_after_closeout(rows), [], f"provisional-after-closeout on {day}: {rows}"
        )
        return {r["flag_code"] for r in rows}

    # --- the pilot matrix ----------------------------------------------------

    def test_clean_on_time_day_no_flags(self):
        day = "2026-03-02"
        self._checkin(day, "09:00:00", "IN")
        self._checkin(day, "17:00:00", "OUT")
        self.assertEqual(self._flags(day), set())

    def test_late_start(self):
        day = "2026-03-03"
        self._checkin(day, "09:20:00", "IN")  # 20 min late (< 30 so no MISSING_TIME), grace=0
        self._checkin(day, "17:00:00", "OUT")
        self.assertIn("LATE_START", self._flags(day))

    def test_left_early(self):
        day = "2026-03-04"
        self._checkin(day, "09:00:00", "IN")
        self._checkin(day, "16:45:00", "OUT")  # 15 min early
        self.assertIn("LEFT_EARLY", self._flags(day))

    def test_unnotified_absence(self):
        day = "2026-03-05"  # on-shift, zero checkins
        self.assertEqual(self._flags(day), {"UNNOTIFIED_ABSENCE"})

    def test_single_checkin_attendance_issue(self):
        day = "2026-03-09"
        self._checkin(day, "09:00:00", "IN")  # exactly one punch
        self.assertIn("ATTENDANCE_ISSUE", self._flags(day))

    def test_holiday_punch_is_off_shift_only(self):
        day = HOLIDAY_DATE
        # make this employee's company resolve the holiday via default_holiday_list
        frappe.db.set_value("Company", self.company, "default_holiday_list", HOLIDAY_LIST)
        self._checkin(day, "10:00:00", "IN")
        self._checkin(day, "14:00:00", "OUT")
        self.assertEqual(self._flags(day), {"OFF_SHIFT_PUNCH"})

    def test_non_primary_site_punch(self):
        day = "2026-03-10"
        self._checkin(day, "09:00:00", "IN", branch=ALT_BRANCH)
        self._checkin(day, "17:00:00", "OUT", branch=ALT_BRANCH)
        self.assertIn("NON_PRIMARY_SITE_PUNCH", self._flags(day))

    def test_missing_time_intra_shift_gap(self):
        day = "2026-03-11"
        # present 09:00-10:00 then 10:45-17:00 → a 45-min mid-morning gap (not lunch)
        self._checkin(day, "09:00:00", "IN")
        self._checkin(day, "10:00:00", "OUT")
        self._checkin(day, "10:45:00", "IN")
        self._checkin(day, "17:00:00", "OUT")
        self.assertIn("MISSING_TIME", self._flags(day))

    def test_intraday_provisional_non_primary_site(self):
        """The live /hr-attendance display depends on intraday (day_closed=0) flags."""
        day = "2026-03-12"
        self._checkin(day, "09:00:00", "IN", branch=ALT_BRANCH)
        self._checkin(day, "17:00:00", "OUT", branch=ALT_BRANCH)
        d = getdate(day)
        frappe.db.delete("Attendance Flag", {"employee": self.employee, "attendance_date": d})
        refresh_intraday_flags_for_employee_date(self.employee, d)
        rows = frappe.get_all(
            "Attendance Flag",
            filters={"employee": self.employee, "attendance_date": d},
            fields=["flag_code", "day_closed"],
        )
        non_primary = [r for r in rows if r["flag_code"] == "NON_PRIMARY_SITE_PUNCH"]
        self.assertTrue(non_primary, f"expected provisional NON_PRIMARY_SITE_PUNCH, got {rows}")
        self.assertEqual(non_primary[0]["day_closed"], 0, "intraday flags must be provisional")
