"""Which rollout phase an employee-day belongs to.

The flag engine had no notion of when it went live: point it at any date and it
judged that day, including punches imported from the device history, from before
anyone was told the rules. This module is the single owner of every date
comparison that answers "was the system watching?".

Three phases, resolved from the day's OWN attendance_date and never from "now".
That is load-bearing, not incidental: intraday deletes and re-inserts AUTO flags
on every single checkin (intraday.on_employee_checkin_after_insert), so a phase
derived from the current date would silently re-label the whole pilot window the
moment go-live passed. Derived from attendance_date, regeneration is idempotent.
"""
from __future__ import annotations

from datetime import date as _date

import frappe
from frappe.utils import getdate

PRELAUNCH = "PRELAUNCH"
TESTING = "TESTING"
LIVE = "LIVE"

SETTINGS = "Dewey Time Settings"


def _as_date(value):
    """getdate(), but None for anything that is not date-shaped.

    The isinstance check is load-bearing, not defensive padding. On a real bench,
    `frappe.utils.getdate(falsy)` returns TODAY, not None. Without this guard, an
    unset `rollout_testing_start` (None) would read as "testing starts today":
    every historical day PRELAUNCH, every future day TESTING -- the exact inverse
    of the intended "no dates set" = LIVE default.

    The same gap also breaks every test in this suite, which runs against a
    MagicMock installed as `frappe`: an unconfigured `frappe.get_cached_doc(SETTINGS)`
    returns a MagicMock whose every attribute is truthy AND whose `__lt__` returns a
    truthy MagicMock, so without this guard such a mock reads as "a cutoff is set,
    and every date falls before it" -- every day PRELAUNCH, and the whole engine
    suite red for a reason unrelated to the code.

    With the guard, both an unset production date and an unconfigured mock read as
    "no dates set" = LIVE -- the behaviour this module, and its tests, both require.

    datetime is a subclass of date, so the two-member tuple covers it.
    """
    if not isinstance(value, (_date, str)):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return getdate(value)


def _settings_doc():
    return frappe.get_cached_doc(SETTINGS)


def rollout_dates_for_branch(branch: str | None) -> tuple:
    """(testing_start, go_live) governing `branch`, normalised to dates or None.

    A branch row is used WHOLE. A row with a blank `go_live` means "the pilot is
    still open for this branch" -- it does NOT fall back to the global `go_live`.
    Partial inheritance would make a blank field mean two different things
    depending on the global config.

    A falsy branch resolves straight to the global pair, and that is the primary
    path rather than a fallback: hr_calendar.py:779 records that a great many
    employees have no branch set.
    """
    settings = _settings_doc()
    if branch:
        for row in getattr(settings, "branch_rollout", None) or []:
            if getattr(row, "branch", None) == branch:
                return (
                    _as_date(getattr(row, "testing_start", None)),
                    _as_date(getattr(row, "go_live", None)),
                )
    return (
        _as_date(getattr(settings, "rollout_testing_start", None)),
        _as_date(getattr(settings, "rollout_go_live", None)),
    )


def phase_for(*, branch: str | None, attendance_date) -> str:
    """PRELAUNCH / TESTING / LIVE for one branch-day.

    Unset dates mean LIVE -- the system behaves exactly as it did before this
    module existed. That is the only safe upgrade default.

    Boundaries, stated so there is nothing to interpret: the day equal to
    testing_start is TESTING; the day equal to go_live is LIVE.
    """
    testing_start, go_live = rollout_dates_for_branch(branch)
    if testing_start is None:
        return LIVE
    day = _as_date(attendance_date)
    if day is None:
        raise ValueError(
            "phase_for requires an attendance_date; "
            "a falsy one would resolve to today"
        )
    if day < testing_start:
        return PRELAUNCH
    if go_live is None or day < go_live:
        return TESTING
    return LIVE


def branch_for_employee(employee: str) -> str | None:
    """One reader, so the refusal path and the stamp path cannot disagree about
    which branch governs an employee."""
    return frappe.get_cached_value("Employee", employee, "branch")


def phase_for_employee(*, employee: str, attendance_date) -> str:
    return phase_for(
        branch=branch_for_employee(employee), attendance_date=attendance_date
    )


def phases_configured() -> bool:
    """Whether any rollout date is set anywhere.

    False means the feature is dormant and the system behaves exactly as it did
    before it existed -- which is what the queue payload reports so Phase B can
    render no banner at all rather than an empty one.
    """
    settings = _settings_doc()
    if _as_date(getattr(settings, "rollout_testing_start", None)):
        return True
    for row in getattr(settings, "branch_rollout", None) or []:
        if _as_date(getattr(row, "testing_start", None)):
            return True
    return False
