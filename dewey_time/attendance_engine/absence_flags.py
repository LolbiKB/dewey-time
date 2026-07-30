from __future__ import annotations

from datetime import time, timedelta

from frappe.utils import getdate

from dewey_time.attendance_engine.absence_intervals import (
    absence_threshold_minutes,
    compute_missing_time_intervals,
    missing_expected_max_end_min,
)
from dewey_time.attendance_engine.lunch_detection import combine_date_time


def _interval_datetimes(attendance_date, start_min: int, end_min: int):
    """Turn minutes-since-midnight into datetimes, allowing values past 1440.

    Overnight shifts are expressed by adding 1440 to the end minute
    (`absence_intervals._missing_expected_intervals`), so an interval can
    legitimately run to minute 1800 — 06:00 the following day. Building a
    `datetime.time(hour=1800 // 60)` raises `ValueError: hour must be in 0..23`,
    which aborted the whole closeout batch for every employee sorted after the
    night worker while the device still reported healthy.

    Anchoring on midnight and adding a timedelta carries the rollover into the
    next day. Note `combine_date_time` cannot be used with a timedelta here: it
    modulos by 24h, which would silently wrap minute 1800 back to 06:00 on the
    *same* day and mis-date the flag rather than crashing.
    """
    midnight = combine_date_time(attendance_date, time(0, 0))
    return midnight + timedelta(minutes=start_min), midnight + timedelta(minutes=end_min)


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
