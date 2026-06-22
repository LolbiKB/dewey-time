import frappe

NAME = "ADMS Bridge"
APP = "dewey_time"


def execute():
    """Add a simple Desk sidebar icon that links straight to the ADMS dashboard.

    A second ``add_to_apps_screen`` entry can't surface a peer app-switcher icon:
    ``frappe.boot.load_desktop_data`` reads only the FIRST entry per installed
    app (``apps[0]``), so the ADMS tile is ignored in the Desk switcher. Instead
    ADMS gets its own URL-type Workspace — one click from the Desk sidebar to
    ``/adms``. Idempotent: safe to re-run on every migrate.
    """
    fields = {
        "title": NAME,
        "label": NAME,
        "type": "URL",
        "external_link": "/adms",
        "public": 1,
        "module": "Dewey Time",
        "app": APP,
        "icon": "tool",
        "indicator_color": "green",
        "content": "[]",
        "is_hidden": 0,
    }

    if frappe.db.exists("Workspace", NAME):
        doc = frappe.get_doc("Workspace", NAME)
        doc.update(fields)
        doc.save(ignore_permissions=True)
    else:
        frappe.get_doc({"doctype": "Workspace", **fields}).insert(ignore_permissions=True)

    frappe.clear_cache()
