import frappe

no_cache = 1


def get_context(context):
    # The SPA itself enforces ADMS-admin access via the token exchange, but
    # gate the shell too so Guests land on login instead of a broken page.
    if frappe.session.user in (None, "", "Guest"):
        frappe.local.flags.redirect_location = "/login?redirect-to=/adms"
        raise frappe.Redirect

    csrf_token = frappe.sessions.get_csrf_token()
    frappe.db.commit()

    context.update({"csrf_token": csrf_token})
    return context
