from __future__ import annotations

from datetime import datetime

import frappe
from frappe.utils import get_datetime, getdate, now_datetime


def _format_datetime(value):
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _coerce_int(value):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _validate_device_branch(device_branch):
    branch = (device_branch or "").strip()
    if not branch:
        frappe.throw("device_branch is required")
    if frappe.db.exists("Branch", branch):
        return branch
    frappe.throw(f"device_branch must match an existing Branch name: {branch}")


def device_sync_doc_name(device_sn: str, local_date) -> str:
    """Stable primary key: one row per (device_sn, local_date)."""
    local_date = getdate(local_date)
    device_sn = (device_sn or "").strip()
    if not device_sn:
        frappe.throw("device_sn is required")
    return f"DSS-{frappe.scrub(device_sn)}-{local_date}"[:140]


def _sync_rows_for_device_date(device_sn: str, local_date):
    return frappe.get_all(
        "Device Sync Status",
        filters={"device_sn": device_sn, "local_date": getdate(local_date)},
        fields=["name", "modified", "last_device_log_at", "last_delivered_at"],
        order_by="modified desc",
    )


def _row_sort_key(row):
    log_at = get_datetime(row.get("last_device_log_at"))
    modified = get_datetime(row.get("modified"))
    return (
        log_at or datetime.min,
        modified or datetime.min,
    )


def merge_device_sync_duplicates(device_sn: str, local_date) -> str:
    """
    Keep a single row per (device_sn, local_date).
    Winner: highest last_device_log_at, then latest modified.
    Renames winner to DSS-{scrub(device_sn)}-{local_date} when needed.
    """
    device_sn = (device_sn or "").strip()
    local_date = getdate(local_date)
    canonical = device_sync_doc_name(device_sn, local_date)
    rows = _sync_rows_for_device_date(device_sn, local_date)

    if not rows:
        return canonical

    winner = max(rows, key=_row_sort_key)
    winner_name = winner["name"]

    for row in rows:
        if row["name"] != winner_name:
            frappe.delete_doc("Device Sync Status", row["name"], ignore_permissions=True, force=True)

    if winner_name != canonical:
        if frappe.db.exists("Device Sync Status", canonical):
            frappe.delete_doc("Device Sync Status", canonical, ignore_permissions=True, force=True)
        frappe.rename_doc("Device Sync Status", winner_name, canonical, force=True, merge=True)

    return canonical


def dedupe_device_sync_for_calendar(rows: list[dict]) -> list[dict]:
    """One sync row per (device_sn, local_date) — keep latest modified."""
    best_by_key: dict[tuple[str, str], dict] = {}
    for row in rows:
        device_sn = row.get("device_sn") or ""
        local_date = str(row.get("local_date") or "")
        key = (device_sn, local_date)
        existing = best_by_key.get(key)
        if not existing:
            best_by_key[key] = row
            continue
        if (get_datetime(row.get("modified")) or datetime.min) > (
            get_datetime(existing.get("modified")) or datetime.min
        ):
            best_by_key[key] = row

    out = list(best_by_key.values())
    out.sort(key=lambda row: (str(row.get("local_date") or ""), row.get("device_sn") or ""))
    return out


def upsert_device_sync_status(
    *,
    device_sn: str,
    local_date,
    device_branch=None,
    last_device_log_at=None,
    last_delivered_at=None,
    pending_count=None,
    last_error=None,
    bridge_env=None,
):
    device_sn = (device_sn or "").strip()
    local_date = getdate(local_date)
    if not device_sn:
        frappe.throw("device_sn is required")

    canonical = merge_device_sync_duplicates(device_sn, local_date)

    values = {
        "device_sn": device_sn,
        "branch": device_branch,
        "local_date": local_date,
        "last_device_log_at": get_datetime(last_device_log_at) if last_device_log_at else None,
        "last_delivered_at": get_datetime(last_delivered_at) if last_delivered_at else None,
        "pending_count": _coerce_int(pending_count),
        "last_error": last_error,
        "bridge_env": bridge_env,
    }

    if frappe.db.exists("Device Sync Status", canonical):
        doc = frappe.get_doc("Device Sync Status", canonical)
    else:
        doc = frappe.get_doc({"doctype": "Device Sync Status", "name": canonical})

    for field, value in values.items():
        setattr(doc, field, value)

    doc.save(ignore_permissions=True)
    return doc.name


@frappe.whitelist(allow_guest=True, methods=["POST"])
def notify_device_sync_status(
    device_sn=None,
    local_date=None,
    device_branch=None,
    last_device_log_at=None,
    last_delivered_at=None,
    pending_count=None,
    last_error=None,
    bridge_env=None,
):
    """
    Bridge webhook: intraday device sync watermark.
    Auth: API key (Authorization: token key:secret) + optional X-Bridge-Secret.
    Upserts on (device_sn, local_date) — never accumulates duplicate rows.
    """
    from dewey_time.attendance_engine.bridge_auth import validate_bridge_request

    validate_bridge_request()

    device_sn = (device_sn or "").strip()
    if not device_sn:
        frappe.throw("device_sn is required")
    if not local_date:
        frappe.throw("local_date is required")
    if not last_device_log_at:
        frappe.throw("last_device_log_at is required")
    if not last_delivered_at:
        frappe.throw("last_delivered_at is required")

    device_branch = _validate_device_branch(device_branch)

    local_date = getdate(local_date)
    delivered_dt = get_datetime(last_delivered_at)
    device_log_dt = get_datetime(last_device_log_at)
    if delivered_dt and device_log_dt and delivered_dt > device_log_dt:
        frappe.throw("last_delivered_at must not be after last_device_log_at")

    doc_name = upsert_device_sync_status(
        device_sn=device_sn,
        local_date=local_date,
        device_branch=device_branch,
        last_device_log_at=last_device_log_at,
        last_delivered_at=last_delivered_at,
        pending_count=pending_count,
        last_error=last_error,
        bridge_env=bridge_env,
    )

    return {
        "ok": True,
        "name": doc_name,
        "device_sn": device_sn,
        "local_date": str(local_date),
        "updated_at": _format_datetime(now_datetime()),
    }
