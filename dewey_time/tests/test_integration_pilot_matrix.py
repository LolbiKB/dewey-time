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

import json
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

# A second shift and a second employee, carrying the one thing SHIFT does not:
# a scheduled lunch. Kept separate rather than adding lunch fields to SHIFT,
# because every existing scenario above is calibrated against a lunch-free day
# and a midday carve would quietly change what several of them assert.
LUNCH_SHIFT = "PM Day 0900-1700 Lunch"
LUNCH_START = "12:00:00"
LUNCH_END = "13:00:00"


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
        #
        # Looked up by the name ERPNext DERIVES ("first middle last"), not by
        # the employee_name passed in: Employee.validate overwrites that field,
        # so a lookup for the value we supplied never matched and every bench
        # run inserted another employee and another Shift Assignment instead of
        # reusing them.
        existing = frappe.db.get_value("Employee", {"employee_name": "Pilot Matrix"}, "name")
        if existing:
            cls.employee = existing
        else:
            emp = frappe.get_doc(
                {
                    "doctype": "Employee",
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

        cls.lunch_employee = cls._ensure_lunch_employee()

        frappe.db.commit()

    @classmethod
    def _ensure_lunch_employee(cls):
        """A second employee on a shift that actually schedules a lunch.

        custom_lunch_start / custom_lunch_end are dewey_time custom fields on
        Shift Type (sandbox_bootstrap's make_custom_fields creates them), which
        is why they are set through the doc dict rather than the Shift Type's
        own schema.
        """
        _ensure(
            "Shift Type",
            LUNCH_SHIFT,
            {
                "name": LUNCH_SHIFT,
                "start_time": "09:00:00",
                "end_time": "17:00:00",
                "custom_lunch_start": LUNCH_START,
                "custom_lunch_end": LUNCH_END,
            },
        )

        # Same derived-name rule as above; "Pilot Lunch" is what ERPNext stores.
        employee = frappe.db.get_value("Employee", {"employee_name": "Pilot Lunch"}, "name")
        if not employee:
            emp = frappe.get_doc(
                {
                    "doctype": "Employee",
                    "first_name": "Pilot",
                    "last_name": "Lunch",
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
            employee = emp.name

        if not frappe.get_all(
            "Shift Assignment",
            filters={"employee": employee, "shift_type": LUNCH_SHIFT, "docstatus": 1},
            pluck="name",
        ):
            sa = frappe.get_doc(
                {
                    "doctype": "Shift Assignment",
                    "employee": employee,
                    "shift_type": LUNCH_SHIFT,
                    "company": cls.company,
                    "start_date": "2026-01-01",
                    "status": "Active",
                }
            )
            sa.insert(ignore_permissions=True)
            sa.submit()

        return employee

    # --- helpers -------------------------------------------------------------

    def _checkin(self, day, hhmmss, log_type, branch=PRIMARY_BRANCH, sid=None, employee=None):
        employee = employee or self.employee
        # The id has to carry the employee too, now that two of them can punch
        # on the same day at the same minute — custom_supabase_log_id is unique.
        sid = sid or f"pm-{employee}-{day}-{hhmmss}-{log_type}"
        frappe.get_doc(
            {
                "doctype": "Employee Checkin",
                "employee": employee,
                "time": f"{day} {hhmmss}",
                "log_type": log_type,
                "custom_supabase_log_id": sid,
                "custom_device_branch": branch,
            }
        ).insert(ignore_permissions=True)

    def _rows(self, day, employee=None):
        """Every Attendance Flag row for one employee-day, evidence parsed."""
        employee = employee or self.employee
        rows = frappe.get_all(
            "Attendance Flag",
            filters={"employee": employee, "attendance_date": getdate(day)},
            fields=["flag_code", "day_closed", "evidence"],
        )
        for row in rows:
            try:
                row["evidence"] = json.loads(row["evidence"]) if row["evidence"] else {}
            except (TypeError, ValueError):
                row["evidence"] = {}
        return rows

    def _flags(self, day, employee=None):
        """Run the real closeout core for one day; return the set of flag_codes."""
        employee = employee or self.employee
        d = getdate(day)
        frappe.db.delete("Attendance Flag", {"employee": employee, "attendance_date": d})
        _generate_for_employee_date(
            employee=employee, attendance_date=d, include_unnotified_absence=True
        )
        rows = frappe.get_all(
            "Attendance Flag",
            filters={"employee": employee, "attendance_date": d},
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

    # --- the two cases the matrix was missing --------------------------------
    #
    # Added after the pilot matrix finally ran on a bench and controls showed
    # what it does and does not reach: forcing _bridge_scheduled_lunch wide open
    # left all nine green, and disabling the provisional intraday no-show left
    # all nine green. Both of the branch's headline behaviours were invisible
    # here. These two close that.

    def test_an_untaken_lunch_does_not_split_one_absence_in_two(self):
        """_bridge_scheduled_lunch, against a real Shift Type with a real lunch.

        Present 09:00-11:00, then gone. The lunch carve leaves 11:00-12:00 and
        13:00-17:00 -- two findings for one continuous absence, which is the
        shape that made a no-show unreadable in the queue. Bridged, it is one
        row of 11:00-17:00.

        `minutes` is the sum of the parts (60 + 240 = 300), NOT the span (360):
        the unpaid hour in the middle is still not owed. Asserting both numbers
        is what makes this a bridge test rather than a count test -- a naive
        merge that recomputed minutes from the span would pass on the count and
        fail here.
        """
        day = "2026-03-16"
        emp = self.lunch_employee
        self._checkin(day, "09:00:00", "IN", employee=emp)
        self._checkin(day, "11:00:00", "OUT", employee=emp)

        self.assertIn("MISSING_TIME", self._flags(day, employee=emp))
        missing = [r for r in self._rows(day, employee=emp) if r["flag_code"] == "MISSING_TIME"]

        self.assertEqual(len(missing), 1, f"one absence, one row — got {missing}")
        evidence = missing[0]["evidence"]
        self.assertEqual(evidence.get("minutes"), 300, f"sum of the parts, not the span: {evidence}")
        self.assertTrue(str(evidence.get("interval_start", "")).endswith("11:00:00"), evidence)
        self.assertTrue(str(evidence.get("interval_end", "")).endswith("17:00:00"), evidence)

    def test_a_no_show_says_so_intraday_instead_of_two_gaps_around_lunch(self):
        """The branch's headline behaviour, end to end on a real bench.

        Zero punches on a shift that schedules a lunch. Before, the intraday
        pass produced two MISSING_TIME rows split by a lunch nobody took and
        never said the person had not shown up; UNNOTIFIED_ABSENCE existed but
        waited for end-of-day closeout. Now one provisional no-show says it
        while the day is still running.

        The assertion that carries the feature is `assertEqual(missing, [])`:
        the no-show REPLACES the gap rows rather than joining them.
        """
        day = "2026-03-17"
        emp = self.lunch_employee
        d = getdate(day)
        frappe.db.delete("Attendance Flag", {"employee": emp, "attendance_date": d})

        refresh_intraday_flags_for_employee_date(emp, d)

        rows = self._rows(day, employee=emp)
        absences = [r for r in rows if r["flag_code"] == "UNNOTIFIED_ABSENCE"]
        missing = [r for r in rows if r["flag_code"] == "MISSING_TIME"]

        self.assertEqual(len(absences), 1, f"exactly one no-show, got {rows}")
        self.assertEqual(missing, [], f"the no-show replaces the gap rows, got {missing}")

        absence = absences[0]
        self.assertEqual(absence["day_closed"], 0, "a running day is not closed")
        evidence = absence["evidence"]
        self.assertIs(evidence.get("provisional"), True, f"must be provisional: {evidence}")
        self.assertEqual(evidence.get("reason"), "on_shift_no_checkins_intraday", evidence)
