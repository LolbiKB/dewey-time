from __future__ import annotations

from datetime import datetime, timedelta

from zkteco_hr.attendance_engine.lunch_detection import (
    detect_observed_lunch,
    find_plausible_lunch_pair,
    sorted_punch_datetimes,
    combine_date_time,
    coerce_punch_datetime,
)

# Re-export for tests / closeout
__all__ = [
    "evaluate_lunch_flags",
    "detect_observed_lunch",
    "find_plausible_lunch_pair",
]


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

    from frappe.utils import getdate

    attendance_date = getdate(attendance_date)
    punch_times = sorted_punch_datetimes(checkins, attendance_date)
    if len(punch_times) < 2:
        return []

    lunch_start_dt = combine_date_time(attendance_date, lunch_start)
    lunch_end_dt = combine_date_time(attendance_date, lunch_end)
    if lunch_end_dt <= lunch_start_dt:
        return []

    grace = timedelta(minutes=max(0, int(grace_minutes or 0)))
    return_threshold = lunch_end_dt + grace
    scheduled_minutes = int(max(0, (lunch_end_dt - lunch_start_dt).total_seconds() / 60))
    min_observed_minutes = max(1, scheduled_minutes // 2)

    flags: list[tuple[str, dict]] = []
    expected_lunch = {
        "lunch_start": lunch_start_dt.isoformat(),
        "lunch_end": lunch_end_dt.isoformat(),
        "grace_minutes": int(grace_minutes or 0),
        "return_threshold": return_threshold.isoformat(),
    }

    lunch_pair = find_plausible_lunch_pair(
        punch_times,
        lunch_start_dt=lunch_start_dt,
        lunch_end_dt=lunch_end_dt,
        grace=grace,
        min_duration_minutes=min_observed_minutes,
    )
    if lunch_pair is None:
        return []
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
