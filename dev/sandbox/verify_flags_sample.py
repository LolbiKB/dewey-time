"""
verify_flags_sample.py — hand-verification helper for the real-data pass (Tasks 7-8).

Run this via:
    bench --site <site> console
    # then inside the console:
    exec(open('apps/dewey_time/dev/sandbox/verify_flags_sample.py').read())
    sample_employees_by_branch()

Or as a one-liner:
    bench --site <site> execute dewey_time.dev.sandbox.verify_flags_sample.flag_code_coverage \
        --kwargs '{"start_date": "2026-06-01", "end_date": "2026-06-14"}'

Prerequisites:
- The site must have been seeded with the anonymized prod backup (seed --prod).
- This file is a HELPER for manual human review, not an automated test.
  It does NOT modify any data.

Dependency: only `frappe` (standard Frappe bench context).
"""
from __future__ import annotations

from datetime import date, datetime


def sample_employees_by_branch(per_branch: int = 5) -> dict[str, list[str]]:
    """
    Return a dict of {branch_name: [employee_id, ...]} with up to `per_branch`
    Active employees per branch, excluding any whose name contains 'ADMS Bridge'
    (the Bridge service integration user).

    Usage:
        result = sample_employees_by_branch(per_branch=5)
        for branch, employees in result.items():
            print(branch, employees)
    """
    import frappe

    employees = frappe.get_all(
        "Employee",
        filters={"status": "Active"},
        fields=["name", "employee_name", "branch"],
    )

    by_branch: dict[str, list[str]] = {}
    for emp in employees:
        if "ADMS Bridge" in (emp.get("employee_name") or ""):
            continue
        branch = (emp.get("branch") or "").strip() or "__no_branch__"
        bucket = by_branch.setdefault(branch, [])
        if len(bucket) < per_branch:
            bucket.append(emp["name"])

    return by_branch


def day_report(employee: str, date_str: str | date) -> None:
    """
    Print a human-readable report for one employee on one date:
    - Shift assignment (shift_type, start_date, end_date, status)
    - Employee checkins ordered by time (time, log_type, device_branch)
    - Attendance Flags emitted for that day (flag_code, day_closed, source)

    Usage:
        day_report("HR-EMP-00042", "2026-06-10")
    """
    import frappe
    from frappe.utils import getdate

    d = getdate(date_str)
    d_str = str(d)
    print(f"\n{'='*60}")
    print(f"Employee: {employee}  |  Date: {d_str}")
    print(f"{'='*60}")

    # Shift assignment
    shift_rows = frappe.get_all(
        "Shift Assignment",
        filters={
            "employee": employee,
            "start_date": ["<=", d],
            "docstatus": 1,
        },
        fields=["name", "shift_type", "start_date", "end_date", "status"],
        order_by="start_date desc",
        limit=5,
    )
    # Filter to assignments whose end_date is None or >= d
    active_shifts = [
        r for r in shift_rows
        if not r.get("end_date") or getdate(r["end_date"]) >= d
    ]
    if active_shifts:
        s = active_shifts[0]
        print(
            f"Shift: {s['shift_type']}  "
            f"[{s['start_date']} -> {s.get('end_date') or 'open'}]  "
            f"status={s['status']}"
        )
    else:
        print("Shift: (none / off-shift)")

    # Checkins
    checkins = frappe.get_all(
        "Employee Checkin",
        filters={
            "employee": employee,
            "time": ["between", [f"{d_str} 00:00:00", f"{d_str} 23:59:59"]],
        },
        fields=["name", "time", "log_type", "custom_device_branch"],
        order_by="time asc",
    )
    print(f"\nCheckins ({len(checkins)}):")
    if checkins:
        for c in checkins:
            print(
                f"  {c['time']}  {c.get('log_type', '?'):5s}  "
                f"branch={c.get('custom_device_branch') or '(none)'}"
            )
    else:
        print("  (no checkins)")

    # Attendance Flags
    flags = frappe.get_all(
        "Attendance Flag",
        filters={"employee": employee, "attendance_date": d},
        fields=["name", "flag_code", "day_closed", "source", "evidence"],
        order_by="day_closed asc, flag_code asc",
    )
    print(f"\nAttendance Flags ({len(flags)}):")
    if flags:
        for f in flags:
            closed_label = "FINAL" if f["day_closed"] else "provisional"
            print(
                f"  [{closed_label}]  {f['flag_code']}  "
                f"source={f.get('source') or '-'}"
            )
    else:
        print("  (no flags)")

    print()


def flag_code_coverage(
    start_date: str | date,
    end_date: str | date,
) -> dict[str, int]:
    """
    Return a dict of {flag_code: count} for all Attendance Flags in the given
    date window.  Useful for understanding which flag types appear in real data
    and whether the distribution matches expectations.

    Usage:
        counts = flag_code_coverage("2026-06-01", "2026-06-14")
        for code, n in sorted(counts.items(), key=lambda x: -x[1]):
            print(f"{n:6d}  {code}")
    """
    import frappe
    from frappe.utils import getdate

    d_start = str(getdate(start_date))
    d_end = str(getdate(end_date))

    rows = frappe.db.sql(
        """
        SELECT flag_code, COUNT(*) AS cnt
        FROM `tabAttendance Flag`
        WHERE attendance_date BETWEEN %(start)s AND %(end)s
        GROUP BY flag_code
        ORDER BY cnt DESC
        """,
        {"start": d_start, "end": d_end},
        as_dict=True,
    )

    counts: dict[str, int] = {r["flag_code"]: r["cnt"] for r in (rows or [])}
    print(f"\nFlag counts {d_start} → {d_end}:")
    for code, n in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {n:6d}  {code}")
    return counts
