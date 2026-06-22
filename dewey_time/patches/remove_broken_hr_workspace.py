import frappe


def execute():
    """Remove legacy Workspace fixture that breaks Frappe v16 sidebar."""
    name = "HR Attendance Calendar"
    if frappe.db.exists("Workspace", name):
        frappe.delete_doc("Workspace", name, force=1, ignore_permissions=True)
