import frappe

ROLE_NAME = "ADMS Admin"


def execute():
    """Create the ADMS Admin role (website-only) used by the /adms dashboard gate.

    Holders may exchange their Frappe session for an ADMS dashboard token
    (dashboard_auth.get_dashboard_token); the bridge admin list remains the
    second, per-person gate. desk_access stays 0 — the SPA is their whole UI.
    """
    if frappe.db.exists("Role", ROLE_NAME):
        return

    frappe.get_doc(
        {
            "doctype": "Role",
            "role_name": ROLE_NAME,
            "desk_access": 0,
        }
    ).insert(ignore_permissions=True)
    frappe.clear_cache()
