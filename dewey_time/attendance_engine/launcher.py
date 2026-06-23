"""Home launcher resolver.

Assembles the per-user app-tile list for the /home launcher SPA. Gating here is
COSMETIC — each app's own route enforces real auth — so the policy is:
broad apps fail-open, admin apps fail-closed (see _visible).
"""

import frappe
from frappe import _

from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES as ADMS_ROLES
from dewey_time.attendance_engine.hr_calendar import (
    _employee_linked_to_user,
    _is_hr_staff,
)
from dewey_time.utils.sync_hr_attendance_assets import SITE_FAVICON_LOGO

_BROAD = "broad"
_ADMIN = "admin"


def _can_see_hr() -> bool:
    return bool(_is_hr_staff() or _employee_linked_to_user())


def _can_see_adms() -> bool:
    return bool(set(frappe.get_roles()) & ADMS_ROLES)


def _has_desk_access(roles=None) -> bool:
    """True if any of the user's roles enables Desk access (Role.desk_access=1).

    Role-field based (matches how this app reasons about desk-less roles). The
    framework alternative is `frappe.get_user().has_desk_access()`.
    """
    roles = roles if roles is not None else frappe.get_roles()
    if not roles:
        return False
    return bool(
        frappe.get_all(
            "Role",
            filters={"name": ["in", list(roles)], "desk_access": 1},
            limit=1,
        )
    )


# Gate + fail-policy per curated app (keyed by add_to_apps_screen `name`).
_APP_GATES = {
    "dewey_time": {"gate": _can_see_hr, "policy": _BROAD},
    "adms": {"gate": _can_see_adms, "policy": _ADMIN},
}


def _visible(gate, policy: str) -> bool:
    try:
        return bool(gate())
    except Exception:
        frappe.log_error(title="launcher gate error")
        return policy == _BROAD  # fail-open for broad, fail-closed for admin


def _initials(full_name: str) -> str:
    parts = (full_name or "").split()
    return ("".join(p[0] for p in parts[:2]).upper()) or "?"


def _user_image() -> str | None:
    try:
        emp = _employee_linked_to_user()
        if emp:
            img = frappe.db.get_value("Employee", emp, "image")
            if img:
                return img
        return frappe.db.get_value("User", frappe.session.user, "user_image") or None
    except Exception:
        frappe.log_error(title="launcher user image lookup failed")
        return None


@frappe.whitelist()
def get_launcher():
    """Return the current user's launcher tiles + greeting."""
    if frappe.session.user in (None, "", "Guest"):
        frappe.throw(_("Login required"), frappe.AuthenticationError)

    full_name = frappe.utils.get_fullname(frappe.session.user) or frappe.session.user
    user = {"full_name": full_name, "initials": _initials(full_name), "image_url": _user_image()}

    apps = []
    try:
        entries = frappe.get_hooks("add_to_apps_screen", app_name="dewey_time") or []
        for entry in entries:
            cfg = _APP_GATES.get(entry.get("name"))
            if not cfg:
                continue  # curated: skip apps without a known gate
            if _visible(cfg["gate"], cfg["policy"]):
                apps.append({
                    "name": entry["name"],
                    "title": entry["title"],
                    "route": entry["route"],
                    "logo": entry["logo"],
                    "admin": cfg["policy"] == _ADMIN,
                })
        # Synthesized Desk tile (not a dewey_time app entry).
        if _visible(_has_desk_access, _ADMIN):
            apps.append({
                "name": "desk",
                "title": "Frappe Desk",
                "route": "/desk",
                "logo": SITE_FAVICON_LOGO,
                "admin": True,
            })
    except Exception:
        frappe.log_error(title="get_launcher failed")  # never 500 the front door

    return {"user": user, "apps": apps}
