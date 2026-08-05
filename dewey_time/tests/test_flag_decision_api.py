import json
import sys
import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import frappe  # noqa: E402

FIXED_NOW = datetime(2026, 8, 4, 9, 30, 0)
FLAG_DATE = date(2026, 8, 3)


def _getdate(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value[:10])
    return value


frappe.utils.getdate = _getdate
frappe.utils.now_datetime = MagicMock(return_value=FIXED_NOW)
sys.modules["frappe.utils"].getdate = _getdate
sys.modules["frappe.utils"].now_datetime = frappe.utils.now_datetime
frappe.get_roles = MagicMock(return_value=["HR User"])
frappe.generate_hash = MagicMock(return_value="a1b2c3d4e5f6")
frappe.db.commit = MagicMock()
frappe.db.set_value = MagicMock()
frappe.log_error = MagicMock()

# flag_decision_api binds getdate/now_datetime at import time, so a copy imported by an
# earlier test module in the same run would hold the un-fixed mocks. Drop both modules
# and let the tests re-import them — same trick as test_dev_tools.py:36-39.
for _mod in list(sys.modules):
    if _mod.startswith("dewey_time.attendance_engine.flag_decision_api") or _mod.startswith(
        "dewey_time.attendance_engine.flag_identity"
    ):
        del sys.modules[_mod]

from dewey_time.attendance_engine.flag_identity import (  # noqa: E402
    evidence_fingerprint,
    flag_identity,
)


def _flag_row(employee, *, flag_code="LATE_START", minutes=12, day_closed=1):
    return {
        "name": f"AF-{employee}-{flag_code}",
        "employee": employee,
        "attendance_date": FLAG_DATE,
        "flag_code": flag_code,
        "evidence": json.dumps({"minutes": minutes}),
        "day_closed": day_closed,
    }


def _identity(row):
    return flag_identity(
        employee=row["employee"],
        attendance_date=row["attendance_date"],
        flag_code=row["flag_code"],
        evidence=row["evidence"],
    )


class _FakeDoc:
    """Stands in for a Frappe Document: records the insert payload and hands back a
    deterministic name so supersession pointers can be asserted."""

    def __init__(self, payload, store):
        self.payload = dict(payload)
        self._store = store
        self.name = None

    def insert(self, ignore_permissions=False):
        self._store.append(self)
        self.name = f"AFD-{len(self._store):04d}"
        self.ignore_permissions = ignore_permissions
        return self


def _make_get_doc(store):
    def _get_doc(payload, *args, **kwargs):
        return _FakeDoc(payload, store)

    return _get_doc


def _make_get_all(*, flags=(), decisions=(), employees=()):
    def _get_all(doctype, **kwargs):
        if doctype == "Attendance Flag":
            return [dict(row) for row in flags]
        if doctype == "Attendance Flag Decision":
            return [dict(row) for row in decisions]
        if doctype == "Employee":
            return [dict(row) for row in employees]
        return []

    return _get_all


def _decision_docs(store):
    return [doc for doc in store if doc.payload.get("doctype") == "Attendance Flag Decision"]


class TestDecideFlags(unittest.TestCase):
    def setUp(self):
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["HR User"]
        # A real dict, not the module MagicMock: `form_dict.get("confirm")` on a
        # MagicMock returns a truthy MagicMock and would silently confirm everything.
        frappe.form_dict = {}
        frappe.db.set_value.reset_mock()
        frappe.db.commit.reset_mock()

    def test_non_hr_session_is_rejected(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        frappe.session.user = "punchclock@example.com"
        frappe.get_roles.return_value = []
        store = []

        with patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            with self.assertRaises(Exception) as ctx:
                decide_flags(
                    identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                    outcome="EXCUSED",
                    reason="APPROVED_LEAVE",
                )

        self.assertIn("Not permitted", str(ctx.exception))
        self.assertEqual(store, [])

    def test_invalid_outcome_throws(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        with self.assertRaises(Exception) as ctx:
            decide_flags(
                identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                outcome="FORGIVEN",
                reason="APPROVED_LEAVE",
            )

        self.assertIn("outcome", str(ctx.exception))

    def test_invalid_reason_throws(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        with self.assertRaises(Exception) as ctx:
            decide_flags(
                identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                outcome="EXCUSED",
                reason="FELT_LIKE_IT",
            )

        self.assertIn("reason", str(ctx.exception))

    def test_upheld_without_note_throws(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        with self.assertRaises(Exception) as ctx:
            decide_flags(
                identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                outcome="UPHELD",
                reason="GENUINE_VIOLATION",
            )

        self.assertIn("note", str(ctx.exception))

    def test_other_reason_without_note_throws(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        with self.assertRaises(Exception) as ctx:
            decide_flags(
                identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                outcome="EXCUSED",
                reason="OTHER",
            )

        self.assertIn("note", str(ctx.exception))

    def test_decision_row_denormalises_flag_and_branch(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        row = _flag_row("HR-EMP-00001")
        store = []

        with patch.object(
            frappe,
            "get_all",
            side_effect=_make_get_all(
                flags=[row],
                employees=[{"name": "HR-EMP-00001", "branch": "Phnom Penh HQ"}],
            ),
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            result = decide_flags(
                identities=[_identity(row)],
                outcome="EXCUSED",
                reason="APPROVED_LEAVE",
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["written"], 1)
        payload = _decision_docs(store)[0].payload
        self.assertEqual(payload["doctype"], "Attendance Flag Decision")
        self.assertEqual(payload["flag_identity"], _identity(row))
        self.assertEqual(payload["employee"], "HR-EMP-00001")
        self.assertEqual(payload["attendance_date"], FLAG_DATE)
        self.assertEqual(payload["flag_code"], "LATE_START")
        self.assertEqual(payload["employee_branch"], "Phnom Penh HQ")
        self.assertEqual(payload["evidence_fingerprint"], evidence_fingerprint(row["evidence"]))
        self.assertEqual(payload["superseded"], 0)
        self.assertIsNone(payload["supersedes"])

    def test_identities_accepted_as_json_string(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        row = _flag_row("HR-EMP-00002")
        store = []

        with patch.object(
            frappe, "get_all", side_effect=_make_get_all(flags=[row])
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            result = decide_flags(
                identities=json.dumps([_identity(row)]),
                outcome="EXCUSED",
                reason="DEVICE_OR_DATA_FAULT",
            )

        self.assertEqual(result["written"], 1)
        self.assertEqual(len(_decision_docs(store)), 1)

    def test_decided_by_and_decided_at_come_from_the_session_not_the_client(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        row = _flag_row("HR-EMP-00003")
        store = []
        frappe.form_dict = {
            "decided_by": "attacker@example.com",
            "decided_at": "2020-01-01 00:00:00",
        }

        with patch.object(
            frappe, "get_all", side_effect=_make_get_all(flags=[row])
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            decide_flags(
                identities=[_identity(row)],
                outcome="EXCUSED",
                reason="MANAGER_APPROVED",
            )

        payload = _decision_docs(store)[0].payload
        self.assertEqual(payload["decided_by"], "hr@example.com")
        self.assertEqual(payload["decided_at"], FIXED_NOW)

    def test_one_bad_identity_among_39_writes_38_and_reports_one_error(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        rows = [_flag_row(f"HR-EMP-{index:05d}") for index in range(1, 40)]
        # The 39th flag was corrected away while HR was deciding — its identity no
        # longer resolves to a live AUTO flag.
        live_rows = rows[:-1]
        identities = [_identity(row) for row in rows]
        store = []

        with patch.object(
            frappe,
            "get_all",
            side_effect=_make_get_all(
                flags=live_rows,
                employees=[{"name": row["employee"], "branch": "Siem Reap"} for row in live_rows],
            ),
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            result = decide_flags(
                identities=identities,
                outcome="EXCUSED",
                reason="DEVICE_OR_DATA_FAULT",
                confirm=1,
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["written"], 38)
        self.assertEqual(len(_decision_docs(store)), 38)
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["errors"][0]["flag_identity"], identities[-1])
        self.assertTrue(result["errors"][0]["error"])
        # One group_key, generated server-side, shared by every row in the call.
        self.assertTrue(result["group_key"])
        self.assertEqual(
            {doc.payload["group_key"] for doc in _decision_docs(store)},
            {result["group_key"]},
        )

    def test_over_threshold_without_confirm_previews_and_writes_nothing(self):
        from dewey_time.attendance_engine.flag_decision_api import (
            DECIDE_CONFIRM_THRESHOLD,
            decide_flags,
        )

        rows = [
            _flag_row(f"HR-EMP-{index:05d}")
            for index in range(1, DECIDE_CONFIRM_THRESHOLD + 2)
        ]
        store = []

        with patch.object(
            frappe, "get_all", side_effect=_make_get_all(flags=rows)
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            result = decide_flags(
                identities=[_identity(row) for row in rows],
                outcome="EXCUSED",
                reason="DEVICE_OR_DATA_FAULT",
            )

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["count"], DECIDE_CONFIRM_THRESHOLD + 1)
        self.assertEqual(result["preview"]["employees"], DECIDE_CONFIRM_THRESHOLD + 1)
        self.assertEqual(store, [])
        frappe.db.set_value.assert_not_called()

    def test_second_decision_supersedes_the_first(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        row = _flag_row("HR-EMP-00007")
        identity = _identity(row)
        decisions = []
        store = []

        with patch.object(
            frappe,
            "get_all",
            side_effect=_make_get_all(flags=[row], decisions=decisions),
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            decide_flags(
                identities=[identity],
                outcome="EXCUSED",
                reason="APPROVED_LEAVE",
            )
            first = _decision_docs(store)[0]
            self.assertIsNone(first.payload["supersedes"])
            frappe.db.set_value.assert_not_called()

            # The first row is now the live one for this identity.
            decisions.append({"name": first.name, "flag_identity": identity})

            second_result = decide_flags(
                identities=[identity],
                outcome="UPHELD",
                reason="GENUINE_VIOLATION",
                note="Third unexplained late start this month.",
            )

        self.assertEqual(second_result["written"], 1)
        second = _decision_docs(store)[1]
        self.assertEqual(second.payload["supersedes"], first.name)
        self.assertEqual(second.payload["superseded"], 0)
        self.assertEqual(second.payload["outcome"], "UPHELD")
        # Only the pointer flips on the old row; its content is never edited.
        frappe.db.set_value.assert_called_once_with(
            "Attendance Flag Decision",
            first.name,
            "superseded",
            1,
            update_modified=False,
        )


class TestReverseDecisionGroup(unittest.TestCase):
    def setUp(self):
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["HR User"]
        frappe.form_dict = {}
        frappe.db.set_value.reset_mock()
        frappe.db.commit.reset_mock()

    def test_plain_hr_user_cannot_reverse_a_group(self):
        from dewey_time.attendance_engine.flag_decision_api import reverse_decision_group

        store = []
        with patch.object(frappe, "get_all", side_effect=_make_get_all()), patch.object(
            frappe, "get_doc", side_effect=_make_get_doc(store)
        ):
            with self.assertRaises(Exception) as ctx:
                reverse_decision_group(
                    group_key="AFD-a1b2c3d4e5f6",
                    note="Wrong batch.",
                    confirm=1,
                )

        self.assertIn("HR Manager", str(ctx.exception))
        frappe.db.set_value.assert_not_called()
        self.assertEqual(store, [])

    def test_reversal_requires_a_note(self):
        from dewey_time.attendance_engine.flag_decision_api import reverse_decision_group

        frappe.get_roles.return_value = ["HR User", "HR Manager"]

        with patch.object(frappe, "get_all", side_effect=_make_get_all()):
            with self.assertRaises(Exception) as ctx:
                reverse_decision_group(group_key="AFD-a1b2c3d4e5f6", note="  ", confirm=1)

        self.assertIn("note", str(ctx.exception))

    def test_hr_manager_previews_then_supersedes_every_live_row_in_the_group(self):
        from dewey_time.attendance_engine.flag_decision_api import reverse_decision_group

        frappe.get_roles.return_value = ["HR User", "HR Manager"]
        rows = [
            {"name": "AFD-0001", "flag_identity": "AUTO-a-2026-08-03-late-start", "employee": "HR-EMP-00001"},
            {"name": "AFD-0002", "flag_identity": "AUTO-b-2026-08-03-late-start", "employee": "HR-EMP-00002"},
        ]
        store = []

        with patch.object(
            frappe, "get_all", side_effect=_make_get_all(decisions=rows)
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            preview = reverse_decision_group(
                group_key="AFD-a1b2c3d4e5f6",
                note="Device fault was misdiagnosed.",
            )
            self.assertTrue(preview["needs_confirm"])
            self.assertEqual(preview["preview"], {"count": 2, "employees": 2})
            frappe.db.set_value.assert_not_called()

            result = reverse_decision_group(
                group_key="AFD-a1b2c3d4e5f6",
                note="Device fault was misdiagnosed.",
                confirm=1,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["reversed"], 2)
        self.assertEqual(result["errors"], [])
        self.assertEqual(
            [call.args for call in frappe.db.set_value.call_args_list],
            [
                ("Attendance Flag Decision", "AFD-0001", "superseded", 1),
                ("Attendance Flag Decision", "AFD-0002", "superseded", 1),
            ],
        )
        comments = [doc for doc in store if doc.payload.get("doctype") == "Comment"]
        self.assertEqual(len(comments), 2)
        self.assertIn("Device fault was misdiagnosed.", comments[0].payload["content"])


if __name__ == "__main__":
    unittest.main()
