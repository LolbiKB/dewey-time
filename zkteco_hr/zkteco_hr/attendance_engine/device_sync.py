from __future__ import annotations

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
    local_date = getdate(local_date)
    device_sn = (device_sn or "").strip()
    if not device_sn:
        frappe.throw("device_sn is required")

    doc_name = f"DSS-{frappe.scrub(device_sn)}-{local_date}"[:140]

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

    if frappe.db.exists("Device Sync Status", doc_name):
        frappe.db.set_value("Device Sync Status", doc_name, values, update_modified=True)
        return doc_name

    doc = frappe.get_doc({"doctype": "Device Sync Status", "name": doc_name, **values})
    doc.insert(ignore_permissions=True)
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
    """
    from zkteco_hr.attendance_engine.bridge_auth import validate_bridge_request

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
