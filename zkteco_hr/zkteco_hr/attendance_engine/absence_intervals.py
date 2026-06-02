from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import getdate, now_datetime

from zkteco_hr.attendance_engine.attendance_segments import derive_segments
from zkteco_hr.attendance_engine.lunch_detection import detect_observed_lunch
from zkteco_hr.attendance_engine.shift_grace import (
    effective_lunch_return_grace,
    effective_start_grace,
)


def absence_threshold_minutes() -> int:
    return int(frappe.conf.get("absence_threshold_minutes") or 30)


def _subtract_ranges(
    parts: list[dict], exclude_start: int, exclude_end: int
) -> list[dict]:
    out: list[dict] = []
    for part in parts:
        if part["endMin"] <= exclude_start or part["startMin"] >= exclude_end:
            out.append(part)
            continue
        if part["startMin"] < exclude_start:
            out.append({"startMin": part["startMin"], "endMin": exclude_start})
        if exclude_end < part["endMin"]:
            out.append({"startMin": exclude_end, "endMin": part["endMin"]})
    return [p for p in out if p["endMin"] > p["startMin"]]


def _parse_shift_time_to_minutes(value) -> int | None:
    if value is None:
        return None
    if hasattr(value, "hour"):
        return value.hour * 60 + value.minute
    text = str(value).strip()
    parts = text.split(":")
    if len(parts) < 2:
        return None
    try:
        hh = int(parts[0])
        mm = int(parts[1])
    except ValueError:
        return None
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        return None
    return hh * 60 + mm


def present_hour_start_min(now: datetime | None = None) -> int:
    now = now or now_datetime()
    return now.hour * 60


def missing_expected_max_end_min(attendance_date, now: datetime | None = None) -> int | None:
    attendance_date = getdate(attendance_date)
    now = now or now_datetime()
    today = getdate(now.date())
    if attendance_date > today:
        return 0
    if attendance_date < today:
        return None
    return present_hour_start_min(now)


def derive_missing_expected_intervals(
    *,
    shift_meta: dict,
    segments: list[dict],
    exclude_intervals: list[dict] | None = None,
    max_end_min: int | None = None,
) -> list[dict]:
    start_min = _parse_shift_time_to_minutes(shift_meta.get("start_time"))
    end_min = _parse_shift_time_to_minutes(shift_meta.get("end_time"))
    if start_min is None or end_min is None or end_min <= start_min:
        return []
    if max_end_min is not None and max_end_min <= 0:
        return []

    expected_parts = [{"startMin": start_min, "endMin": end_min}]
    lunch_start = _parse_shift_time_to_minutes(shift_meta.get("custom_lunch_start"))
    lunch_end = _parse_shift_time_to_minutes(shift_meta.get("custom_lunch_end"))
    if lunch_start is not None and lunch_end is not None and lunch_end > lunch_start:
        expected_parts = _subtract_ranges(expected_parts, lunch_start, lunch_end)

    covered = [
        {"startMin": s["start_min"], "endMin": s["end_min"]}
        for s in segments
        if s.get("start_min") is not None and s.get("end_min") is not None
    ]
    missing_parts = expected_parts
    for cover in covered:
        missing_parts = _subtract_ranges(missing_parts, cover["startMin"], cover["endMin"])

    for exclude in exclude_intervals or []:
        missing_parts = _subtract_ranges(
            missing_parts, exclude["startMin"], exclude["endMin"]
        )

    results: list[dict] = []
    for part in missing_parts:
        capped_end = min(part["endMin"], max_end_min) if max_end_min is not None else part["endMin"]
        if capped_end <= part["startMin"]:
            continue
        minutes = capped_end - part["startMin"]
        if minutes <= 0:
            continue
        results.append(
            {
                "startMin": part["startMin"],
                "endMin": capped_end,
                "minutes": minutes,
                "kind": "missing_expected",
            }
        )
    return results


def derive_away_gap_intervals(
    *,
    segments: list[dict],
    shift_meta: dict,
    observed_lunch_range: dict | None,
) -> list[dict]:
    grace = effective_start_grace(shift_meta)
    lunch_start = _parse_shift_time_to_minutes(shift_meta.get("custom_lunch_start"))
    lunch_end = _parse_shift_time_to_minutes(shift_meta.get("custom_lunch_end"))
    shift_start = _parse_shift_time_to_minutes(shift_meta.get("start_time"))

    scheduled_lunch_range = None
    if lunch_start is not None and lunch_end is not None and lunch_end > lunch_start:
        scheduled_lunch_range = {
            "startMin": lunch_start,
            "endMin": lunch_end + max(0, grace),
        }

    start_grace_interval = None
    if shift_start is not None:
        start_grace_interval = {
            "startMin": shift_start,
            "endMin": shift_start + max(0, grace),
        }

    sorted_segments = sorted(
        [s for s in segments if s.get("start_min") is not None and s.get("end_min") is not None],
        key=lambda s: s["start_min"],
    )

    results: list[dict] = []
    for i in range(len(sorted_segments) - 1):
        current = sorted_segments[i]
        nxt = sorted_segments[i + 1]
        end_min = current["end_min"]
        start_min = nxt["start_min"]
        if start_min <= end_min:
            continue

        parts = [{"startMin": end_min, "endMin": start_min}]
        if observed_lunch_range:
            parts = _subtract_ranges(parts, observed_lunch_range["startMin"], observed_lunch_range["endMin"])
        if start_grace_interval:
            trimmed: list[dict] = []
            for part in parts:
                trimmed.extend(
                    _subtract_ranges(
                        [part],
                        start_grace_interval["startMin"],
                        start_grace_interval["endMin"],
                    )
                )
            parts = trimmed

        for part in parts:
            if scheduled_lunch_range:
                subparts = _subtract_ranges(
                    [part],
                    scheduled_lunch_range["startMin"],
                    scheduled_lunch_range["endMin"],
                )
            else:
                subparts = [part]
            for away_part in subparts:
                minutes = away_part["endMin"] - away_part["startMin"]
                if minutes <= 0:
                    continue
                results.append(
                    {
                        "startMin": away_part["startMin"],
                        "endMin": away_part["endMin"],
                        "minutes": minutes,
                        "kind": "away",
                    }
                )
    return results


def _classify_interval_kind(interval: dict, segments: list[dict]) -> str:
    if interval.get("kind") == "away":
        return "away"
    sorted_segments = sorted(
        [s for s in segments if s.get("start_min") is not None],
        key=lambda s: s["start_min"],
    )
    if not sorted_segments:
        return "leading"
    first_start = sorted_segments[0]["start_min"]
    last_end = max(s["end_min"] for s in segments if s.get("end_min") is not None)
    if interval["endMin"] <= first_start:
        return "leading"
    if interval["startMin"] >= last_end:
        return "trailing"
    return "leading"


def _merge_intervals(intervals: list[dict]) -> list[dict]:
    if not intervals:
        return []
    sorted_intervals = sorted(intervals, key=lambda row: (row["startMin"], row["endMin"]))
    merged: list[dict] = [dict(sorted_intervals[0])]
    for current in sorted_intervals[1:]:
        last = merged[-1]
        if current["startMin"] <= last["endMin"]:
            last["endMin"] = max(last["endMin"], current["endMin"])
            last["minutes"] = last["endMin"] - last["startMin"]
            if last.get("kind") != current.get("kind"):
                last["kind"] = current.get("kind") or last.get("kind")
        else:
            merged.append(dict(current))
    return merged


def compute_missing_time_intervals(
    *,
    checkins: list[dict],
    shift_meta: dict,
    attendance_date,
    max_end_min: int | None = None,
) -> list[dict]:
    attendance_date = getdate(attendance_date)
    segments = derive_segments(checkins, attendance_date)
    observed = detect_observed_lunch(
        checkins=checkins,
        shift_meta=shift_meta,
        attendance_date=attendance_date,
        grace_minutes=effective_lunch_return_grace(shift_meta),
    )
    observed_lunch_range = None
    if observed:
        lunch_out = observed.get("lunch_out")
        lunch_in = observed.get("lunch_in")
        if lunch_out and lunch_in:
            from frappe.utils import get_datetime

            out_dt = get_datetime(lunch_out)
            in_dt = get_datetime(lunch_in)
            observed_lunch_range = {
                "startMin": out_dt.hour * 60 + out_dt.minute,
                "endMin": in_dt.hour * 60 + in_dt.minute,
            }

    away_intervals = derive_away_gap_intervals(
        segments=segments,
        shift_meta=shift_meta,
        observed_lunch_range=observed_lunch_range,
    )
    away_for_exclude = [{"startMin": a["startMin"], "endMin": a["endMin"]} for a in away_intervals]

    missing_expected = derive_missing_expected_intervals(
        shift_meta=shift_meta,
        segments=segments,
        exclude_intervals=away_for_exclude,
        max_end_min=max_end_min,
    )

    combined = _merge_intervals(missing_expected + away_intervals)
    for interval in combined:
        interval["kind"] = _classify_interval_kind(interval, segments)
    return combined
