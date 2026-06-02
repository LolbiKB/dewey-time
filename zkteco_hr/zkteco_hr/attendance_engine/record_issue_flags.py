from __future__ import annotations

from zkteco_hr.attendance_engine.attendance_segments import derive_unpaired_punches
from zkteco_hr.attendance_engine.lunch_flags import evaluate_lunch_flags


def evaluate_record_issue_flags(
    *,
    checkins: list[dict],
    shift_meta: dict | None,
    attendance_date,
    grace_minutes: int = 0,
    undelivered_items: list[dict] | None = None,
) -> list[tuple[str, dict]]:
    """Returns ATTENDANCE_ISSUE rows (on-shift only — caller must gate off-shift)."""
    flags: list[tuple[str, dict]] = []
    checkins_count = len(checkins or [])

    if checkins_count == 1:
        punch = checkins[0]
        flags.append(
            (
                "ATTENDANCE_ISSUE",
                {
                    "reason": "single_checkin",
                    "checkins_count": 1,
                    "punch_time": _iso(punch.get("time")),
                },
            )
        )

    unpaired = derive_unpaired_punches(checkins, attendance_date)
    for punch in unpaired:
        if checkins_count == 1 and punch is checkins[0]:
            continue
        flags.append(
            (
                "ATTENDANCE_ISSUE",
                {
                    "reason": "unpaired_punch",
                    "punch_time": _iso(punch.get("time")),
                    "custom_device_branch": punch.get("custom_device_branch"),
                },
            )
        )

    unknown_hits = sum(1 for c in checkins if not (c.get("custom_device_branch") or "").strip())
    if unknown_hits:
        flags.append(
            (
                "ATTENDANCE_ISSUE",
                {
                    "reason": "unknown_device_branch",
                    "unknown_branch_checkins": unknown_hits,
                },
            )
        )

    if shift_meta and checkins_count >= 2:
        lunch_flags = evaluate_lunch_flags(
            checkins=checkins,
            shift_meta=shift_meta,
            attendance_date=attendance_date,
            grace_minutes=grace_minutes,
        )
        for code, evidence in lunch_flags:
            if code == "MISSING_LUNCH":
                flags.append(
                    (
                        "ATTENDANCE_ISSUE",
                        {
                            "reason": "missing_lunch_pair",
                            **evidence,
                        },
                    )
                )

    for item in undelivered_items or []:
        flags.append(
            (
                "ATTENDANCE_ISSUE",
                {
                    "reason": "delivery_failed",
                    "undelivered": item,
                },
            )
        )

    return flags


def _iso(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)
