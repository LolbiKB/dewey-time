"""Person-dedup and cause grouping for the HR flag queue.

Pure module: no frappe import, no queries, no I/O. `flag_queue_api` owns every
read (its query budget is O(1) in employee count) and hands the result sets in as
plain dicts; everything here is a transformation over those dicts. That is what
lets the invariant this module exists to guarantee — a FLAG appears in exactly
one entry — be tested without a bench. A person may appear in more than one:
see `_entries_for`.

Spec: docs/superpowers/specs/2026-08-05-hr-flag-management-design.md, sections
"Triage ranking — additive, computed on read" and "Cause grouping — branch level".
"""

from __future__ import annotations

from dewey_time.attendance_engine.flag_identity import (
    date_key,
    evidence_fingerprint,
    parse_evidence,
)
from dewey_time.attendance_engine.flag_triage import (
    TIER_REVIEW,
    TIER_ROUTINE,
    tier_for_rank,
    triage_rank,
)

GROUP_BRANCH_NO_DEVICE_DATA = "BRANCH_NO_DEVICE_DATA"
GROUP_REPEAT_PATTERN = "REPEAT_PATTERN"
GROUP_ROUTINE_CODE = "ROUTINE_CODE"

STATE_UNDECIDED = "undecided"
STATE_MATCHED = "matched"
STATE_NEEDS_RE_REVIEW = "needs_re_review"

# A flag that still owes HR an answer. `needs_re_review` belongs here on purpose:
# per the spec a fingerprint mismatch means the decision is "not applied and not
# deleted; the flag re-enters the queue with its prior decision shown as
# context", so it must still rank its person and still keep that person from
# clearing the queue.
UNRESOLVED_STATES = (STATE_UNDECIDED, STATE_NEEDS_RE_REVIEW)

# Both cause groups are defined by people *sharing* a key ("employees sharing
# (Employee.branch, attendance_date)"). A one-member group card would bury a
# person row behind an expander and an all-checked member list for no gain, so a
# would-be group of one degrades back to a lone person entry.
GROUP_MIN_MEMBERS = 2

# The same code from the same person on this many distinct dates is a pattern.
# Judgement, not measurement (spec) — but nothing is persisted from it, so
# changing it later is free.
PATTERN_MIN_DAYS = 3

# Only the expected compresses. An act-tier flag is never bulk-excusable as a
# habit: "three no-shows in a fortnight is not a pattern to bulk-excuse; it is
# three things to look at". This is the load-bearing rule of the whole feature —
# pattern grouping must never be the mechanism by which something serious
# disappears into a batch.
PATTERN_TIERS = (TIER_ROUTINE, TIER_REVIEW)


def build_queue(
    *,
    flags: list[dict],
    decisions_by_identity: dict[str, dict],
    employees_by_id: dict[str, dict],
    outage_branch_dates: set[tuple[str, str]],
    include_decided: bool = False,
) -> dict:
    """Rank, dedup and group live flags against live decisions.

    `flags` are `Attendance Flag` rows (flag_identity, employee, attendance_date,
    flag_code, severity, day_closed, evidence); `decisions_by_identity` holds only
    live (superseded=0) `Attendance Flag Decision` rows; `employees_by_id` maps an
    employee id to {employee_name, branch}; `outage_branch_dates` holds
    (branch, "YYYY-MM-DD") pairs with an open closeout alert or no sync watermark.

    `include_decided` keeps people whose flags are ALL settled in `entries`. It is
    off by default because the queue's default question is "who still owes me
    something", and on because deciding an already-decided identity is the only
    way HR can correct a decision (`flag_decision_api._write_decision` inserts a
    new row and supersedes the old one) — unreachable people make that correction
    unreachable too.

    Returns {"entries", "counts", "orphans"}. Counts are flag counts over the
    whole input — including flags belonging to people who have fully cleared the
    queue, which is what makes `decided` a meaningful toolbar number — while
    `counts["people"]` counts distinct employees who still owe HR an answer,
    whether or not settled people are also on show.
    """
    counts = {"open": 0, "needs_re_review": 0, "decided": 0, "people": 0}
    by_person: dict[tuple[str, str], dict[str, dict]] = {}
    live_identities: set[str] = set()
    live_code_keys: set[tuple] = set()

    for flag in flags:
        employee = flag.get("employee")
        if not employee:
            continue
        date_str = _date_str(flag.get("attendance_date"))
        flag_out = _flag_out(flag, decisions_by_identity)
        live_identities.add(flag_out["flag_identity"])
        live_code_keys.add((employee, date_str, flag_out["flag_code"]))

        bucket = by_person.setdefault((employee, date_str), {})
        previous = bucket.get(flag_out["flag_identity"])
        # flag_identity deliberately excludes day_closed (spec: "a provisional flag
        # and the final flag that replaces it share one identity"), so the two rows
        # collide here whenever both are briefly live. Closeout is the authority:
        # the final wins and the day is counted once.
        if previous is None or flag_out["day_closed"] > previous["day_closed"]:
            bucket[flag_out["flag_identity"]] = flag_out

    person_days = []
    for (employee, date_str), bucket in by_person.items():
        person_flags = sorted(bucket.values(), key=_flag_sort_key)
        for flag_out in person_flags:
            if flag_out["decision_state"] == STATE_UNDECIDED:
                counts["open"] += 1
            elif flag_out["decision_state"] == STATE_NEEDS_RE_REVIEW:
                counts["needs_re_review"] += 1
            else:
                counts["decided"] += 1
        # A day leaves the queue only once every flag on it is settled — unless
        # the caller asked for the settled ones back, which is what makes an
        # applied decision reachable for replacement.
        unresolved = any(f["decision_state"] in UNRESOLVED_STATES for f in person_flags)
        if unresolved or include_decided:
            person_days.append({"employee": employee, "date": date_str, "flags": person_flags})

    entries = _entries_for(person_days, employees_by_id, outage_branch_dates)
    entries.sort(key=_entry_sort_key)
    # Only people who still owe HR an answer, so `people` keeps meaning "people
    # with something open" (which is what the toolbar renders it as) when settled
    # people are on show. Under the default every person in `entries` is
    # unresolved by construction, so the filter changes nothing there.
    counts["people"] = len(
        {person["employee"] for person in _iter_people(entries) if person["undecided_count"]}
    )

    return {
        "entries": entries,
        "counts": counts,
        "orphans": _orphans(decisions_by_identity, live_identities, live_code_keys),
    }


def _date_str(value) -> str:
    """Frappe returns dates as datetime.date from get_all but as str from the
    client, and both must land in the same group key and outage lookup.

    Thin alias for flag_identity.date_key so this module and flag_queue_api --
    which builds the `outage_branch_dates` tuples :191 tests membership of, and
    the decision code keys _orphans compares -- cannot normalise differently.
    Both failures are silent (zero groups, everything orphaned_flag_gone), so
    there is exactly one implementation, not two identical ones.
    """
    return date_key(value)


def _flag_out(flag: dict, decisions_by_identity: dict[str, dict]) -> dict:
    """One FlagOut: rank, tier, and how its live decision (if any) currently stands."""
    identity = flag.get("flag_identity") or ""
    evidence = parse_evidence(flag.get("evidence"))
    rank = triage_rank(flag.get("flag_code") or "", evidence)
    decision = decisions_by_identity.get(identity)

    if decision is None:
        state = STATE_UNDECIDED
    elif (decision.get("evidence_fingerprint") or "") == evidence_fingerprint(evidence):
        state = STATE_MATCHED
    else:
        # Includes decisions with no stored fingerprint at all (rows migrated out
        # of the old Desk workflow): a match that cannot be proven must surface
        # for re-review rather than silently excuse a corrected flag.
        state = STATE_NEEDS_RE_REVIEW

    return {
        "flag_identity": identity,
        "flag_code": flag.get("flag_code"),
        # The flag's OWN date. It used to live only on the person entry, because
        # an entry WAS a person-day; once an entry spans dates (a repeat pattern,
        # or a person's leftover flags) the person can no longer answer "when"
        # for each flag it holds.
        "attendance_date": _date_str(flag.get("attendance_date")),
        "severity": flag.get("severity"),
        "day_closed": int(flag.get("day_closed") or 0),
        "evidence": evidence,
        "rank": rank,
        "tier": tier_for_rank(rank),
        "decision_state": state,
        "decision": decision,
    }


def _person(employee: str, person_flags: list[dict], employees_by_id: dict, *, entry_key: str) -> dict:
    """One Person: an employee and the flags of theirs that landed in ONE entry.

    `person_flags` must already be worst-first. Under the per-flag invariant a
    person may legitimately appear in more than one entry, so this no longer
    stands for a person-DAY: `dates` is every date the flags in THIS entry fall
    on, and `attendance_date` is the worst unresolved flag's date — kept because
    the panel and the list still show a single headline day.

    `entry_key` is stamped by the caller rather than derived here: it has to be
    unique across the whole assembled set, and only the assembler knows whether
    this person is a lone row or a member of a particular group.
    """
    meta = employees_by_id.get(employee) or {}
    unresolved = [f for f in person_flags if f["decision_state"] in UNRESOLVED_STATES]
    # `default=0` is what a fully settled person ranks — reachable only under
    # include_decided, and correct: they sink to the foot of a worst-first queue
    # because they are not work, they are a record to correct if HR got it wrong.
    rank = max((f["rank"] for f in unresolved), default=0)
    # Worst unresolved first; a fully settled person falls back to their worst
    # flag overall so the headline date is never blank.
    top = unresolved[0] if unresolved else (person_flags[0] if person_flags else None)
    return {
        "entry_key": entry_key,
        "employee": employee,
        # An Employee row can be missing from the batch (deleted, or outside the
        # employee query's filters). Show the id rather than dropping someone who
        # still owes HR a decision.
        "employee_name": meta.get("employee_name") or employee,
        "employee_branch": meta.get("branch"),
        "attendance_date": top["attendance_date"] if top else None,
        "dates": sorted({f["attendance_date"] for f in person_flags}),
        # Rank and tier come from the worst *unresolved* flag only: a decided
        # absence must not keep its person out of tomorrow's routine group.
        "rank": rank,
        "tier": tier_for_rank(rank),
        "flags": person_flags,
        "undecided_count": len(unresolved),
        # Stamped after assembly by _stamp_cross_references (Task 4) — a badge
        # derived from the entry set cannot be computed before that set exists.
        "also_count": 0,
        "also_outlier_count": 0,
    }


def _is_pattern_flag(flag_out: dict) -> bool:
    """Can this flag be compressed into a repeat pattern?

    Unresolved, because a decided flag is not work; and routine or review tier
    only, because the pattern group's whole purpose is a bulk decision.
    """
    return (
        flag_out["decision_state"] in UNRESOLVED_STATES
        and flag_out["tier"] in PATTERN_TIERS
    )


def _pattern_codes(person_days: list[dict]) -> dict[str, set[str]]:
    """flag_code -> the employees who hit it on PATTERN_MIN_DAYS or more dates.

    Codes with fewer than GROUP_MIN_MEMBERS qualifying employees are dropped
    here rather than downstream, so "one person late four times" never reaches
    the assembler as a would-be group: it stays a person row reading
    "4 late starts".
    """
    dates_by_pair: dict[tuple[str, str], set[str]] = {}
    for person_day in person_days:
        for flag_out in person_day["flags"]:
            if not _is_pattern_flag(flag_out):
                continue
            key = (person_day["employee"], flag_out["flag_code"])
            dates_by_pair.setdefault(key, set()).add(person_day["date"])

    by_code: dict[str, set[str]] = {}
    for (employee, code), dates in dates_by_pair.items():
        if len(dates) >= PATTERN_MIN_DAYS:
            by_code.setdefault(code, set()).add(employee)

    return {code: employees for code, employees in by_code.items() if len(employees) >= GROUP_MIN_MEMBERS}


def _day_tier(person_flags: list[dict]) -> str:
    """Tier of the worst unresolved flag on a person-day — the ROUTINE_CODE guard.

    Computed over the WHOLE day, before pattern claiming removes anything from
    it, so the group's "and nothing else wrong that day" stays true: that clause
    is about how bad the day was, not about which entry each flag ended up in.
    """
    ranks = [f["rank"] for f in person_flags if f["decision_state"] in UNRESOLVED_STATES]
    return tier_for_rank(max(ranks, default=0))


def _top_unresolved(person_flags: list[dict]) -> dict | None:
    for flag_out in person_flags:  # already worst-first
        if flag_out["decision_state"] in UNRESOLVED_STATES:
            return flag_out
    return None


def _entries_for(
    person_days: list[dict],
    employees_by_id: dict,
    outage_branch_dates: set,
) -> list[dict]:
    """Assign every flag to exactly one entry. First claim wins.

    Precedence, per the spec's taxonomy table:
      1. BRANCH_NO_DEVICE_DATA — branch + date, claims the whole day
      2. REPEAT_PATTERN        — flag code, one person across >= PATTERN_MIN_DAYS dates
      3. ROUTINE_CODE          — flag code + date, across people
      4. (none)                — everything left, one entry per person

    The invariant this guarantees is "a flag appears in exactly one entry", NOT
    "a person appears in exactly one entry". A person may legitimately appear
    twice — once in a pattern group holding their four late starts, once as
    their own row holding a three-hour gap — because those are two different
    judgements and bundling them forced one decision onto two unrelated things.
    """
    branch_groups: dict[str, dict] = {}
    unclaimed_days: list[dict] = []

    # --- 1. A device outage claims the whole day, before anything else looks at it.
    for person_day in person_days:
        branch = (employees_by_id.get(person_day["employee"]) or {}).get("branch")
        if branch and (branch, person_day["date"]) in outage_branch_dates:
            key = "{0}:{1}:{2}".format(GROUP_BRANCH_NO_DEVICE_DATA, branch, person_day["date"])
            group = branch_groups.setdefault(
                key,
                {
                    "group_type": GROUP_BRANCH_NO_DEVICE_DATA,
                    "group_key": key,
                    "branch": branch,
                    "flag_code": None,
                    "attendance_date": person_day["date"],
                    "by_employee": {},
                },
            )
            group["by_employee"].setdefault(person_day["employee"], []).extend(person_day["flags"])
            continue
        unclaimed_days.append(person_day)

    # --- 2. Repeat patterns, computed over what the outage groups left behind.
    #
    # KNOWN COUPLING, not a bug. This reads `unclaimed_days`, but an undersized
    # branch group is not demoted until assembly below, so a day claimed by a
    # group that later degrades never comes back for pattern detection. The
    # observable effect is that an outage at a branch can change how employees who
    # do NOT work there are grouped: two people late on the same three days form
    # one pattern, and adding an outage at a branch where only the first of them
    # works drops the pair below the two-person gate, so the second is regrouped
    # too. No flag is lost or duplicated either way — the partition is total at
    # every stage — and the degradation is always toward MORE rows, never toward
    # something being hidden inside a batch, which is the direction that would
    # matter. Resolving it would mean iterating claim and demotion to a fixed
    # point for a strictly worse-looking queue.
    pattern_codes = _pattern_codes(unclaimed_days)
    pattern_groups: dict[str, dict] = {}
    leftover_days: list[dict] = []

    for person_day in unclaimed_days:
        # Over the WHOLE day, before pattern claiming removes anything — see _day_tier.
        day_tier = _day_tier(person_day["flags"])
        kept: list[dict] = []
        for flag_out in person_day["flags"]:
            code = flag_out["flag_code"]
            if _is_pattern_flag(flag_out) and person_day["employee"] in pattern_codes.get(code, ()):
                key = "{0}:{1}".format(GROUP_REPEAT_PATTERN, code)
                group = pattern_groups.setdefault(
                    key,
                    {
                        "group_type": GROUP_REPEAT_PATTERN,
                        "group_key": key,
                        "branch": None,
                        # A pattern spans dates by definition, so it has no single
                        # one. Consumers must read the members' `dates` instead.
                        "attendance_date": None,
                        "flag_code": code,
                        "by_employee": {},
                    },
                )
                group["by_employee"].setdefault(person_day["employee"], []).append(flag_out)
            else:
                kept.append(flag_out)
        if kept:
            leftover_days.append({**person_day, "flags": kept, "day_tier": day_tier})

    # --- 3. Routine code groups over what is still unclaimed.
    routine_groups: dict[str, dict] = {}
    leftover_by_employee: dict[str, list[dict]] = {}

    for person_day in leftover_days:
        top = _top_unresolved(person_day["flags"])
        # Keyed off the worst REMAINING unresolved flag, so the group is always
        # named after something it actually contains — but guarded on the whole
        # day's tier, so "nothing else wrong that day" stays true. `top` is None
        # for a fully settled leftover day (only reachable under include_decided):
        # a cause group is a bulk-decide affordance and there is nothing of
        # theirs to bulk-decide, so they fall through to a person entry.
        if top is not None and person_day["day_tier"] == TIER_ROUTINE:
            key = "{0}:{1}:{2}".format(GROUP_ROUTINE_CODE, top["flag_code"], person_day["date"])
            group = routine_groups.setdefault(
                key,
                {
                    "group_type": GROUP_ROUTINE_CODE,
                    "group_key": key,
                    "branch": None,
                    "flag_code": top["flag_code"],
                    "attendance_date": person_day["date"],
                    "by_employee": {},
                },
            )
            group["by_employee"].setdefault(person_day["employee"], []).extend(person_day["flags"])
            continue
        leftover_by_employee.setdefault(person_day["employee"], []).extend(person_day["flags"])

    # --- 4. Assemble. A group of one degrades back to its member's leftovers.
    entries: list[dict] = []
    for holder in (branch_groups, pattern_groups, routine_groups):
        for group in holder.values():
            if len(group["by_employee"]) < GROUP_MIN_MEMBERS:
                for employee, flags in group["by_employee"].items():
                    leftover_by_employee.setdefault(employee, []).extend(flags)
                continue
            members = [
                _person(
                    employee,
                    sorted(flags, key=_flag_sort_key),
                    employees_by_id,
                    entry_key="{0}|p:{1}".format(group["group_key"], employee),
                )
                for employee, flags in group["by_employee"].items()
            ]
            members.sort(key=_member_sort_key)
            rank = max(member["rank"] for member in members)
            entries.append(
                {
                    "kind": "group",
                    "group_type": group["group_type"],
                    "group_key": group["group_key"],
                    "branch": group["branch"],
                    "flag_code": group["flag_code"],
                    "attendance_date": group["attendance_date"],
                    "rank": rank,
                    "tier": tier_for_rank(rank),
                    "members": members,
                }
            )

    for employee, flags in leftover_by_employee.items():
        person = _person(
            employee,
            sorted(flags, key=_flag_sort_key),
            employees_by_id,
            entry_key="p:{0}".format(employee),
        )
        entries.append({"kind": "person", **person})

    return entries


def _orphans(
    decisions_by_identity: dict[str, dict],
    live_identities: set,
    live_code_keys: set,
) -> dict:
    """Count decisions that matched no live flag. They never enter `entries`.

    Retained forever for audit (spec: "Orphaned decisions are retained forever and
    never shown as applied"); the queue only reports how many there are.
    """
    orphans = {"orphaned_flag_gone": 0, "orphaned_evidence_changed": 0}
    for identity, decision in decisions_by_identity.items():
        if identity in live_identities:
            continue
        code_key = (
            decision.get("employee"),
            _date_str(decision.get("attendance_date")),
            decision.get("flag_code"),
        )
        # Same employee/date/code still flagged under a different identity -> the
        # punch underneath was corrected and the evidence suffix moved. Nothing
        # there at all -> the flag was corrected away or deleted outright.
        if code_key in live_code_keys:
            orphans["orphaned_evidence_changed"] += 1
        else:
            orphans["orphaned_flag_gone"] += 1
    return orphans


def _flag_sort_key(flag_out: dict) -> tuple:
    return (-flag_out["rank"], flag_out["flag_code"] or "", flag_out["flag_identity"])


def _member_sort_key(person: dict) -> tuple:
    return (-person["rank"], (person["employee_name"] or "").lower(), person["employee"])


def _entry_sort_key(entry: dict) -> tuple:
    """Rank first, so a lone 3h gap can outrank a 168-member routine group; then
    blast radius; then a stable string so two runs of the same data never reorder."""
    if entry["kind"] == "group":
        return (-entry["rank"], -len(entry["members"]), entry["group_key"])
    return (-entry["rank"], -1, entry["entry_key"])


def _iter_people(entries: list[dict]):
    for entry in entries:
        if entry["kind"] == "group":
            for member in entry["members"]:
                yield member
        else:
            yield entry
