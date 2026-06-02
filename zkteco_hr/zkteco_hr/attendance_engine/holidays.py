from __future__ import annotations

import frappe
from frappe.utils import getdate


def holiday_by_date_for_company(*, company: str | None, start, end) -> dict[str, dict]:
    """
    Company holiday lookup for a date range (inclusive).

    Returns:
      { "YYYY-MM-DD": { "description": str, "weekly_off": bool } }
    """
    if not company:
        return {}
    if not frappe.db.table_exists("Holiday List"):
        return {}

    start = getdate(start)
    end = getdate(end)
    if end < start:
        return {}

    holiday_list = frappe.db.get_value("Company", company, "default_holiday_list")
    if not holiday_list or not frappe.db.exists("Holiday List", holiday_list):
        return {}

    rows = (
        frappe.get_all(
            "Holiday",
            filters={"parent": holiday_list, "holiday_date": ["between", [start, end]]},
            fields=["holiday_date", "description", "weekly_off"],
            order_by="holiday_date asc",
        )
        or []
    )

    out: dict[str, dict] = {}
    for row in rows:
        d = row.get("holiday_date")
        if not d:
            continue
        key = str(getdate(d))
        out[key] = {
            "description": row.get("description") or "Holiday",
            "weekly_off": bool(row.get("weekly_off")),
        }
    return out

