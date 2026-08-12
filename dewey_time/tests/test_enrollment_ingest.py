import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import enrollment as mod  # noqa: E402


class _Rejected(Exception):
    """What frappe.throw becomes for the tests that assert a rejection."""


class UpsertTest(unittest.TestCase):
    def test_a_new_row_is_named_after_the_employee(self):
        """A row that does not exist yet is created name-keyed, matching the
        doctype's autoname (field:employee)."""
        doc = MagicMock()
        # Real Frappe populates name from the construction dict; MagicMock does
        # not, so state it here rather than bending the code to suit the mock.
        doc.name = "HR-EMP-0042"
        with patch.object(mod.frappe.db, "get_value", return_value=None), patch.object(
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

        # The values ride in the construction dict, and the row is INSERTed.
        # `name` is deliberately absent: autoname is field:employee, and a
        # dict-constructed doc that carries a name is treated as an existing
        # row, so save() would take the UPDATE path and check_if_latest would
        # raise DoesNotExistError on the very first write. Verified against a
        # real bench -- the mocked suite cannot see it, which is how it shipped.
        get_doc.assert_called_once_with({
                "doctype": mod.ENROLLMENT_DOCTYPE,
                "employee": "HR-EMP-0042",
                "pin": "1042",
                "is_registered": 1,
                "fingerprint_count": 2,
                "face_count": 0,
                "synced_at": "2026-08-11 09:14:03",
                "bridge_env": "prod",
            })
        self.assertEqual(name, "HR-EMP-0042")
        doc.insert.assert_called_once_with(ignore_permissions=True)
        doc.save.assert_not_called()

    def test_an_existing_row_is_loaded_not_recreated(self):
        doc = MagicMock()
        with patch.object(
            mod.frappe.db, "get_value", return_value="HR-EMP-0042"
        ), patch.object(mod.frappe, "get_doc", return_value=doc) as get_doc:
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

    def test_a_renamed_employee_updates_its_existing_row_not_a_second_one(self):
        """autoname is field:employee, but that only holds at CREATION.

        frappe.rename_doc on an Employee -- routine HR cleanup -- rewrites this
        doctype's `employee` Link column and leaves the register row named after
        the OLD id. Looking the row up by NAME would then miss it and insert a
        SECOND row, which immediately violates unique:1 on `employee` (the old
        row now carries the new id) and aborts every snapshot from then on,
        forever. So the docname is resolved by field, never assumed.
        """
        doc = MagicMock()
        with patch.object(
            mod.frappe.db, "get_value", return_value="HR-EMP-OLD"
        ) as get_value, patch.object(mod.frappe, "get_doc", return_value=doc) as get_doc:
            mod.upsert_enrollment_row(
                employee="HR-EMP-NEW",
                pin="1042",
                is_registered=True,
                fingerprint_count=1,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )

        get_value.assert_called_once_with(
            mod.ENROLLMENT_DOCTYPE, {"employee": "HR-EMP-NEW"}, "name"
        )
        get_doc.assert_called_once_with(mod.ENROLLMENT_DOCTYPE, "HR-EMP-OLD")
        self.assertEqual(doc.employee, "HR-EMP-NEW")

    def test_is_registered_is_stored_as_an_int_not_a_bool(self):
        """Frappe Check fields are 0/1. A Python bool round-trips through the
        ORM but compares badly in db filters like {"is_registered": 1}."""
        doc = MagicMock()
        with patch.object(mod.frappe.db, "get_value", return_value=None), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ) as get_doc:
            mod.upsert_enrollment_row(
                employee="HR-EMP-0042",
                pin="1042",
                is_registered=True,
                fingerprint_count=1,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )
        self.assertIs(get_doc.call_args.args[0]["is_registered"], 1)

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
        with patch.object(mod.frappe.db, "get_value", return_value=None), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ) as get_doc:
            mod.upsert_enrollment_row(
                employee="  HR-EMP-0042 ", pin="1042", is_registered=True,
                fingerprint_count=1, face_count=0,
                synced_at="2026-08-11 09:14:03", bridge_env="prod",
            )
        self.assertEqual(get_doc.call_args.args[0]["employee"], "HR-EMP-0042")

    def test_a_malformed_count_does_not_abort_the_row(self):
        """One bad value from the bridge must not take down the whole snapshot."""
        doc = MagicMock()
        with patch.object(mod.frappe.db, "get_value", return_value=None), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ) as get_doc:
            mod.upsert_enrollment_row(
                employee="HR-EMP-0042", pin="1042", is_registered=True,
                fingerprint_count="abc", face_count=None,
                synced_at="2026-08-11 09:14:03", bridge_env="prod",
            )
        values = get_doc.call_args.args[0]
        self.assertEqual(values["fingerprint_count"], 0)
        self.assertEqual(values["face_count"], 0)

    def test_an_existing_row_is_saved_never_inserted(self):
        """The other half of the insert/save split.

        These two branches are not interchangeable in Frappe and the mocks
        cannot tell them apart by outcome, so the branch CHOICE is what gets
        pinned -- once in each direction.
        """
        doc = MagicMock()
        with patch.object(
            mod.frappe.db, "get_value", return_value="HR-EMP-0042"
        ), patch.object(mod.frappe, "get_doc", return_value=doc):
            mod.upsert_enrollment_row(
                employee="HR-EMP-0042", pin="1042", is_registered=True,
                fingerprint_count=1, face_count=0,
                synced_at="2026-08-11 09:14:03", bridge_env="prod",
            )
        doc.save.assert_called_once_with(ignore_permissions=True)
        doc.insert.assert_not_called()


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
        #: Ordered log of the two write-visibility calls, so their sequence is
        #: assertable and not merely their occurrence.
        self.sequence = []
        self.invalidate_cache = MagicMock(
            side_effect=lambda: self.sequence.append("invalidate")
        )
        self.commit = MagicMock(side_effect=lambda: self.sequence.append("commit"))

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
        registered_docnames=None,
        previous_count=None,
        existing_employees=None,
        scanned_at=_UNSET,
        **kwargs,
    ):
        """Drive notify_enrollment_snapshot with the DB stubbed out.

        `existing_employees=None` means "every linked id has an Employee
        record" (the default for tests not exercising that guard); pass an
        explicit iterable to make some ids missing.

        `existing_registered` names already-registered EMPLOYEES and assumes
        docname == employee, which is the ordinary case. Pass
        `registered_docnames` instead to drive the post-rename case where the
        two diverge.
        """
        if registered_docnames is None:
            registered_docnames = {emp: emp for emp in existing_registered}
        if previous_count is None:
            previous_count = len(registered_docnames)
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
            mod, "_registered_employee_docnames", return_value=dict(registered_docnames)
        ), patch.object(
            mod, "_previous_registered_count", return_value=previous_count
        ), patch.object(
            mod, "_existing_employee_ids", side_effect=_existing
        ), patch.object(
            mod, "_record_snapshot_time"
        ), patch(
            # The webhook imports this one lazily (circular import), so patch it
            # on its own module -- the deferred import reads the attribute at
            # call time and sees the stand-in.
            "dewey_time.attendance_engine.enrollment_api.invalidate_enrollment_cache",
            self.invalidate_cache,
        ), patch.object(mod.frappe.db, "commit", self.commit):
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

    def test_the_clear_path_writes_to_the_docname_not_the_employee_value(self):
        """The rename hazard's other end.

        `employee` is a Link column and the docname is only equal to it at
        creation. After frappe.rename_doc the two diverge, and clearing by
        employee VALUE hands db.set_value a name that does not exist -- which
        updates zero rows and raises nothing, so a leaver stays flagged as
        enrolled while last_enrollment_snapshot_at advances as though the
        snapshot had landed. Silent, permanent, and invisible to every caller.
        """
        result = self._run(
            [_user("E1")], registered_docnames={"E2": "HR-EMP-OLD-E2"}
        )
        self.assertEqual(self.cleared, ["HR-EMP-OLD-E2"])
        self.assertEqual(result["cleared"], 1)

    def test_an_employee_present_under_a_renamed_docname_is_not_cleared(self):
        """The absent set is computed on employee VALUES even though the write
        goes to docnames -- `seen` holds what the bridge reported, which is the
        employee id. Comparing docnames against it would clear a row that was
        in the snapshot."""
        self._run([_user("E1")], registered_docnames={"E1": "HR-EMP-OLD-E1"})
        self.assertEqual(self.cleared, [])

    def test_a_clear_only_snapshot_still_drops_the_read_cache(self):
        """_clear_absent_rows writes with db.set_value, which fires no doc
        hooks -- so the "Employee Biometric Enrollment" doc_events invalidation
        misses a snapshot that only cleared rows. Clearing IS the offboarding
        signal, the highest-value row on the page; it must not sit behind the
        read cache's TTL."""
        result = self._run([], existing_registered=("E2",))
        self.assertEqual(self.upserts, [])
        self.assertEqual(self.cleared, ["E2"])
        self.assertEqual(result["cleared"], 1)
        self.invalidate_cache.assert_called_once_with()

    def test_the_cache_is_dropped_after_the_commit_not_before(self):
        """Invalidating first leaves a window: a concurrent
        get_enrollment_report landing between the delete and the commit
        rebuilds from PRE-commit state and re-caches it for the full TTL --
        re-establishing exactly the staleness the call exists to remove, and
        for longer than doing nothing would have."""
        self._run([_user("E1")])
        self.assertEqual(self.sequence, ["commit", "invalidate"])

    def test_two_pins_for_one_employee_aggregate_to_registered(self):
        """The bridge's `users` table is one row per device PIN, and nothing
        stops two PINs mapping to one employee -- a re-enrolment under a new
        PIN with the stale row left behind. Upserting both lets the LAST array
        element win, so a stale `is_registered: false` sorting after the live
        row flips a leaver's register row to 0. classify(Left, False) is None,
        and LEAVER_STILL_ENROLLED -- the security finding this whole report
        exists for -- silently disappears. OR the flags instead."""
        self._run([_user("E1", registered=True), _user("E1", registered=False)])
        self.assertEqual(len(self.upserts), 1)
        self.assertTrue(self.upserts[0]["is_registered"])

    def test_the_aggregate_does_not_depend_on_array_order(self):
        """Same two rows the other way round. Order-dependence is the defect."""
        self._run([_user("E1", registered=False), _user("E1", registered=True)])
        self.assertEqual(len(self.upserts), 1)
        self.assertTrue(self.upserts[0]["is_registered"])

    def test_the_aggregate_keeps_the_highest_count_and_the_first_pin(self):
        """Counts are per-device facts about one person: the bigger number is
        the one that describes them. The pin is provenance for whoever goes
        looking at the device, so the first non-empty one is kept rather than
        blanked by a stale row."""
        first = dict(_user("E1", fp=1), pin="")
        second = dict(_user("E1", fp=3), pin="2001", face_count=2)
        self._run([first, second])
        self.assertEqual(self.upserts[0]["fingerprint_count"], 3)
        self.assertEqual(self.upserts[0]["face_count"], 2)
        self.assertEqual(self.upserts[0]["pin"], "2001")

    def test_duplicate_employee_ids_are_counted_so_the_bridge_can_log_them(self):
        """Merging quietly would hide a real bridge-side data problem; the
        count is how the operator finds out the PIN table needs cleaning.

        It counts merged-away ENTRIES, not distinct employees -- three PINs for
        one person is 2, because 2 is how many stale rows there are to delete.
        """
        result = self._run([_user("E1"), _user("E1"), _user("E1"), _user("E2")])
        self.assertEqual(result["duplicate_employee_ids"], 2)
        self.assertEqual(result["registered"], 2)

    def test_no_duplicates_reports_zero_not_absent(self):
        """A declared int, always present -- the bridge logs it unconditionally."""
        result = self._run([_user("E1"), _user("E2")])
        self.assertEqual(result["duplicate_employee_ids"], 0)

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
            mod, "_registered_employee_docnames", return_value={}
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


class RegisteredEmployeeDocnamesTest(unittest.TestCase):
    """Direct coverage of _registered_employee_docnames: the clearing pass
    needs BOTH halves of the row's identity, because a rename makes them
    different values."""

    def test_it_maps_the_employee_value_to_the_docname_they_can_diverge(self):
        with patch.object(
            mod.frappe,
            "get_all",
            return_value=[{"name": "HR-EMP-OLD", "employee": "HR-EMP-NEW"}],
        ) as get_all:
            result = mod._registered_employee_docnames()

        get_all.assert_called_once_with(
            mod.ENROLLMENT_DOCTYPE,
            filters={"is_registered": 1},
            fields=["name", "employee"],
        )
        self.assertEqual(result, {"HR-EMP-NEW": "HR-EMP-OLD"})


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
