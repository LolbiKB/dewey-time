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

# "ADMS Admin" is a custom website-only role created by
# patches.add_adms_admin_role — assign it in Desk → User instead of handing
# out System Manager. The bridge admin list is still the second gate.
ALLOWED_ROLES = {"System Manager", "ADMS Admin"}
EXCHANGE_TIMEOUT_SECONDS = 20


@frappe.whitelist()
def get_dashboard_token():
    """Exchange the caller's Frappe session for an ADMS dashboard token."""
    if frappe.session.user in (None, "", "Guest"):
        frappe.throw(_("Login required"), frappe.AuthenticationError)

    if not (set(frappe.get_roles()) & ALLOWED_ROLES):
        frappe.throw(_("Not permitted to use the ADMS dashboard"), frappe.PermissionError)

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
            data=json.dumps({"email": email}),
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
