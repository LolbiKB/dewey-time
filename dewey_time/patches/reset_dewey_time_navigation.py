import frappe


def execute():
    """
    Clear stale/broken navigation records.

    Frappe v16 sidebar can crash if Workspace Sidebar items reference entities
    that don't exist or resolve incorrectly (e.g. Page links treated as Workspaces).
    """
    for dt, name in [
        ("Workspace Sidebar", "Dewey Time"),
        ("Workspace", "Dewey Time"),
        ("Workspace", "HR Attendance Calendar"),
    ]:
        if frappe.db.exists(dt, name):
            frappe.delete_doc(dt, name, force=1, ignore_permissions=True)

