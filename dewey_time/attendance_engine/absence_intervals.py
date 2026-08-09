from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import getdate, now_datetime

from dewey_time.attendance_engine.attendance_segments import (
    derive_segments,
    minutes_from_checkin_time,
)
from dewey_time.attendance_engine.lunch_detection import detect_observed_lunch
from dewey_time.attendance_engine.shift_grace import (
    effective_lunch_return_grace,
    effective_start_grace,
)
from dewey_time.attendance_engine.shift_times import shift_time_to_minutes


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
    return shift_time_to_minutes(value)


def present_hour_start_min(now: datetime | None = None) -> int:
    now = now or now_datetime()
    return now.hour * 60 + now.minute


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
    if start_min is None or end_min is None:
        return []
    if end_min <= start_min:  # overnight shift: end is next day
        end_min += 1440
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


def _bridge_scheduled_lunch(
    intervals: list[dict], *, lunch_start: int | None, lunch_end: int | None
) -> list[dict]:
    """Join two missing intervals that abut the scheduled lunch exactly.

    `derive_missing_expected_intervals` carves the scheduled lunch out of the
    expected window unconditionally. That is right for someone who took a
    lunch and wrong for someone who was not there to take one: a day with a
    stray punch and nothing else came out as 08:05-12:00 and 13:00-17:00 --
    two findings for one absence, and the shape that made a no-show
    unreadable in the queue.

    Exact abutment on BOTH sides is the whole test. It can only happen when
    the employee was absent across the entire lunch window, so a gap that
    merely straddles midday is left as the two separate findings it is.

    `minutes` is the SUM of the parts, never the span: the unpaid hour is
    still not owed. A bridged row therefore has
    `minutes != endMin - startMin`, deliberately, and the copy that renders
    it has to say so.
    """
    if lunch_start is None or lunch_end is None or lunch_end <= lunch_start:
        return intervals

    out: list[dict] = []
    for interval in intervals:
        previous = out[-1] if out else None
        if (
            previous is not None
            and previous["endMin"] == lunch_start
            and interval["startMin"] == lunch_end
        ):
            previous["endMin"] = interval["endMin"]
            previous["minutes"] = previous["minutes"] + interval["minutes"]
            continue
        out.append(dict(interval))
    return out


def derive_presence_intervals(
    checkins: list[dict], attendance_date, *, session_end_min: int | None
) -> list[dict]:
    """Intervals during which the employee was demonstrably present.

    Deliberately NOT derive_segments. That function pairs punches only within a
    same-branch run and drops anything else on the floor, which is right for
    branch-attribution flags and catastrophically wrong for absence: a day
    worked 09:00-17:00 with the OUT punch recorded at another site produced
    zero segments, so closeout billed the entire shift as MISSING_TIME on top
    of the NON_PRIMARY_SITE_PUNCH it already raised. Same for a blank
    custom_device_branch, and same for a forgotten evening punch.

    Presence is branch-agnostic on purpose. Where the punches went is a
    separate question with its own flags (NON_PRIMARY_SITE_PUNCH,
    ATTENDANCE_ISSUE/unknown_device_branch); charging the anomaly twice — once
    as a branch flag and again as hours of absence — is what made HR distrust
    the numbers.

    A trailing unpaired punch opens a session running to `session_end_min`:
    the current time intraday, the shift end at closeout. Without it, every
    employee currently at work was flagged as missing the whole elapsed shift
    at each 30-minute tick.
    """
    ordered = sorted(checkins, key=lambda row: row.get("time") or "")
    mins = [
        m
        for m in (minutes_from_checkin_time(c.get("time"), attendance_date) for c in ordered)
        if m is not None
    ]

    intervals: list[dict] = []
    for i in range(0, len(mins) - 1, 2):
        start, end = mins[i], mins[i + 1]
        if end > start:
            intervals.append({"start_min": start, "end_min": end})

    if len(mins) % 2 == 1 and session_end_min is not None:
        start = mins[-1]
        if session_end_min > start:
            intervals.append({"start_min": start, "end_min": session_end_min})

    return intervals


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
            out_delta = (out_dt.date() - attendance_date).days
            in_delta = (in_dt.date() - attendance_date).days
            observed_lunch_range = {
                "startMin": max(0, out_delta) * 1440 + out_dt.hour * 60 + out_dt.minute,
                "endMin": max(0, in_delta) * 1440 + in_dt.hour * 60 + in_dt.minute,
            }

    away_intervals = derive_away_gap_intervals(
        segments=segments,
        shift_meta=shift_meta,
        observed_lunch_range=observed_lunch_range,
    )
    away_for_exclude = [{"startMin": a["startMin"], "endMin": a["endMin"]} for a in away_intervals]

    # Absence is measured against PRESENCE, not against branch-attributed
    # segments: a cross-branch, branch-blank or unclosed pair yields no segment
    # and would otherwise bill the whole shift as missing. Away-gap detection
    # above deliberately keeps using real segments — a gap between two
    # same-branch stints is a different question from "were they here at all".
    shift_end_min = _parse_shift_time_to_minutes(shift_meta.get("end_time"))
    shift_start_min = _parse_shift_time_to_minutes(shift_meta.get("start_time"))
    if shift_end_min is not None and shift_start_min is not None and shift_end_min <= shift_start_min:
        shift_end_min += 1440
    missing_expected = derive_missing_expected_intervals(
        shift_meta=shift_meta,
        segments=derive_presence_intervals(
            checkins,
            attendance_date,
            session_end_min=max_end_min if max_end_min is not None else shift_end_min,
        ),
        exclude_intervals=away_for_exclude,
        max_end_min=max_end_min,
    )

    combined = _merge_intervals(missing_expected + away_intervals)
    # After merging, not before: _merge_intervals sorts, and bridging compares
    # each interval against the one before it.
    combined = _bridge_scheduled_lunch(
        combined,
        lunch_start=_parse_shift_time_to_minutes(shift_meta.get("custom_lunch_start")),
        lunch_end=_parse_shift_time_to_minutes(shift_meta.get("custom_lunch_end")),
    )
    for interval in combined:
        interval["kind"] = _classify_interval_kind(interval, segments)
    return combined
