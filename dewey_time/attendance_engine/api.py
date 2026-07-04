import json
from datetime import datetime, timedelta

import frappe
from frappe.utils import get_datetime, getdate, now_datetime


_HEARTBEAT_KEY = "dewey_time_last_intraday_run_at"
_STALE_AFTER_MINUTES = 90  # intraday runs every 30 min; 3 missed cycles = stale


def _read_heartbeat_value():
    """Read the intraday heartbeat from the durable global-default KV store.

    Extracted as a named function so tests can stub it without needing to
    monkeypatch frappe.defaults across a module boundary.
    """
    return frappe.defaults.get_global_default(_HEARTBEAT_KEY)


@frappe.whitelist()
def get_engine_health():
    """Report whether the intraday scheduler is alive.

    The external uptime monitor authenticates with a Frappe API key
    (Authorization: token <key>:<secret>) and should alert on healthy=false
    or any non-200 response — a dead scheduler stops the heartbeat, the
    endpoint goes stale, and the monitor fires.
    """
    server_now = now_datetime()
    raw = _read_heartbeat_value()

    last_run_at = None
    minutes_since = None
    healthy = False

    if raw:
        try:
            # We write the heartbeat as a plain ISO string ("YYYY-MM-DDTHH:MM:SS");
            # use stdlib fromisoformat to avoid Frappe's get_datetime format assumptions.
            last_run_dt = datetime.fromisoformat(str(raw))
            # now_datetime() returns a naive datetime in server local time;
            # strip tzinfo from last_run_dt if present so the subtraction is safe.
            if last_run_dt.tzinfo is not None:
                last_run_dt = last_run_dt.replace(tzinfo=None)
            delta = server_now - last_run_dt
            minutes_since = round(delta.total_seconds() / 60, 1)
            last_run_at = str(raw)
            healthy = minutes_since <= _STALE_AFTER_MINUTES
        except Exception:
            pass  # corrupt timestamp → treat as never run

    return {
        "healthy": healthy,
        "last_intraday_run_at": last_run_at,
        "minutes_since_last_run": minutes_since,
        "stale_after_minutes": _STALE_AFTER_MINUTES,
        "server_time": server_now.isoformat(timespec="seconds"),
    }


@frappe.whitelist()
def get_my_week(employee: str, start_date: str, end_date: str):
    """
    MVP read API for Desk:
    - checkins per day
    - computed first/last + gross minutes (simple heuristic)
    - flags per day
    """
    from dewey_time.attendance_engine.hr_calendar import _require_calendar_access

    _require_calendar_access(employee)
    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be >= start_date")

    days = []
    cur = start
    while cur <= end:
        days.append(_get_day(employee=employee, attendance_date=cur))
        cur = cur + timedelta(days=1)

    return {"employee": employee, "start_date": str(start), "end_date": str(end), "days": days}


def _get_day(*, employee: str, attendance_date):
    attendance_date = getdate(attendance_date)
    start = get_datetime(str(attendance_date) + " 00:00:00")
    end = get_datetime(str(attendance_date) + " 23:59:59")

    checkins = (
        frappe.get_all(
            "Employee Checkin",
            filters={"employee": employee, "time": ["between", [start, end]]},
            fields=["time", "log_type", "device_id", "custom_device_branch"],
            order_by="time asc",
        )
        or []
    )

    first_in = checkins[0]["time"] if checkins else None
    last_out = checkins[-1]["time"] if checkins else None

    gross_minutes = None
    if first_in and last_out and last_out >= first_in:
        gross_minutes = int((last_out - first_in).total_seconds() / 60)

    flags = (
        frappe.get_all(
            "Attendance Flag",
            filters={"employee": employee, "attendance_date": attendance_date},
            fields=[
                "name",
                "flag_code",
                "severity",
                "source",
                "status",
                "day_closed",
                "rule_version",
                "evidence",
            ],
            order_by="creation asc",
        )
        or []
    )

    for f in flags:
        ev = f.get("evidence")
        if isinstance(ev, str) and ev:
            try:
                f["evidence"] = json.loads(ev)
            except Exception:
                f["evidence"] = None

    return {
        "date": str(attendance_date),
        "checkins": checkins,
        "first_in": first_in,
        "last_out": last_out,
        "gross_minutes": gross_minutes,
        "flags": flags,
    }

