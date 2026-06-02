from __future__ import annotations

from datetime import datetime

from frappe.utils import getdate


def punch_branch(checkin: dict) -> str | None:
    branch = (checkin.get("custom_device_branch") or "").strip()
    return branch or None


def has_punch_branch(checkin: dict) -> bool:
    return punch_branch(checkin) is not None


def group_checkins_by_branch_runs(sorted_checkins: list[dict]) -> list[list[dict]]:
    runs: list[list[dict]] = []
    for checkin in sorted_checkins:
        if not has_punch_branch(checkin):
            runs.append([checkin])
            continue
        branch = punch_branch(checkin)
        current = runs[-1] if runs else None
        if not current:
            runs.append([checkin])
            continue
        current_branch = punch_branch(current[0])
        if current_branch and current_branch == branch:
            current.append(checkin)
        else:
            runs.append([checkin])
    return runs


def minutes_from_checkin_time(value, attendance_date) -> int | None:
    attendance_date = getdate(attendance_date)
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        from frappe.utils import get_datetime

        dt = get_datetime(value)
    if dt.date() != attendance_date:
        return None
    return dt.hour * 60 + dt.minute


def derive_segments(checkins: list[dict], attendance_date) -> list[dict]:
    """IN/OUT pairs within same branch run (mirrors frontend attendancePunches.ts)."""
    sorted_checkins = sorted(checkins, key=lambda row: row.get("time") or "")
    segments: list[dict] = []

    for run in group_checkins_by_branch_runs(sorted_checkins):
        if not run or not has_punch_branch(run[0]):
            continue
        for i in range(0, len(run) - 1, 2):
            start = run[i]
            end = run[i + 1]
            start_branch = punch_branch(start)
            end_branch = punch_branch(end)
            if not start_branch or start_branch != end_branch:
                continue
            start_min = minutes_from_checkin_time(start.get("time"), attendance_date)
            end_min = minutes_from_checkin_time(end.get("time"), attendance_date)
            segments.append(
                {
                    "start": start,
                    "end": end,
                    "start_min": start_min,
                    "end_min": end_min,
                    "branch": start_branch,
                }
            )
    return segments


def derive_unpaired_punches(checkins: list[dict], attendance_date) -> list[dict]:
    sorted_checkins = sorted(checkins, key=lambda row: row.get("time") or "")
    unpaired: list[dict] = []
    for run in group_checkins_by_branch_runs(sorted_checkins):
        if not run:
            continue
        if not has_punch_branch(run[0]):
            unpaired.extend(run)
            continue
        if len(run) % 2 == 1:
            unpaired.append(run[-1])
    return unpaired
