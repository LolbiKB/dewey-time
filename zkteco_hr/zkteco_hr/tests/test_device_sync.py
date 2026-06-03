import importlib
import unittest
from unittest.mock import MagicMock, patch

importlib.import_module("zkteco_hr.tests.test_closeout")


class TestDeviceSyncWebhook(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.bridge_auth.validate_bridge_request")
    @patch("zkteco_hr.attendance_engine.device_sync.frappe.db.exists")
    @patch("zkteco_hr.attendance_engine.device_sync.frappe.get_doc")
    def test_notify_device_sync_status_inserts(self, get_doc, exists, _auth):
        from zkteco_hr.attendance_engine.device_sync import notify_device_sync_status

        exists.side_effect = lambda doctype, name: doctype != "Device Sync Status"
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
        self.assertEqual(result["device_sn"], "dev1")
        doc.insert.assert_called_once_with(ignore_permissions=True)

    @patch("zkteco_hr.attendance_engine.bridge_auth.validate_bridge_request")
    @patch("zkteco_hr.attendance_engine.device_sync.frappe.db.set_value")
    @patch("zkteco_hr.attendance_engine.device_sync.frappe.db.exists")
    def test_notify_device_sync_status_upserts(self, exists, set_value, _auth):
        from zkteco_hr.attendance_engine.device_sync import notify_device_sync_status

        exists.side_effect = lambda doctype, name: doctype == "Device Sync Status" or doctype == "Branch"

        result = notify_device_sync_status(
            device_sn="dev1",
            local_date="2026-06-03",
            device_branch="BRANCH-A",
            last_device_log_at="2026-06-03 14:02:00",
            last_delivered_at="2026-06-03 14:00:00",
        )

        self.assertTrue(result["ok"])
        set_value.assert_called_once()

    @patch("zkteco_hr.attendance_engine.bridge_auth.validate_bridge_request")
    def test_delivered_after_device_log_rejected(self, _auth):
        from zkteco_hr.attendance_engine.device_sync import notify_device_sync_status

        with self.assertRaises(Exception):
            notify_device_sync_status(
                device_sn="dev1",
                local_date="2026-06-03",
                device_branch="BRANCH-A",
                last_device_log_at="2026-06-03 14:00:00",
                last_delivered_at="2026-06-03 15:00:00",
            )


    @patch("zkteco_hr.attendance_engine.bridge_auth.validate_bridge_request")
    def test_missing_device_branch_rejected(self, _auth):
        from zkteco_hr.attendance_engine.device_sync import notify_device_sync_status

        with self.assertRaises(Exception):
            notify_device_sync_status(
                device_sn="dev1",
                local_date="2026-06-03",
                device_branch="",
                last_device_log_at="2026-06-03 14:02:00",
                last_delivered_at="2026-06-03 14:00:00",
            )

    @patch("zkteco_hr.attendance_engine.device_sync.frappe.db.exists")
    @patch("zkteco_hr.attendance_engine.bridge_auth.validate_bridge_request")
    def test_unknown_device_branch_rejected(self, _auth, exists):
        from zkteco_hr.attendance_engine.device_sync import notify_device_sync_status

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


if __name__ == "__main__":
    unittest.main()
