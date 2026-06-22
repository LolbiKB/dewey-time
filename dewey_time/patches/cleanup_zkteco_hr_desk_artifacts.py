import frappe


def execute():
    """Drop the stale "ZKTeco HR" desk-nav artifacts left from the old app name.

    This app was renamed zkteco_hr -> dewey_time (modules.txt is now "Dewey
    Time"), but a site migrated before the rename can still carry orphaned
    "ZKTeco HR" records that surface a stray Desk icon: a Desktop Icon, its
    Workspace Sidebar, the backing Workspace, and the now-orphaned Module Def.
    Remove them so nothing ZKTeco-branded lingers in Desk. The HR app stays
    reachable via its Dewey Time app-switcher entry and the /hr-attendance SPA.

    Defensive + idempotent: each delete is guarded so a missing or link-blocked
    record can never abort the migrate (cf. the desk-nav patch that errored
    mid-run). Mirrors cleanup_adms_bridge_desk_artifacts.
    """
    for name in frappe.get_all("Desktop Icon", filters={"label": "ZKTeco HR"}, pluck="name"):
        _safe_delete("Desktop Icon", name)

    for doctype in ("Workspace Sidebar", "Workspace", "Module Def"):
        if frappe.db.exists(doctype, "ZKTeco HR"):
            _safe_delete(doctype, "ZKTeco HR")

    frappe.clear_cache()


def _safe_delete(doctype, name):
    try:
        frappe.delete_doc(doctype, name, force=1, ignore_permissions=True, ignore_missing=True)
    except Exception:
        frappe.log_error(title="cleanup_zkteco_hr_desk_artifacts", message=frappe.get_traceback())
