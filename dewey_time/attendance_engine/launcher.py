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


# Built-in gate predicates, keyed by the Launcher Tile `gate` Select value.
# These are looked up at call time (not closure-captured) so unit-test patches
# on mod._can_see_hr / mod._has_desk_access are honoured.
def _gate_hr():
    return _can_see_hr()


def _gate_adms():
    return _can_see_adms()


def _gate_desk():
    return _has_desk_access()


_GATE_FUNCS = {
    "hr_or_employee": _gate_hr,
    "adms": _gate_adms,
    "desk": _gate_desk,
}


def _can_see_by_roles(tile_name: str) -> bool:
    wanted = {
        r["role"]
        for r in frappe.get_all(
            "Launcher Tile Role", filters={"parent": tile_name}, fields=["role"]
        )
    }
    return bool(wanted & set(frappe.get_roles()))


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
    user = {
        "full_name": full_name,
        "initials": _initials(full_name),
        "image_url": _user_image(),
        "can_manage_tiles": "System Manager" in set(frappe.get_roles()),
    }

    apps = []
    try:
        tiles = frappe.get_all(
            "Launcher Tile",
            filters={"enabled": 1},
            fields=["name", "app_name", "title", "route", "icon", "is_admin", "gate"],
            order_by="tile_order asc",
        )
        for t in tiles:
            policy = _ADMIN if t.get("is_admin") else _BROAD
            gate = t.get("gate")
            if gate == "roles":
                predicate = (lambda name: lambda: _can_see_by_roles(name))(t["name"])
            else:
                predicate = _GATE_FUNCS.get(gate)
                if predicate is None:
                    continue  # unknown gate → skip (curated safety)
            if _visible(predicate, policy):
                apps.append({
                    "name": t["app_name"],
                    "title": t["title"],
                    "route": t["route"],
                    "logo": t.get("icon") or "",
                    "admin": bool(t.get("is_admin")),
                })
    except Exception:
        frappe.log_error(title="get_launcher failed")  # never 500 the front door

    return {"user": user, "apps": apps}
