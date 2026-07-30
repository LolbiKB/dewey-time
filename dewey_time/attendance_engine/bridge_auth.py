"""Bridge webhook authentication (API key, pinned principal, optional shared secret)."""

import frappe
from frappe import _
from frappe.utils.password import check_password

#: Desk-less role marking a User as an allowed Bridge caller. Created on
#: after_migrate (see ensure_bridge_role), assigned in Desk → User.
BRIDGE_ROLE = "Bridge Device"


def ensure_bridge_role():
    """Idempotently ensure the Bridge role exists (run on after_migrate).

    Mirrors ensure_adms_roles: desk-less, self-healing if deleted.
    """
    if not frappe.db.exists("Role", BRIDGE_ROLE):
        frappe.get_doc(
            {"doctype": "Role", "role_name": BRIDGE_ROLE, "desk_access": 0}
        ).insert(ignore_permissions=True)
        frappe.clear_cache()


def validate_bridge_request():
    """
    Authenticate bridge callers via Authorization: token api_key:api_secret.

    The caller must additionally BE a bridge principal — either the User named
    by site config `bridge_user`, or a User holding the `Bridge Device` role.
    Optionally enforces X-Bridge-Secret when site config bridge_closeout_secret
    is set.
    """
    _validate_api_key_auth()
    _validate_bridge_secret()


def _validate_api_key_auth():
    """Require a bridge API key on every request.

    There is deliberately NO "already authenticated, carry on" shortcut here.
    An earlier version returned early whenever frappe.session.user was not
    Guest, which meant any logged-in user — including an ordinary ESS employee
    with a browser session — passed bridge authentication without presenting a
    key at all, and could drive notify_device_closeout_status to write
    finalized (day_closed=1) flags for a whole device/date.

    Removing that shortcut also makes the key lookup below reachable for the
    first time, which is why the principal check is not optional: a valid
    api_key alone proves only that SOME user issued it, not that the caller is
    the Bridge.
    """
    authorization = (frappe.get_request_header("Authorization") or "").strip()
    if not authorization.lower().startswith("token "):
        frappe.throw(_("Authorization header token api_key:api_secret is required"), frappe.AuthenticationError)

    token = authorization[6:].strip()
    if ":" not in token:
        frappe.throw(_("Invalid Authorization token format"), frappe.AuthenticationError)

    api_key, api_secret = token.split(":", 1)
    user = frappe.db.get_value(
        "User", {"api_key": api_key, "enabled": 1}, ["name", "api_secret"], as_dict=True
    )
    if not user or not user.api_secret:
        frappe.throw(_("Invalid API key"), frappe.AuthenticationError)

    if not check_password(user.api_secret, api_secret):
        frappe.throw(_("Invalid API secret"), frappe.AuthenticationError)

    _assert_bridge_principal(user.name)
    frappe.set_user(user.name)


def _assert_bridge_principal(user: str):
    """Fail closed unless this User is designated as the Bridge.

    Two supported pins, checked in order:
      1. site config `bridge_user` — an explicit User name. Exact match.
      2. the `Bridge Device` role.

    With neither configured this raises, by design: an unpinned webhook that
    accepts any User's API key is the hole this function exists to close.
    """
    pinned = (frappe.conf.get("bridge_user") or "").strip()
    if pinned:
        if user != pinned:
            frappe.throw(_("API key is not the configured bridge user"), frappe.AuthenticationError)
        return

    if BRIDGE_ROLE not in set(frappe.get_roles(user)):
        frappe.throw(
            _(
                "This API key is not authorised for bridge webhooks. Grant the "
                "{0} role to the bridge user, or set bridge_user in site config."
            ).format(BRIDGE_ROLE),
            frappe.AuthenticationError,
        )


def _validate_bridge_secret():
    """Defence in depth, on top of the key + principal pin above.

    Still optional: making it mandatory would break any deployment whose Bridge
    has not been given the secret yet, and the principal check is now the
    primary control. Enforced strictly whenever it IS configured.
    """
    expected = frappe.conf.get("bridge_closeout_secret")
    if not expected:
        return

    provided = frappe.get_request_header("X-Bridge-Secret")
    if provided != expected:
        frappe.throw(_("Invalid bridge secret"), frappe.AuthenticationError)
