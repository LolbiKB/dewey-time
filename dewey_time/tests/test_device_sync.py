import importlib
import unittest
from unittest.mock import ANY, MagicMock, patch

importlib.import_module("dewey_time.tests.test_closeout")


class TestDeviceSyncHelpers(unittest.TestCase):
    def test_device_sync_doc_name_stable(self):
        from dewey_time.attendance_engine.device_sync import device_sync_doc_name

        self.assertEqual(
            device_sync_doc_name("PYA8254100003", "2026-06-03"),
            "DSS-pya8254100003-2026-06-03",
        )

    def test_dedupe_calendar_rows_keeps_latest_modified(self):
        from dewey_time.attendance_engine.device_sync import dedupe_device_sync_for_calendar

        rows = dedupe_device_sync_for_calendar(
            [
                {
                    "device_sn": "DEV1",
                    "local_date": "2026-06-03",
                    "modified": "2026-06-03 10:00:00",
                    "last_device_log_at": "2026-06-03 09:00:00",
                },
                {
                    "device_sn": "DEV1",
                    "local_date": "2026-06-03",
                    "modified": "2026-06-03 14:00:00",
                    "last_device_log_at": "2026-06-03 13:00:00",
                },
                {
                    "device_sn": "DEV2",
                    "local_date": "2026-06-03",
                    "modified": "2026-06-03 11:00:00",
                },
            ]
        )
        self.assertEqual(len(rows), 2)
        dev1 = next(row for row in rows if row["device_sn"] == "DEV1")
        self.assertEqual(dev1["last_device_log_at"], "2026-06-03 13:00:00")


class TestDeviceSyncWebhook(unittest.TestCase):
    @patch("dewey_time.attendance_engine.bridge_auth.validate_bridge_request")
    @patch("dewey_time.attendance_engine.device_sync.merge_device_sync_duplicates")
    @patch("dewey_time.attendance_engine.device_sync.frappe.db.exists")
    @patch("dewey_time.attendance_engine.device_sync.frappe.get_doc")
    def test_notify_uses_get_doc_save(self, get_doc, exists, merge, _auth):
        from dewey_time.attendance_engine.device_sync import notify_device_sync_status

        def _exists(doctype, name):
            if doctype == "Branch":
                return True
            return True

        exists.side_effect = _exists
        merge.return_value = "DSS-dev1-2026-06-03"
        doc = MagicMock()
        doc.name = "DSS-dev1-2026-06-03"
        get_doc.return_value = doc

        result = notify_device_sync_status(
            device_sn="dev1",
            local_date="2026-06-03",
            device_branch="BRANCH-A",
            last_device_log_at="2026-06-03 14:02:00",
            last_delivered_at="2026-06-03 14:00:00",
            pending_count=0,
        )

        self.assertTrue(result["ok"])
        merge.assert_called_once_with("dev1", ANY)
        doc.save.assert_called_once_with(ignore_permissions=True)

    @patch("dewey_time.attendance_engine.bridge_auth.validate_bridge_request")
    @patch("dewey_time.attendance_engine.device_sync.merge_device_sync_duplicates")
    @patch("dewey_time.attendance_engine.device_sync.frappe.db.exists")
    @patch("dewey_time.attendance_engine.device_sync.frappe.get_doc")
    def test_notify_accepts_missing_last_delivered_at(self, get_doc, exists, merge, _auth):
        """Nothing delivered yet is a real state, not an error.

        Requiring last_delivered_at forced the bridge to substitute a value it
        did not have (it sent last_device_log_at), so an outage looked like
        delivery was current and the stalled-bridge banner could never fire.
        """
        from dewey_time.attendance_engine.device_sync import notify_device_sync_status

        exists.return_value = True
        merge.return_value = "DSS-dev1-2026-06-03"
        doc = MagicMock()
        doc.name = "DSS-dev1-2026-06-03"
        get_doc.return_value = doc

        result = notify_device_sync_status(
            device_sn="dev1",
            local_date="2026-06-03",
            device_branch="BRANCH-A",
            last_device_log_at="2026-06-03 14:02:00",
            last_delivered_at=None,
            pending_count=3,
        )

        self.assertTrue(result["ok"])
        doc.save.assert_called_once_with(ignore_permissions=True)

    @patch("dewey_time.attendance_engine.bridge_auth.validate_bridge_request")
    @patch("dewey_time.attendance_engine.device_sync.merge_device_sync_duplicates")
    @patch("dewey_time.attendance_engine.device_sync.frappe.db.exists")
    @patch("dewey_time.attendance_engine.device_sync.frappe.get_doc")
    def test_notify_inserts_when_missing(self, get_doc, exists, merge, _auth):
        from dewey_time.attendance_engine.device_sync import notify_device_sync_status

        def _exists(doctype, name):
            if doctype == "Branch":
                return True
            return False

        exists.side_effect = _exists
        merge.return_value = "DSS-dev1-2026-06-03"
        doc = MagicMock()
        # A sentinel, NOT the expected name. naming_rule is "By script", so the
        # assertion below has to prove the CODE assigned the docname. Seeding
        # the expected value here would make that assertion pass even with the
        # assignment deleted -- and the row would then insert under a Frappe-
        # generated hash instead of its stable (device_sn, local_date) key,
        # silently breaking the upsert for every subsequent tick.
        doc.name = "SENTINEL-NOT-ASSIGNED-BY-CODE"
        get_doc.return_value = doc

        notify_device_sync_status(
            device_sn="dev1",
            local_date="2026-06-03",
            device_branch="BRANCH-A",
            last_device_log_at="2026-06-03 14:02:00",
            last_delivered_at="2026-06-03 14:00:00",
        )

        # This test previously asserted doc.save() and so PINNED THE DEFECT: a
        # dict-constructed doc carrying an explicit `name` makes _save() take
        # the UPDATE path, and check_if_latest() then raised DoesNotExistError
        # on every first write. It was named "inserts_when_missing" while
        # requiring the one call that cannot insert.
        get_doc.assert_called_once()
        construction = get_doc.call_args.args[0]
        self.assertEqual(construction["doctype"], "Device Sync Status")
        self.assertNotIn("name", construction)
        self.assertEqual(doc.name, "DSS-dev1-2026-06-03")
        doc.insert.assert_called_once_with(ignore_permissions=True)
        doc.save.assert_not_called()

    @patch("dewey_time.attendance_engine.bridge_auth.validate_bridge_request")
    @patch("dewey_time.attendance_engine.device_sync.merge_device_sync_duplicates")
    @patch("frappe.db.exists")
    @patch("frappe.get_doc")
    def test_notify_saves_an_existing_row_and_never_inserts(
        self, get_doc, exists, merge, _auth
    ):
        """The reverse pin. Without it, swapping save() for insert() outright
        would pass the insert test above while breaking every update."""
        from dewey_time.attendance_engine.device_sync import notify_device_sync_status

        exists.return_value = True
        merge.return_value = "DSS-dev1-2026-06-03"
        doc = MagicMock()
        doc.name = "DSS-dev1-2026-06-03"
        get_doc.return_value = doc

        notify_device_sync_status(
            device_sn="dev1",
            local_date="2026-06-03",
            device_branch="BRANCH-A",
            last_device_log_at="2026-06-03 14:02:00",
            last_delivered_at="2026-06-03 14:00:00",
        )

        get_doc.assert_called_once_with("Device Sync Status", "DSS-dev1-2026-06-03")
        doc.save.assert_called_once_with(ignore_permissions=True)
        doc.insert.assert_not_called()

    @patch("dewey_time.attendance_engine.bridge_auth.validate_bridge_request")
    def test_delivered_after_device_log_rejected(self, _auth):
        from dewey_time.attendance_engine.device_sync import notify_device_sync_status

        with self.assertRaises(Exception):
            notify_device_sync_status(
                device_sn="dev1",
                local_date="2026-06-03",
                device_branch="BRANCH-A",
                last_device_log_at="2026-06-03 14:00:00",
                last_delivered_at="2026-06-03 15:00:00",
            )

    @patch("dewey_time.attendance_engine.bridge_auth.validate_bridge_request")
    def test_missing_device_branch_rejected(self, _auth):
        from dewey_time.attendance_engine.device_sync import notify_device_sync_status

        with self.assertRaises(Exception):
            notify_device_sync_status(
                device_sn="dev1",
                local_date="2026-06-03",
                device_branch="",
                last_device_log_at="2026-06-03 14:02:00",
                last_delivered_at="2026-06-03 14:00:00",
            )

    @patch("dewey_time.attendance_engine.device_sync.frappe.db.exists")
    @patch("dewey_time.attendance_engine.bridge_auth.validate_bridge_request")
    def test_unknown_device_branch_rejected(self, _auth, exists):
        from dewey_time.attendance_engine.device_sync import notify_device_sync_status

        def _exists(doctype, name):
            if doctype == "Branch":
                return False
            return True

        exists.side_effect = _exists

        with self.assertRaises(Exception):
            notify_device_sync_status(
                device_sn="dev1",
                local_date="2026-06-03",
                device_branch="UNKNOWN-BRANCH",
                last_device_log_at="2026-06-03 14:02:00",
                last_delivered_at="2026-06-03 14:00:00",
            )


class TestMergeDuplicates(unittest.TestCase):
    @patch("dewey_time.attendance_engine.device_sync.frappe.rename_doc")
    @patch("dewey_time.attendance_engine.device_sync.frappe.delete_doc")
    @patch("dewey_time.attendance_engine.device_sync.frappe.db.exists")
    @patch("dewey_time.attendance_engine.device_sync.frappe.get_all")
    def test_merge_keeps_highest_log_at(self, get_all, exists, delete_doc, rename_doc):
        from dewey_time.attendance_engine.device_sync import merge_device_sync_duplicates

        get_all.return_value = [
            {
                "name": "DSS-pya8254100003-2026-06-03-old",
                "modified": "2026-06-03 12:00:00",
                "last_device_log_at": "2026-06-03 10:00:00",
                "last_delivered_at": "2026-06-03 09:00:00",
            },
            {
                "name": "DSS-pya8254100003-2026-06-03",
                "modified": "2026-06-03 11:00:00",
                "last_device_log_at": "2026-06-03 14:00:00",
                "last_delivered_at": "2026-06-03 13:00:00",
            },
            {
                "name": "DSS-pya8254100003-2026-06-03-extra",
                "modified": "2026-06-03 15:00:00",
                "last_device_log_at": "2026-06-03 12:00:00",
                "last_delivered_at": "2026-06-03 11:00:00",
            },
        ]
        exists.return_value = False

        name = merge_device_sync_duplicates("PYA8254100003", "2026-06-03")

        self.assertEqual(name, "DSS-pya8254100003-2026-06-03")
        self.assertEqual(delete_doc.call_count, 2)
        rename_doc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
