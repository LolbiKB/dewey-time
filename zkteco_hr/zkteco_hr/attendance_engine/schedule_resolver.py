"""Weekly schedule grouping, Shift Type / Shift Schedule matching, SSA reconciliation."""

from __future__ import annotations

from datetime import timedelta

import frappe
from frappe.utils import add_days, getdate, get_time

WEEKDAYS: tuple[str, ...] = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)

WEEKDAY_SHORT: dict[str, str] = {
    "Monday": "MON",
    "Tuesday": "TUE",
    "Wednesday": "WED",
    "Thursday": "THU",
    "Friday": "FRI",
    "Saturday": "SAT",
    "Sunday": "SUN",
}

WEEKDAY_TO_INDEX = {day: idx for idx, day in enumerate(WEEKDAYS)}


def normalize_time(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%H:%M:%S")
    text = str(value).strip()
    if not text:
        return None
    text = text.split(".")[0]
    parts = text.split(":")
    if len(parts) == 2:
        return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:00"
    if len(parts) == 3:
        return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{parts[2].zfill(2)}"
    return text


def time_to_minutes(value) -> int | None:
    normalized = normalize_time(value)
    if not normalized:
        return None
    try:
        parsed = get_time(normalized)
    except Exception:
        return None
    return parsed.hour * 60 + parsed.minute


def time_to_hhmm(value) -> str:
    normalized = normalize_time(value)
    if not normalized:
        return "0000"
    parts = normalized.split(":")
    return f"{parts[0]}{parts[1]}"


def profile_key(profile: dict) -> tuple:
    return (
        normalize_time(profile.get("start_time")),
        normalize_time(profile.get("end_time")),
        normalize_time(profile.get("lunch_start")),
        normalize_time(profile.get("lunch_end")),
        int(profile.get("grace_minutes") or 0),
    )


def group_week_pattern(days: list[dict]) -> list[dict]:
    """Group working days with identical time profiles."""
    groups: list[dict] = []
    buckets: dict[tuple, dict] = {}

    for row in days or []:
        weekday = row.get("weekday")
        if weekday not in WEEKDAY_TO_INDEX:
            continue
        if not row.get("works"):
            continue

        profile = {
            "start_time": normalize_time(row.get("start_time")),
            "end_time": normalize_time(row.get("end_time")),
            "lunch_start": normalize_time(row.get("lunch_start")),
            "lunch_end": normalize_time(row.get("lunch_end")),
            "grace_minutes": int(row.get("grace_minutes") or 0),
        }
        if not profile["start_time"] or not profile["end_time"]:
            continue
        if time_to_minutes(profile["end_time"]) is not None and time_to_minutes(
            profile["start_time"]
        ) is not None:
            if time_to_minutes(profile["end_time"]) <= time_to_minutes(profile["start_time"]):
                continue

        key = profile_key(profile)
        if key not in buckets:
            buckets[key] = {"days": [], "profile": profile}
        buckets[key]["days"].append(weekday)

    for bucket in buckets.values():
        bucket["days"] = sorted(bucket["days"], key=lambda d: WEEKDAY_TO_INDEX[d])
        groups.append(bucket)

    groups.sort(key=lambda g: min(WEEKDAY_TO_INDEX[d] for d in g["days"]))
    return groups


def compact_days_label(days: list[str], profile: dict) -> str:
    day_set = set(days)
    weekdays = set(WEEKDAYS[:5])
    if day_set == weekdays:
        return "MON-FRI"
    if day_set == {"Saturday"}:
        start_m = time_to_minutes(profile.get("start_time"))
        end_m = time_to_minutes(profile.get("end_time"))
        if start_m is not None and end_m is not None and end_m - start_m <= 5 * 60:
            return "SAT-AM"
        return "SAT"
    if len(days) == 1:
        return WEEKDAY_SHORT[days[0]]
    ordered = sorted(days, key=lambda d: WEEKDAY_TO_INDEX[d])
    return "-".join(WEEKDAY_SHORT[d] for d in ordered)


def proposed_shift_type_name(profile: dict) -> str:
    return f"FT_{time_to_hhmm(profile.get('start_time'))}_{time_to_hhmm(profile.get('end_time'))}"


def proposed_pat_name(days: list[str], shift_type_name: str, profile: dict) -> str:
    compact = compact_days_label(days, profile)
    lunch_start = profile.get("lunch_start")
    lunch_end = profile.get("lunch_end")
    lunch_suffix = ""
    if lunch_start and lunch_end:
        lunch_suffix = f"_L{time_to_hhmm(lunch_start)}_{time_to_hhmm(lunch_end)}"
    return f"PAT_{compact}_{shift_type_name}{lunch_suffix}"


def _shift_type_row_matches(profile: dict, row: dict) -> bool:
    return (
        normalize_time(row.get("start_time")) == normalize_time(profile.get("start_time"))
        and normalize_time(row.get("end_time")) == normalize_time(profile.get("end_time"))
        and normalize_time(row.get("custom_lunch_start"))
        == normalize_time(profile.get("lunch_start"))
        and normalize_time(row.get("custom_lunch_end"))
        == normalize_time(profile.get("lunch_end"))
        and int(row.get("custom_grace_minutes") or 0)
        == int(profile.get("grace_minutes") or 0)
    )


def match_shift_type(profile: dict) -> dict:
    proposed = proposed_shift_type_name(profile)
    if not frappe.db.table_exists("Shift Type"):
        return {"action": "create", "proposed_name": proposed}

    fields = ["name", "start_time", "end_time"]
    for col in ("custom_lunch_start", "custom_lunch_end", "custom_grace_minutes"):
        if frappe.db.has_column("Shift Type", col):
            fields.append(col)

    rows = frappe.get_all("Shift Type", fields=fields, limit_page_length=500) or []
    matches = [row for row in rows if _shift_type_row_matches(profile, row)]
    if not matches:
        if frappe.db.exists("Shift Type", proposed):
            return {"action": "use", "name": proposed}
        return {"action": "create", "proposed_name": proposed}

    preferred = next((row for row in matches if row.get("name") == proposed), None)
    chosen = preferred or sorted(matches, key=lambda r: (len(r.get("name") or ""), r.get("name") or ""))[0]
    return {"action": "use", "name": chosen.get("name")}


def _repeat_days_set(doc) -> set[str]:
    rows = getattr(doc, "repeat_on_days", None) or []
    return {row.day for row in rows if getattr(row, "day", None)}


def match_shift_schedule(
    *,
    days: list[str],
    shift_type: str,
    profile: dict,
    frequency: str = "Every Week",
) -> dict:
    day_set = set(days)

    if not frappe.db.table_exists("Shift Schedule"):
        return {
            "action": "create",
            "proposed_name": proposed_pat_name(days, shift_type, profile),
        }

    names = frappe.get_all(
        "Shift Schedule",
        filters={"docstatus": 1, "shift_type": shift_type, "frequency": frequency},
        pluck="name",
    ) or []

    matches: list[str] = []
    for name in names:
        doc = frappe.get_doc("Shift Schedule", name)
        if _repeat_days_set(doc) == day_set:
            matches.append(name)

    if not matches:
        return {
            "action": "create",
            "proposed_name": proposed_pat_name(days, shift_type, profile),
        }

    chosen = sorted(matches, key=lambda n: (len(n), n))[0]
    return {"action": "use", "name": chosen, "alternatives": [n for n in matches if n != chosen]}


def build_warnings(group: dict, shift_schedule: dict) -> list[str]:
    warnings: list[str] = []
    days = group.get("days") or []
    profile = group.get("profile") or {}
    if "Saturday" in days and compact_days_label(days, profile) == "SAT":
        proposed_am = proposed_pat_name(days, shift_schedule.get("proposed_name", "FT"), profile)
        if "SAT-AM" not in proposed_am and shift_schedule.get("action") == "create":
            alt = proposed_pat_name(days, proposed_shift_type_name(profile), profile)
            warnings.append(f"Saturday PAT naming: consider {alt.replace('SAT_', 'SAT-AM_')} per SOP")
    return warnings


def build_resolve_plan(*, employee: str, week_pattern: dict) -> dict:
    frequency = week_pattern.get("frequency") or "Every Week"
    groups_out: list[dict] = []
    warnings: list[str] = []

    for group in group_week_pattern(week_pattern.get("days") or []):
        profile = group["profile"]
        shift_type = match_shift_type(profile)
        shift_type_name = shift_type.get("name") or shift_type.get("proposed_name")
        shift_schedule = match_shift_schedule(
            days=group["days"],
            shift_type=shift_type_name,
            profile=profile,
            frequency=frequency,
        )
        if shift_schedule.get("action") == "create" and shift_type.get("action") == "use":
            shift_schedule["proposed_name"] = proposed_pat_name(
                group["days"], shift_type_name, profile
            )
        group_warnings = build_warnings(group, shift_schedule)
        warnings.extend(group_warnings)
        groups_out.append(
            {
                "days": group["days"],
                "profile": profile,
                "shift_type": shift_type,
                "shift_schedule": shift_schedule,
            }
        )

    needs_create = any(
        g["shift_type"].get("action") == "create" or g["shift_schedule"].get("action") == "create"
        for g in groups_out
    )

    return {
        "employee": employee,
        "groups": groups_out,
        "warnings": warnings,
        "needs_create": needs_create,
    }


def target_pat_names(plan: dict) -> set[str]:
    names: set[str] = set()
    for group in plan.get("groups") or []:
        sched = group.get("shift_schedule") or {}
        if sched.get("action") == "use" and sched.get("name"):
            names.add(sched["name"])
        elif sched.get("action") == "create" and sched.get("proposed_name"):
            names.add(sched["proposed_name"])
    return names


def is_ssa_enabled(ssa: dict) -> bool:
    if (ssa.get("shift_status") or "").lower() == "inactive":
        return False
    enabled = ssa.get("enabled")
    if enabled in (0, False, "0"):
        return False
    return True


def employee_has_enabled_ssas(employee: str) -> bool:
    return any(is_ssa_enabled(ssa) for ssa in list_employee_ssas(employee))


def list_employee_ssas(employee: str) -> list[dict]:
    if not frappe.db.table_exists("Shift Schedule Assignment"):
        return []

    filters: dict = {"employee": employee}
    fields = ["name", "shift_schedule", "enabled"]
    if frappe.db.has_column("Shift Schedule Assignment", "shift_status"):
        fields.append("shift_status")
    start_field = None
    if frappe.db.has_column("Shift Schedule Assignment", "create_shifts_after"):
        start_field = "create_shifts_after"
        fields.append(start_field)
    elif frappe.db.has_column("Shift Schedule Assignment", "from_date"):
        start_field = "from_date"
        fields.append(start_field)

    rows = frappe.get_all("Shift Schedule Assignment", filters=filters, fields=fields) or []
    out: list[dict] = []
    for row in rows:
        pat = row.get("shift_schedule")
        repeat_days: list[str] = []
        shift_type = None
        if pat and frappe.db.exists("Shift Schedule", pat):
            doc = frappe.get_doc("Shift Schedule", pat)
            if doc.docstatus == 1:
                repeat_days = sorted(_repeat_days_set(doc), key=lambda d: WEEKDAY_TO_INDEX.get(d, 99))
                shift_type = doc.shift_type
        out.append(
            {
                "name": row.get("name"),
                "shift_schedule": pat,
                "enabled": row.get("enabled"),
                "shift_status": row.get("shift_status"),
                "create_shifts_after": str(getdate(row.get(start_field))) if start_field and row.get(start_field) else None,
                "repeat_days": repeat_days,
                "shift_type": shift_type,
            }
        )
    return out


def build_reconcile_preview(*, employee: str, plan: dict, effective_from) -> dict:
    effective_from = getdate(effective_from)
    target_pats = target_pat_names(plan)
    ssas = list_employee_ssas(employee)

    disable_ssas: list[dict] = []
    affected_assignments: list[dict] = []

    for ssa in ssas:
        pat = ssa.get("shift_schedule")
        if not pat or pat in target_pats:
            continue
        if not ssa.get("enabled") and (ssa.get("shift_status") or "").lower() == "inactive":
            continue
        disable_ssas.append(
            {
                "name": ssa.get("name"),
                "shift_schedule": pat,
                "shift_type": ssa.get("shift_type"),
            }
        )
        affected_assignments.extend(
            _future_assignments_for_shift_type(
                employee=employee,
                shift_type=ssa.get("shift_type"),
                effective_from=effective_from,
            )
        )

    return {
        "effective_from": str(effective_from),
        "disable_ssas": disable_ssas,
        "affected_assignments": affected_assignments,
    }


def _future_assignments_for_shift_type(*, employee: str, shift_type: str | None, effective_from) -> list[dict]:
    if not shift_type or not frappe.db.table_exists("Shift Assignment"):
        return []

    effective_from = getdate(effective_from)
    filters: dict = {
        "employee": employee,
        "shift_type": shift_type,
        "docstatus": 1,
    }
    if frappe.db.has_column("Shift Assignment", "status"):
        filters["status"] = "Active"

    rows = frappe.get_all(
        "Shift Assignment",
        filters=filters,
        fields=["name", "start_date", "end_date", "shift_type"],
        order_by="start_date asc",
    ) or []

    out: list[dict] = []
    for row in rows:
        start_date = getdate(row.get("start_date")) if row.get("start_date") else None
        end_date = getdate(row.get("end_date")) if row.get("end_date") else None
        if not start_date:
            continue
        if end_date and end_date < effective_from:
            continue
        action = "cancel" if start_date >= effective_from else "end_before"
        out.append(
            {
                "name": row.get("name"),
                "shift_type": row.get("shift_type"),
                "start_date": str(start_date),
                "end_date": str(end_date) if end_date else None,
                "action": action,
                "proposed_end_date": str(add_days(effective_from, -1)) if action == "end_before" else None,
            }
        )
    return out


def reconcile_orphan_ssas(*, employee: str, plan: dict, effective_from) -> dict:
    preview = build_reconcile_preview(employee=employee, plan=plan, effective_from=effective_from)
    effective_from = getdate(effective_from)

    disabled: list[str] = []
    trimmed: list[str] = []
    cancelled: list[str] = []

    for ssa_info in preview.get("disable_ssas") or []:
        ssa_name = ssa_info.get("name")
        if not ssa_name:
            continue
        doc = frappe.get_doc("Shift Schedule Assignment", ssa_name)
        if frappe.db.has_column("Shift Schedule Assignment", "enabled"):
            doc.enabled = 0
        if frappe.db.has_column("Shift Schedule Assignment", "shift_status"):
            doc.shift_status = "Inactive"
        doc.save(ignore_permissions=True)
        disabled.append(ssa_name)

    for item in preview.get("affected_assignments") or []:
        name = item.get("name")
        if not name:
            continue
        doc = frappe.get_doc("Shift Assignment", name)
        if item.get("action") == "end_before" and item.get("proposed_end_date"):
            doc.end_date = getdate(item["proposed_end_date"])
            doc.save(ignore_permissions=True)
            trimmed.append(name)
        elif item.get("action") == "cancel":
            if doc.docstatus == 1:
                doc.cancel()
            cancelled.append(name)

    return {
        "disabled_ssas": disabled,
        "trimmed_assignments": trimmed,
        "cancelled_assignments": cancelled,
    }


def week_pattern_from_ssas(employee: str) -> list[dict]:
    """Prefill 7-day grid from enabled SSAs + submitted PATs."""
    rows = [{ "weekday": day, "works": False } for day in WEEKDAYS]
    by_day = {row["weekday"]: row for row in rows}

    for ssa in list_employee_ssas(employee):
        if not is_ssa_enabled(ssa):
            continue
        pat = ssa.get("shift_schedule")
        if not pat:
            continue
        if not frappe.db.exists("Shift Schedule", pat):
            continue
        pat_doc = frappe.get_doc("Shift Schedule", pat)
        if pat_doc.docstatus != 1:
            continue
        shift_type_name = pat_doc.shift_type
        meta = frappe.get_doc("Shift Type", shift_type_name) if shift_type_name else None
        if not meta:
            continue

        profile = {
            "start_time": normalize_time(meta.start_time),
            "end_time": normalize_time(meta.end_time),
            "lunch_start": normalize_time(getattr(meta, "custom_lunch_start", None)),
            "lunch_end": normalize_time(getattr(meta, "custom_lunch_end", None)),
            "grace_minutes": int(getattr(meta, "custom_grace_minutes", None) or 0),
        }

        for day in _repeat_days_set(pat_doc):
            if day not in by_day:
                continue
            by_day[day].update(
                {
                    "works": True,
                    "start_time": profile["start_time"],
                    "end_time": profile["end_time"],
                    "lunch_start": profile["lunch_start"],
                    "lunch_end": profile["lunch_end"],
                    "grace_minutes": profile["grace_minutes"],
                }
            )

    return rows


def create_shift_type(profile: dict, *, name: str | None = None) -> str:
    proposed = name or proposed_shift_type_name(profile)
    if frappe.db.exists("Shift Type", proposed):
        return proposed

    doc = frappe.new_doc("Shift Type")
    doc.shift_type_name = proposed
    if hasattr(doc, "name"):
        doc.name = proposed
    doc.start_time = profile.get("start_time")
    doc.end_time = profile.get("end_time")
    if frappe.db.has_column("Shift Type", "custom_lunch_start"):
        doc.custom_lunch_start = profile.get("lunch_start")
    if frappe.db.has_column("Shift Type", "custom_lunch_end"):
        doc.custom_lunch_end = profile.get("lunch_end")
    if frappe.db.has_column("Shift Type", "custom_grace_minutes"):
        doc.custom_grace_minutes = profile.get("grace_minutes") or 0
    if frappe.db.has_column("Shift Type", "enable_auto_attendance"):
        doc.enable_auto_attendance = 0
    doc.insert(ignore_permissions=True)
    return doc.name


def create_shift_schedule(
    *,
    days: list[str],
    shift_type: str,
    profile: dict,
    frequency: str = "Every Week",
    name: str | None = None,
) -> str:
    existing = match_shift_schedule(days=days, shift_type=shift_type, profile=profile, frequency=frequency)
    if existing.get("action") == "use":
        return existing["name"]

    doc = frappe.new_doc("Shift Schedule")
    doc.shift_type = shift_type
    doc.frequency = frequency
    for day in days:
        doc.append("repeat_on_days", {"day": day})
    doc.insert(ignore_permissions=True)
    doc.submit()
    return doc.name


def upsert_ssa(*, employee: str, shift_schedule: str, create_shifts_after) -> str:
    create_shifts_after = getdate(create_shifts_after)
    filters = {"employee": employee, "shift_schedule": shift_schedule}
    existing = frappe.get_all("Shift Schedule Assignment", filters=filters, pluck="name") or []

    if existing:
        doc = frappe.get_doc("Shift Schedule Assignment", existing[0])
    else:
        doc = frappe.new_doc("Shift Schedule Assignment")
        doc.employee = employee
        doc.shift_schedule = shift_schedule

    if frappe.db.has_column("Shift Schedule Assignment", "enabled"):
        doc.enabled = 1
    if frappe.db.has_column("Shift Schedule Assignment", "shift_status"):
        doc.shift_status = "Active"
    start_field = None
    if frappe.db.has_column("Shift Schedule Assignment", "create_shifts_after"):
        start_field = "create_shifts_after"
    elif frappe.db.has_column("Shift Schedule Assignment", "from_date"):
        start_field = "from_date"
    if start_field:
        current = getattr(doc, start_field, None)
        if current:
            current_date = getdate(current)
            if create_shifts_after < current_date:
                setattr(doc, start_field, create_shifts_after)
        else:
            setattr(doc, start_field, create_shifts_after)

    if existing:
        doc.save(ignore_permissions=True)
    else:
        doc.insert(ignore_permissions=True)

    return doc.name


def generate_shifts_for_ssa(ssa_name: str, start_date, end_date=None) -> None:
    doc = frappe.get_doc("Shift Schedule Assignment", ssa_name)
    if hasattr(doc, "create_shifts"):
        start = getdate(start_date)
        if end_date:
            doc.create_shifts(start, getdate(end_date))


_CLEAR_SAMPLE_CAP = 10


def _list_employee_shift_assignment_names(employee: str) -> list[str]:
    if not frappe.db.table_exists("Shift Assignment"):
        return []
    return frappe.get_all("Shift Assignment", filters={"employee": employee}, pluck="name") or []


def _list_employee_ssa_names(employee: str) -> list[str]:
    if not frappe.db.table_exists("Shift Schedule Assignment"):
        return []
    return frappe.get_all("Shift Schedule Assignment", filters={"employee": employee}, pluck="name") or []


def _count_attendance_flags(employee: str) -> int:
    if not frappe.db.table_exists("Attendance Flag"):
        return 0
    return frappe.db.count("Attendance Flag", {"employee": employee})


def _sample_names(names: list[str], cap: int = _CLEAR_SAMPLE_CAP) -> list[str]:
    return list(names[:cap])


def preview_clear_employee_schedule(employee: str) -> dict:
    """Dev: counts of SSA, SA, and Attendance Flag rows for an employee."""
    assignment_names = _list_employee_shift_assignment_names(employee)
    ssa_names = _list_employee_ssa_names(employee)
    flag_count = _count_attendance_flags(employee)

    return {
        "employee": employee,
        "shift_assignment_count": len(assignment_names),
        "ssa_count": len(ssa_names),
        "attendance_flag_count": flag_count,
        "sample_shift_assignments": _sample_names(assignment_names),
        "sample_ssas": _sample_names(ssa_names),
    }


def _disable_ssa(ssa_name: str) -> None:
    doc = frappe.get_doc("Shift Schedule Assignment", ssa_name)
    if frappe.db.has_column("Shift Schedule Assignment", "enabled"):
        doc.enabled = 0
    if frappe.db.has_column("Shift Schedule Assignment", "shift_status"):
        doc.shift_status = "Inactive"
    doc.save(ignore_permissions=True)


def _delete_shift_assignment(name: str) -> tuple[str | None, str]:
    """Returns (cancelled_name or None, deleted_name)."""
    doc = frappe.get_doc("Shift Assignment", name)
    cancelled = None
    if doc.docstatus == 1:
        doc.cancel()
        cancelled = name
    frappe.delete_doc("Shift Assignment", name, force=1)
    return cancelled, name


def _delete_ssa(ssa_name: str) -> tuple[str | None, str | None]:
    """Returns (deleted_name, disabled_name) — at most one set."""
    try:
        frappe.delete_doc("Shift Schedule Assignment", ssa_name, force=1)
        return ssa_name, None
    except frappe.LinkExistsError:
        _disable_ssa(ssa_name)
        return None, ssa_name
    except Exception as exc:
        message = str(exc).lower()
        if "link" in message or "linked" in message:
            _disable_ssa(ssa_name)
            return None, ssa_name
        raise


def clear_employee_schedule(employee: str) -> dict:
    """
    Dev: remove all Shift Assignments, Shift Schedule Assignments, and Attendance Flags
    for one employee. Does not delete Shift Type / Shift Schedule masters.
    """
    cancelled_assignments: list[str] = []
    deleted_assignments: list[str] = []
    deleted_ssas: list[str] = []
    disabled_ssas: list[str] = []

    for name in _list_employee_shift_assignment_names(employee):
        cancelled, deleted = _delete_shift_assignment(name)
        if cancelled:
            cancelled_assignments.append(cancelled)
        deleted_assignments.append(deleted)

    for ssa_name in _list_employee_ssa_names(employee):
        deleted, disabled = _delete_ssa(ssa_name)
        if deleted:
            deleted_ssas.append(deleted)
        if disabled:
            disabled_ssas.append(disabled)

    deleted_flags = 0
    if frappe.db.table_exists("Attendance Flag"):
        deleted_flags = _count_attendance_flags(employee)
        if deleted_flags:
            frappe.db.delete("Attendance Flag", {"employee": employee})

    return {
        "ok": True,
        "employee": employee,
        "cancelled_assignments": cancelled_assignments,
        "deleted_assignments": deleted_assignments,
        "deleted_ssas": deleted_ssas,
        "disabled_ssas": disabled_ssas,
        "deleted_flags": deleted_flags,
    }
