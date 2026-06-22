"""Invariant oracle for the flag engine (the sandbox `verify` step).

Runs a battery of invariants over the AUTO-generated `Attendance Flag` rows and
emits findings as JSON. Two oracle layers:

  * crash oracle  — simply executing the queries against real (anonymized) data;
                    any exception surfaces as a failed `verify`.
  * invariant oracle — the pure functions below, each grounded in the engine's
                    actual control flow (attendance_engine/closeout.py +
                    intraday.py), not just plausible-sounding rules.

Each invariant is a PURE function (rows in, violating rows out) so it is unit
testable with no Frappe. `run()` is the only Frappe-touching part: it pulls the
rows + reference data and aggregates every invariant's hits into one findings
object, tagging each with its `invariant` name and a `kind`:

  * "contradiction" — the engine cannot produce this; a hit is almost certainly a bug.
  * "advisory"      — has a known-legitimate cause; a hit is worth a human look.

Run via: bench --site sandbox execute dewey_time.utils.sandbox_verify.run
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

import frappe


def no_duplicate_flags(rows: list[dict]) -> list[dict]:
    """contradiction: the engine deletes-then-recreates AUTO flags per
    (employee, date), so the same (employee, date, flag_code, day_closed) must
    never appear twice. A duplicate means a non-idempotent write or a race."""
    keys = Counter(
        (r["employee"], r["attendance_date"], r["flag_code"], r["day_closed"])
        for r in rows
    )
    return [
        {"employee": e, "attendance_date": d, "flag_code": f, "day_closed": c, "count": n}
        for (e, d, f, c), n in keys.items() if n > 1
    ]


# closeout._generate_for_employee_date takes exactly ONE of three early-return
# paths per pass, which partitions the punch-derived flags into these groups:
#   ABSENCE        — the `checkins_count == 0` path (on shift, zero punches)
#   OFF_SHIFT      — the holiday / `not on_shift` path (punches, but off shift)
#   ON_SHIFT_PUNCH — the on-shift-with-punches path (shift-boundary / site flags)
# Because each path returns before reaching the others, a single
# (employee, date, day_closed) must not carry flags from more than one group.
# ATTENDANCE_ISSUE / MISSING_LUNCH / MISSING_IN_OR_OUT / DELIVERY_FAILED /
# UNKNOWN_DEVICE_BRANCH are intentionally OUT of every group: record-issue flags
# are emitted in BOTH the zero-checkins and on-shift paths, so they legitimately
# cross groups and must not trip this invariant.
_EXCLUSION_GROUPS = {
    "ABSENCE": frozenset({"UNNOTIFIED_ABSENCE"}),
    "OFF_SHIFT": frozenset({"OFF_SHIFT_PUNCH"}),
    "ON_SHIFT_PUNCH": frozenset(
        {"LATE_START", "LEFT_EARLY", "MISSING_TIME", "LATE_FROM_LUNCH", "NON_PRIMARY_SITE_PUNCH"}
    ),
}
_CODE_TO_GROUP = {code: group for group, codes in _EXCLUSION_GROUPS.items() for code in codes}


def mutual_exclusion_violations(rows: list[dict]) -> list[dict]:
    """contradiction: flags from >1 path-partition group on the same
    (employee, date, day_closed). Scoped by day_closed because intraday (0) and
    closeout (1) are separate passes, each internally coherent."""
    groups_by_key: dict[tuple, set] = defaultdict(set)
    codes_by_key: dict[tuple, set] = defaultdict(set)
    for r in rows:
        group = _CODE_TO_GROUP.get(r["flag_code"])
        if not group:
            continue
        key = (r["employee"], r["attendance_date"], r["day_closed"])
        groups_by_key[key].add(group)
        codes_by_key[key].add(r["flag_code"])
    out = []
    for key, groups in groups_by_key.items():
        if len(groups) >= 2:
            employee, attendance_date, day_closed = key
            out.append({
                "employee": employee,
                "attendance_date": attendance_date,
                "day_closed": day_closed,
                "groups": sorted(groups),
                "flag_codes": sorted(codes_by_key[key]),
            })
    return out


def provisional_after_closeout(rows: list[dict]) -> list[dict]:
    """advisory: a day carrying BOTH provisional (day_closed=0) and final
    (day_closed=1) AUTO flags. Closeout deletes provisional rows when it
    finalises, and intraday deletes only its own day_closed=0 rows with no
    closed-day guard (intraday.py) — so this state arises when a late punch
    re-triggers intraday after closeout. Usually benign (late data), but worth a
    look: the HR view can show stale provisional flags over a finalised day."""
    states: dict[tuple, set] = defaultdict(set)
    codes: dict[tuple, dict] = defaultdict(lambda: defaultdict(set))
    for r in rows:
        key = (r["employee"], r["attendance_date"])
        states[key].add(r["day_closed"])
        codes[key][r["day_closed"]].add(r["flag_code"])
    out = []
    for (employee, attendance_date), day_closed_values in states.items():
        if 0 in day_closed_values and 1 in day_closed_values:
            out.append({
                "employee": employee,
                "attendance_date": attendance_date,
                "provisional_codes": sorted(codes[(employee, attendance_date)][0]),
                "final_codes": sorted(codes[(employee, attendance_date)][1]),
            })
    return out


def orphan_employee_flags(rows: list[dict], valid_employees: set) -> list[dict]:
    """contradiction: a flag referencing an Employee that does not exist.
    Anonymization is id-preserving, so a flag whose employee is absent from
    tabEmployee is a referential-integrity break (deleted employee, bad import)."""
    counts = Counter(r["employee"] for r in rows if r["employee"] not in valid_employees)
    return [{"employee": e, "flag_count": n} for e, n in counts.items()]


def unknown_flag_code(rows: list[dict], valid_codes: set) -> list[dict]:
    """contradiction: a flag_code outside the engine's declared AUTO_FLAG_CODES.
    Indicates schema drift or a stray write the detectors should never produce."""
    counts = Counter(r["flag_code"] for r in rows if r["flag_code"] not in valid_codes)
    return [{"flag_code": fc, "flag_count": n} for fc, n in counts.items()]


def run() -> str:
    rows = frappe.get_all(
        "Attendance Flag",
        filters={"source": "AUTO"},
        fields=["employee", "attendance_date", "flag_code", "day_closed"],
        limit_page_length=0,
    )
    valid_employees = set(frappe.get_all("Employee", pluck="name") or [])

    # Source the canonical code list from the engine itself (lazy import: keeps
    # this module's top level Frappe-only so the pure functions stay unit-testable).
    try:
        from dewey_time.attendance_engine.closeout import AUTO_FLAG_CODES
        valid_codes = set(AUTO_FLAG_CODES)
    except Exception:
        valid_codes = set()

    checks = [
        ("no_duplicate_flags", "contradiction", no_duplicate_flags(rows)),
        ("mutual_exclusion", "contradiction", mutual_exclusion_violations(rows)),
        ("provisional_after_closeout", "advisory", provisional_after_closeout(rows)),
        ("orphan_employee", "contradiction", orphan_employee_flags(rows, valid_employees)),
        # Skip when the code list could not be resolved, else everything reads as unknown.
        ("unknown_flag_code", "contradiction",
         unknown_flag_code(rows, valid_codes) if valid_codes else []),
    ]

    violations: list[dict] = []
    by_invariant: dict[str, int] = {}
    for name, kind, found in checks:
        by_invariant[name] = len(found)
        for v in found:
            violations.append({"invariant": name, "kind": kind, **v})

    findings = {
        "oracle": "invariant-suite",
        "scanned": len(rows),
        "employees_known": len(valid_employees),
        "by_invariant": by_invariant,
        "violations": violations,
    }
    print(json.dumps(findings, default=str))
    return f"VERIFY_OK violations={len(violations)}"
