from __future__ import annotations

import json

import frappe
from frappe.utils import add_days, getdate, nowdate

from zkteco_hr.attendance_engine.hr_calendar import (
    _require_hr_role,
    shift_assignment_bounds_by_employee,
)
from zkteco_hr.attendance_engine.schedule_resolver import (
    build_resolve_plan,
    create_shift_schedule,
    create_shift_type,
    employee_has_enabled_ssas,
    generate_shifts_for_ssa,
    is_ssa_enabled,
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

    row = frappe.db.get_value(
        "Employee",
        employee,
        ["employee_name", "company", "branch", "status"],
        as_dict=True,
    ) or {}
    if (row.get("status") or "").lower() in ("inactive", "left"):
        frappe.throw(f"Employee {employee} is inactive")

    return {
        "employee": employee,
        "employee_name": row.get("employee_name") or employee,
        "company": row.get("company"),
        "branch": row.get("branch"),
    }


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
        "default_effective_from": str(add_days(getdate(nowdate()), 1)),
        "default_generate_through": str(add_days(getdate(nowdate()), 91)),
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
    _employee_header(employee)

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
    through = getdate(
        generate_through or frappe.form_dict.get("generate_through") or add_days(effective, 90)
    )
    if through < effective:
        frappe.throw("generate_through must be on or after create_shifts_after")
    if (through - effective).days > 365:
        frappe.throw("generate_through cannot be more than 365 days after create_shifts_after")

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
            )
            generate_shifts_for_ssa(ssa_name, effective, through)
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
        "assignments_generated_through": str(through),
        "attendance_url": f"/hr-attendance?employee={employee}",
    }
