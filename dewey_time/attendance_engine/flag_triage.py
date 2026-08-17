"""Additive triage ranking for Attendance Flag rows, computed on read.

Pure arithmetic over a `flag_code` string and an `evidence` dict — no I/O, and no
`import frappe` anywhere in this file. That is deliberate, not incidental: Global
Constraint 4 of this plan forbids changing `severity`, either `FLAG_SEVERITY` dict, or
any of their existing consumers (`attendance_flag.py:6-20`, `closeout.py:61-75`, pinned
equal by `test_the_two_severity_maps_agree` in `test_closeout.py`). `triage_rank` is a
*second*, additive dimension that the queue API computes fresh on every read and never
persists anywhere — it exists precisely because `severity` cannot express some
orderings HR needs: LATE_START and OFF_SHIFT_PUNCH are both `WARNING`, yet the spec
ranks a device-outage punch above a routine late start (see
`test_off_shift_punch_outranks_late_start_despite_equal_severity` in the test module).
Keeping this module frappe-free means it is trivially unit-testable with zero mocking
and cannot, even by accident, touch a doctype or the database.

Table transcribed verbatim from
docs/superpowers/specs/2026-08-05-hr-flag-management-design.md,
"Triage ranking — additive, computed on read".
"""

from __future__ import annotations

TIER_ACT = "act"
TIER_REVIEW = "review"
TIER_ROUTINE = "routine"

# Flag codes whose rank doesn't depend on evidence at all.
_FIXED_RANKS = {
    "UNNOTIFIED_ABSENCE": 150,
    "ATTENDANCE_ISSUE": 140,
    "MISSING_IN_OR_OUT": 140,
    "OFF_SHIFT_PUNCH": 50,
    "DELIVERY_FAILED": 50,
    "UNKNOWN_DEVICE_BRANCH": 50,
    "NON_PRIMARY_SITE_PUNCH": 10,
    "MISSING_LUNCH": 5,
}


def _minutes(evidence) -> int | None:
    """Best-effort int `minutes` out of an evidence dict, else None.

    None covers every way the spec's "missing or unparseable" can show up: `evidence`
    isn't a dict at all (e.g. None, or a raw JSON string `flag_identity.parse_evidence`
    hasn't touched yet), the "minutes" key is absent, or its value isn't numeric.
    Every caller below treats None the same as "below the lowest threshold" — never a
    top band — because a value we cannot read is not evidence of urgency.

    TOTAL by design: it returns None rather than raising for every input. `minutes`
    comes out of a JSON column and json.loads accepts the bare tokens NaN, Infinity
    and -Infinity, so a malformed row really can hold a non-finite float — and int()
    raises ValueError on NaN and OverflowError on an infinity, on BOTH branches below.
    This function sits on the queue read path, which ranks every flag in a range in
    one pass, so a raised exception here 500s the whole queue for every employee
    instead of degrading the one unreadable flag to its lowest band.
    """
    if not isinstance(evidence, dict):
        return None
    value = evidence.get("minutes")
    if isinstance(value, (int, float)):
        try:
            return int(value)
        except (ValueError, OverflowError):
            return None
    if isinstance(value, str):
        try:
            return int(float(value))
        except (ValueError, OverflowError):
            return None
    return None


def _missing_time_band(minutes: int | None) -> int:
    """The MISSING_TIME banding, shared with the provisional no-show.

    Two bands: >=120 min scales up through act (130-139); everything else --
    0-119, and a missing or unparseable value -- collapses to the single
    review band at 60.
    """
    if minutes is not None and minutes >= 120:
        return 130 + min(minutes // 60, 9)
    return 60


def triage_rank(flag_code: str, evidence) -> int:
    """Additive rank, computed on read. Never stored. Unknown code -> 5."""
    # A no-show the day has not confirmed is not the 150 a closed-out one is.
    # It stands in for MISSING_TIME rows that ranked 60 until two hours had
    # elapsed, and promoting it to the top of act at 31 minutes would put
    # someone who walks in at 08:45 above every real ATTENDANCE_ISSUE until
    # they badge.
    #
    # NO_CHECKIN_YET is the code intraday writes for this now. It is banded the
    # same way rather than given a _FIXED_RANK, because "nobody has arrived" at
    # 31 minutes and at four hours are not the same finding and the queue has to
    # order them apart.
    if flag_code == "NO_CHECKIN_YET":
        return _missing_time_band(_minutes(evidence))

    # LEGACY ONLY, and deliberately kept. Intraday stopped writing provisional
    # UNNOTIFIED_ABSENCE rows, but every site has some already in the table and
    # they stay visible until the first intraday pass after deploy deletes them.
    # Removing this branch would spike them all to 150 for that window --
    # top of act, above every confirmed finding -- which is the exact failure
    # the branch was added to prevent. Safe to delete once no provisional
    # UNNOTIFIED_ABSENCE rows remain.
    if flag_code == "UNNOTIFIED_ABSENCE" and isinstance(evidence, dict) and evidence.get(
        "provisional"
    ):
        return _missing_time_band(_minutes(evidence))

    if flag_code in _FIXED_RANKS:
        return _FIXED_RANKS[flag_code]

    minutes = _minutes(evidence)

    if flag_code == "MISSING_TIME":
        # Two bands total: >=120 min scales up through Act (130-139 via
        # 130 + min(minutes // 60, 9)); everything else — 0-119 min, and a
        # missing/unparseable `minutes` — collapses into the single Review band
        # (60). 60 already *is* "the lowest band for this code": there is no
        # separate below-30 band to fall to, so 29 min lands here too.
        return _missing_time_band(minutes)

    if flag_code == "LEFT_EARLY":
        return 70 if minutes is not None and minutes >= 60 else 25

    if flag_code == "LATE_START":
        return 65 if minutes is not None and minutes >= 60 else 20

    if flag_code == "LATE_FROM_LUNCH":
        return 55 if minutes is not None and minutes >= 30 else 15

    return 5


def tier_for_rank(rank: int) -> str:
    """rank >= 100 -> "act"; rank >= 50 -> "review"; else "routine"."""
    if rank >= 100:
        return TIER_ACT
    if rank >= 50:
        return TIER_REVIEW
    return TIER_ROUTINE
