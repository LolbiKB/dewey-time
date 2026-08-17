import inspect
import pathlib
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import miniapp_api  # noqa: E402

# A full HR payload, including everything an employee must never receive.
HR_PAYLOAD = {
    "employee": "HR-EMP-00001",
    "employee_branch": "DIS Iconic",
    "is_clock_based": False,
    "device_sync": [
        {"device_sn": "CK92218010001", "last_error": "timeout", "pending_count": 3}
    ],
    "days": [
        {
            "date": "2026-08-14",
            "shift": {
                "shift_assigned": True,
                "shift_type": "FT_Standard",
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "grace_minutes": 15,
                "lunch_start": "12:00:00",
                "lunch_end": "13:00:00",
            },
            "holiday": None,
            "leave": {"on_leave": False},
            "observed_lunch": None,
            "first_in": "2026-08-14 07:58:00",
            "last_out": "2026-08-14 17:06:00",
            "checkins": [
                {
                    "name": "EMP-CKIN-1",
                    "time": "2026-08-14 07:58:00",
                    "log_type": "IN",
                    "device_id": "ZK-A4-014",
                    "custom_device_branch": "DIS Iconic",
                }
            ],
            "flags": [
                {
                    "name": "AUTO-emp-1-2026-08-14-late-start",
                    "flag_code": "LATE_START",
                    "severity": "WARNING",
                    "is_provisional": False,
                    "evidence": {"first_in": "07:58", "grace_minutes": 15},
                    "decision": None,
                    "decision_state": "undecided",
                }
            ],
        }
    ],
}


def _flag(code, **over):
    """A full HR flag row -- including everything an employee must never see."""
    row = {
        "name": f"AUTO-emp-1-2026-08-14-{code.lower()}",
        "flag_code": code,
        "severity": "CRITICAL",
        "status": "OPEN",
        "source": "AUTO",
        "day_closed": 1,
        "is_provisional": False,
        "hr_note": "spoke to the supervisor",
        "rule_version": "v3",
        "linked_checkin": "EMP-CKIN-1",
        "evidence": {"first_in": "07:58", "grace_minutes": 15},
        "decision": None,
        "decision_state": "undecided",
    }
    row.update(over)
    return row


def _day(flags, checkins=()):
    return {
        "employee": "HR-EMP-00001",
        "days": [{
            "date": "2026-08-14",
            "checkins": [{"time": t} for t in checkins],
            "flags": flags,
        }],
    }


class TestSignatureGuard(unittest.TestCase):
    def test_the_endpoint_accepts_no_employee_selecting_parameter(self):
        # THE MOST IMPORTANT TEST IN THIS MODULE.
        #
        # The endpoint is safe today because an attacker cannot name a victim --
        # there is no field to put one in. That property will not die to an
        # attack; it will die to a reasonable-looking edit, when someone
        # building the manager view adds `employee=None` so a supervisor can
        # see their team. Every other test here would still pass, because they
        # all exercise the employee's own path.
        #
        # If you are here because this test failed: resolving an employee from
        # a caller-supplied parameter needs its own authorization design, not a
        # new parameter. Do not delete this test to make it pass.
        params = set(inspect.signature(miniapp_api.get_my_calendar).parameters)
        self.assertEqual(params, {"init_data", "start_date", "end_date"})


class TestHttpMethod(unittest.TestCase):
    def test_the_endpoint_is_post_only(self):
        # A source assertion because frappe.whitelist is a passthrough under
        # the test mock, so the registration cannot be introspected.
        #
        # Without methods=["POST"] Frappe also serves GET, and a GET carries
        # init_data -- the whole authentication credential -- in the query
        # string, into the access log, any fronting proxy, and the webview's
        # history. The webhook has always pinned this; this endpoint shipped
        # without it and the whole-branch review caught it.
        src = (
            pathlib.Path(__file__).resolve().parents[1]
            / "telegram" / "miniapp_api.py"
        ).read_text()
        self.assertIn('@frappe.whitelist(allow_guest=True, methods=["POST"])', src)


class TestProjection(unittest.TestCase):
    def _narrowed(self):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00001"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar",
                          return_value=HR_PAYLOAD):
            return miniapp_api.get_my_calendar("initdata", "2026-08-14", "2026-08-14")

    def test_the_day_key_set_is_exactly_the_allowlist(self):
        # Equality, NOT "device_sync is absent". An absence assertion passes
        # forever while a newly added field leaks; equality fails the moment
        # the payload grows, which is the alarm the allowlist exists to raise.
        day = self._narrowed()["days"][0]
        self.assertEqual(
            set(day),
            {"date", "shift", "checkins", "holiday", "leave", "observed_lunch",
             "first_in", "last_out", "flags"},
        )

    def test_the_top_level_key_set_is_exactly_the_allowlist(self):
        # Same equality rule as the day set above. The four beyond `days` are
        # the employee's own identity, shown so they can confirm WHICH record
        # their Telegram account was bound to -- the check that matters now
        # that binding can happen from a recorded id rather than only from a
        # link HR sent. `employee_branch` is the same site the check-in
        # notification already names.
        #
        # Still absent, and this equality is what keeps them absent:
        # device_alerts, device_sync and the picker's nav metadata.
        self.assertEqual(
            set(self._narrowed()),
            {"employee", "employee_name", "khmer_name", "designation",
             "image", "employee_branch", "days"},
        )

    def test_the_projection_itself_exposes_no_identity(self):
        # narrow() is a pure projection of what it is handed, and the identity
        # is a separate lookup merged after it. Pinned because a future edit
        # that moved the lookup inside narrow() would make every allowlist test
        # in this class depend on a database call.
        self.assertEqual(set(miniapp_api.narrow(HR_PAYLOAD)), {"employee", "employee_branch", "days"})

    def test_the_shift_block_drops_grace_minutes(self):
        # grace_minutes tells an employee exactly how late they can be before
        # the system notices. That is HR policy, not employee-facing data.
        shift = self._narrowed()["days"][0]["shift"]
        self.assertEqual(
            set(shift),
            {"shift_assigned", "shift_type", "start_time", "end_time",
             "lunch_start", "lunch_end"},
        )

    def test_each_checkin_is_narrowed_but_keeps_its_branch(self):
        # A top-level allowlist alone would pass device_id straight through
        # inside the punch objects, so the narrowing is per-field.
        #
        # custom_device_branch survives on purpose. It is a place the employee
        # physically stood -- the check-in notification already names it -- and
        # attendancePunches.ts:37 groups punches by it, so without it every
        # punch renders as an ungrouped "rogue" run and a normal worked day
        # draws as an anomaly. Found by looking at the built page, not here.
        checkin = self._narrowed()["days"][0]["checkins"][0]
        self.assertEqual(set(checkin), {"time", "log_type", "custom_device_branch"})

    def test_the_device_serial_still_never_reaches_the_employee(self):
        checkin = self._narrowed()["days"][0]["checkins"][0]
        self.assertNotIn("device_id", checkin)
        self.assertNotIn("name", checkin)

    def test_flags_reach_the_employee_stripped_of_everything_hr_only(self):
        # This test used to assert that NO flag reached the employee, and the
        # reason it gave was sound: intraday deletes and re-inserts AUTO flags
        # on every checkin, so an employee watching them would see provisional
        # judgments appear and vanish all day. The day-flags design keeps that
        # reasoning and answers it differently -- see the certainty rules in
        # TestFlagProjection, which withhold exactly the provisional flags that
        # can withdraw themselves. What must never come back is the payload
        # AROUND the flag.
        payload = self._narrowed()
        self.assertEqual(
            set(payload["days"][0]["flags"][0]),
            {"flag_code", "is_provisional", "decision", "decision_state"},
        )
        self.assertNotIn("AUTO-emp-1", repr(payload))
        self.assertNotIn("grace_minutes", repr(payload))

    def test_no_device_internals_reach_the_employee(self):
        payload = repr(self._narrowed())
        self.assertNotIn("CK92218010001", payload)
        self.assertNotIn("last_error", payload)
        self.assertNotIn("ZK-A4-014", payload)

    def test_a_day_missing_optional_blocks_does_not_invent_them(self):
        # An off day has no shift and no punches. The projection must not
        # fabricate empty objects that the UI would then render as a shift.
        sparse = {"employee": "E", "days": [{"date": "2026-08-15"}]}
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="E"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar",
                          return_value=sparse):
            day = miniapp_api.get_my_calendar("d", "2026-08-15", "2026-08-15")["days"][0]
        self.assertNotIn("shift", day)
        self.assertEqual(day["checkins"], [])


class TestFlagProjection(unittest.TestCase):
    def _flags(self, payload):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00001"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar",
                          return_value=payload):
            got = miniapp_api.get_my_calendar("d", "2026-08-14", "2026-08-14")
        return got["days"][0]["flags"]

    def test_a_visible_flag_carries_exactly_four_fields(self):
        # Equality, not absence. An absence assertion passes forever while a
        # newly added field leaks.
        flags = self._flags(_day([_flag("LATE_START")]))
        self.assertEqual(len(flags), 1)
        self.assertEqual(
            set(flags[0]),
            {"flag_code", "is_provisional", "decision", "decision_state"},
        )

    def test_the_decision_is_narrowed_here_and_not_upstream(self):
        # hr_calendar redacts this too, but only `if not hr_view` -- a
        # frappe.session.user check in another module. THIS test is what makes
        # miniapp_api's promise true on its own: add a field to that upstream
        # dict for an HR need and it must not reach a phone.
        #
        # The fixture deliberately hands over an UNREDACTED decision, i.e. what
        # hr_calendar produces for an HR viewer.
        flags = self._flags(_day([_flag("LATE_START", decision={
            "name": "FD-0007",
            "outcome": "UPHELD",
            "reason": "GENUINE_VIOLATION",
            "note": "third time this month, verbal warning given",
            "decided_by": "hr.manager@dewey.example",
            "decided_at": "2026-08-15 09:14:00",
        }, decision_state="matched")]))
        self.assertEqual(set(flags[0]["decision"]), {"outcome", "decided_at"})
        payload = repr(flags)
        self.assertNotIn("verbal warning", payload)
        self.assertNotIn("hr.manager", payload)
        self.assertNotIn("GENUINE_VIOLATION", payload)

    def test_an_undecided_flag_keeps_a_null_decision_not_an_empty_one(self):
        # The client reads decision?.outcome. Fabricating {} would be a lie
        # about whether HR has looked at this.
        flags = self._flags(_day([_flag("LATE_START")]))
        self.assertIsNone(flags[0]["decision"])

    def test_hr_internals_never_reach_the_employee(self):
        payload = repr(self._flags(_day([_flag("LATE_START")])))
        self.assertNotIn("grace_minutes", payload)
        self.assertNotIn("spoke to the supervisor", payload)
        self.assertNotIn("AUTO-emp-1", payload)
        self.assertNotIn("CRITICAL", payload)
        self.assertNotIn("EMP-CKIN-1", payload)

    def test_infrastructure_codes_are_not_the_employees_business(self):
        # Ours failing, not their day, and none of it actionable by them.
        flags = self._flags(_day([
            _flag("UNKNOWN_DEVICE_BRANCH"),
            _flag("DELIVERY_FAILED"),
            _flag("NON_PRIMARY_SITE_PUNCH"),
        ]))
        self.assertEqual(flags, [])

    def test_a_code_invented_later_is_hidden_by_default(self):
        # THE POINT OF THE ALLOWLIST. Written as a denylist this test would
        # pass only until somebody added a code to the engine.
        self.assertEqual(self._flags(_day([_flag("SOME_FUTURE_CODE")])), [])

    def test_a_provisional_absence_is_withheld(self):
        # intraday.py:175 raises it the moment the first MISSING_TIME interval
        # would have appeared and withdraws it when a punch lands. Somebody
        # whose approved leave is not keyed in yet would otherwise carry "no
        # record for this day" from mid-morning until closeout cleared it.
        flags = self._flags(_day([
            _flag("UNNOTIFIED_ABSENCE", is_provisional=True, day_closed=0),
        ]))
        self.assertEqual(flags, [])

    def test_a_closed_out_absence_is_shown(self):
        flags = self._flags(_day([_flag("UNNOTIFIED_ABSENCE")]))
        self.assertEqual([f["flag_code"] for f in flags], ["UNNOTIFIED_ABSENCE"])

    def test_a_provisional_gap_that_is_still_running_is_withheld(self):
        # The engine measures today's gaps up to the present minute, so an
        # untracked lunch is a 31-minute gap at 12:31 while the person eats.
        flags = self._flags(_day(
            [_flag("MISSING_TIME", is_provisional=True, day_closed=0,
                   evidence={"interval_start": "2026-08-14T12:00:00",
                             "interval_end": "2026-08-14T12:31:00"})],
            checkins=["2026-08-14 08:02:00", "2026-08-14 12:00:00"],
        ))
        self.assertEqual(flags, [])

    def test_a_provisional_gap_that_ended_is_shown(self):
        # A punch landed after it, so the gap is closed and certain.
        flags = self._flags(_day(
            [_flag("MISSING_TIME", is_provisional=True, day_closed=0,
                   evidence={"interval_start": "2026-08-14T12:00:00",
                             "interval_end": "2026-08-14T12:31:00"})],
            checkins=["2026-08-14 12:00:00", "2026-08-14 12:58:00"],
        ))
        self.assertEqual([f["flag_code"] for f in flags], ["MISSING_TIME"])

    def test_a_final_gap_needs_no_later_punch(self):
        flags = self._flags(_day(
            [_flag("MISSING_TIME",
                   evidence={"interval_end": "2026-08-14T12:31:00"})],
            checkins=[],
        ))
        self.assertEqual([f["flag_code"] for f in flags], ["MISSING_TIME"])

    def test_the_gap_comparison_parses_instead_of_comparing_strings(self):
        # THE TEST THAT EARNS ITS PLACE. evidence stores an ISO datetime with a
        # "T" and Frappe stores checkin times with a space. Compared as
        # strings, " " < "T", so "2026-08-14 12:58:00" sorts BEFORE
        # "2026-08-14T12:31:00" and a genuinely closed gap is withheld forever.
        # The naive implementation passes every other test in this class.
        flags = self._flags(_day(
            [_flag("MISSING_TIME", is_provisional=True, day_closed=0,
                   evidence={"interval_end": "2026-08-14T12:31:00"})],
            checkins=["2026-08-14 12:58:00"],
        ))
        self.assertEqual([f["flag_code"] for f in flags], ["MISSING_TIME"],
                         "a space-separated punch time must parse, not sort")

    def test_a_gap_with_no_interval_end_is_withheld_while_provisional(self):
        # Nothing to compare against is not the same as certain.
        flags = self._flags(_day(
            [_flag("MISSING_TIME", is_provisional=True, day_closed=0, evidence={})],
            checkins=["2026-08-14 12:58:00"],
        ))
        self.assertEqual(flags, [])

    def test_a_day_with_no_flags_gets_an_empty_list_not_a_missing_key(self):
        # The client counts len(flags); a missing key would make every day need
        # a guard, and one of them would be forgotten.
        self.assertEqual(self._flags(_day([])), [])


class TestAuth(unittest.TestCase):
    def test_the_employee_comes_from_initdata_not_the_request(self):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00007") as auth, \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar",
                          return_value=HR_PAYLOAD) as build:
            miniapp_api.get_my_calendar("thedata", "2026-08-14", "2026-08-14")
        auth.assert_called_once_with("thedata")
        self.assertEqual(build.call_args[0][0], "HR-EMP-00007")

    def test_a_rejected_initdata_never_reaches_the_builder(self):
        # assert_not_called is the specific assertion here -- "it raised" would
        # be satisfied by almost anything, as Task 2's mutation rounds showed.
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          side_effect=Exception("Not permitted")), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar") as build:
            with self.assertRaises(Exception):
                miniapp_api.get_my_calendar("bad", "2026-08-14", "2026-08-14")
        build.assert_not_called()

    def test_auth_runs_before_anything_else(self):
        # Ordering matters: validating the range first would let an
        # unauthenticated caller probe for accepted date windows.
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          side_effect=Exception("Not permitted")), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar") as build:
            with self.assertRaises(Exception):
                miniapp_api.get_my_calendar("bad", "2026-12-31", "2020-01-01")
        build.assert_not_called()


class TestRange(unittest.TestCase):
    def test_a_backwards_range_is_refused(self):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="E"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar") as build:
            with self.assertRaises(Exception):
                miniapp_api.get_my_calendar("d", "2026-08-14", "2026-08-01")
        build.assert_not_called()

    def test_an_oversized_range_is_refused(self):
        # An unbounded range would let one launch pull the employee's whole
        # history in a single query.
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="E"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar") as build:
            with self.assertRaises(Exception):
                miniapp_api.get_my_calendar("d", "2020-01-01", "2026-08-14")
        build.assert_not_called()

    def test_a_range_at_the_limit_is_allowed(self):
        # The boundary itself, so the check cannot quietly become off-by-one
        # and start refusing the month view the UI asks for.
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="E"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar",
                          return_value={"employee": "E", "days": []}) as build:
            miniapp_api.get_my_calendar("d", "2026-06-01", "2026-08-02")  # 62 days
        build.assert_called_once()


class TestEmployeePhoto(unittest.TestCase):
    """The avatar is the Employee's own photo, and only when a Guest can load it."""

    def test_a_public_file_is_kept(self):
        self.assertEqual(miniapp_api._public_image("/files/dara.jpg"), "/files/dara.jpg")

    def test_a_private_file_is_dropped_rather_than_shipped_broken(self):
        # Mini App requests carry no Frappe session by design, so a private
        # path renders as a broken image with a 403 behind it. None lets the
        # client fall back to initials, which looks deliberate.
        self.assertIsNone(miniapp_api._public_image("/private/files/dara.jpg"))

    def test_an_absolute_or_foreign_url_is_dropped(self):
        # The Employee image field is free text a Desk user can put anything
        # into, and this value lands in an <img src>.
        for hostile in (
            "https://evil.example/x.jpg",
            "//evil.example/x.jpg",
            "javascript:alert(1)",
            "data:image/svg+xml;base64,AAAA",
        ):
            with self.subTest(url=hostile):
                self.assertIsNone(miniapp_api._public_image(hostile))

    def test_nothing_on_the_record_is_nothing_to_show(self):
        for empty in (None, "", "   "):
            with self.subTest(value=repr(empty)):
                self.assertIsNone(miniapp_api._public_image(empty))


#: An Employee row as the DB would hand it back, including columns this app
#: must never ship. All three of the last ones live on the real doctype.
EMPLOYEE_ROW = {
    "employee_name": "Sok Dara",
    "designation": "Cashier",
    "image": "/files/dara.jpg",
    "custom_khmer_last_name": "សុខ",
    "custom_khmer_first_name": "ដារា",
    "department": "Retail",
    "employment_type": "Full-time",
    "date_of_joining": "2024-03-12",
    "branch": "DIS Iconic",
    "cell_number": "012 345 678",
    "personal_email": "dara.sok@gmail.com",
    "reports_to": "HR-EMP-00002",
    "date_of_birth": "1994-02-02",
    "passport_number": "N1234567",
    "salary_mode": "Bank",
}

ENROLLED = {
    "employee": "HR-EMP-00001",
    "is_registered": True,
    "fingerprint_count": 2,
    "face_count": 0,
    "finger_ids": [3, 6],
    "synced_at": "2026-08-17 06:00:00",
    "last_snapshot_at": "2026-08-17 06:05:00",
}


class _ProfileHarness(unittest.TestCase):
    """Drive get_my_profile with the DB and the enrolment seam stubbed out."""

    def _profile(self, row=None, status=None, has_column=None):
        row = EMPLOYEE_ROW if row is None else row
        status = ENROLLED if status is None else status
        self.asked_for = []

        def _get_value(doctype, name, fields, as_dict=False):
            if doctype != "Employee":
                return None
            if as_dict:
                self.asked_for.append(tuple(fields))
                return {k: row[k] for k in fields if k in row}
            # The single-field reads: reports_to, then the manager's name.
            if fields == "reports_to":
                return row.get("reports_to")
            if fields == "employee_name":
                return "Chan Sophea"
            return None

        column = (lambda _dt, field: True) if has_column is None else has_column

        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00001"), \
             patch.object(miniapp_api.enrollment_api, "enrollment_status",
                          return_value=status), \
             patch.object(miniapp_api.frappe.db, "get_value", side_effect=_get_value), \
             patch.object(miniapp_api.frappe.db, "has_column", side_effect=column):
            return miniapp_api.get_my_profile("initdata")


class TestProfileSignatureGuard(unittest.TestCase):
    def test_the_endpoint_accepts_no_employee_selecting_parameter(self):
        # The same property, and the same reason, as get_my_calendar's guard:
        # this dies to a reasonable-looking edit adding `employee=None` for a
        # manager view, not to an attack. Resolving another employee needs its
        # own authorization design, not a new parameter.
        params = set(inspect.signature(miniapp_api.get_my_profile).parameters)
        self.assertEqual(params, {"init_data"})

    def test_both_endpoints_are_post_only(self):
        # A GET would carry init_data -- the whole authentication credential --
        # in the query string, into the access log and the webview's history.
        src = (
            pathlib.Path(__file__).resolve().parents[1]
            / "telegram" / "miniapp_api.py"
        ).read_text()
        self.assertEqual(
            src.count('@frappe.whitelist(allow_guest=True, methods=["POST"])'), 2
        )


class TestProfileProjection(_ProfileHarness):
    def test_the_key_set_is_exactly_the_allowlist(self):
        self.assertEqual(
            set(self._profile()),
            {
                "employee", "employee_name", "khmer_name", "designation", "image",
                "department", "employment_type", "date_of_joining", "branch",
                "reports_to_name", "cell_number", "personal_email", "biometric",
            },
        )

    def test_the_select_never_asks_for_a_field_outside_the_allowlist(self):
        # Stronger than checking the response: this fails if somebody widens
        # the query "just to have it", before anything renders it.
        self._profile()
        asked = {field for fields in self.asked_for for field in fields}
        for forbidden in ("date_of_birth", "passport_number", "salary_mode"):
            self.assertNotIn(forbidden, asked)

    def test_a_row_wider_than_the_allowlist_is_narrowed_on_the_way_out(self):
        # DEFENCE IN DEPTH, and it needs its own harness to be a real guard.
        #
        # The select above is the first defence: get_value returns only the
        # columns it was asked for, so a wider row cannot normally exist and a
        # test feeding one through the ordinary path proves nothing -- it passes
        # whether or not the projection narrows. Verified by mutation: replacing
        # the projection with `**row` left the key-set assertion green.
        #
        # This patches _employee_row directly, which is the shape a future edit
        # would take: someone reaching for frappe.get_doc, or get_value with
        # "*", to add one field. Then the dict comprehension is the only thing
        # between this doctype's salary and passport columns and a phone.
        wide = dict(EMPLOYEE_ROW, custom_disciplinary_note="final warning")
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00001"), \
             patch.object(miniapp_api.enrollment_api, "enrollment_status",
                          return_value=ENROLLED), \
             patch.object(miniapp_api, "_employee_row", return_value=wide), \
             patch.object(miniapp_api, "_reports_to_name", return_value=None), \
             patch.object(miniapp_api.frappe.db, "get_value", return_value={}), \
             patch.object(miniapp_api.frappe.db, "has_column", return_value=True):
            profile = miniapp_api.get_my_profile("initdata")

        for forbidden in (
            "custom_disciplinary_note", "date_of_birth", "passport_number", "salary_mode",
        ):
            self.assertNotIn(forbidden, profile)

    def test_the_manager_is_named_and_never_identified(self):
        # A docname is another employee's identifier. The NAME answers "who do
        # I tell if I'm sick"; the id answers nothing an employee needs.
        profile = self._profile()
        self.assertEqual(profile["reports_to_name"], "Chan Sophea")
        self.assertNotIn("reports_to", profile)

    def test_no_manager_is_none_rather_than_an_error(self):
        row = dict(EMPLOYEE_ROW, reports_to=None)
        self.assertIsNone(self._profile(row=row)["reports_to_name"])

    def test_an_empty_field_is_none_so_the_client_can_drop_the_row(self):
        row = dict(EMPLOYEE_ROW, department="", personal_email=None)
        profile = self._profile(row=row)
        self.assertIsNone(profile["department"])
        self.assertIsNone(profile["personal_email"])

    def test_a_site_missing_columns_still_answers(self):
        # Mid-migration. Losing one row is acceptable; raising is not.
        profile = self._profile(has_column=lambda _dt, field: field == "branch")
        self.assertEqual(profile["branch"], "DIS Iconic")
        self.assertIsNone(profile["employment_type"])
        self.assertIsNone(profile["reports_to_name"])


class TestProfileBiometric(_ProfileHarness):
    def test_the_biometric_key_set_is_exactly_the_allowlist(self):
        self.assertEqual(
            set(self._profile()["biometric"]),
            {"state", "fingers", "fingerprint_count", "face", "checked_at"},
        )

    def test_never_heard_from_the_bridge_is_not_the_same_as_not_enrolled(self):
        # THE HONESTY GUARD. enrollment_status reports feed health precisely so
        # these two can be told apart. Telling somebody they are not set up when
        # the truth is that our snapshot is missing is the same failure as
        # showing a provisional flag.
        status = dict(ENROLLED, is_registered=True, last_snapshot_at=None, synced_at=None)
        self.assertEqual(self._profile(status=status)["biometric"]["state"], "unknown")

    def test_a_cleared_marker_does_not_erase_this_persons_own_snapshot(self):
        # last_enrollment_snapshot_at is a Single. Clearing it in Desk stores
        # 0001-01-01, which _last_snapshot_at normalises to None -- a path that
        # module's docstring records as OBSERVED ON A REAL BENCH. Every register
        # row still carries its own synced_at.
        #
        # Keying "unknown" off the marker alone rendered "Not checked yet"
        # directly above "Last checked 17 Aug" on the same card.
        status = dict(ENROLLED, last_snapshot_at=None, synced_at="2026-08-17 06:00:00")
        bio = self._profile(status=status)["biometric"]
        self.assertEqual(bio["state"], "enrolled")
        self.assertEqual(bio["checked_at"], "2026-08-17 06:00:00")

    def test_a_timestamp_and_the_unknown_state_are_mutually_exclusive(self):
        # THE INVARIANT, stated directly rather than left implicit in the two
        # cases above: one value drives both fields, so the card cannot claim a
        # last-checked time it has just said it does not have.
        cases = [
            dict(ENROLLED, last_snapshot_at=None, synced_at=None),
            dict(ENROLLED, last_snapshot_at=None, synced_at="2026-08-17 06:00:00"),
            dict(ENROLLED, last_snapshot_at="2026-08-17 06:05:00", synced_at=None),
            dict(ENROLLED, is_registered=False, last_snapshot_at=None, synced_at=None),
        ]
        for status in cases:
            with self.subTest(snapshot=status["last_snapshot_at"], synced=status["synced_at"]):
                bio = self._profile(status=status)["biometric"]
                self.assertEqual(
                    bio["state"] == "unknown",
                    bio["checked_at"] is None,
                    "state and checked_at disagree about whether we have heard",
                )

    def test_a_snapshot_that_does_not_know_this_person_is_not_enrolled(self):
        status = dict(ENROLLED, is_registered=False, fingerprint_count=0, finger_ids=[])
        self.assertEqual(
            self._profile(status=status)["biometric"]["state"], "not_enrolled"
        )

    def test_a_snapshot_that_knows_them_is_enrolled(self):
        self.assertEqual(self._profile()["biometric"]["state"], "enrolled")

    def test_the_device_integers_are_translated_and_never_shipped(self):
        self.assertEqual(
            self._profile()["biometric"]["fingers"], ["left_index", "right_index"]
        )

    def test_a_slot_the_table_does_not_know_is_named_not_dropped(self):
        # Dropping would make len(fingers) < fingerprint_count, and the client
        # then shows a bare number instead of the names it does have.
        status = dict(ENROLLED, finger_ids=[3, 99], fingerprint_count=2)
        self.assertEqual(
            self._profile(status=status)["biometric"]["fingers"],
            ["left_index", "other_finger"],
        )

    def test_face_is_a_yes_or_no_and_never_a_count(self):
        self.assertIs(self._profile()["biometric"]["face"], False)
        status = dict(ENROLLED, face_count=1)
        self.assertIs(self._profile(status=status)["biometric"]["face"], True)

    def test_checked_at_prefers_this_persons_own_snapshot_time(self):
        self.assertEqual(
            self._profile()["biometric"]["checked_at"], "2026-08-17 06:00:00"
        )

    def test_checked_at_falls_back_to_the_bridges_last_contact(self):
        # "When did we last hear about you" is the better answer; "when did we
        # last hear at all" is the weaker one that is still true.
        status = dict(ENROLLED, synced_at=None)
        self.assertEqual(
            self._profile(status=status)["biometric"]["checked_at"],
            "2026-08-17 06:05:00",
        )


class TestProfileAuth(unittest.TestCase):
    def test_auth_runs_before_any_read(self):
        calls = []
        with patch.object(
            miniapp_api.miniapp_auth, "employee_from_init_data",
            side_effect=lambda _d: (calls.append("auth"), "HR-EMP-00001")[1],
        ), patch.object(
            miniapp_api.enrollment_api, "enrollment_status",
            side_effect=lambda _e: (calls.append("enrol"), ENROLLED)[1],
        ), patch.object(
            miniapp_api.frappe.db, "get_value",
            side_effect=lambda *a, **k: (calls.append("db"), None)[1],
        ), patch.object(miniapp_api.frappe.db, "has_column", return_value=True):
            miniapp_api.get_my_profile("initdata")
        self.assertEqual(calls[0], "auth")

    def test_a_rejected_initdata_never_reaches_the_database(self):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          side_effect=Exception("nope")), \
             patch.object(miniapp_api.frappe.db, "get_value") as get_value:
            with self.assertRaises(Exception):
                miniapp_api.get_my_profile("forged")
        get_value.assert_not_called()
