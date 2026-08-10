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

    bench --site test_site run-tests --module dewey_time.tests.test_integration_pilot_matrix

``--module`` ALONE, with no ``--app``. ``frappe-sandbox test --backend --module``
does not work: it builds ``run-tests --app dewey_time --module ...``, and the
``--app`` form makes frappe's loader import every ``test_*.py`` in the app, which
installs a MagicMock over ``sys.modules["frappe"]`` and kills this module with
``ModuleNotFoundError: No module named 'frappe.boot'`` before it reaches the DB.

In the no-Docker fast lane (``unittest discover``) and in a full
``run-tests --app dewey_time`` run, ``frappe`` is either absent or a MagicMock (the
other modules inject one at import) — so these tests **self-skip** there rather
than erroring. See the readiness report for the global-mock-leak follow-up.
"""

import json
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock as _MagicMock

try:
    import frappe

    _HAS_REAL_BENCH = not isinstance(frappe, _MagicMock)
except ImportError:  # no frappe on PYTHONPATH (fast lane)
    frappe = None
    _HAS_REAL_BENCH = False

if _HAS_REAL_BENCH:
    # IntegrationTestCase, NOT the deprecated FrappeTestCase, and the choice is
    # load-bearing rather than tidiness. Frappe categorises a suite by its base
    # class, and a FrappeTestCase lands in "old-frappe-test-class-category" whose
    # preparation step (deprecation_dumpster.get_compat_frappe_test_case_preparation)
    # walks the WHOLE app and imports every test_*.py it finds. Thirty-three of this
    # app's test modules install a MagicMock over sys.modules["frappe"] at import
    # time, so that walk replaced the real frappe underneath this module and every
    # test here died on `ModuleNotFoundError: No module named 'frappe.boot'` before
    # touching the database. IntegrationTestCase is categorised "integration", whose
    # preparation imports nothing outside the module under test.
    from frappe.tests import IntegrationTestCase
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

    _Base = IntegrationTestCase
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
    # The command a developer actually sees, so it has to be the one that works.
    # NOT `frappe-sandbox test --backend --module ...`: the module docstring
    # above records that it builds the `--app dewey_time --module ...` form,
    # which loads every test_*.py in the app, installs a MagicMock over
    # sys.modules["frappe"], and skips straight back to here — `Ran 0 tests`.
    "requires a real Frappe bench — run via: "
    "bench --site test_site run-tests --module dewey_time.tests.test_integration_pilot_matrix",
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
        #
        # And it has to carry the BRANCH, which is not decoration: the id doubles
        # as the idempotence key just below, so every field this helper can vary
        # must appear in it or two different punches collapse into one. Branch is
        # the field that would otherwise be lost, and it is the field
        # test_non_primary_site_punch and test_intraday_provisional_non_primary_site
        # exist to assert. Leave it out and a later test reusing an existing
        # employee/date/time/log_type at a DIFFERENT branch silently keeps the old
        # row and asserts against a stale branch — a false green on a bench that
        # has run before. With it in, that punch gets its own id, the insert is
        # attempted, and hrms's Employee Checkin.validate_duplicate_log refuses it
        # loudly on the timestamp, which is the behaviour that existed before this
        # helper became idempotent.
        sid = sid or f"pm-{employee}-{day}-{hhmmss}-{log_type}-{branch}"
        # An idempotent existence check, like the _ensure fixtures above, and now
        # required rather than tidy. The rollout tests commit — purge_testing_flags
        # does it inside the endpoint under test, and _rollout_dates does it so the
        # restore is durable — and a commit ends the single transaction this whole
        # class is rolled back in at cleanup. Every punch inserted before that
        # commit therefore outlives the run, so a plain insert makes the SECOND run
        # of this module die on hrms's Employee Checkin.validate_duplicate_log
        # instead of on anything the module is testing.
        if frappe.db.exists("Employee Checkin", {"custom_supabase_log_id": sid}):
            return
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
        #
        # Restored explicitly. This write used to be undone by the class
        # rollback, but the rollout tests commit (purge_testing_flags does it
        # inside the endpoint under test, _rollout_dates does it so the restore
        # is durable) and a commit ends the transaction the whole class is
        # rolled back in. Left alone it now persists to the bench and hands
        # every other suite on this site a company with a holiday list it never
        # asked for.
        previous_holiday_list = frappe.db.get_value(
            "Company", self.company, "default_holiday_list"
        )
        self.addCleanup(frappe.db.commit)
        self.addCleanup(
            frappe.db.set_value,
            "Company",
            self.company,
            "default_holiday_list",
            previous_holiday_list,
        )
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

    # --- rollout phases ------------------------------------------------------

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

    def test_a_pre_cutoff_day_with_punches_earns_no_flags(self):
        """A pre-cutoff day earns nothing even when it plainly would otherwise.

        11:30 against an 09:00 shift is well past any grace, so the first assertion
        establishes that this day flags with no cutoff configured and the second
        that it stops once one is set. True and worth asserting -- but NOT on its own
        evidence that the guard is what stops it; see the test below, which is.
        """
        day = "2026-03-18"
        self._checkin(day, "11:30:00", "IN")
        self._checkin(day, "17:00:00", "OUT")

        self.assertNotEqual(self._flags(day), set())

        with self._rollout_dates("2026-03-19", "2026-03-20"):
            self.assertEqual(self._flags(day), set())

    def test_a_pre_cutoff_day_leaves_an_existing_flag_untouched(self):
        """The decisive control: on a pre-cutoff day the engine must not even
        reach its delete.

        "No flags are written" is NOT decisive on its own. With the guard removed
        the engine still computes the flags and still tries to insert them; each
        insert dies on the rollout_phase Select rejecting PRELAUNCH, and
        _insert_flags' bare `except` swallows it. Both paths therefore end with
        zero new flags. The delete is the one observable that separates them --
        and it is also the specific thing the guard was placed before, so that
        #148's delivery-marker protection is never asked about a day the engine
        has no opinion on.

        _generate_for_employee_date directly, NOT _flags(): _flags deletes the
        employee-day's flags before running the engine, which would destroy the
        seeded row this test is watching. The day needs no punches and no shift --
        the delete precedes the shift lookup, so the guard is the only thing that
        can spare the seed either way.
        """
        day = "2026-03-25"
        d = getdate(day)
        frappe.db.delete("Attendance Flag", {"employee": self.employee, "attendance_date": d})
        seed = frappe.get_doc(
            {
                "doctype": "Attendance Flag",
                "employee": self.employee,
                "company": self.company,
                "attendance_date": d,
                "flag_code": "LATE_START",
                "severity": "WARNING",
                "source": "AUTO",
                "status": "OPEN",
                "day_closed": 1,
                "rule_version": "v0",
                "rollout_phase": "LIVE",
                "evidence": "{}",
            }
        )
        seed.insert(ignore_permissions=True)

        with self._rollout_dates("2026-03-26", "2026-03-27"):
            _generate_for_employee_date(
                employee=self.employee, attendance_date=d, include_unnotified_absence=True
            )

        self.assertTrue(
            frappe.db.exists("Attendance Flag", seed.name),
            f"the engine deleted a flag on {day}, a day it was never watching",
        )

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

        # Its own pair of days (Mon/Tue), not the 03-19/03-20 the two tests above
        # use. _rollout_dates commits, so those tests' checkins survive their own
        # rollback, and re-punching the same employee at the same timestamp is what
        # hrms's Employee Checkin.validate_duplicate_log exists to refuse.
        pilot_day, live_day = "2026-03-23", "2026-03-24"
        for day in (pilot_day, live_day):
            self._checkin(day, "11:30:00", "IN")
            self._checkin(day, "17:00:00", "OUT")

        days = [getdate(pilot_day), getdate(live_day)]

        def _count(phase):
            # Scoped to this test's own two days. Unscoped, assertGreater(
            # _count("TESTING"), 0) was satisfied by the TESTING rows
            # test_a_pilot_day_is_stamped_testing commits on 03-19, so the test
            # passed whether or not its own setup produced anything at all.
            return frappe.db.count(
                "Attendance Flag",
                {
                    "employee": self.employee,
                    "source": "AUTO",
                    "rollout_phase": phase,
                    "attendance_date": ["in", days],
                },
            )

        with self._rollout_dates(pilot_day, live_day):
            self._flags(pilot_day)
            self._flags(live_day)

            self.assertGreater(_count("TESTING"), 0)
            live_before = _count("LIVE")
            self.assertGreater(live_before, 0)

            frappe.set_user("Administrator")
            purge_testing_flags(dry_run=0)

            self.assertEqual(_count("TESTING"), 0)
            self.assertEqual(_count("LIVE"), live_before)

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

    def test_every_dewey_time_doctype_loads_its_own_controller(self):
        """The T3-11 regression test.

        Asserted on the controller CLASS, not on meta.custom, because the class
        is the thing that actually matters -- `custom` is merely the flag that
        made Frappe substitute the base Document. import_controller reads that
        flag from tabDocType, so a JSON edit that never reached the database (a
        migrate that skipped the reimport because `modified` did not move)
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

    # --- T3-11: each revived hook, asserted by a side effect only it produces --
    #
    # A loaded controller whose hook never fires looks identical from outside,
    # so "the class loads" (above) is necessary and not sufficient. Every test
    # below was verified to FAIL with its own DocType reverted to custom:1.

    def _probe_flag(self, attendance_date, **overrides):
        """An Attendance Flag written the way Desk would write one."""
        payload = {
            "doctype": "Attendance Flag",
            "employee": self.employee,
            "company": self.company,
            "attendance_date": attendance_date,
            "flag_code": "LATE_START",
            "source": "AUTO",
            "status": "OPEN",
            "day_closed": 1,
            "rollout_phase": "LIVE",
        }
        payload.update(overrides)
        flag = frappe.get_doc(payload)
        flag.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "Attendance Flag", flag.name, force=True, ignore_permissions=True
        )
        return flag

    def test_a_status_change_stamps_who_and_when(self):
        """AttendanceFlag.before_save. Nothing else writes these two fields."""
        flag = self._probe_flag("2026-03-02")

        # Blank on insert, and that is the is_new() gate doing its job rather
        # than an accident. frappe runs before_save during insert() too, and
        # has_value_changed() answers True for every field when there is no
        # pre-save snapshot -- so without the gate this row would arrive
        # already stamped, on every engine insert, all day.
        self.assertFalse(flag.status_changed_by, "insert is not a status change")

        # "CLOSED", not "RESOLVED": the Select options are
        # OPEN/EXPLAINED/APPROVED/REJECTED/CLOSED.
        flag.status = "CLOSED"
        flag.save(ignore_permissions=True)

        self.assertTrue(flag.status_changed_by)
        self.assertTrue(flag.status_changed_at)

    def test_saving_without_touching_status_does_not_restamp(self):
        """The other half of the gate: only a status change stamps."""
        flag = self._probe_flag("2026-03-03")
        flag.status = "CLOSED"
        flag.save(ignore_permissions=True)
        first_stamp = flag.status_changed_at

        flag.rule_version = "v1"  # any field except status
        flag.save(ignore_permissions=True)

        self.assertEqual(flag.status_changed_at, first_stamp)

    def test_an_auto_flag_no_longer_gets_a_deterministic_name(self):
        """The naming deleted alongside this fix, asserted where it takes effect.

        Before T3-11 this could not be tested at all: the controller did not
        load, so an AUTO flag got a hash name whether the code said so or not.
        Now the code runs, and this pins that it does not name the row.
        """
        flag = self._probe_flag("2026-03-04")
        self.assertNotIn("AUTO-", flag.name)

    def test_an_incoherent_rollout_configuration_is_now_rejected(self):
        """DeweyTimeSettings.validate -- the punch list's stated cost of T3-11.

        Restores the original values in cleanup: Dewey Time Settings is a
        Single, so a test value left behind would change what every later test
        on this site sees.
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
        the guard never sees an insert. This is the Desk-edit path, which HR
        User and HR Manager both have write access to reach.
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
        # outcome edit would pass whether the immutability guard ran or only
        # the note-required rule did -- and the guard is what is under test.
        decision.reason = "MANAGER_APPROVED"
        with self.assertRaises(frappe.ValidationError):
            decision.save(ignore_permissions=True)

    def test_a_second_sync_row_for_one_device_day_is_rejected(self):
        """DeviceSyncStatus.autoname + validate.

        The dead autoname is why merge_device_sync_duplicates exists: without
        it every write made another row. Both halves are asserted -- the
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

        # Exception, not a specific class: a second row with the same
        # deterministic name can fail as ValidationError from validate() or as
        # DuplicateEntryError from the unique-name constraint, depending on
        # which fires first. Pinning one would make this brittle about a detail
        # it is not testing.
        duplicate = frappe.get_doc(
            {
                "doctype": "Device Sync Status",
                "device_sn": "PM-PROBE-01",
                "local_date": "2026-03-06",
            }
        )
        with self.assertRaises(Exception):
            duplicate.insert(ignore_permissions=True)
