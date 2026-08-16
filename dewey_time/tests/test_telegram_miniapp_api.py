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
                    "evidence": {"first_in": "07:58"},
                }
            ],
        }
    ],
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
             "first_in", "last_out"},
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
             "employee_branch", "days"},
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

    def test_no_flags_reach_the_employee(self):
        # Intraday deletes and re-inserts AUTO flags on every checkin, so an
        # employee watching them would see provisional judgments appear and
        # vanish all day.
        payload = self._narrowed()
        self.assertNotIn("flags", payload["days"][0])
        self.assertNotIn("LATE_START", repr(payload))
        self.assertNotIn("AUTO-emp-1", repr(payload))

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
