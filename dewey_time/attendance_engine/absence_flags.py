from __future__ import annotations

from datetime import time

from frappe.utils import getdate

from dewey_time.attendance_engine.absence_intervals import (
    absence_threshold_minutes,
    compute_missing_time_intervals,
    missing_expected_max_end_min,
)
from dewey_time.attendance_engine.lunch_detection import combine_date_time


def _interval_datetimes(attendance_date, start_min: int, end_min: int):
    start_dt = combine_date_time(
        attendance_date, time(hour=start_min // 60, minute=start_min % 60)
    )
    end_dt = combine_date_time(attendance_date, time(hour=end_min // 60, minute=end_min % 60))
    return start_dt, end_dt


def evaluate_missing_time_flags(
    *,
    checkins: list[dict],
    shift_meta: dict,
    attendance_date,
    max_end_min: int | None = None,
) -> list[tuple[str, dict]]:
    threshold = absence_threshold_minutes()
    intervals = compute_missing_time_intervals(
        checkins=checkins,
        shift_meta=shift_meta,
        attendance_date=attendance_date,
        max_end_min=max_end_min,
    )
    flags: list[tuple[str, dict]] = []
    for interval in intervals:
        if interval["minutes"] < threshold:
            continue
        start_dt, end_dt = _interval_datetimes(
            attendance_date, interval["startMin"], interval["endMin"]
        )
        flags.append(
            (
                "MISSING_TIME",
                {
                    "interval_start": start_dt.isoformat(),
                    "interval_end": end_dt.isoformat(),
                    "minutes": interval["minutes"],
                    "kind": interval.get("kind") or "away",
                    "threshold_minutes": threshold,
                },
            )
        )
    return flags


def missing_time_max_end_min_for_date(attendance_date) -> int | None:
    return missing_expected_max_end_min(attendance_date)
