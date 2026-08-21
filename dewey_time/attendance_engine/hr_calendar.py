from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import timedelta

import frappe
from frappe.utils import get_datetime, getdate, nowdate

from dewey_time.attendance_engine import rollout
from dewey_time.attendance_engine.closeout import _get_shift_meta, has_open_device_closeout_alert
from dewey_time.attendance_engine.employment_type import is_clock_based
from dewey_time.attendance_engine.lunch_detection import detect_observed_lunch
from dewey_time.attendance_engine.shift_grace import effective_lunch_return_grace, effective_start_grace
from dewey_time.attendance_engine.holidays import holiday_by_date_for_company
from dewey_time.attendance_engine.shift_assignment import (
    get_shift_assignment as _get_shift_assignment,
    shift_assignment_bounds_by_employee,
)
from dewey_time.attendance_engine.flag_identity import date_key, evidence_fingerprint, flag_identity


HR_STAFF_ROLES = frozenset({"System Manager", "HR User", "HR Manager"})


def _is_hr_staff(user: str | None = None) -> bool:
    user = user or frappe.session.user
    if user == "Administrator":
        return True
    roles = set(frappe.get_roles(user) or [])
    return bool(roles & HR_STAFF_ROLES)


def _employee_linked_to_user(user: str | None = None) -> str | None:
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None
    return frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name")


def _excluded_calendar_employees() -> list[str]:
    """Employee IDs to hide from the HR calendar/schedule pickers (e.g. the ADMS
    Bridge service account). Configured via site_config `hr_calendar_excluded_employees`
    (a JSON list or a comma/newline-separated string)."""
    raw = frappe.conf.get("hr_calendar_excluded_employees") or []
    if isinstance(raw, str):
        raw = [p.strip() for p in re.split(r"[,\n]", raw) if p.strip()]
    return [str(e) for e in raw if e]


def _require_hr_role():
    if _is_hr_staff():
        return
    frappe.throw("Not permitted")


def _require_calendar_access(employee: str):
    if _is_hr_staff():
        return
    linked = _employee_linked_to_user()
    if linked and linked == employee:
        return
    frappe.throw("Not permitted", frappe.PermissionError)


def _coerce_bool(value, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ("1", "true", "yes")


def _format_time(value):
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%H:%M:%S")
    text = str(value).strip()
    if not text:
        return None
    return text.split(".")[0]


def _format_datetime(value):
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _filter_auto_flags_for_calendar_day(
    day_flags: list[dict],
    *,
    attendance_date,
    employee_branch: str | None,
    site_today,
) -> list[dict]:
    """Open days show provisional AUTO only; past days prefer final closeout flags."""
    attendance_date = getdate(attendance_date)
    site_today = getdate(site_today)
    non_auto = [row for row in day_flags if (row.get("source") or "").upper() != "AUTO"]
    auto = [row for row in day_flags if (row.get("source") or "").upper() == "AUTO"]

    if attendance_date > site_today:
        return non_auto

    if attendance_date < site_today:
        finals = [row for row in auto if row.get("day_closed") == 1]
        return non_auto + (finals if finals else auto)

    branch_still_open = bool(employee_branch) and has_open_device_closeout_alert(
        branch=employee_branch, local_date=attendance_date
    )
    if branch_still_open:
        return non_auto + [row for row in auto if row.get("day_closed") == 0]

    if not employee_branch:
        provisional = [row for row in auto if row.get("day_closed") == 0]
        if provisional:
            return non_auto + provisional

    finals = [row for row in auto if row.get("day_closed") == 1]
    return non_auto + (finals if finals else auto)


def is_full_time_employment(employment_type: str | None) -> bool:
    """True when employment_type looks like full-time (not part-time / contract variants)."""
    if not employment_type:
        return False
    normalized = str(employment_type).strip().lower().replace("-", " ")
    if "part" in normalized:
        return False
    return "full" in normalized


def _shift_schedule_assignment_start_field() -> str | None:
    """HRMS uses create_shifts_after; older/custom schemas may use from_date."""
    if frappe.db.has_column("Shift Schedule Assignment", "create_shifts_after"):
        return "create_shifts_after"
    if frappe.db.has_column("Shift Schedule Assignment", "from_date"):
        return "from_date"
    return None


def _shift_schedule_assignment_metadata_by_employee(employee_ids: list[str]) -> dict[str, dict]:
    """Enabled Shift Schedule Assignment rows (HR Setup), keyed by employee."""
    if not employee_ids or not frappe.db.table_exists("Shift Schedule Assignment"):
        return {}

    start_field = _shift_schedule_assignment_start_field()
    fields = ["employee", "name"]
    if start_field:
        fields.append(start_field)
    if frappe.db.has_column("Shift Schedule Assignment", "end_date"):
        fields.append("end_date")

    filters: dict = {"employee": ["in", employee_ids]}
    if frappe.db.has_column("Shift Schedule Assignment", "enabled"):
        filters["enabled"] = 1

    order_by = f"{start_field} desc, creation desc" if start_field else "creation desc"

    today = getdate()
    by_employee: dict[str, dict] = {}
    rows = (
        frappe.get_all(
            "Shift Schedule Assignment",
            filters=filters,
            fields=fields,
            order_by=order_by,
        )
        or []
    )

    for row in rows:
        emp = row.get("employee")
        if not emp or emp in by_employee:
            continue
        end_date = row.get("end_date")
        if end_date and getdate(end_date) < today:
            continue
        start_date = row.get(start_field) if start_field else None
        by_employee[emp] = {
            "has_shift_assignment": True,
            "has_shift_schedule_assignment": True,
            "shift_schedule_assignment": row.get("name"),
            "schedule_min_date": str(getdate(start_date)) if start_date else None,
            "schedule_max_date": str(getdate(end_date)) if end_date else None,
        }
    return by_employee


def employee_has_active_shift_schedule_assignment(employee: str) -> bool:
    """Whether the employee has an enabled Shift Schedule Assignment (metadata only)."""
    return employee in _shift_schedule_assignment_metadata_by_employee([employee])


def _active_shift_schedule_assignment_employees(employee_ids: list[str]) -> set[str]:
    return set(_shift_schedule_assignment_metadata_by_employee(employee_ids).keys())


def _leave_by_date_for_range(*, employee: str, start, end) -> dict[str, dict]:
    """Approved leave applications overlapping [start, end], keyed by yyyy-mm-dd."""
    if not frappe.db.table_exists("Leave Application"):
        return {}

    rows = (
        frappe.get_all(
            "Leave Application",
            filters={
                "employee": employee,
                "docstatus": 1,
                "status": "Approved",
                "from_date": ["<=", end],
                "to_date": [">=", start],
            },
            fields=["from_date", "to_date", "leave_type"],
        )
        or []
    )

    by_date: dict[str, dict] = {}
    for row in rows:
        from_d = getdate(row["from_date"])
        to_d = getdate(row["to_date"])
        leave_type = row.get("leave_type")
        cur = from_d if from_d > start else start
        end_d = to_d if to_d < end else end
        while cur <= end_d:
            key = str(cur)
            by_date[key] = {"on_leave": True, "leave_type": leave_type}
            cur = cur + timedelta(days=1)
    return by_date


def _shift_day_context(*, employee: str, attendance_date, meta_resolver=None):
    """(context, assignment, meta) for one day, resolved ONCE.

    The day loop needs all three -- the context for the payload, the meta for
    observed-lunch detection -- and used to re-derive the last two by calling
    the same two lookups a SECOND time for the same date, immediately after
    this function had already done it. On a month range that is ~60 wasted
    queries per request, for answers already in hand.

    `meta_resolver` lets a caller memoise the Shift Type read across the range
    (see build_employee_calendar): `_get_shift_meta` is an uncached
    `frappe.get_doc`, and a 31-day month loads the same one or two documents
    thirty-one times.
    """
    resolve_meta = meta_resolver or _get_shift_meta
    assignment = _get_shift_assignment(employee=employee, attendance_date=attendance_date)
    if not assignment or not assignment.get("shift_type"):
        return {"shift_assigned": False}, None, None

    meta = resolve_meta(assignment["shift_type"])
    if not meta:
        return {"shift_assigned": False}, assignment, None

    ctx = {
        "shift_assigned": True,
        "shift_type": assignment["shift_type"],
        "start_time": _format_time(meta.get("start_time")),
        "end_time": _format_time(meta.get("end_time")),
        "grace_minutes": effective_start_grace(meta),
        "lunch_start": _format_time(meta.get("custom_lunch_start")),
        "lunch_end": _format_time(meta.get("custom_lunch_end")),
    }
    if assignment.get("schedule_superseded"):
        ctx["schedule_superseded"] = True
    if assignment.get("assignment_status"):
        ctx["assignment_status"] = assignment["assignment_status"]
    return ctx, assignment, meta


def _shift_context_for_day(*, employee: str, attendance_date):
    """Just the context. The name three tests and any future caller use."""
    return _shift_day_context(employee=employee, attendance_date=attendance_date)[0]


def first_checkin_date_by_employee(employee_ids: list[str]) -> dict[str, dict]:
    """
    Earliest calendar day (`Employee Checkin.time`) with any punch row, per employee.
    Includes off-shift / demo seed rows — week-nav backward bound only (not flag logic).
    """
    if not employee_ids or not frappe.db.table_exists("Employee Checkin"):
        return {}

    placeholders = ", ".join(["%s"] * len(employee_ids))
    rows = frappe.db.sql(
        f"""
        SELECT employee, MIN(DATE(`time`)) AS first_checkin_date
        FROM `tabEmployee Checkin`
        WHERE employee IN ({placeholders})
          AND `time` IS NOT NULL
        GROUP BY employee
        """,
        tuple(employee_ids),
        as_dict=True,
    )

    out: dict[str, dict] = {}
    for row in rows or []:
        emp = row.get("employee")
        if not emp:
            continue
        first = row.get("first_checkin_date")
        out[emp] = {
            "first_checkin_date": str(getdate(first)) if first else None,
        }
    return out


@frappe.whitelist()
def get_calendar_session():
    """SPA bootstrap: HR staff vs personal (linked Employee) calendar mode."""
    linked = _employee_linked_to_user()
    hr_staff = _is_hr_staff()
    if not hr_staff and not linked:
        frappe.throw(
            "No active Employee is linked to your user account.",
            frappe.PermissionError,
        )
    return {
        "hr_staff": hr_staff,
        "employee_id": linked,
    }


@frappe.whitelist()
def list_calendar_employees(include_without_shifts=True):
    """
    Active employees for the HR attendance calendar picker.

    HR staff see all active employees; other users see only their linked Employee.
    Returns ``{"employees": [...], "current_user_employee": "EMP-001" | null}``
    so the SPA can default HR staff to their own record.
    """
    include_all = _coerce_bool(include_without_shifts, default=True)
    current_user_employee = _employee_linked_to_user()

    if _is_hr_staff():
        employee_ids = None
    else:
        if not current_user_employee:
            frappe.throw(
                "No active Employee is linked to your user account.",
                frappe.PermissionError,
            )
        employee_ids = [current_user_employee]

    employees = _list_calendar_employee_rows(employee_ids, include_all=include_all)
    return {
        "employees": employees,
        "current_user_employee": current_user_employee,
    }


def _list_calendar_employee_rows(employee_ids: list[str] | None, *, include_all: bool, limit: int = 500):
    fields = ["name", "employee_name", "designation", "department", "company", "image", "branch"]
    if frappe.db.has_column("Employee", "employment_type"):
        fields.append("employment_type")
    # Installed by dewey_time.setup.custom_fields, but a site mid-migration may
    # not have them yet -- and an unknown column makes frappe.get_all raise,
    # taking the whole picker down rather than losing one optional fact.
    for khmer_field in ("custom_khmer_last_name", "custom_khmer_first_name"):
        if frappe.db.has_column("Employee", khmer_field):
            fields.append(khmer_field)

    filters: dict = {"status": "Active"}
    if employee_ids is not None:
        filters["name"] = ["in", employee_ids]
    else:
        excluded = _excluded_calendar_employees()
        if excluded:
            filters["name"] = ["not in", excluded]

    rows = (
        frappe.get_all(
            "Employee",
            filters=filters,
            fields=fields,
            order_by="employee_name asc",
            limit_page_length=limit,
        )
        or []
    )

    employee_ids = [row["name"] for row in rows]
    try:
        ssa_by_employee = _shift_schedule_assignment_metadata_by_employee(employee_ids)
    except Exception:
        frappe.log_error(title="list_calendar_employees SSA metadata failed")
        ssa_by_employee = {}
    try:
        assignment_bounds = shift_assignment_bounds_by_employee(employee_ids)
    except Exception:
        frappe.log_error(title="list_calendar_employees shift bounds failed")
        assignment_bounds = {}
    try:
        checkin_bounds = first_checkin_date_by_employee(employee_ids)
    except Exception:
        frappe.log_error(title="list_calendar_employees first checkin bounds failed")
        checkin_bounds = {}

    employees = []
    for row in rows:
        emp_id = row["name"]
        ssa = ssa_by_employee.get(emp_id, {})
        bounds = assignment_bounds.get(emp_id, {})
        checkins = checkin_bounds.get(emp_id, {})
        has_shift_assignment = ssa.get("has_shift_assignment") is True
        if not include_all and not has_shift_assignment:
            continue

        display_name = row.get("employee_name") or emp_id
        employment_type = row.get("employment_type")
        schedule_min_date = bounds.get("schedule_min_date") or ssa.get("schedule_min_date")
        schedule_max_date = bounds.get("schedule_max_date")
        if schedule_max_date is None and bounds.get("schedule_min_date"):
            schedule_max_date = None
        elif schedule_max_date is None:
            schedule_max_date = ssa.get("schedule_max_date")

        employees.append(
            {
                "id": emp_id,
                "label": f"{emp_id} · {display_name}",
                "employee_name": display_name,
                # Emitted, not merely selected. A field in the SELECT list that
                # the output dict drops is a production no-op returning None
                # forever -- which is what `branch` did here until it was caught
                # in review. `.get` because the SELECT above is conditional.
                "custom_khmer_last_name": row.get("custom_khmer_last_name"),
                "custom_khmer_first_name": row.get("custom_khmer_first_name"),
                "image": row.get("image"),
                "title": row.get("designation"),
                "department": row.get("department"),
                "branch": row.get("branch"),
                "company": row.get("company"),
                "employment_type": employment_type,
                "is_full_time": is_full_time_employment(employment_type),
                "is_clock_based": is_clock_based(employment_type),
                "has_shift_schedule_assignment": has_shift_assignment,
                "has_shift_assignment": has_shift_assignment,
                "shift_schedule_assignment": ssa.get("shift_schedule_assignment"),
                "schedule_min_date": schedule_min_date,
                "schedule_max_date": schedule_max_date,
                "first_checkin_date": checkins.get("first_checkin_date"),
            }
        )

    employees.sort(
        key=lambda e: (
            0 if e.get("has_shift_assignment") else 1,
            (e.get("employee_name") or e.get("id") or "").lower(),
        )
    )
    return employees


def _employee_nav_meta(employee: str) -> dict:
    checkin = first_checkin_date_by_employee([employee]).get(employee, {})
    bounds = shift_assignment_bounds_by_employee([employee]).get(employee, {})
    employment_type = (
        frappe.db.get_value("Employee", employee, "employment_type")
        if frappe.db.has_column("Employee", "employment_type")
        else None
    )
    return {
        "first_checkin_date": checkin.get("first_checkin_date"),
        "schedule_max_date": bounds.get("schedule_max_date"),
        # Deliberately NOT "has_shift_assignment": list_calendar_employees uses
        # that name for "has a Shift SCHEDULE Assignment", a different doctype.
        # One name meaning two things across two payloads the same SPA consumes
        # is how the week grid ended up hidden for employees who do have
        # concrete Shift Assignment rows.
        "has_shift_assignment_rows": bool(bounds.get("has_shift_assignment")),
        "is_clock_based": is_clock_based(employment_type),
    }


# What the attach point below actually needs from a decision: the key to match it
# to a flag, the fingerprint that decides matched vs needs_re_review, and the two
# fields a non-HR viewer is allowed to see.
_DECISION_FIELDS_EMPLOYEE_VIEW = (
    "flag_identity",
    "outcome",
    "decided_at",
    "evidence_fingerprint",
)

# Everything above plus HR's own working record: the free-text note, the reason
# (which can read GENUINE_VIOLATION), who decided, and the batch it belonged to.
_DECISION_FIELDS_HR_VIEW = (
    "name",
    "flag_identity",
    "outcome",
    "reason",
    "note",
    "decided_by",
    "decided_at",
    "group_key",
    "evidence_fingerprint",
)


def _live_decisions_by_identity(*, employee: str, start, end, hr_view: bool) -> dict[str, dict]:
    """Live (superseded=0) Attendance Flag Decision rows for one employee's date
    range, as ONE batched query keyed by flag_identity — never per-day, never
    per-flag (Global Constraint 5). Called exactly once per get_employee_calendar
    request, regardless of how many days or flags are in range; the per-flag
    attach below this is an in-memory dict lookup, not a query.

    `hr_view` narrows the SELECT rather than the payload. The payload is already
    safe — the attach point projects an allowlist for a non-HR viewer — but an
    employee reading their own calendar is a first-class path here, and HR's
    private note about them has no reason to be fetched into that request's memory
    at all. Defence in depth: two things would have to break before it leaks.
    """
    if not frappe.db.table_exists("Attendance Flag Decision"):
        return {}

    rows = (
        frappe.get_all(
            "Attendance Flag Decision",
            filters={
                "employee": employee,
                "attendance_date": ["between", [start, end]],
                "superseded": 0,
            },
            fields=list(_DECISION_FIELDS_HR_VIEW if hr_view else _DECISION_FIELDS_EMPLOYEE_VIEW),
        )
        or []
    )

    by_identity: dict[str, dict] = {}
    for row in rows:
        row["decided_at"] = _format_datetime(row.get("decided_at"))
        identity = row.get("flag_identity")
        if identity:
            by_identity[identity] = row
    return by_identity


@frappe.whitelist()
def get_employee_calendar(employee: str, start_date: str, end_date: str):
    """
    HR calendar range API (MVP):
    - checkins bucketed per day
    - computed first/last + gross minutes (simple heuristic)
    - flags per day (chips)
    - shift context per day (when assigned)
    """
    _require_calendar_access(employee)
    return build_employee_calendar(employee, start_date, end_date)


def build_employee_calendar(employee: str, start_date: str, end_date: str):
    """The calendar payload, with NO permission check.

    Split out of get_employee_calendar so a caller that has authorized by some
    other means can reach it. The Telegram Mini App is that caller: it creates
    no Frappe User by design, and _require_calendar_access resolves identity
    via frappe.session.user -> Employee.user_id, so that gate can never pass
    for it — the split is what makes the employee surface possible at all.

    CALLERS ARE RESPONSIBLE FOR AUTHORIZATION. There are exactly two:
      - get_employee_calendar above — HR staff or self, via
        _require_calendar_access.
      - telegram/miniapp_api.get_my_calendar — a verified Telegram binding,
        which also narrows the result to an allowlist before returning it.
        This payload is HR-shaped and carries device serials, flag evidence
        and grace minutes; do not hand it to an employee unnarrowed.
    """
    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be >= start_date")

    start_dt = get_datetime(str(start) + " 00:00:00")
    end_dt = get_datetime(str(end) + " 23:59:59")

    checkins = (
        frappe.get_all(
            "Employee Checkin",
            filters={"employee": employee, "time": ["between", [start_dt, end_dt]]},
            fields=["name", "time", "log_type", "device_id", "custom_device_branch"],
            order_by="time asc",
        )
        or []
    )

    employee_company = frappe.db.get_value("Employee", employee, "company")
    holiday_by_date = holiday_by_date_for_company(company=employee_company, start=start, end=end)

    employee_branch = frappe.db.get_value("Employee", employee, "branch")
    device_alerts = []
    if employee_branch and frappe.db.table_exists("Device Closeout Alert"):
        device_alerts = (
            frappe.get_all(
                "Device Closeout Alert",
                filters={
                    "branch": employee_branch,
                    "local_date": ["between", [start, end]],
                    "resolved_at": ["is", "not set"],
                },
                fields=["device_sn", "branch", "local_date", "status", "last_error"],
                order_by="local_date asc, device_sn asc",
            )
            or []
        )
        for row in device_alerts:
            if row.get("local_date"):
                row["local_date"] = str(row["local_date"])

    device_sync = []
    if employee_branch and frappe.db.table_exists("Device Sync Status"):
        from dewey_time.attendance_engine.device_sync import dedupe_device_sync_for_calendar

        raw_sync = (
            frappe.get_all(
                "Device Sync Status",
                filters={
                    "branch": employee_branch,
                    "local_date": ["between", [start, end]],
                },
                fields=[
                    "name",
                    "device_sn",
                    "branch",
                    "local_date",
                    "last_device_log_at",
                    "last_delivered_at",
                    "pending_count",
                    "last_error",
                    "modified",
                ],
                order_by="modified desc",
            )
            or []
        )
        device_sync = dedupe_device_sync_for_calendar(raw_sync)
        for row in device_sync:
            if row.get("local_date"):
                row["local_date"] = str(row["local_date"])
            row["last_device_log_at"] = _format_datetime(row.get("last_device_log_at"))
            row["last_delivered_at"] = _format_datetime(row.get("last_delivered_at"))
            row.pop("modified", None)

    flags = []
    if frappe.db.table_exists("Attendance Flag"):
        flags = (
            frappe.get_all(
                "Attendance Flag",
                filters={"employee": employee, "attendance_date": ["between", [start, end]]},
                fields=[
                    "name",
                    "attendance_date",
                    "flag_code",
                    "severity",
                    "source",
                    "status",
                    "day_closed",
                    "rule_version",
                    "evidence",
                ],
                order_by="attendance_date asc, creation asc",
            )
            or []
        )

    checkins_by_day = defaultdict(list)
    for c in checkins:
        d = getdate(c["time"])
        checkins_by_day[str(d)].append(
            {
                **c,
                "time": _format_datetime(c.get("time")),
            }
        )

    # Resolved once for the whole request — reads cached roles, no query, so this
    # does not touch the query budget (Global Constraint 5). An employee viewing
    # their own calendar (a first-class path: _require_calendar_access allows a
    # non-HR user through for their own linked Employee) must not receive HR's
    # private `note`/`decided_by`/`reason` on their own flags. Resolved BEFORE the
    # decision read so it can narrow the SELECT as well as the payload.
    hr_view = _is_hr_staff()
    decisions_by_identity = _live_decisions_by_identity(
        employee=employee, start=start, end=end, hr_view=hr_view
    )

    flags_by_day_raw: dict[str, list[dict]] = defaultdict(list)
    for f in flags:
        d = f.get("attendance_date")
        # date_key(), not str(d): the ONE normaliser flag_queue_api._flag_rows also
        # uses, so a datetime-shaped attendance_date can never silently produce an
        # identity that fails to match a decision's stored flag_identity.
        key = date_key(d)
        if not key:
            continue
        ev = f.get("evidence")
        if isinstance(ev, str) and ev:
            try:
                f["evidence"] = json.loads(ev)
            except Exception:
                f["evidence"] = None
        day_closed = f.get("day_closed")
        source = (f.get("source") or "").upper()
        if source == "AUTO":
            # Attach the live decision (if any) by flag_identity, computed from the
            # flag's own fields — never from `name`, which is unstable across the
            # provisional/final rename (attendance_flag.py:53-71, Global Constraint 2).
            identity = flag_identity(
                employee=employee,
                attendance_date=key,
                flag_code=f.get("flag_code"),
                evidence=f.get("evidence"),
            )
            decision = decisions_by_identity.get(identity)
            if decision is None:
                decision_state = "undecided"
            elif evidence_fingerprint(f.get("evidence")) == decision.get("evidence_fingerprint"):
                decision_state = "matched"
            else:
                # Evidence moved under the decision (e.g. HR corrected the punch that
                # produced it). Same match/mismatch rule flag_grouping.build_queue
                # uses for the triage queue, so this surface and that one can never
                # disagree about the same flag_identity.
                decision_state = "needs_re_review"
        else:
            # HR/EMPLOYEE-created rows are never AUTO, but flag_identity() always
            # prefixes "AUTO-" (flag_identity.py:181) — computing one here would
            # risk colliding with an unrelated engine-generated flag for the same
            # employee/date/code. flag_queue_api._flag_rows filters source == "AUTO"
            # for the identical reason (flag_queue_api.py:102-105).
            decision, decision_state = None, "undecided"

        if decision is not None and not hr_view:
            # Allowlist, never `pop()`/`del`: a field the doctype gains later then
            # defaults to hidden rather than leaking, the same reason
            # flag_queue_api._open_alert_rows rebuilds its card field by field
            # instead of passing the row through. decision_state stays truthful
            # either way — redacting the whole attachment instead would make an
            # excused flag falsely report "undecided" in the employee's own view.
            decision = {"outcome": decision.get("outcome"), "decided_at": decision.get("decided_at")}

        flags_by_day_raw[key].append(
            {
                **f,
                "is_provisional": day_closed == 0,
                "decision": decision,
                "decision_state": decision_state,
            }
        )

    site_today = getdate(nowdate())
    flags_by_day = defaultdict(list)
    for key, day_flags in flags_by_day_raw.items():
        flags_by_day[key] = _filter_auto_flags_for_calendar_day(
            day_flags,
            attendance_date=key,
            employee_branch=employee_branch,
            site_today=site_today,
        )

    leave_by_date = _leave_by_date_for_range(employee=employee, start=start, end=end)

    # REQUEST-SCOPED, by construction: this dict dies with the call, so there
    # is no cross-request staleness to reason about and no test pollution.
    # `_get_shift_meta` is an uncached frappe.get_doc("Shift Type"), and a
    # month range loads the same one or two documents once per day.
    #
    # Deliberately NOT get_cached_doc in _get_shift_meta itself: that function
    # is on the flag-WRITING path too (intraday, closeout), where a stale Shift
    # Type means a wrong LATE_START threshold. That is its own change, with its
    # own reasoning about invalidation.
    meta_by_shift: dict = {}

    def _meta(shift_type):
        if shift_type not in meta_by_shift:
            meta_by_shift[shift_type] = _get_shift_meta(shift_type)
        return meta_by_shift[shift_type]

    days = []
    cur = start
    while cur <= end:
        key = str(cur)
        day_checkins = checkins_by_day.get(key, [])
        first_in = day_checkins[0]["time"] if day_checkins else None
        last_out = day_checkins[-1]["time"] if day_checkins else None

        gross_minutes = None
        if first_in and last_out:
            first_dt = get_datetime(first_in)
            last_dt = get_datetime(last_out)
            if last_dt >= first_dt:
                gross_minutes = int((last_dt - first_dt).total_seconds() / 60)

        observed_lunch = None
        # ONE resolution per day, not two. `meta` is non-None only when the
        # assignment resolved AND its Shift Type loaded, which is exactly the
        # old three-part guard (`shift_assigned` implies both).
        shift, _assignment, meta = _shift_day_context(
            employee=employee, attendance_date=cur, meta_resolver=_meta,
        )
        if meta and day_checkins:
            observed_lunch = detect_observed_lunch(
                checkins=day_checkins,
                shift_meta=meta,
                attendance_date=cur,
                grace_minutes=effective_lunch_return_grace(meta),
            )

        days.append(
            {
                "date": key,
                "shift": shift,
                "holiday": holiday_by_date.get(key),
                "leave": leave_by_date.get(key, {"on_leave": False}),
                "checkins": day_checkins,
                "first_in": first_in,
                "last_out": last_out,
                "gross_minutes": gross_minutes,
                "observed_lunch": observed_lunch,
                "flags": flags_by_day.get(key, []),
                # PRELAUNCH here means the engine never evaluated this day. Without
                # it a pre-cutoff day is pixel-identical to a clean one, which is the
                # single place the cutoff can actively mislead. Rendered in Phase B.
                "rollout_phase": rollout.phase_for(
                    branch=employee_branch, attendance_date=cur
                ),
            }
        )
        cur = cur + timedelta(days=1)

    return {
        "employee": employee,
        "start_date": str(start),
        "end_date": str(end),
        "days": days,
        "device_alerts": device_alerts,
        "device_sync": device_sync,
        # The employee's primary site. Already resolved above for the closeout-alert
        # and sync-status lookups, so this adds no query. The SPA needs it to tell
        # which punches happened somewhere other than home; without it the client
        # cannot make that comparison at all. May be None — a great many employees
        # have no branch set, and every consumer must treat that as "do not judge".
        "employee_branch": employee_branch,
        **_employee_nav_meta(employee),
    }
