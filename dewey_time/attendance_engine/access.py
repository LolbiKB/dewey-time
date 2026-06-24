"""Access & roles overview + tile role-picker APIs (System-Manager-gated).

Read-only roster of who holds the Dewey roles and who lands on /home, plus the
server-side writer for a Launcher Tile's visible_to_roles (the 'roles' gate).
"""

import json
from collections import defaultdict

import frappe

from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES as ADMS_ROLES
from dewey_time.attendance_engine.hr_calendar import HR_STAFF_ROLES

_PSEUDO_ROLES = {"Administrator", "Guest", "All"}
_LANDING_VALUE = "home"


@frappe.whitelist()
def get_assignable_roles():
    frappe.only_for("System Manager")
    roles = frappe.get_all("Role", filters={"disabled": 0}, pluck="name")
    return [r for r in roles if r not in _PSEUDO_ROLES]


@frappe.whitelist()
def get_tile_roles(tile):
    frappe.only_for("System Manager")
    return frappe.get_all("Launcher Tile Role", filters={"parent": tile}, pluck="role")


@frappe.whitelist()
def set_tile_roles(tile, roles):
    frappe.only_for("System Manager")
    if isinstance(roles, str):
        roles = json.loads(roles or "[]")
    doc = frappe.get_doc("Launcher Tile", tile)
    doc.set("visible_to_roles", [{"role": r} for r in roles])
    doc.save(ignore_permissions=True)
    return {"tile": tile, "roles": list(roles)}


@frappe.whitelist()
def get_access_overview():
    frappe.only_for("System Manager")
    hr_roles = set(HR_STAFF_ROLES)
    adms_roles = set(ADMS_ROLES)
    landing_roles = set(
        frappe.get_all(
            "Role",
            filters={"home_page": ["in", [_LANDING_VALUE, "/" + _LANDING_VALUE]]},
            pluck="name",
        )
    )
    interesting = hr_roles | adms_roles | landing_roles

    by_user = defaultdict(set)
    for row in frappe.get_all(
        "Has Role",
        filters={"role": ["in", list(interesting)]},
        fields=["parent", "role"],
    ):
        by_user[row["parent"]].add(row["role"])

    if not by_user:
        return {"users": []}

    info = {
        u["name"]: u
        for u in frappe.get_all(
            "User",
            filters={"name": ["in", list(by_user)], "enabled": 1},
            fields=["name", "full_name", "user_type"],
        )
    }

    users = []
    for user, uroles in by_user.items():
        u = info.get(user)
        if not u:
            continue  # disabled user
        users.append({
            "user": user,
            "full_name": u.get("full_name") or user,
            "hr": bool(uroles & hr_roles),
            "adms": bool(uroles & adms_roles),
            "desk": u.get("user_type") == "System User",
            "lands_on_home": bool(uroles & landing_roles),
            "roles": sorted(uroles & interesting),
        })
    users.sort(key=lambda r: r["full_name"].lower())
    return {"users": users}
