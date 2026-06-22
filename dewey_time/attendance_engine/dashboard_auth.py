"""ADMS dashboard token exchange.

The ADMS dashboard SPA (served from this site at /adms) authenticates with
the user's Frappe session — no separate Supabase login. On load it calls
get_dashboard_token(); we verify the session + role here, then exchange the
user's email server-to-server with the ADMS bridge, which checks its own
admin list and mints a short-lived data-plane token. The bridge URL and
shared secret live in site config (mirrors bridge_closeout_secret):

    bench --site <site> set-config adms_bridge_url https://<cloud-run-host>
    bench --site <site> set-config adms_bridge_secret <shared secret>

The secret never reaches the browser; only the minted token does.
"""

import json

import frappe
import requests
from frappe import _

# Dedicated, desk-less ADMS roles (ensured on migrate via after_migrate).
# Assign in Desk → User. 'ADMS Super Admin' → full ADMS access; 'ADMS Admin' →
# standard. System Manager deliberately does NOT grant access (it would let
# every Frappe sysadmin, incl. Administrator, into ADMS). The role drives the
# bridge: it auto-provisions the admin row, so there's no separate admin list
# to maintain for role holders.
ADMS_SUPER_ADMIN_ROLE = "ADMS Super Admin"
ADMS_ADMIN_ROLE = "ADMS Admin"
ALLOWED_ROLES = {ADMS_ADMIN_ROLE, ADMS_SUPER_ADMIN_ROLE}
EXCHANGE_TIMEOUT_SECONDS = 20


def ensure_adms_roles():
    """Idempotently ensure the dedicated ADMS roles exist (run on after_migrate).

    Desk-less roles assigned in Desk → User to grant /adms access. Holding a
    role auto-provisions the bridge admin row on first login (see
    get_dashboard_token). Self-healing: recreated if deleted.
    """
    for role_name in (ADMS_ADMIN_ROLE, ADMS_SUPER_ADMIN_ROLE):
        if not frappe.db.exists("Role", role_name):
            frappe.get_doc(
                {"doctype": "Role", "role_name": role_name, "desk_access": 0}
            ).insert(ignore_permissions=True)
    frappe.clear_cache()


@frappe.whitelist()
def get_dashboard_token():
    """Exchange the caller's Frappe session for an ADMS dashboard token."""
    if frappe.session.user in (None, "", "Guest"):
        frappe.throw(_("Login required"), frappe.AuthenticationError)

    roles = set(frappe.get_roles())
    if not (roles & ALLOWED_ROLES):
        frappe.throw(_("Not permitted to use the ADMS dashboard"), frappe.PermissionError)
    # Super-admin role wins; otherwise standard admin.
    app_role = "super_admin" if ADMS_SUPER_ADMIN_ROLE in roles else "admin"

    email = (
        frappe.db.get_value("User", frappe.session.user, "email")
        or frappe.session.user
    )

    bridge_url = (frappe.conf.get("adms_bridge_url") or "").rstrip("/")
    bridge_secret = frappe.conf.get("adms_bridge_secret")
    if not bridge_url or not bridge_secret:
        frappe.throw(
            _("ADMS bridge is not configured (adms_bridge_url / adms_bridge_secret)"),
        )

    try:
        response = requests.post(
            f"{bridge_url}/admin/auth/frappe-exchange",
            headers={
                "Content-Type": "application/json",
                "X-Bridge-Secret": bridge_secret,
            },
            data=json.dumps({"email": email, "app_role": app_role}),
            timeout=EXCHANGE_TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        frappe.log_error(title="ADMS token exchange unreachable")
        frappe.throw(_("ADMS bridge is unreachable"))

    if response.status_code == 403:
        frappe.throw(_("You are not registered as an ADMS admin"), frappe.PermissionError)
    if response.status_code != 200:
        # Never echo the secret or raw bridge internals to the browser.
        frappe.log_error(
            title="ADMS token exchange failed",
            message=f"HTTP {response.status_code}: {response.text[:500]}",
        )
        frappe.throw(_("ADMS token exchange failed"))

    payload = response.json()
    return {
        "token": payload.get("token"),
        "expires_in": payload.get("expires_in"),
        "email": payload.get("email"),
        "role": payload.get("role"),
    }
