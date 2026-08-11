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
    #: Sentinel distinct from None: _run(..., scanned_at=None) must be able to
    #: drive the "scanned_at is required" guard, not silently fall back to a
    #: default value the way a plain `scanned_at=None` default parameter would.
    _UNSET = object()

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

    def _run(
        self,
        users,
        *,
        existing_registered=(),
        previous_count=None,
        existing_employees=None,
        scanned_at=_UNSET,
        **kwargs,
    ):
        """Drive notify_enrollment_snapshot with the DB stubbed out.

        `existing_employees=None` means "every linked id has an Employee
        record" (the default for tests not exercising that guard); pass an
        explicit iterable to make some ids missing.
        """
        if previous_count is None:
            previous_count = len(existing_registered)
        if scanned_at is self._UNSET:
            scanned_at = "2026-08-11 09:14:03"

        def _clear(absent, **kw):
            self.cleared.extend(absent)
            return len(absent)

        def _existing(ids, **kw):
            ids = list(ids)
            return set(ids) if existing_employees is None else set(existing_employees)

        with patch.object(mod, "validate_bridge_request"), patch.object(
            mod, "upsert_enrollment_row", side_effect=lambda **kw: self.upserts.append(kw)
        ), patch.object(
            mod, "_clear_absent_rows", side_effect=_clear
        ), patch.object(
            mod, "_registered_employee_ids", return_value=set(existing_registered)
        ), patch.object(
            mod, "_previous_registered_count", return_value=previous_count
        ), patch.object(
            mod, "_existing_employee_ids", side_effect=_existing
        ), patch.object(
            mod, "_record_snapshot_time"
        ), patch.object(mod.frappe.db, "commit"):
            return mod.notify_enrollment_snapshot(
                bridge_env="prod",
                scanned_at=scanned_at,
                users=users,
                **kwargs,
            )

    def test_auth_runs_before_anything_else(self):
        """The gate must not be reachable around — assert it is called."""
        mod.frappe.throw = self._raise
        with patch.object(mod, "validate_bridge_request") as gate:
            with self.assertRaises(_Rejected):
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

    def test_a_non_dict_element_is_skipped_not_fatal(self):
        """A bare string in the array (e.g. ["E1"]) must not crash on
        `.get("frappe_employee_id")` -- it is simply not linked."""
        result = self._run(["E1", _user("E2")])
        self.assertEqual([u["employee"] for u in self.upserts], ["E2"])
        self.assertEqual(result["skipped_unlinked"], 1)

    def test_an_employee_absent_from_the_snapshot_is_cleared(self):
        """Snapshot semantics: absent means not enrolled. This is the whole
        offboarding signal, and a delta could not express it."""
        result = self._run([_user("E1")], existing_registered=("E1", "E2"))
        self.assertEqual(self.cleared, ["E2"])
        self.assertEqual(result["cleared"], 1)

    def test_a_users_json_string_is_parsed(self):
        """Frappe hands form-encoded bodies through as strings."""
        import json

        result = self._run(json.dumps([_user("E1")]))
        self.assertEqual(result["registered"], 1)

    def test_a_malformed_users_string_is_rejected_not_a_500(self):
        """json.loads raising straight out of an allow_guest=True webhook
        would surface as an unhandled 500 -- a traceback in the Error Log,
        nothing the bridge can parse. It must become a normal frappe.throw."""
        mod.frappe.throw = self._raise
        with self.assertRaises(_Rejected):
            self._run("not valid json{")

    def test_a_missing_scanned_at_is_rejected(self):
        mod.frappe.throw = self._raise
        with self.assertRaises(_Rejected):
            self._run([_user("E1")], scanned_at=None)

    def test_a_stringly_false_is_registered_is_coerced_correctly(self):
        """A wire "0" must not round-trip through bare bool() as True."""
        self._run([_user("E1", registered="0")])
        self.assertFalse(self.upserts[0]["is_registered"])

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

    def test_a_missing_employee_is_skipped_not_fatal(self):
        """The bridge tracks missingInFrappeIds for exactly this state: a
        deleted Employee must not wedge the feed with a LinkValidationError
        on every retry, forever."""
        result = self._run(
            [_user("E1"), _user("E2")], existing_employees=("E1",)
        )
        self.assertEqual([u["employee"] for u in self.upserts], ["E1"])
        self.assertEqual(result["skipped_missing_employee"], 1)
        self.assertEqual(result["registered"], 1)

    def test_a_failed_upsert_aborts_before_the_marker_advances(self):
        """seen.add happens before the upsert call, so a swallowed failure
        would both dodge the absent-clearing pass and still let the snapshot
        marker advance -- telling the report a stale row is fresh. The
        failure must propagate, not be swallowed."""

        def _boom(**kw):
            raise RuntimeError("db write failed")

        with patch.object(mod, "validate_bridge_request"), patch.object(
            mod, "upsert_enrollment_row", side_effect=_boom
        ), patch.object(
            mod, "_registered_employee_ids", return_value=set()
        ), patch.object(
            mod, "_previous_registered_count", return_value=0
        ), patch.object(
            mod, "_existing_employee_ids", return_value={"E1"}
        ), patch.object(
            mod, "_record_snapshot_time"
        ) as record_time, patch.object(mod.frappe.db, "commit") as commit:
            with self.assertRaises(RuntimeError):
                mod.notify_enrollment_snapshot(
                    bridge_env="prod",
                    scanned_at="2026-08-11 09:14:03",
                    users=[_user("E1")],
                )
        record_time.assert_not_called()
        commit.assert_not_called()

    def _raise(self, msg, exc=None):
        raise _Rejected(str(msg))


class ClearAbsentRowsTest(unittest.TestCase):
    """Direct coverage of _clear_absent_rows: the endpoint-level tests above
    all stub this out, so nothing was actually exercising the "clear" path
    the register's is_registered=0 offboarding signal depends on."""

    def test_zeroes_counts_via_a_direct_db_update(self):
        with patch.object(mod.frappe.db, "set_value") as set_value:
            count = mod._clear_absent_rows(
                ["E2"], synced_at="2026-08-11 09:14:03", bridge_env="prod"
            )

        set_value.assert_called_once_with(
            mod.ENROLLMENT_DOCTYPE,
            "E2",
            {
                "is_registered": 0,
                "fingerprint_count": 0,
                "face_count": 0,
                "synced_at": "2026-08-11 09:14:03",
                "bridge_env": "prod",
            },
            update_modified=True,
        )
        self.assertEqual(count, 1)

    def test_clearing_a_row_does_not_go_through_the_full_doc_save_helper(self):
        """The point of writing via db.set_value is to skip doc.save()'s Link
        revalidation entirely -- a row whose Employee was force-deleted must
        not raise LinkValidationError on this path either. Pinned here so a
        later "simplification" back to the shared helper reintroduces that
        wedge in an obviously-failing test rather than silently."""
        with patch.object(mod.frappe.db, "set_value"), patch.object(
            mod, "upsert_enrollment_row"
        ) as upsert:
            mod._clear_absent_rows(["E2"], synced_at="2026-08-11 09:14:03", bridge_env="prod")

        upsert.assert_not_called()


class ExistingEmployeeIdsTest(unittest.TestCase):
    """Direct coverage of _existing_employee_ids: one query for the whole
    payload, not one per row."""

    def test_one_query_not_one_per_row(self):
        with patch.object(mod.frappe, "get_all", return_value=["E1"]) as get_all:
            result = mod._existing_employee_ids(["E1", "E2", "E3"])

        get_all.assert_called_once_with(
            "Employee", filters={"name": ["in", ["E1", "E2", "E3"]]}, pluck="name"
        )
        self.assertEqual(result, {"E1"})

    def test_an_empty_input_skips_the_query_entirely(self):
        with patch.object(mod.frappe, "get_all") as get_all:
            result = mod._existing_employee_ids([])
        get_all.assert_not_called()
        self.assertEqual(result, set())


if __name__ == "__main__":
    unittest.main()
