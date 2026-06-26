"""Dewey Time's own launcher-tile visibility gates.

These predicates encode product knowledge (HR staff, linked employees, ADMS
roles) that the launcher resolver must NOT know about. The resolver reaches them
only by dotted path (see the `dewey_launcher_tiles` hook), so when the launcher
moves to dewey_portal in Phase 2 these gates stay here, with the product that
owns them.

Each gate is a zero-arg callable returning bool. They are cheap and
side-effect-free; the resolver wraps them with fail-open/fail-closed policy.
"""

import frappe

from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES as ADMS_ROLES
from dewey_time.attendance_engine.hr_calendar import (
    _employee_linked_to_user,
    _is_hr_staff,
)


def can_see_attendance() -> bool:
    """Visible to HR staff and to any user linked to an Employee."""
    return bool(_is_hr_staff() or _employee_linked_to_user())


def can_see_adms() -> bool:
    """Visible to holders of an ADMS role."""
    return bool(set(frappe.get_roles()) & ADMS_ROLES)
