import frappe


WORKSPACE_CONTENT = (
    '[{"type":"header","data":{"text":"Dewey Time","col":12}},'
    '{"type":"shortcut","data":{"shortcut_name":"Attendance Flag","label":"Attendance Flag",'
    '"link_to":"Attendance Flag","link_type":"DocType","color":"Orange","doc_view":"List","col":4}}]'
)


def execute():
    """Remove legacy Desk calendar pages and stale workspace shortcuts."""
    for page_name in ("hr-attendance-calendar", "hr-attendance-calendar-react"):
        if frappe.db.exists("Page", page_name):
            frappe.delete_doc("Page", page_name, force=1, ignore_permissions=True)

    if frappe.db.exists("Workspace", "Dewey Time"):
        workspace = frappe.get_doc("Workspace", "Dewey Time")
        workspace.content = WORKSPACE_CONTENT
        workspace.save(ignore_permissions=True)

    if frappe.db.exists("Workspace", "HR Attendance Calendar"):
        frappe.delete_doc("Workspace", "HR Attendance Calendar", force=1, ignore_permissions=True)
