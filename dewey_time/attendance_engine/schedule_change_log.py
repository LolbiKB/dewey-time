from __future__ import annotations

import json

import frappe
from frappe.utils import now_datetime


def _summarize(leaving, adding):
    parts = []
    if leaving:
        parts.append("Retired " + " · ".join(leaving))
    if adding:
        parts.append("Added " + " · ".join(adding))
    return "; ".join(parts) if parts else "Schedule updated"


def record_schedule_change(*, employee, effective_from, reconcile, created, ssas):
    """Best-effort audit row for a confirmed schedule apply. NEVER raises — an audit-write
    failure must not break the schedule change itself."""
    try:
        if not frappe.db.table_exists("Schedule Change Log"):
            return None
        reconcile = reconcile or {}
        leaving = list(reconcile.get("leaving_labels") or [])
        adding = list(reconcile.get("add_labels") or [])
        affected = reconcile.get("affected_assignments") or []
        inactivated = sum(1 for a in affected if a.get("action") == "inactivate")
        trimmed = sum(1 for a in affected if a.get("action") == "end_before")
        created = created or {}
        created_types = list(created.get("shift_types") or [])
        created_scheds = list(created.get("shift_schedules") or [])
        if not (leaving or adding or affected or created_types or created_scheds or ssas):
            return None
        doc = frappe.new_doc("Schedule Change Log")
        doc.employee = employee
        doc.changed_by = getattr(frappe.session, "user", None) or "Administrator"
        doc.change_datetime = now_datetime()
        doc.effective_from = effective_from
        doc.summary = _summarize(leaving, adding)
        doc.inactivated_count = inactivated
        doc.trimmed_count = trimmed
        doc.detail = json.dumps(
            {
                "leaving": leaving,
                "adding": adding,
                "created_shift_types": created_types,
                "created_shift_schedules": created_scheds,
            },
            separators=(",", ":"),
        )
        doc.insert(ignore_permissions=True)
        return doc.name
    except Exception:
        frappe.log_error(title="schedule change log: write failed")
        return None
