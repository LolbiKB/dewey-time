from __future__ import annotations

from datetime import datetime, timedelta

from frappe.utils import getdate


def evaluate_lunch_flags(
    *,
    checkins: list[dict],
    shift_meta: dict | None,
    attendance_date,
    grace_minutes: int = 0,
) -> list[tuple[str, dict]]:
    """
    MVP lunch rules (full-day shifts with lunch window only).
    Returns list of (flag_code, extra_evidence) for closeout.
    """
    if not shift_meta:
        return []

    lunch_start = shift_meta.get("custom_lunch_start")
    lunch_end = shift_meta.get("custom_lunch_end")
    if not lunch_start or not lunch_end:
        return []

    attendance_date = getdate(attendance_date)
    punch_times = _sorted_punch_datetimes(checkins, attendance_date)
    if len(punch_times) < 2:
        return []

    lunch_start_dt = _combine_date_time(attendance_date, lunch_start)
    lunch_end_dt = _combine_date_time(attendance_date, lunch_end)
    if lunch_end_dt <= lunch_start_dt:
        return []

    grace = timedelta(minutes=max(0, int(grace_minutes or 0)))
    return_threshold = lunch_end_dt + grace

    flags: list[tuple[str, dict]] = []
    expected_lunch = {
        "lunch_start": lunch_start_dt.isoformat(),
        "lunch_end": lunch_end_dt.isoformat(),
        "grace_minutes": int(grace_minutes or 0),
        "return_threshold": return_threshold.isoformat(),
    }

    lunch_pair = _find_plausible_lunch_pair(
        punch_times, lunch_start_dt=lunch_start_dt, lunch_end_dt=lunch_end_dt, grace=grace
    )
    if lunch_pair is None:
        flags.append(
            (
                "MISSING_LUNCH",
                {
                    **expected_lunch,
                    "reason": "no_plausible_lunch_out_in_pair",
                    "punch_count": len(punch_times),
                },
            )
        )
    else:
        _lunch_out, lunch_in = lunch_pair
        if lunch_in > return_threshold:
            flags.append(
                (
                    "LATE_FROM_LUNCH",
                    {
                        **expected_lunch,
                        "lunch_out": _lunch_out.isoformat(),
                        "lunch_in": lunch_in.isoformat(),
                    },
                )
            )

    return flags


def _sorted_punch_datetimes(checkins: list[dict], attendance_date) -> list[datetime]:
    out: list[datetime] = []
    for row in checkins or []:
        dt = _coerce_punch_datetime(row.get("time"), attendance_date)
        if dt is not None:
            out.append(dt)
    out.sort()
    return out


def _coerce_punch_datetime(value, attendance_date) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if hasattr(value, "hour"):
        return _combine_date_time(attendance_date, value)
    try:
        from frappe.utils import get_datetime

        return get_datetime(value)
    except Exception:
        return None


def _combine_date_time(d, t) -> datetime:
    d = getdate(d)
    if isinstance(t, datetime):
        return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second)
    if hasattr(t, "hour"):
        return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second)
    from frappe.utils import get_datetime

    return get_datetime(f"{d} {t}")


def _find_plausible_lunch_pair(
    punch_times: list[datetime],
    *,
    lunch_start_dt: datetime,
    lunch_end_dt: datetime,
    grace: timedelta,
) -> tuple[datetime, datetime] | None:
    """First punch at/after lunch start followed by a later punch before lunch end + grace (+1h slack)."""
    window_end = lunch_end_dt + grace + timedelta(hours=1)

    for i in range(len(punch_times) - 1):
        lunch_out = punch_times[i]
        lunch_in = punch_times[i + 1]
        if lunch_out < lunch_start_dt:
            continue
        if lunch_in <= lunch_out:
            continue
        if lunch_in <= window_end:
            return lunch_out, lunch_in

    return None
