from __future__ import annotations

import json

import frappe
from frappe.utils import add_days, getdate, nowdate

def _default_effective_from() -> str:
    """July 1st of the current year when today is before it; otherwise tomorrow."""
    today = getdate(nowdate())
    july_first = today.replace(month=7, day=1)
    if today < july_first:
        return str(july_first)
    return str(add_days(today, 1))

from zkteco_hr.attendance_engine.hr_calendar import (
    _require_hr_role,
    shift_assignment_bounds_by_employee,
)
from zkteco_hr.attendance_engine.schedule_resolver import (
    build_resolve_plan,
    create_shift_schedule,
    create_shift_type,
    employee_has_enabled_ssas,
    is_weekly_schedule_eligible,
    validate_week_pattern,
    DEFAULT_SHIFT_GENERATION_DAYS,
    generate_shifts_for_ssa,
    group_week_pattern,
    is_ssa_enabled,
    shift_generation_end_date,
    list_employee_ssas,
    upsert_ssa,
    week_pattern_from_ssas,
)


def _parse_json(value, default=None):
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return default
        return json.loads(text)
    return default


def _parse_week_pattern(week_pattern) -> dict:
    data = _parse_json(week_pattern, {})
    if not isinstance(data, dict):
        frappe.throw("week_pattern must be an object")
    days = data.get("days") or []
    if not isinstance(days, list):
        frappe.throw("week_pattern.days must be an array")
    return {
        "frequency": data.get("frequency") or "Every Week",
        "days": days,
    }


def _employee_header(employee: str) -> dict:
    if not frappe.db.exists("Employee", employee):
        frappe.throw(f"Employee {employee} not found")

    fields = ["employee_name", "company", "branch", "status"]
    if frappe.db.has_column("Employee", "employment_type"):
        fields.append("employment_type")
    row = frappe.db.get_value("Employee", employee, fields, as_dict=True) or {}
    if (row.get("status") or "").lower() in ("inactive", "left"):
        frappe.throw(f"Employee {employee} is inactive")

    return {
        "employee": employee,
        "employee_name": row.get("employee_name") or employee,
        "company": row.get("company"),
        "branch": row.get("branch"),
        "employment_type": row.get("employment_type"),
    }


def _normalize_time_hhmm(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    parts = text.split(":")
    if len(parts) >= 2:
        return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}"
    return text


def _template_key_from_blocks(blocks: list[dict]) -> str:
    # Stable key: ordered blocks, ordered days.
    compact: list[dict] = []
    for block in blocks:
        profile = block.get("profile") or {}
        compact.append(
            {
                "days": block.get("days") or [],
                "start": _normalize_time_hhmm(profile.get("start_time")),
                "end": _normalize_time_hhmm(profile.get("end_time")),
                "lunch_start": _normalize_time_hhmm(profile.get("lunch_start")),
                "lunch_end": _normalize_time_hhmm(profile.get("lunch_end")),
                "grace": int(profile.get("grace_minutes") or 0),
            }
        )
    return json.dumps(compact, sort_keys=True, separators=(",", ":"))


def _template_label_from_blocks(blocks: list[dict]) -> str:
    # Human label, not guaranteed unique.
    parts: list[str] = []
    for block in blocks:
        days = block.get("days") or []
        profile = block.get("profile") or {}
        start = _normalize_time_hhmm(profile.get("start_time")) or "—"
        end = _normalize_time_hhmm(profile.get("end_time")) or "—"
        lunch_start = _normalize_time_hhmm(profile.get("lunch_start"))
        lunch_end = _normalize_time_hhmm(profile.get("lunch_end"))
        lunch = f" (lunch {lunch_start}–{lunch_end})" if lunch_start and lunch_end else ""
        parts.append(f"{', '.join([d[:3] for d in days])}: {start}–{end}{lunch}")
    if not parts:
        return "Empty schedule"
    if len(parts) == 1:
        return parts[0]
    return " · ".join(parts)


def _blocks_from_week_pattern(employee: str) -> list[dict]:
    week_pattern = {"frequency": "Every Week", "days": week_pattern_from_ssas(employee)}
    blocks: list[dict] = []
    for index, group in enumerate(group_week_pattern(week_pattern.get("days") or [])):
        profile = group.get("profile") or {}
        blocks.append(
            {
                "id": f"tpl-{index}",
                "days": group.get("days") or [],
                "profile": {
                    "start_time": _normalize_time_hhmm(profile.get("start_time")) or "",
                    "end_time": _normalize_time_hhmm(profile.get("end_time")) or "",
                    "lunch_start": _normalize_time_hhmm(profile.get("lunch_start")),
                    "lunch_end": _normalize_time_hhmm(profile.get("lunch_end")),
                    "grace_minutes": int(profile.get("grace_minutes") or 0),
                },
            }
        )
    return blocks


@frappe.whitelist()
def list_weekly_schedule_templates(limit=10):
    """
    Dynamic templates derived from employees' enabled SSAs, ranked by frequency.

    Returns: [{ key, label, blocks, count }]
    """
    _require_hr_role()
    try:
        limit_n = int(limit or 10)
    except Exception:
        limit_n = 10
    limit_n = max(1, min(limit_n, 50))

    cache_key = f"weekly_schedule_templates:v1:limit={limit_n}"
    cached = frappe.cache().get_value(cache_key)
    if cached:
        return cached

    if not frappe.db.table_exists("Shift Schedule Assignment"):
        return {"templates": []}

    # Derive employee set from enabled SSAs (and not ended if end_date exists).
    filters: dict = {}
    if frappe.db.has_column("Shift Schedule Assignment", "enabled"):
        filters["enabled"] = 1
    fields = ["employee"]
    has_end_date = frappe.db.has_column("Shift Schedule Assignment", "end_date")
    if has_end_date:
        fields.append("end_date")

    rows = frappe.get_all(
        "Shift Schedule Assignment",
        filters=filters,
        fields=fields,
        limit_page_length=2000,
    ) or []

    today = getdate(nowdate())
    employees: set[str] = set()
    for row in rows:
        emp = row.get("employee")
        if not emp:
            continue
        if has_end_date:
            end_date = row.get("end_date")
            if end_date and getdate(end_date) < today:
                continue
        employees.add(emp)
    employees = sorted(employees)

    counts: dict[str, dict] = {}
    for emp in employees:
        try:
            blocks = _blocks_from_week_pattern(emp)
        except Exception:
            continue
        if not blocks:
            continue
        key = _template_key_from_blocks(blocks)
        item = counts.get(key)
        if not item:
            counts[key] = {
                "key": key,
                "label": _template_label_from_blocks(blocks),
                "blocks": blocks,
                "count": 1,
            }
        else:
            item["count"] += 1

    templates = sorted(counts.values(), key=lambda t: (-int(t.get("count") or 0), t.get("label") or ""))
    payload = {"templates": templates[:limit_n]}
    frappe.cache().set_value(cache_key, payload, expires_in_sec=300)
    return payload

@frappe.whitelist()
def get_employee_schedule_context(employee: str):
    _require_hr_role()
    if not employee:
        employee = frappe.form_dict.get("employee")
    if not employee:
        frappe.throw("employee is required")

    header = _employee_header(employee)
    ssas = list_employee_ssas(employee)
    enabled_ssas = [ssa for ssa in ssas if is_ssa_enabled(ssa)]
    bounds = shift_assignment_bounds_by_employee([employee]).get(employee, {})

    assignment_summary = {
        "earliest_start_date": bounds.get("schedule_min_date"),
        "latest_end_date": bounds.get("schedule_max_date"),
    }

    return {
        **header,
        "ssas": ssas,
        "enabled_ssa_count": len(enabled_ssas),
        "can_apply": len(enabled_ssas) == 0,
        "assignment_summary": assignment_summary,
        "week_pattern": {
            "frequency": "Every Week",
            "days": week_pattern_from_ssas(employee),
        },
        "default_effective_from": _default_effective_from(),
        "default_generate_through": str(
            add_days(getdate(_default_effective_from()), DEFAULT_SHIFT_GENERATION_DAYS)
        ),
    }


@frappe.whitelist()
def resolve_weekly_schedule_plan(employee: str, week_pattern=None, effective_from=None):
    _require_hr_role()
    if not employee:
        employee = frappe.form_dict.get("employee")
    if not employee:
        frappe.throw("employee is required")

    pattern = _parse_week_pattern(week_pattern or frappe.form_dict.get("week_pattern"))
    _employee_header(employee)
    return build_resolve_plan(employee=employee, week_pattern=pattern)


@frappe.whitelist()
def get_holiday_preview(employee: str, start_date: str, end_date: str):
    _require_hr_role()
    header = _employee_header(employee)
    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be on or after start_date")

    holidays: list[dict] = []
    company = header.get("company")
    if company and frappe.db.table_exists("Holiday List"):
        holiday_list = frappe.db.get_value("Company", company, "default_holiday_list")
        if holiday_list and frappe.db.exists("Holiday List", holiday_list):
            rows = frappe.get_all(
                "Holiday",
                filters={"parent": holiday_list, "holiday_date": ["between", [start, end]]},
                fields=["holiday_date", "description", "weekly_off"],
                order_by="holiday_date asc",
            ) or []
            for row in rows:
                holidays.append(
                    {
                        "date": str(getdate(row.get("holiday_date"))),
                        "description": row.get("description") or "Holiday",
                        "weekly_off": bool(row.get("weekly_off")),
                    }
                )

    return {"holidays": holidays}


@frappe.whitelist()
def apply_weekly_schedule(
    employee: str,
    week_pattern=None,
    create_shifts_after=None,
    generate_through=None,
    confirm_create=None,
):
    _require_hr_role()
    if not employee:
        employee = frappe.form_dict.get("employee")
    if not employee:
        frappe.throw("employee is required")

    pattern = _parse_week_pattern(week_pattern or frappe.form_dict.get("week_pattern"))
    employee_info = _employee_header(employee)

    employment_type = employee_info.get("employment_type")
    if frappe.db.has_column("Employee", "employment_type") and not is_weekly_schedule_eligible(
        employment_type
    ):
        if not (employment_type or "").strip():
            frappe.throw(
                "This employee has no employment type set. "
                "Weekly Schedule supports Full-time, Part-time Fixed, Probation, and Intern only.",
                exc=frappe.ValidationError,
            )
        frappe.throw(
            f"This employee ({employment_type}) is not eligible for Weekly Schedule. "
            "Choose Full-time, Part-time Fixed, Probation, or Intern.",
            exc=frappe.ValidationError,
        )

    pattern_issues = validate_week_pattern(pattern)
    if pattern_issues:
        first = pattern_issues[0]
        frappe.throw(
            f"{first.get('weekday')}: {first.get('message')}",
            exc=frappe.ValidationError,
        )

    if employee_has_enabled_ssas(employee):
        frappe.throw(
            "This employee already has an active Shift Schedule Assignment. "
            "Disable existing SSAs and adjust Shift Assignments in Desk, then return here "
            "only when setting up a fresh schedule.",
            exc=frappe.ValidationError,
        )

    effective = getdate(
        create_shifts_after or frappe.form_dict.get("create_shifts_after") or add_days(nowdate(), 1)
    )
    through_raw = (
        generate_through
        if generate_through is not None
        else frappe.form_dict.get("generate_through")
    )
    through = through_raw if through_raw is not None and str(through_raw).strip() else None
    generation_end = shift_generation_end_date(effective, through)

    confirm = confirm_create
    if isinstance(confirm, str):
        confirm = confirm.strip().lower() in ("1", "true", "yes")
    confirm = bool(confirm)

    plan = build_resolve_plan(employee=employee, week_pattern=pattern)
    if plan.get("needs_create") and not confirm:
        return {"needs_confirm": True, "plan": plan}

    created_shift_types: list[str] = []
    created_shift_schedules: list[str] = []
    ssas_out: list[dict] = []

    try:
        for group in plan.get("groups") or []:
            profile = group.get("profile") or {}
            shift_type_info = group.get("shift_type") or {}
            shift_schedule_info = group.get("shift_schedule") or {}

            shift_type_name = shift_type_info.get("name")
            if shift_type_info.get("action") == "create":
                shift_type_name = create_shift_type(profile, name=shift_type_info.get("proposed_name"))
                created_shift_types.append(shift_type_name)
            elif not shift_type_name:
                frappe.throw("Shift Type match failed for a group")

            pat_name = shift_schedule_info.get("name")
            if shift_schedule_info.get("action") == "create":
                pat_name = create_shift_schedule(
                    days=group.get("days") or [],
                    shift_type=shift_type_name,
                    profile=profile,
                    name=shift_schedule_info.get("proposed_name"),
                )
                created_shift_schedules.append(pat_name)
            elif not pat_name:
                frappe.throw("Shift Schedule match failed for a group")

            ssa_name = upsert_ssa(
                employee=employee,
                shift_schedule=pat_name,
                create_shifts_after=effective,
                company=employee_info.get("company"),
            )
            generate_shifts_for_ssa(ssa_name, effective, generation_end)
            ssas_out.append({"name": ssa_name, "shift_schedule": pat_name})

        frappe.db.commit()
    except frappe.ValidationError:
        frappe.db.rollback()
        raise
    except Exception as exc:
        frappe.db.rollback()
        message = str(exc)
        if "duplicate" in message.lower() or "already exists" in message.lower():
            frappe.throw(
                f"Pattern may already exist on site. Re-run Preview and use the existing PAT. ({message})"
            )
        if "validate_existing_shift_assignments" in message.lower():
            frappe.throw(
                "Cannot move create_shifts_after earlier while later assignments exist. "
                "Pick a later effective date or adjust assignments in Desk."
            )
        raise

    return {
        "ok": True,
        "employee": employee,
        "ssas": ssas_out,
        "created": {
            "shift_types": created_shift_types,
            "shift_schedules": created_shift_schedules,
        },
        "assignments_generated_through": str(generation_end),
        "assignments_open_ended": through is None,
        "attendance_url": f"/hr-attendance?employee={employee}",
    }
