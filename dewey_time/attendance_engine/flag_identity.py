"""Pure identity + fingerprint math for Attendance Flag rows.

`Attendance Flag` documents are hard-deleted and rebuilt by the flag engine on
every punch and every closeout (see `intraday.py`, `closeout.py`) -- their
`name` is therefore useless as a foreign key from `Attendance Flag Decision`,
and doubly so because a provisional row's name carries a `-prov` suffix that
a finalised row for the same employee/date/code does not
(`attendance_flag.py:53-71`). `flag_identity()` recomputes a stable key from
the flag's *content* instead, so a decision recorded against a provisional
flag still applies once closeout replaces it with a final one sharing the
same identity.

This module has NO frappe import and does no I/O -- it is pure functions
over plain values, importable and unit-testable without a live bench (same
shape as `shift_grace.py`, whose pure helpers are tested in
`test_shift_grace.py` with no frappe mock at all -- see that file before
assuming every backend test needs `_install_frappe_mock()`).

Deliberate differences from `attendance_flag.py`'s `before_insert` /
`_*_key` helpers, which this module mirrored in spirit but never called.

Those helpers are gone as of T3-11 (2026-08-11), and this module is now the
only key scheme in the app. It kept three deliberate differences from them,
recorded because each is a decision rather than an accident:

- `day_closed` is excluded from the key entirely (no `-prov` marker). A
  provisional flag and the final flag that replaces it at closeout therefore
  share one identity -- that is the whole point of this module existing.
- The `DELIVERY_FAILED` suffix is capped at `[:80]` like its `MISSING_TIME`
  and `ATTENDANCE_ISSUE` siblings. The controller's `_delivery_failed_key`
  left it uncapped, a truncation-collision window on long
  `custom_supabase_log_id` values; this module closed it rather than
  reproducing it. That uncapped version being the one that would have come
  back to life is part of why the naming was deleted instead of revived.
- There is no `[:140]` truncation. A Frappe docname is capped;
  `flag_identity` is an ordinary `Data` column on `Attendance Flag Decision`,
  not a name, so nothing caps it.
"""

from __future__ import annotations

import hashlib
import json

_DELIVERY_FAILED_EVIDENCE_KEYS = ("pin", "user_id", "supabase_log_id", "custom_supabase_log_id")


def _scrub(value) -> str:
    """Local stand-in for `frappe.scrub`: lowercase, spaces/hyphens -> underscores.

    Deliberately NOT a call to `frappe.scrub` -- this module must import and
    run without a live bench (see module docstring). Parity with frappe's
    own scrub is not required, only that every caller of `flag_identity()`
    agrees on the same transform for the same input: write-time
    (`flag_decision_api.py`, computing the identity to store on a new
    decision) and read-time (`flag_queue_api.py`, computing the identity of
    each live `Attendance Flag` to match decisions against) both import this
    same function, so they can never disagree with each other even if they
    disagreed with the real `frappe.scrub`.
    """
    return str(value).strip().lower().replace(" ", "_").replace("-", "_")


def parse_evidence(evidence) -> dict:
    """Normalise `Attendance Flag.evidence` to a dict.

    The field is stored as a JSON string on the doctype but is frequently
    handled already-decoded (e.g. a dict evidence payload built in-process
    by the engine before insert, or a test fixture). Accept `str | dict |
    None` and never raise or return `None`: an absent or unparseable
    payload becomes `{}`, so every caller can unconditionally `.get()` off
    the result instead of null-checking first.
    """
    if isinstance(evidence, dict):
        return evidence
    if isinstance(evidence, str) and evidence:
        try:
            parsed = json.loads(evidence)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def date_key(value) -> str:
    """A date column as "YYYY-MM-DD", for keys that must compare equal.

    The ONE normaliser for every date that is compared, grouped or hashed on
    across the flag queue: `flag_queue_api` builds the outage `(branch, date)`
    tuples and the decision code keys with it, and `flag_grouping` looks those
    tuples up with a raw membership test (`flag_grouping.py:191`) and compares
    the decision code keys in `_orphans`. Two implementations that drifted
    would produce zero outage groups and mis-classified orphans with no
    exception and no failing test, so both modules delegate here rather than
    each keeping their own copy.

    Slices rather than str()s so a datetime-typed column normalises to the same
    key its date-typed sibling would. `None` becomes "" (never "None"): an
    absent date must not collide with a real one under a plausible-looking key.
    """
    if value is None:
        return ""
    return str(value)[:10]


def _format_date(attendance_date) -> str:
    # Deliberately NOT date_key(): identity formatting strftimes date/datetime
    # objects, which is what lets `date(2026, 8, 3)`, `datetime(2026, 8, 3)` and
    # "2026-08-03" all produce one identity. It is a third normaliser in this
    # chain on purpose -- do not merge it into date_key(). The one input it
    # cannot rescue is a datetime-*shaped* string ("2026-08-03 00:00:00"), which
    # is precisely why callers that read dates off the driver run them through
    # date_key() before handing them to flag_identity().
    if hasattr(attendance_date, "strftime"):
        return attendance_date.strftime("%Y-%m-%d")
    return str(attendance_date)


def _delivery_failed_suffix(evidence: dict):
    # Mirrors attendance_flag.py:90-103: check the nested "undelivered" dict
    # first (the shape the delivery-failure path actually writes), then fall
    # back to the same keys at the top level of evidence.
    undelivered = evidence.get("undelivered")
    if isinstance(undelivered, dict):
        for key in _DELIVERY_FAILED_EVIDENCE_KEYS:
            value = undelivered.get(key)
            if value:
                return _scrub(value)[:80]
    for key in _DELIVERY_FAILED_EVIDENCE_KEYS:
        value = evidence.get(key)
        if value:
            return _scrub(value)[:80]
    return None


def _missing_time_suffix(evidence: dict):
    start = evidence.get("interval_start")
    if start:
        return _scrub(start)[:80]
    return None


def _attendance_issue_suffix(evidence: dict):
    # `reason` defaults to "issue" (mirrors attendance_flag.py:116), so this
    # never returns None for a dict payload -- even an empty one. The
    # scrub(flag_code) fallback in flag_identity() below only fires when
    # `evidence` itself didn't parse to a dict at all (parse_evidence
    # already folded that case to `{}` before this function ever sees it,
    # which is indistinguishable here from a genuinely empty dict -- an
    # accepted simplification, since ATTENDANCE_ISSUE evidence is always
    # engine-written and always a real dict in practice).
    reason = evidence.get("reason") or "issue"
    # `delivery_failed` is the one reason that writes no punch_time
    # (record_issue_flags.py:72-81 carries only reason + undelivered), so every
    # undelivered item in one closeout collapsed onto the identical suffix
    # "delivery_failed-". That is a docname collision as well as an identity
    # one: attendance_flag.py builds the AUTO name from this same pair, so the
    # second insert raised DuplicateEntryError, and closeout.py's flag loop has
    # no per-flag isolation -- the raise aborted every remaining flag for that
    # employee-day, silently. Falling back to the item's own identifier keeps
    # them distinct.
    #
    # Ordered `punch or delivery_key` on purpose: a reason that DOES carry
    # punch_time is untouched, so no existing identity moves except the
    # delivery-failure ones this fixes.
    punch = evidence.get("punch_time") or _delivery_failed_suffix(evidence) or ""
    return _scrub(f"{reason}-{punch}")[:80]


# code -> (literal suffix prefix, evidence -> key-or-None builder)
_SUFFIX_BUILDERS = {
    "DELIVERY_FAILED": ("delivery-failed", _delivery_failed_suffix),
    "MISSING_TIME": ("missing-time", _missing_time_suffix),
    "ATTENDANCE_ISSUE": ("attendance-issue", _attendance_issue_suffix),
}


def flag_identity(*, employee: str, attendance_date, flag_code: str, evidence) -> str:
    """Stable key for an AUTO Attendance Flag, independent of day_closed.

    Format: "AUTO-{scrub(employee)}-{YYYY-MM-DD}-{suffix}" -- no [:140]
    truncation. See the module docstring for the deliberate differences
    from `attendance_flag.py`'s `before_insert`, which this mirrors.
    """
    parsed = parse_evidence(evidence)
    suffix = None
    spec = _SUFFIX_BUILDERS.get(flag_code)
    if spec is not None:
        prefix, builder = spec
        key = builder(parsed)
        if key:
            suffix = f"{prefix}-{key}"
    if suffix is None:
        # Either flag_code isn't one of the three evidence-keyed codes, or
        # it is but the specific evidence key was absent -- same fallback
        # attendance_flag.py's before_insert uses (`:39`, before any of the
        # elif branches run).
        suffix = _scrub(flag_code)
    return "AUTO-{0}-{1}-{2}".format(_scrub(employee), _format_date(attendance_date), suffix)


def evidence_fingerprint(evidence) -> str:
    """32 lowercase hex chars, sha256 over {"minutes", "reason"} only.

    Identity (`flag_identity`) deliberately ignores flag magnitude -- e.g.
    LATE_START's suffix is just "late_start" regardless of how many minutes
    late. The fingerprint is the staleness guard for that gap: a decision's
    stored fingerprint is compared against the live flag's on every read
    (`flag_queue_api.py`), and a mismatch demotes the decision to
    `needs_re_review` instead of silently applying an "excused 6 minutes
    late" decision to a punch later corrected to 90 minutes late. Codes
    carrying neither key (e.g. UNNOTIFIED_ABSENCE) hash a constant
    {"minutes": None, "reason": None} payload and so can never go stale --
    correct for a binary flag with no magnitude to drift.
    """
    parsed = parse_evidence(evidence)
    payload = {"minutes": parsed.get("minutes"), "reason": parsed.get("reason")}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:32]
