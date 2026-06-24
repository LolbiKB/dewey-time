"""Role-based post-login landing control for the /home launcher.

Sets Role.home_page = "home" (verified v16 value; get_home_page strips slashes)
so holders of a role land on /home after login. Because a per-user
default_workspace outranks Role.home_page in get_home_page(), enabling a role
also snapshots + nulls default_workspace for that role's System Users, and
disabling restores it. All writes clear the website cache so changes take
effect with no deploy (the kill-switch). Landing is applied at login, so
changes affect users' NEXT login, not active sessions.
"""

import json

import frappe
from frappe import _

_LANDING_VALUE = "home"
_SETTINGS = "Dewey Time Settings"
_SNAPSHOT_FIELD = "landing_workspace_snapshot"


def _clear_cache():
    # Deletes the per-user "home_page" Redis hash so the new landing is read.
    from frappe.website.utils import clear_cache
    clear_cache()


# Built-in pseudo-roles that should never be offered as a landing toggle.
_PSEUDO_ROLES = {"Administrator", "Guest", "All"}


def _assignable_roles():
    # Include custom roles (e.g. ADMS Admin) — only drop disabled + pseudo-roles.
    roles = frappe.get_all("Role", filters={"disabled": 0}, pluck="name")
    return [r for r in roles if r not in _PSEUDO_ROLES]


def _system_users_with_role(role):
    users = frappe.get_all("Has Role", filters={"role": role}, pluck="parent")
    if not users:
        return []
    return frappe.get_all(
        "User",
        filters={"name": ["in", users], "user_type": "System User", "enabled": 1},
        pluck="name",
    )


def _load_snapshot():
    raw = frappe.db.get_single_value(_SETTINGS, _SNAPSHOT_FIELD)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}


def _save_snapshot(snapshot):
    frappe.db.set_value(_SETTINGS, _SETTINGS, _SNAPSHOT_FIELD, json.dumps(snapshot))


def _user_has_other_landing_role(user, excluding_role):
    roles = frappe.get_all("Has Role", filters={"parent": user}, pluck="role")
    for r in roles:
        if r == excluding_role:
            continue
        if (frappe.db.get_value("Role", r, "home_page") or "").strip("/") == _LANDING_VALUE:
            return True
    return False


@frappe.whitelist()
def set_role_landing(role, enabled):
    frappe.only_for("System Manager")
    enabled = enabled in (True, 1, "1", "true", "True")
    if not frappe.db.exists("Role", role):
        frappe.throw(_("Unknown role"), frappe.DoesNotExistError)

    snapshot = _load_snapshot()
    users = _system_users_with_role(role)

    if enabled:
        for u in users:
            if u not in snapshot:
                snapshot[u] = frappe.db.get_value("User", u, "default_workspace") or ""
            frappe.db.set_value("User", u, "default_workspace", None)
        frappe.db.set_value("Role", role, "home_page", _LANDING_VALUE)
    else:
        frappe.db.set_value("Role", role, "home_page", "")
        for u in users:
            if _user_has_other_landing_role(u, role):
                continue
            if u in snapshot:
                frappe.db.set_value("User", u, "default_workspace", snapshot.pop(u) or None)

    _save_snapshot(snapshot)
    _clear_cache()
    return {"role": role, "enabled": enabled}


@frappe.whitelist()
def get_landing_state():
    frappe.only_for("System Manager")
    roles = []
    for role in _assignable_roles():
        on = (frappe.db.get_value("Role", role, "home_page") or "").strip("/") == _LANDING_VALUE
        roles.append({
            "role": role,
            "enabled": on,
            "user_count": len(_system_users_with_role(role)),
        })
    masks = {
        "portal_home": frappe.db.get_single_value("Portal Settings", "default_portal_home") or None,
        "home_page_hook": bool(frappe.get_hooks("home_page")),
        "default_app": frappe.db.get_single_value("System Settings", "default_app") or None,
    }
    return {
        "roles": roles,
        "masks": masks,
        "note": "Landing applies at next login; active sessions are unaffected.",
    }
