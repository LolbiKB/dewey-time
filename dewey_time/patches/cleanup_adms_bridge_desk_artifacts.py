import frappe


def execute():
    """Drop the non-rendering ADMS desk-nav artifacts.

    This site's Desk shows app icons only via the navbar app-switcher, which is
    one entry per installed app (frappe.boot.load_desktop_data reads apps[0]);
    there is no /apps launcher grid and the Desktop Icon / Workspace Sidebar
    system is unused here. The earlier add_adms_bridge_desk_link /
    add_adms_bridge_desk_icon attempts therefore never surfaced (and the trio
    patch errored mid-run). Remove any stray "ADMS Bridge" records they left so
    nothing lingers. ADMS stays reachable at /adms. Defensive + idempotent.
    """
    for name in frappe.get_all("Desktop Icon", filters={"label": "ADMS Bridge"}, pluck="name"):
        frappe.delete_doc("Desktop Icon", name, force=1, ignore_permissions=True, ignore_missing=True)

    for doctype in ("Workspace Sidebar", "Workspace"):
        if frappe.db.exists(doctype, "ADMS Bridge"):
            frappe.delete_doc(doctype, "ADMS Bridge", force=1, ignore_permissions=True, ignore_missing=True)

    frappe.clear_cache()
