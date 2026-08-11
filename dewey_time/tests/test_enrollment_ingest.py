import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import enrollment as mod  # noqa: E402


class _Rejected(Exception):
    """What frappe.throw becomes for the tests that assert a rejection."""


class UpsertTest(unittest.TestCase):
    def test_the_docname_is_the_employee_id(self):
        """One row per employee, name-keyed, so the upsert needs no lookup."""
        doc = MagicMock()
        # Real Frappe populates name from the construction dict; MagicMock does
        # not, so state it here rather than bending the code to suit the mock.
        doc.name = "HR-EMP-0042"
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

    def test_a_blank_employee_id_is_rejected(self):
        """The bridge sends frappe_employee_id straight through from Supabase;
        an empty (whitespace-only) value must not create a row named "" ."""
        with self.assertRaisesRegex(Exception, "employee is required"):
            mod.upsert_enrollment_row(
                employee="   ",
                pin="1042",
                is_registered=True,
                fingerprint_count=1,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )

    def test_a_padded_employee_id_is_stripped_before_naming(self):
        """The construction dict bypasses set_new_name's own strip, so this
        guard is the only thing standing between a padded bridge id and a
        docname with whitespace in it."""
        doc = MagicMock()
        with patch.object(mod.frappe.db, "exists", return_value=False), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ) as get_doc:
            mod.upsert_enrollment_row(
                employee="  HR-EMP-0042 ", pin="1042", is_registered=True,
                fingerprint_count=1, face_count=0,
                synced_at="2026-08-11 09:14:03", bridge_env="prod",
            )
        get_doc.assert_called_once_with(
            {"doctype": mod.ENROLLMENT_DOCTYPE, "name": "HR-EMP-0042"}
        )

    def test_a_malformed_count_does_not_abort_the_row(self):
        """One bad value from the bridge must not take down the whole snapshot."""
        doc = MagicMock()
        with patch.object(mod.frappe.db, "exists", return_value=False), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ):
            mod.upsert_enrollment_row(
                employee="HR-EMP-0042", pin="1042", is_registered=True,
                fingerprint_count="abc", face_count=None,
                synced_at="2026-08-11 09:14:03", bridge_env="prod",
            )
        self.assertEqual(doc.fingerprint_count, 0)
        self.assertEqual(doc.face_count, 0)


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


if __name__ == "__main__":
    unittest.main()
