import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


class TestSummarize(unittest.TestCase):
    def test_leaving_only(self):
        from dewey_time.attendance_engine.schedule_change_log import _summarize

        self.assertEqual(_summarize(["MON-FRI 09-17"], []), "Retired MON-FRI 09-17")

    def test_adding_only(self):
        from dewey_time.attendance_engine.schedule_change_log import _summarize

        self.assertEqual(_summarize([], ["SAT 08-12"]), "Added SAT 08-12")

    def test_both(self):
        from dewey_time.attendance_engine.schedule_change_log import _summarize

        self.assertEqual(_summarize(["A"], ["B"]), "Retired A; Added B")

    def test_neither(self):
        from dewey_time.attendance_engine.schedule_change_log import _summarize

        self.assertEqual(_summarize([], []), "Schedule updated")


class TestRecordScheduleChange(unittest.TestCase):
    def test_noop_writes_nothing(self):
        import frappe
        from dewey_time.attendance_engine import schedule_change_log

        frappe.db.table_exists.return_value = True
        with patch.object(schedule_change_log.frappe, "new_doc") as new_doc:
            out = schedule_change_log.record_schedule_change(
                employee="EMP-1",
                effective_from="2026-07-01",
                reconcile={"leaving_labels": [], "add_labels": [], "affected_assignments": []},
                created={"shift_types": [], "shift_schedules": []},
                ssas=[],
            )
        self.assertIsNone(out)
        new_doc.assert_not_called()

    def test_writes_row_for_real_change(self):
        import frappe
        from dewey_time.attendance_engine import schedule_change_log

        frappe.db.table_exists.return_value = True
        frappe.session = type("S", (), {"user": "hr@example.com"})()
        doc = MagicMock()
        doc.name = "SCL-xyz"
        with patch.object(schedule_change_log.frappe, "new_doc", return_value=doc):
            out = schedule_change_log.record_schedule_change(
                employee="EMP-1",
                effective_from="2026-07-01",
                reconcile={
                    "leaving_labels": ["MON-FRI 09-17"],
                    "add_labels": ["MON-SAT 09-17"],
                    "affected_assignments": [{"action": "inactivate"}, {"action": "end_before"}],
                },
                created={"shift_types": [], "shift_schedules": []},
                ssas=[{"name": "SSA-1"}],
            )
        self.assertEqual(out, "SCL-xyz")
        self.assertEqual(doc.employee, "EMP-1")
        self.assertEqual(doc.changed_by, "hr@example.com")
        self.assertEqual(doc.inactivated_count, 1)
        self.assertEqual(doc.trimmed_count, 1)
        self.assertEqual(doc.summary, "Retired MON-FRI 09-17; Added MON-SAT 09-17")
        doc.insert.assert_called_once()

    def test_never_raises_on_failure(self):
        import frappe
        from dewey_time.attendance_engine import schedule_change_log

        frappe.db.table_exists.return_value = True

        def boom(*a, **k):
            raise RuntimeError("db down")

        with patch.object(schedule_change_log.frappe, "new_doc", side_effect=boom):
            out = schedule_change_log.record_schedule_change(
                employee="EMP-1",
                effective_from="2026-07-01",
                reconcile={"leaving_labels": ["X"], "add_labels": [], "affected_assignments": []},
                created={},
                ssas=[],
            )
        self.assertIsNone(out)


if __name__ == "__main__":
    unittest.main()
