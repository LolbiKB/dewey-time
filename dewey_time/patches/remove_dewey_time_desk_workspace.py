import frappe

NAME = "Dewey Time"


def execute():
    """Remove Desk workspace/sidebar/tile — app entry is add_to_apps_screen + /hr-attendance SPA only."""
    for doctype, name in (
        ("Desktop Icon", NAME),
        ("Workspace Sidebar", NAME),
        ("Workspace", NAME),
        ("Workspace", "HR Attendance Calendar"),
    ):
        if frappe.db.exists(doctype, name):
            frappe.delete_doc(doctype, name, force=1, ignore_permissions=True)

    frappe.clear_cache()
