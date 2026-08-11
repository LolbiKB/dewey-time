"""Bucket classification for the biometric enrollment register.

Deliberately imports no frappe: all four states are then testable without a
database, which is where the logic risk in this feature actually lives.
"""

from __future__ import annotations

#: An active employee with no biometric template. The worklist.
NEEDS_ENROLLMENT = "NEEDS_ENROLLMENT"
#: A template exists but produced no check-ins in the window: a bad enrollment,
#: or a long absence. Distinct from having no template at all.
ENROLLED_NOT_PUNCHING = "ENROLLED_NOT_PUNCHING"
#: Enrolled and producing check-ins. Nothing to do.
OK = "OK"
#: Left the company, template still live on the device. A security finding.
LEAVER_STILL_ENROLLED = "LEAVER_STILL_ENROLLED"

#: Employee statuses the report covers. "Inactive" and "Suspended" are excluded:
#: neither is a state where "should this person be able to clock in?" has an
#: obvious answer, and guessing would put unactionable rows in front of HR.
REPORTED_STATUSES = ("Active", "Left")


def classify(*, status: str, is_registered: bool, checkin_count: int) -> str | None:
    """The bucket for one employee, or None when they are out of population.

    The status test comes FIRST and deliberately so. Testing the Left branch
    ensures a registered leaver returns LEAVER_STILL_ENROLLED instead of OK
    (which would happen if the Left branch were deleted). Without the Left
    branch, an unregistered leaver also becomes NEEDS_ENROLLMENT instead of
    None, a false worklist entry.
    """
    if status not in REPORTED_STATUSES:
        return None

    if status == "Left":
        return LEAVER_STILL_ENROLLED if is_registered else None

    if not is_registered:
        return NEEDS_ENROLLMENT

    return OK if checkin_count > 0 else ENROLLED_NOT_PUNCHING


def days_since(relieving_date, today) -> int | None:
    """Whole days from relieving_date to today, or None when it is unknown.

    None rather than 0: a missing relieving date must not render as "left
    today". Callers omit the count instead of fabricating one. A future date
    clamps to 0 rather than going negative.
    """
    if not relieving_date:
        return None
    return max(0, (today - relieving_date).days)
