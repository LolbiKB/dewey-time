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
    def test_notify_inserts_when_missing(self, get_doc, exists, merge, _auth):
        from dewey_time.attendance_engine.device_sync import notify_device_sync_status

        def _exists(doctype, name):
            if doctype == "Branch":
                return True
            return False

        exists.side_effect = _exists
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

        get_doc.assert_called_once()
        doc.save.assert_called_once_with(ignore_permissions=True)

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
