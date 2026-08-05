"""Person-dedup and cause grouping for the HR flag queue.

Pure module: no frappe import, no queries, no I/O. `flag_queue_api` owns every
read (its query budget is O(1) in employee count) and hands the result sets in as
plain dicts; everything here is a transformation over those dicts. That is what
lets the invariant this module exists to guarantee — a person-day appears in
exactly one entry — be tested without a bench.

Spec: docs/superpowers/specs/2026-08-05-hr-flag-management-design.md, sections
"Triage ranking — additive, computed on read" and "Cause grouping — branch level".
"""

from __future__ import annotations

from dewey_time.attendance_engine.flag_identity import evidence_fingerprint, parse_evidence
from dewey_time.attendance_engine.flag_triage import TIER_ROUTINE, tier_for_rank, triage_rank

GROUP_BRANCH_NO_DEVICE_DATA = "BRANCH_NO_DEVICE_DATA"
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


def build_queue(
    *,
    flags: list[dict],
    decisions_by_identity: dict[str, dict],
    employees_by_id: dict[str, dict],
    outage_branch_dates: set[tuple[str, str]],
) -> dict:
    """Rank, dedup and group live flags against live decisions.

    `flags` are `Attendance Flag` rows (flag_identity, employee, attendance_date,
    flag_code, severity, day_closed, evidence); `decisions_by_identity` holds only
    live (superseded=0) `Attendance Flag Decision` rows; `employees_by_id` maps an
    employee id to {employee_name, branch}; `outage_branch_dates` holds
    (branch, "YYYY-MM-DD") pairs with an open closeout alert or no sync watermark.

    Returns {"entries", "counts", "orphans"}. Counts are flag counts over the
    whole input — including flags belonging to people who have fully cleared the
    queue, which is what makes `decided` a meaningful toolbar number — while
    `counts["people"]` counts distinct employees actually present in `entries`.
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

    persons = []
    for (employee, date_str), bucket in by_person.items():
        person_flags = sorted(bucket.values(), key=_flag_sort_key)
        for flag_out in person_flags:
            if flag_out["decision_state"] == STATE_UNDECIDED:
                counts["open"] += 1
            elif flag_out["decision_state"] == STATE_NEEDS_RE_REVIEW:
                counts["needs_re_review"] += 1
            else:
                counts["decided"] += 1
        person = _person(employee, date_str, person_flags, employees_by_id)
        # A person leaves the queue only once every flag of theirs is settled.
        if person["undecided_count"]:
            persons.append(person)

    entries = _entries_for(persons, outage_branch_dates)
    entries.sort(key=_entry_sort_key)
    counts["people"] = len({person["employee"] for person in _iter_people(entries)})

    return {
        "entries": entries,
        "counts": counts,
        "orphans": _orphans(decisions_by_identity, live_identities, live_code_keys),
    }


def _date_str(value) -> str:
    """Frappe returns dates as datetime.date from get_all but as str from the
    client, and both must land in the same group key and outage lookup."""
    if value is None:
        return ""
    return str(value)[:10]


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
        "severity": flag.get("severity"),
        "day_closed": int(flag.get("day_closed") or 0),
        "evidence": evidence,
        "rank": rank,
        "tier": tier_for_rank(rank),
        "decision_state": state,
        "decision": decision,
    }


def _person(employee: str, date_str: str, person_flags: list[dict], employees_by_id: dict) -> dict:
    """One Person. `person_flags` must already be worst-first."""
    meta = employees_by_id.get(employee) or {}
    unresolved = [f for f in person_flags if f["decision_state"] in UNRESOLVED_STATES]
    rank = max((f["rank"] for f in unresolved), default=0)
    return {
        "employee": employee,
        # An Employee row can be missing from the batch (deleted, or outside the
        # employee query's filters). Show the id rather than dropping someone who
        # still owes HR a decision.
        "employee_name": meta.get("employee_name") or employee,
        "employee_branch": meta.get("branch"),
        "attendance_date": date_str,
        # Rank and tier come from the worst *unresolved* flag only: a decided
        # absence must not keep its person out of tomorrow's routine group.
        "rank": rank,
        "tier": tier_for_rank(rank),
        # Every flag that person has that day, decided ones included, so the right
        # pane can show the whole day.
        "flags": person_flags,
        "undecided_count": len(unresolved),
    }


def _top_unresolved(person: dict) -> dict | None:
    for flag_out in person["flags"]:  # already worst-first
        if flag_out["decision_state"] in UNRESOLVED_STATES:
            return flag_out
    return None


def _entries_for(persons: list[dict], outage_branch_dates: set) -> list[dict]:
    """Place each person in the first group that claims them, else on their own.

    Precedence is BRANCH_NO_DEVICE_DATA, then ROUTINE_CODE, then ungrouped —
    a person is claimed once and never considered again.
    """
    branch_groups: dict[str, dict] = {}
    routine_groups: dict[str, dict] = {}
    loners: list[dict] = []

    for person in persons:
        date_str = person["attendance_date"]
        branch = person["employee_branch"]

        if branch and (branch, date_str) in outage_branch_dates:
            key = "{0}:{1}:{2}".format(GROUP_BRANCH_NO_DEVICE_DATA, branch, date_str)
            group = branch_groups.setdefault(
                key,
                {"branch": branch, "flag_code": None, "attendance_date": date_str, "members": []},
            )
            group["members"].append(person)
            continue

        # Routine grouping keys off the person's WORST unresolved flag, never off
        # a routine flag they merely also have: someone 9 minutes late who also
        # has a 3h gap must land under the gap. person["tier"] is that worst
        # flag's tier by construction (_person).
        top = _top_unresolved(person)
        if top is not None and person["tier"] == TIER_ROUTINE:
            key = "{0}:{1}:{2}".format(GROUP_ROUTINE_CODE, top["flag_code"], date_str)
            group = routine_groups.setdefault(
                key,
                {
                    "branch": None,
                    "flag_code": top["flag_code"],
                    "attendance_date": date_str,
                    "members": [],
                },
            )
            group["members"].append(person)
            continue

        loners.append(person)

    entries: list[dict] = []
    for group_type, holder in (
        (GROUP_BRANCH_NO_DEVICE_DATA, branch_groups),
        (GROUP_ROUTINE_CODE, routine_groups),
    ):
        for key, group in holder.items():
            if len(group["members"]) < GROUP_MIN_MEMBERS:
                loners.extend(group["members"])
                continue
            members = sorted(group["members"], key=_member_sort_key)
            rank = max(member["rank"] for member in members)
            entries.append(
                {
                    "kind": "group",
                    "group_type": group_type,
                    "group_key": key,
                    "branch": group["branch"],
                    "flag_code": group["flag_code"],
                    "attendance_date": group["attendance_date"],
                    "rank": rank,
                    "tier": tier_for_rank(rank),
                    "members": members,
                }
            )

    for person in loners:
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
    return (-entry["rank"], -1, "{0}|{1}".format(entry["employee"], entry["attendance_date"]))


def _iter_people(entries: list[dict]):
    for entry in entries:
        if entry["kind"] == "group":
            for member in entry["members"]:
                yield member
        else:
            yield entry
