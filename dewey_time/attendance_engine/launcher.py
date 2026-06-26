"""Home launcher resolver.

Assembles the per-user app-tile list for the /home launcher SPA. Gating here is
COSMETIC — each app's own route enforces real auth — so the policy is:
broad tiles fail-open, admin tiles fail-closed (see _visible).

Tiles are registered by apps via the `dewey_launcher_tiles` hook and reconciled
into the Launcher Tile DocType (see launcher_sync.py). A tile's `gate` is either
a built-in name (desk, roles) or a dotted path to a `() -> bool` callable owned
by the registering app — so this resolver knows no product internals for gating.
"""

import frappe
from frappe import _

# Sole remaining product dependency: the employee-photo avatar lookup. Cleaned up
# in Phase 2 when the resolver relocates to dewey_portal.
from dewey_time.attendance_engine.hr_calendar import _employee_linked_to_user

_BROAD = "broad"
_ADMIN = "admin"


def _has_desk_access(roles=None) -> bool:
    """True if any of the user's roles enables Desk access (Role.desk_access=1)."""
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


def _can_see_by_roles(tile_name: str) -> bool:
    wanted = {
        r["role"]
        for r in frappe.get_all(
            "Launcher Tile Role", filters={"parent": tile_name}, fields=["role"]
        )
    }
    return bool(wanted & set(frappe.get_roles()))


def _predicate(gate: str, tile_name: str):
    """Resolve a tile's `gate` to a zero-arg bool predicate, or None to skip.

    - built-in `desk`/`roles` → the generic predicates here
    - dotted path (contains '.') → frappe.get_attr(path), an app-owned callable
    - anything else → None (unknown gate → tile skipped, curated safety)
    """
    if gate == "desk":
        return _has_desk_access
    if gate == "roles":
        return lambda: _can_see_by_roles(tile_name)
    if gate and "." in gate:
        return lambda: bool(frappe.get_attr(gate)())
    return None


def _visible(predicate, policy: str) -> bool:
    try:
        return bool(predicate())
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
            predicate = _predicate(t.get("gate"), t["name"])
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
