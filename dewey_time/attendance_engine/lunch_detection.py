from __future__ import annotations

from datetime import datetime, timedelta

from frappe.utils import getdate

from dewey_time.attendance_engine.shift_times import combine_date_time


def detect_observed_lunch(
    *,
    checkins: list[dict],
    shift_meta: dict | None,
    attendance_date,
    grace_minutes: int = 0,
) -> dict | None:
    """
    Observed lunch = first plausible OUT→IN punch pair in the shift lunch window.
    Same heuristic as lunch closeout flags (no fabrication when absent).
    """
    if not shift_meta:
        return None

    lunch_start = shift_meta.get("custom_lunch_start")
    lunch_end = shift_meta.get("custom_lunch_end")
    if not lunch_start or not lunch_end:
        return None

    attendance_date = getdate(attendance_date)
    punch_times = sorted_punch_datetimes(checkins, attendance_date)
    if len(punch_times) < 2:
        return None

    lunch_start_dt = combine_date_time(attendance_date, lunch_start)
    lunch_end_dt = combine_date_time(attendance_date, lunch_end)
    if lunch_end_dt <= lunch_start_dt:
        return None

    grace = timedelta(minutes=max(0, int(grace_minutes or 0)))
    scheduled_minutes = int(max(0, (lunch_end_dt - lunch_start_dt).total_seconds() / 60))
    min_observed_minutes = max(1, scheduled_minutes // 2)
    pair = find_plausible_lunch_pair(
        punch_times,
        lunch_start_dt=lunch_start_dt,
        lunch_end_dt=lunch_end_dt,
        grace=grace,
        min_duration_minutes=min_observed_minutes,
    )
    if pair is None:
        return None

    lunch_out, lunch_in = pair
    minutes = int(max(0, (lunch_in - lunch_out).total_seconds() / 60))
    return_threshold = lunch_end_dt + grace

    return {
        "lunch_out": lunch_out.isoformat(),
        "lunch_in": lunch_in.isoformat(),
        "minutes": minutes,
        "lunch_start": lunch_start_dt.isoformat(),
        "lunch_end": lunch_end_dt.isoformat(),
        "return_threshold": return_threshold.isoformat(),
        "late_return": lunch_in > return_threshold,
    }


def sorted_punch_datetimes(checkins: list[dict], attendance_date) -> list[datetime]:
    out: list[datetime] = []
    for row in checkins or []:
        dt = coerce_punch_datetime(row.get("time"), attendance_date)
        if dt is not None:
            out.append(dt)
    out.sort()
    return out


def coerce_punch_datetime(value, attendance_date) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if hasattr(value, "hour"):
        return combine_date_time(attendance_date, value)
    try:
        from frappe.utils import get_datetime

        return get_datetime(value)
    except Exception:
        return None


def find_plausible_lunch_pair(
    punch_times: list[datetime],
    *,
    lunch_start_dt: datetime,
    lunch_end_dt: datetime,
    grace: timedelta,
    min_duration_minutes: int = 0,
) -> tuple[datetime, datetime] | None:
    """First plausible OUT→IN pair in lunch window meeting minimum duration."""
    window_end = lunch_end_dt + grace + timedelta(hours=1)
    min_duration_minutes = max(0, int(min_duration_minutes or 0))

    for i in range(len(punch_times) - 1):
        lunch_out = punch_times[i]
        lunch_in = punch_times[i + 1]
        if lunch_out < lunch_start_dt:
            continue
        if lunch_in <= lunch_out:
            continue
        if lunch_in <= window_end:
            minutes = int(max(0, (lunch_in - lunch_out).total_seconds() / 60))
            if minutes < min_duration_minutes:
                continue
            return lunch_out, lunch_in

    return None
