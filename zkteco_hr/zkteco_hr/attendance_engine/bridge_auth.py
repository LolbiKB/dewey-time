"""Bridge webhook authentication (API key + optional shared secret)."""

import frappe
from frappe import _
from frappe.utils.password import check_password


def validate_bridge_request():
    """
    Authenticate bridge callers via Authorization: token api_key:api_secret.
    Optionally enforce X-Bridge-Secret when site config bridge_closeout_secret is set.
    """
    _validate_api_key_auth()
    _validate_bridge_secret()


def _validate_api_key_auth():
    # Always validate the Bridge API key. These are allow_guest=True machine
    # webhooks, so an ambient browser session must NOT satisfy auth — otherwise
    # any logged-in user could drive device closeout/sync. The Bridge always
    # sends the token header, so requiring it here does not affect it.
    authorization = (frappe.get_request_header("Authorization") or "").strip()
    if not authorization.lower().startswith("token "):
        frappe.throw(_("Authorization header token api_key:api_secret is required"), frappe.AuthenticationError)

    token = authorization[6:].strip()
    if ":" not in token:
        frappe.throw(_("Invalid Authorization token format"), frappe.AuthenticationError)

    api_key, api_secret = token.split(":", 1)
    user = frappe.db.get_value("User", {"api_key": api_key}, ["name", "api_secret"], as_dict=True)
    if not user or not user.api_secret:
        frappe.throw(_("Invalid API key"), frappe.AuthenticationError)

    if not check_password(user.api_secret, api_secret):
        frappe.throw(_("Invalid API secret"), frappe.AuthenticationError)

    frappe.set_user(user.name)


def _validate_bridge_secret():
    expected = frappe.conf.get("bridge_closeout_secret")
    if not expected:
        return

    provided = frappe.get_request_header("X-Bridge-Secret")
    if provided != expected:
        frappe.throw(_("Invalid bridge secret"), frappe.AuthenticationError)
