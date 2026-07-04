"""Tests for the engine heartbeat + get_engine_health endpoint (T3-4).

Covers:
- healthy=false + minutes_since_last_run=None when no heartbeat is set
- healthy=true when heartbeat is recent (~5 min ago)
- healthy=false when heartbeat is stale (~120 min ago)
- _record_intraday_heartbeat calls the global-default setter
"""
import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


# ---------------------------------------------------------------------------
# get_engine_health — uses _read_heartbeat_value() as the patchable seam
# ---------------------------------------------------------------------------

class TestGetEngineHealthNoHeartbeat(unittest.TestCase):
    """When no heartbeat has been written, the endpoint should report not healthy."""

    @patch("dewey_time.attendance_engine.api._read_heartbeat_value", return_value=None)
    @patch("dewey_time.attendance_engine.api.now_datetime")
    def test_no_heartbeat_returns_unhealthy(self, mock_now, _mock_read):
        from dewey_time.attendance_engine.api import get_engine_health

        mock_now.return_value = datetime(2026, 7, 2, 10, 0, 0)

        result = get_engine_health()

        self.assertFalse(result["healthy"])
        self.assertIsNone(result["last_intraday_run_at"])
        self.assertIsNone(result["minutes_since_last_run"])
        self.assertEqual(result["stale_after_minutes"], 90)
        self.assertIn("server_time", result)


class TestGetEngineHealthRecentHeartbeat(unittest.TestCase):
    """A heartbeat ~5 minutes ago should be reported as healthy."""

    @patch("dewey_time.attendance_engine.api.now_datetime")
    def test_recent_heartbeat_returns_healthy(self, mock_now):
        from dewey_time.attendance_engine.api import get_engine_health

        server_now = datetime(2026, 7, 2, 10, 5, 0)
        last_run = datetime(2026, 7, 2, 10, 0, 0)
        mock_now.return_value = server_now

        with patch(
            "dewey_time.attendance_engine.api._read_heartbeat_value",
            return_value=last_run.isoformat(timespec="seconds"),
        ):
            result = get_engine_health()

        self.assertTrue(result["healthy"])
        self.assertEqual(result["last_intraday_run_at"], "2026-07-02T10:00:00")
        self.assertAlmostEqual(result["minutes_since_last_run"], 5.0, places=0)
        self.assertEqual(result["stale_after_minutes"], 90)


class TestGetEngineHealthStaleHeartbeat(unittest.TestCase):
    """A heartbeat ~120 minutes ago should be reported as not healthy."""

    @patch("dewey_time.attendance_engine.api.now_datetime")
    def test_stale_heartbeat_returns_unhealthy(self, mock_now):
        from dewey_time.attendance_engine.api import get_engine_health

        server_now = datetime(2026, 7, 2, 12, 0, 0)
        last_run = datetime(2026, 7, 2, 10, 0, 0)  # 120 min ago
        mock_now.return_value = server_now

        with patch(
            "dewey_time.attendance_engine.api._read_heartbeat_value",
            return_value=last_run.isoformat(timespec="seconds"),
        ):
            result = get_engine_health()

        self.assertFalse(result["healthy"])
        self.assertAlmostEqual(result["minutes_since_last_run"], 120.0, places=0)
        self.assertEqual(result["stale_after_minutes"], 90)


# ---------------------------------------------------------------------------
# _record_intraday_heartbeat
# ---------------------------------------------------------------------------

class TestRecordIntradayHeartbeat(unittest.TestCase):
    """_record_intraday_heartbeat should call the global-default setter with the right key."""

    @patch("dewey_time.attendance_engine.intraday.frappe.db")
    @patch("dewey_time.attendance_engine.intraday.now_datetime")
    def test_writes_heartbeat_with_correct_key(self, mock_now, mock_db):
        from dewey_time.attendance_engine.intraday import _record_intraday_heartbeat, _HEARTBEAT_KEY

        fixed_now = datetime(2026, 7, 2, 9, 30, 0)
        mock_now.return_value = fixed_now

        _record_intraday_heartbeat()

        mock_db.set_global_default.assert_called_once_with(
            _HEARTBEAT_KEY,
            fixed_now.isoformat(timespec="seconds"),
        )

    @patch("dewey_time.attendance_engine.intraday.frappe.db")
    @patch("dewey_time.attendance_engine.intraday.now_datetime")
    def test_heartbeat_failure_is_swallowed(self, mock_now, mock_db):
        """A write error must not propagate — the scheduler run must survive."""
        from dewey_time.attendance_engine.intraday import _record_intraday_heartbeat

        mock_now.return_value = datetime(2026, 7, 2, 9, 30, 0)
        mock_db.set_global_default.side_effect = RuntimeError("DB unavailable")

        # Should not raise
        _record_intraday_heartbeat()
