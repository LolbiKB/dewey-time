import json
import unittest
from datetime import date, datetime

# No frappe mock is installed here on purpose: flag_grouping and both modules it
# imports (flag_identity, flag_triage) are frappe-free by design — flag_identity
# carries its own local `_scrub` rather than calling `frappe.scrub`, exactly so
# these modules import without a bench. Same shape as test_flag_identity.py and
# test_flag_triage.py, which mock nothing either.
from dewey_time.attendance_engine.flag_grouping import (
    _day_tier,
    _flag_out,
    _pattern_codes,
    _person,
    build_queue,
    recount,
)
from dewey_time.attendance_engine.flag_identity import evidence_fingerprint
from dewey_time.attendance_engine.flag_triage import triage_rank

DATE = "2026-08-03"
DATE2 = "2026-08-04"

_MATCH = object()


def _flag(employee, attendance_date, flag_code, *, evidence=None, identity=None,
          day_closed=1, severity="WARNING"):
    """One `Attendance Flag` row as flag_queue_api's batched read hands it over."""
    return {
        "flag_identity": identity or "AUTO-{0}-{1}-{2}".format(
            employee.lower(), attendance_date, flag_code.lower().replace("_", "-")
        ),
        "employee": employee,
        "attendance_date": attendance_date,
        "flag_code": flag_code,
        "severity": severity,
        "day_closed": day_closed,
        "evidence": {} if evidence is None else evidence,
    }


def _iter_all_people(entries):
    for entry in entries:
        if entry["kind"] == "group":
            for member in entry["members"]:
                yield member
        else:
            yield entry


def _decision(flag, *, name="AFD-0001", outcome="EXCUSED", reason="DEVICE_OR_DATA_FAULT",
              fingerprint=_MATCH, group_key=None):
    """One live (superseded=0) `Attendance Flag Decision` row.

    `fingerprint` defaults to the flag's own fingerprint, i.e. a decision that
    still matches; pass an explicit value to simulate a corrected punch.
    """
    return {
        "name": name,
        "flag_identity": flag["flag_identity"],
        "employee": flag["employee"],
        "attendance_date": flag["attendance_date"],
        "flag_code": flag["flag_code"],
        "outcome": outcome,
        "reason": reason,
        "note": None,
        "evidence_fingerprint": (
            evidence_fingerprint(flag["evidence"]) if fingerprint is _MATCH else fingerprint
        ),
        "group_key": group_key,
        "decided_by": "hr@example.com",
        "decided_at": "2026-08-05 09:00:00",
    }


def _employees(*rows):
    """rows: (employee_id, employee_name, branch)."""
    return {emp: {"employee_name": name, "branch": branch} for emp, name, branch in rows}


def _people_in(payload):
    """Every Person in the payload, groups flattened — the dedup invariant's subject."""
    return list(_iter_all_people(payload["entries"]))


def _person_days(payload):
    return [(person["employee"], person["attendance_date"]) for person in _people_in(payload)]


def _groups(payload, group_type=None):
    return [
        entry
        for entry in payload["entries"]
        if entry["kind"] == "group" and (group_type is None or entry["group_type"] == group_type)
    ]


class TestPersonDedup(unittest.TestCase):
    def test_act_flag_outranks_a_routine_group_and_person_appears_once(self):
        gap = _flag(
            "EMP-1", DATE, "MISSING_TIME",
            evidence={"minutes": 180, "interval_start": "2026-08-03 10:00:00"},
        )
        late = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})
        others = [
            _flag(emp, DATE, "LATE_START", evidence={"minutes": 9})
            for emp in ("EMP-2", "EMP-3", "EMP-4")
        ]

        payload = build_queue(
            flags=[gap, late] + others,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"),
                ("EMP-2", "Ben", "BR-A"),
                ("EMP-3", "Cy", "BR-A"),
                ("EMP-4", "Dee", "BR-A"),
            ),
            outage_branch_dates=set(),
        )

        head = payload["entries"][0]
        self.assertEqual(head["kind"], "person")
        self.assertEqual(head["employee"], "EMP-1")
        self.assertEqual(head["tier"], "act")
        self.assertEqual([f["flag_code"] for f in head["flags"]], ["MISSING_TIME", "LATE_START"])
        self.assertEqual(head["undecided_count"], 2)

        routine = _groups(payload, "ROUTINE_CODE")
        self.assertEqual(len(routine), 1)
        self.assertEqual(routine[0]["tier"], "routine")
        self.assertEqual([m["employee"] for m in routine[0]["members"]], ["EMP-2", "EMP-3", "EMP-4"])
        self.assertNotIn("EMP-1", [m["employee"] for m in routine[0]["members"]])
        self.assertEqual(_person_days(payload).count(("EMP-1", DATE)), 1)

    def test_a_routine_group_is_keyed_off_the_worst_of_two_routine_codes(self):
        # Both employees hold the same TWO routine codes on the same day, so a
        # group of two forms whichever code is chosen and "named after a code it
        # actually contains" cannot tell the choices apart. What separates them is
        # which one: the key comes from the worst unresolved flag (LATE_START,
        # rank 20), never the least bad (NON_PRIMARY_SITE_PUNCH, rank 10).
        # `_top_unresolved` scanned from the wrong end files everyone under the
        # most trivial thing they did that day, which is the same failure as the
        # retired "someone 9 minutes late who also has a 3h gap must land under
        # the gap" — just below the tier guard, where both codes are routine.
        flags = []
        for emp in ("EMP-1", "EMP-2"):
            flags.append(_flag(emp, DATE, "LATE_START", evidence={"minutes": 9}))
            flags.append(_flag(emp, DATE, "NON_PRIMARY_SITE_PUNCH"))

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A")),
            outage_branch_dates=set(),
        )

        routine = _groups(payload, "ROUTINE_CODE")
        self.assertEqual(len(routine), 1)
        self.assertEqual(routine[0]["flag_code"], "LATE_START")
        self.assertEqual(routine[0]["group_key"], "ROUTINE_CODE:LATE_START:" + DATE)
        # The key names the worst flag; it does not filter the entry down to it.
        # Both codes still travel with their members for the detail panel.
        self.assertEqual(
            {f["flag_code"] for m in routine[0]["members"] for f in m["flags"]},
            {"LATE_START", "NON_PRIMARY_SITE_PUNCH"},
        )

    def test_no_person_day_appears_in_two_entries(self):
        flags = [
            _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-1", DATE, "NON_PRIMARY_SITE_PUNCH"),
            _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-2", DATE, "UNNOTIFIED_ABSENCE"),
            _flag("EMP-3", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-4", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-4", DATE2, "LATE_START", evidence={"minutes": 9}),
        ]

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"),
                ("EMP-2", "Ben", "BR-A"),
                ("EMP-3", "Cy", "BR-A"),
                ("EMP-4", "Dee", "BR-A"),
            ),
            outage_branch_dates=set(),
        )

        days = _person_days(payload)
        self.assertEqual(len(days), len(set(days)))
        self.assertEqual(sorted(d for emp, d in days if emp == "EMP-4"), [DATE, DATE2])
        # EMP-2's absence is act tier, so their routine LATE_START must not pull
        # them into the routine group.
        routine_members = [m["employee"] for m in _groups(payload, "ROUTINE_CODE")[0]["members"]]
        self.assertNotIn("EMP-2", routine_members)

    def test_a_person_claimed_by_two_groups_at_once_lands_in_exactly_one(self):
        # EMP-1 qualifies three ways at once: their branch is dark, they hold the
        # same routine code as the routine group below, and they also have an act
        # flag that would otherwise make them a lone entry. Exactly one claim may
        # win — outage first — and the two losing claims must leave no trace.
        flags = [
            _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag(
                "EMP-1", DATE, "MISSING_TIME",
                evidence={"minutes": 180, "interval_start": "2026-08-03 10:00:00"},
            ),
            _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-3", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-4", DATE, "LATE_START", evidence={"minutes": 9}),
        ]

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "Phnom Penh HQ"),
                ("EMP-2", "Ben", "Phnom Penh HQ"),
                ("EMP-3", "Cy", "BR-A"),
                ("EMP-4", "Dee", "BR-A"),
            ),
            outage_branch_dates={("Phnom Penh HQ", DATE)},
        )

        days = _person_days(payload)
        self.assertEqual(len(days), len(set(days)))
        outage = _groups(payload, "BRANCH_NO_DEVICE_DATA")[0]
        self.assertEqual([m["employee"] for m in outage["members"]], ["EMP-1", "EMP-2"])
        # The outage group inherits EMP-1's act rank rather than demoting them.
        self.assertEqual(outage["rank"], triage_rank("MISSING_TIME", {"minutes": 180}))
        routine = _groups(payload, "ROUTINE_CODE")[0]
        self.assertEqual([m["employee"] for m in routine["members"]], ["EMP-3", "EMP-4"])
        self.assertEqual(
            [e["employee"] for e in payload["entries"] if e["kind"] == "person"], []
        )

    def test_act_tier_people_sharing_a_code_do_not_form_a_routine_group(self):
        # Both have the same worst code, so they would cluster if grouping keyed
        # off the code alone — but ROUTINE_CODE is a bulk-clear affordance for
        # low-stakes flags, and an absence is never bulk-cleared. They stay two
        # person entries, each with its own routine LATE_START along for the ride.
        flags = []
        for emp in ("EMP-1", "EMP-2"):
            flags.append(_flag(emp, DATE, "UNNOTIFIED_ABSENCE"))
            flags.append(_flag(emp, DATE, "LATE_START", evidence={"minutes": 9}))

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(_groups(payload), [])
        self.assertEqual([e["kind"] for e in payload["entries"]], ["person", "person"])
        self.assertEqual([e["tier"] for e in payload["entries"]], ["act", "act"])

    def test_rank_beats_blast_radius_when_ordering_entries(self):
        # A two-person act group must sit above a larger routine group: the queue
        # is ordered worst-first, and group size is only the tie-breaker.
        flags = [
            _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE"),
            _flag("EMP-2", DATE, "UNNOTIFIED_ABSENCE"),
        ]
        flags += [
            _flag(emp, DATE, "LATE_START", evidence={"minutes": 9})
            for emp in ("EMP-3", "EMP-4", "EMP-5")
        ]

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "Phnom Penh HQ"),
                ("EMP-2", "Ben", "Phnom Penh HQ"),
                ("EMP-3", "Cy", "BR-A"),
                ("EMP-4", "Dee", "BR-A"),
                ("EMP-5", "Eve", "BR-A"),
            ),
            outage_branch_dates={("Phnom Penh HQ", DATE)},
        )

        self.assertEqual(
            [e["group_type"] for e in payload["entries"]],
            ["BRANCH_NO_DEVICE_DATA", "ROUTINE_CODE"],
        )
        self.assertEqual([len(e["members"]) for e in payload["entries"]], [2, 3])

    def test_one_employee_flagged_on_two_days_is_one_entry_spanning_both(self):
        # This test used to assert TWO entries, under the retired person-day
        # invariant ("a person-DAY appears in exactly one entry"). Task 3 replaced
        # that with "a FLAG appears in exactly one entry", so a person's leftover
        # flags — whatever days they fall on — now merge into a single row. The
        # change is deliberate, not a weakened assertion.
        payload = build_queue(
            flags=[
                _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE"),
                _flag("EMP-1", DATE2, "UNNOTIFIED_ABSENCE"),
            ],
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(len(payload["entries"]), 1)
        entry = payload["entries"][0]
        self.assertEqual(entry["dates"], [DATE, DATE2])
        # Both absences rank 150, so "worst" is a tie that `_flag_sort_key` breaks
        # on flag_identity — which puts DATE first. (The worst-flag rule itself is
        # discriminated by PersonUnitTests, where the ranks genuinely differ.)
        self.assertEqual(entry["attendance_date"], DATE)
        # Both flags are still on the entry and still owed an answer: merging days
        # must not drop one.
        self.assertEqual(entry["undecided_count"], 2)
        self.assertEqual(payload["counts"]["people"], 1)

    def test_unknown_employee_row_still_yields_a_person(self):
        payload = build_queue(
            flags=[_flag("EMP-404", DATE, "UNNOTIFIED_ABSENCE")],
            decisions_by_identity={},
            employees_by_id={},
            outage_branch_dates=set(),
        )

        person = payload["entries"][0]
        self.assertEqual(person["employee_name"], "EMP-404")
        self.assertIsNone(person["employee_branch"])


class TestBranchOutageGrouping(unittest.TestCase):
    def test_outage_branch_claims_people_who_only_have_routine_flags(self):
        flags = [
            _flag(emp, DATE, "LATE_START", evidence={"minutes": 9})
            for emp in ("EMP-1", "EMP-2", "EMP-3", "EMP-4")
        ]

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "Phnom Penh HQ"),
                ("EMP-2", "Ben", "Phnom Penh HQ"),
                ("EMP-3", "Cy", "Siem Reap"),
                ("EMP-4", "Dee", "Siem Reap"),
            ),
            outage_branch_dates={("Phnom Penh HQ", DATE)},
        )

        outage = _groups(payload, "BRANCH_NO_DEVICE_DATA")
        self.assertEqual(len(outage), 1)
        self.assertEqual(outage[0]["group_key"], "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ:" + DATE)
        self.assertEqual(outage[0]["branch"], "Phnom Penh HQ")
        self.assertIsNone(outage[0]["flag_code"])
        self.assertEqual([m["employee"] for m in outage[0]["members"]], ["EMP-1", "EMP-2"])

        routine = _groups(payload, "ROUTINE_CODE")
        self.assertEqual([m["employee"] for m in routine[0]["members"]], ["EMP-3", "EMP-4"])
        days = _person_days(payload)
        self.assertEqual(len(days), len(set(days)))

    def test_outage_group_carries_the_rank_of_its_worst_member(self):
        payload = build_queue(
            flags=[
                _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE"),
                _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 9}),
            ],
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "Phnom Penh HQ"),
                ("EMP-2", "Ben", "Phnom Penh HQ"),
            ),
            outage_branch_dates={("Phnom Penh HQ", DATE)},
        )

        group = _groups(payload, "BRANCH_NO_DEVICE_DATA")[0]
        self.assertEqual(group["rank"], triage_rank("UNNOTIFIED_ABSENCE", {}))
        self.assertEqual(group["tier"], "act")
        self.assertEqual([m["employee"] for m in group["members"]], ["EMP-1", "EMP-2"])

    def test_a_group_of_one_degrades_to_a_lone_person_entry(self):
        employees = _employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-B"))
        # Two routine people, two different codes -> two would-be groups of one.
        payload = build_queue(
            flags=[
                _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
                _flag("EMP-2", DATE, "NON_PRIMARY_SITE_PUNCH"),
            ],
            decisions_by_identity={},
            employees_by_id=employees,
            outage_branch_dates=set(),
        )
        self.assertEqual([e["kind"] for e in payload["entries"]], ["person", "person"])
        self.assertEqual(_groups(payload), [])

        # Same rule for a dark branch with a single flagged employee.
        solo = build_queue(
            flags=[_flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})],
            decisions_by_identity={},
            employees_by_id=employees,
            outage_branch_dates={("BR-A", DATE)},
        )
        self.assertEqual([e["kind"] for e in solo["entries"]], ["person"])

    def test_date_objects_from_the_database_normalise_to_iso_strings(self):
        # frappe.get_all returns datetime.date; the outage set is built from
        # string dates. Both must land in the same group key.
        payload = build_queue(
            flags=[
                _flag("EMP-1", date(2026, 8, 3), "LATE_START", evidence={"minutes": 9}),
                _flag("EMP-2", date(2026, 8, 3), "LATE_START", evidence={"minutes": 9}),
            ],
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A")),
            outage_branch_dates={("BR-A", "2026-08-03")},
        )

        group = _groups(payload, "BRANCH_NO_DEVICE_DATA")[0]
        self.assertEqual(group["group_key"], "BRANCH_NO_DEVICE_DATA:BR-A:2026-08-03")
        self.assertEqual(group["attendance_date"], "2026-08-03")
        self.assertEqual([m["attendance_date"] for m in group["members"]], ["2026-08-03"] * 2)

    def test_datetime_shaped_dates_truncate_to_the_day(self):
        # A Date column can still surface as a datetime, or as a datetime-shaped
        # string, depending on the read path. Anything past the day part has to be
        # dropped or one day splits into three keys that group with nothing.
        payload = build_queue(
            flags=[
                _flag("EMP-1", datetime(2026, 8, 3, 0, 0), "LATE_START", evidence={"minutes": 9}),
                _flag("EMP-2", "2026-08-03 00:00:00", "LATE_START", evidence={"minutes": 9}),
                _flag("EMP-3", "2026-08-03", "LATE_START", evidence={"minutes": 9}),
            ],
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A"), ("EMP-3", "Cy", "BR-A")
            ),
            outage_branch_dates={("BR-A", "2026-08-03")},
        )

        self.assertEqual(len(payload["entries"]), 1)
        group = _groups(payload, "BRANCH_NO_DEVICE_DATA")[0]
        self.assertEqual(group["group_key"], "BRANCH_NO_DEVICE_DATA:BR-A:2026-08-03")
        self.assertEqual([m["employee"] for m in group["members"]], ["EMP-1", "EMP-2", "EMP-3"])


class TestDecisionState(unittest.TestCase):
    def test_fingerprint_mismatch_is_needs_re_review_with_the_decision_as_context(self):
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 90})
        stale = _decision(flag, name="AFD-0007", fingerprint=evidence_fingerprint({"minutes": 6}))

        payload = build_queue(
            flags=[flag],
            decisions_by_identity={flag["flag_identity"]: stale},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        person = payload["entries"][0]
        out = person["flags"][0]
        self.assertEqual(out["decision_state"], "needs_re_review")
        self.assertEqual(out["decision"]["name"], "AFD-0007")
        self.assertEqual(out["decision"]["outcome"], "EXCUSED")
        self.assertEqual(person["undecided_count"], 1)
        self.assertEqual(
            payload["counts"],
            {"open": 0, "needs_re_review": 1, "decided": 0, "people": 1, "rows": 1},
        )
        self.assertEqual(
            payload["orphans"], {"orphaned_flag_gone": 0, "orphaned_evidence_changed": 0}
        )

    def test_matching_fingerprint_clears_the_person_from_the_queue(self):
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 90})

        payload = build_queue(
            flags=[flag],
            decisions_by_identity={flag["flag_identity"]: _decision(flag)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(payload["entries"], [])
        self.assertEqual(
            payload["counts"],
            {"open": 0, "needs_re_review": 0, "decided": 1, "people": 0, "rows": 0},
        )

    def test_decision_without_a_stored_fingerprint_is_needs_re_review(self):
        # Rows migrated out of the old Desk workflow carry no fingerprint. A match
        # that cannot be proven must not silently excuse a flag.
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 90})

        payload = build_queue(
            flags=[flag],
            decisions_by_identity={flag["flag_identity"]: _decision(flag, fingerprint=None)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(payload["entries"][0]["flags"][0]["decision_state"], "needs_re_review")

    def test_partially_decided_people_rank_by_their_remaining_flag(self):
        flags = []
        decisions = {}
        for emp in ("EMP-1", "EMP-2"):
            absence = _flag(emp, DATE, "UNNOTIFIED_ABSENCE")
            late = _flag(emp, DATE, "LATE_START", evidence={"minutes": 9})
            flags.extend([absence, late])
            decisions[absence["flag_identity"]] = _decision(absence, name="AFD-" + emp)

        payload = build_queue(
            flags=flags,
            decisions_by_identity=decisions,
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A")),
            outage_branch_dates=set(),
        )

        group = _groups(payload, "ROUTINE_CODE")[0]
        self.assertEqual(group["flag_code"], "LATE_START")
        self.assertEqual(group["rank"], triage_rank("LATE_START", {"minutes": 9}))
        member = group["members"][0]
        self.assertEqual(member["undecided_count"], 1)
        # The decided act flag stays on the person, worst-first, so the right pane
        # can still show the whole day.
        self.assertEqual([f["flag_code"] for f in member["flags"]], ["UNNOTIFIED_ABSENCE", "LATE_START"])
        self.assertEqual(member["flags"][0]["decision_state"], "matched")
        self.assertEqual(
            payload["counts"],
            {"open": 2, "needs_re_review": 0, "decided": 2, "people": 2, "rows": 1},
        )

    def test_evidence_arrives_as_json_text_from_the_database(self):
        flag = _flag(
            "EMP-1", DATE, "MISSING_TIME",
            evidence=json.dumps({"minutes": 180, "interval_start": "2026-08-03 10:00:00"}),
        )

        payload = build_queue(
            flags=[flag],
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        out = payload["entries"][0]["flags"][0]
        self.assertEqual(out["evidence"]["minutes"], 180)
        self.assertEqual(out["tier"], "act")
        # triage_rank's minute extraction returns None for anything that isn't a
        # dict, so handing it the raw JSON *string* would silently collapse this
        # 3h gap to MISSING_TIME's lowest band (60) with no error anywhere.
        self.assertEqual(out["rank"], triage_rank("MISSING_TIME", {"minutes": 180}))
        self.assertNotEqual(out["rank"], triage_rank("MISSING_TIME", "{}"))


class TestOrphans(unittest.TestCase):
    def test_decision_with_no_live_flag_is_orphaned_flag_gone_and_shows_nowhere(self):
        live = _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE")
        vanished = _flag(
            "EMP-9", DATE, "MISSING_TIME",
            evidence={"minutes": 45, "interval_start": "2026-08-03 10:00:00"},
        )

        payload = build_queue(
            flags=[live],
            decisions_by_identity={vanished["flag_identity"]: _decision(vanished)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-9", "Zed", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(
            payload["orphans"], {"orphaned_flag_gone": 1, "orphaned_evidence_changed": 0}
        )
        self.assertNotIn("EMP-9", [p["employee"] for p in _people_in(payload)])
        self.assertEqual(payload["counts"]["people"], 1)

    def test_decision_under_a_superseded_evidence_key_is_orphaned_evidence_changed(self):
        old = _flag(
            "EMP-1", DATE, "MISSING_TIME",
            evidence={"minutes": 45, "interval_start": "2026-08-03 10:00:00"},
            identity="AUTO-emp-1-2026-08-03-missing-time-2026-08-03-100000",
        )
        new = _flag(
            "EMP-1", DATE, "MISSING_TIME",
            evidence={"minutes": 45, "interval_start": "2026-08-03 10:15:00"},
            identity="AUTO-emp-1-2026-08-03-missing-time-2026-08-03-101500",
        )

        payload = build_queue(
            flags=[new],
            decisions_by_identity={old["flag_identity"]: _decision(old)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(
            payload["orphans"], {"orphaned_flag_gone": 0, "orphaned_evidence_changed": 1}
        )
        out = payload["entries"][0]["flags"][0]
        self.assertEqual(out["decision_state"], "undecided")
        self.assertIsNone(out["decision"])


class TestCounts(unittest.TestCase):
    def test_counts_people_is_distinct_employees_across_every_entry(self):
        flags = [
            _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE"),
            _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-3", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-4", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-5", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-1", DATE2, "LATE_START", evidence={"minutes": 9}),
        ]

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"),
                ("EMP-2", "Ben", "BR-A"),
                ("EMP-3", "Cy", "BR-A"),
                ("EMP-4", "Dee", "Phnom Penh HQ"),
                ("EMP-5", "Eve", "Phnom Penh HQ"),
            ),
            outage_branch_dates={("Phnom Penh HQ", DATE)},
        )

        # 6 flags over 6 person-days, but 5 Persons: EMP-1's absence on DATE and
        # their late start on DATE2 are both leftovers, so they merge into one row
        # (this was 6 under the retired person-day invariant).
        self.assertEqual(len(_person_days(payload)), 5)
        self.assertEqual(payload["counts"]["people"], 5)
        self.assertEqual(
            payload["counts"]["people"], len({p["employee"] for p in _people_in(payload)})
        )

    def test_counts_split_by_decision_state_over_the_whole_range(self):
        undecided = _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE")
        decided = _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 90})
        stale = _flag("EMP-3", DATE, "LEFT_EARLY", evidence={"minutes": 90})

        payload = build_queue(
            flags=[undecided, decided, stale],
            decisions_by_identity={
                decided["flag_identity"]: _decision(decided, name="AFD-1"),
                stale["flag_identity"]: _decision(
                    stale, name="AFD-2", fingerprint=evidence_fingerprint({"minutes": 5})
                ),
            },
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A"), ("EMP-3", "Cy", "BR-A")
            ),
            outage_branch_dates=set(),
        )

        # EMP-2 has cleared the queue, but their decided flag still counts — the
        # toolbar reports work done over the range, not just work outstanding.
        self.assertEqual(
            payload["counts"],
            {"open": 1, "needs_re_review": 1, "decided": 1, "people": 2, "rows": 2},
        )
        self.assertNotIn("EMP-2", [p["employee"] for p in _people_in(payload)])


class TestIncludeDecided(unittest.TestCase):
    """Deciding an already-decided identity is the ONLY way HR can correct a
    decision (decide_flags supersedes rather than duplicating), so a person whose
    flags are all settled has to stay reachable somehow. Reachability is opt-in:
    the default payload answers "who still owes me something", which is what
    every other test in this file pins.
    """

    def _fixture(self, **kwargs):
        """One settled person (EMP-1) and one who still owes HR an answer (EMP-2)."""
        settled = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 90})
        open_absence = _flag("EMP-2", DATE, "UNNOTIFIED_ABSENCE")
        return build_queue(
            flags=[settled, open_absence],
            decisions_by_identity={settled["flag_identity"]: _decision(settled)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A")),
            outage_branch_dates=set(),
            **kwargs,
        )

    def test_the_default_payload_is_byte_identical_with_the_flag_absent_or_false(self):
        self.assertEqual(self._fixture(), self._fixture(include_decided=False))
        # …and the default really is "settled people are gone", not "the
        # parameter happens to be unread".
        self.assertEqual([e["employee"] for e in self._fixture()["entries"]], ["EMP-2"])

    def test_a_fully_decided_person_is_reachable_with_include_decided(self):
        payload = self._fixture(include_decided=True)

        self.assertEqual(sorted(e["employee"] for e in payload["entries"]), ["EMP-1", "EMP-2"])
        ana = next(e for e in payload["entries"] if e["employee"] == "EMP-1")
        self.assertEqual(ana["kind"], "person")
        self.assertEqual(ana["undecided_count"], 0)
        self.assertEqual([f["decision_state"] for f in ana["flags"]], ["matched"])
        # The live decision travels with the flag, so the panel can show HR what
        # they are about to replace.
        self.assertEqual(ana["flags"][0]["decision"]["name"], "AFD-0001")

    def test_a_fully_decided_person_ranks_last_rather_than_crashing_on_no_unresolved_flag(self):
        # rank/tier come from the worst UNRESOLVED flag, and this person has
        # none — the derivation has to survive an empty list, not raise.
        payload = self._fixture(include_decided=True)
        ana = next(e for e in payload["entries"] if e["employee"] == "EMP-1")

        self.assertEqual(ana["rank"], 0)
        self.assertEqual(ana["tier"], "routine")
        # Worst-first still holds: the person who owes HR an answer stays on top.
        self.assertEqual([e["employee"] for e in payload["entries"]], ["EMP-2", "EMP-1"])

    def test_counts_still_mean_the_same_thing_with_decided_people_in_view(self):
        # `people` is "people with something open" (it backs the header's "N
        # people with something open"), so surfacing settled people must not
        # inflate it, and neither do the flag-state counts, which are already
        # computed over the whole input either way. `rows` is the one count
        # that IS supposed to move: it is a literal len(entries), so it grows
        # by exactly the settled person now on screen.
        default_counts = self._fixture()["counts"]
        with_decided_counts = self._fixture(include_decided=True)["counts"]
        self.assertEqual(
            {k: v for k, v in default_counts.items() if k != "rows"},
            {k: v for k, v in with_decided_counts.items() if k != "rows"},
        )
        self.assertEqual(default_counts["rows"], 1)
        self.assertEqual(with_decided_counts["rows"], 2)
        self.assertEqual(with_decided_counts["people"], 1)

    def test_a_settled_person_does_not_join_a_cause_group(self):
        # Cause groups are a bulk-decide affordance; a person with nothing
        # unresolved has nothing to bulk-decide, so they render on their own
        # rather than padding a group whose action would skip them.
        flags = [_flag(emp, DATE, "LATE_START", evidence={"minutes": 9})
                 for emp in ("EMP-1", "EMP-2", "EMP-3")]
        payload = build_queue(
            flags=flags,
            decisions_by_identity={flags[0]["flag_identity"]: _decision(flags[0])},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A"), ("EMP-3", "Cy", "BR-A")
            ),
            outage_branch_dates=set(),
            include_decided=True,
        )

        routine = _groups(payload, "ROUTINE_CODE")
        self.assertEqual([m["employee"] for m in routine[0]["members"]], ["EMP-2", "EMP-3"])
        self.assertEqual(
            [e["employee"] for e in payload["entries"] if e["kind"] == "person"], ["EMP-1"]
        )


class TestProvisionalFinalCollision(unittest.TestCase):
    def test_provisional_and_final_rows_for_one_identity_collapse_to_the_final(self):
        identity = "AUTO-emp-1-2026-08-03-unnotified-absence"
        provisional = _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE", identity=identity, day_closed=0)
        final = _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE", identity=identity, day_closed=1)

        for order in ([provisional, final], [final, provisional]):
            with self.subTest(first=order[0]["day_closed"]):
                payload = build_queue(
                    flags=order,
                    decisions_by_identity={},
                    employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
                    outage_branch_dates=set(),
                )
                person = payload["entries"][0]
                self.assertEqual(len(person["flags"]), 1)
                self.assertEqual(person["flags"][0]["day_closed"], 1)
                self.assertEqual(person["undecided_count"], 1)
                self.assertEqual(payload["counts"]["open"], 1)


class FlagDateTests(unittest.TestCase):
    def test_each_flag_carries_its_own_date(self):
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})
        result = build_queue(
            flags=[flag],
            decisions_by_identity={},
            employees_by_id={"EMP-1": {"employee_name": "Sokheng Hon", "branch": "HQ"}},
            outage_branch_dates=set(),
        )
        person = result["entries"][0]
        self.assertEqual(person["flags"][0]["attendance_date"], DATE)

    def test_flag_date_is_normalised_from_a_date_object(self):
        flag = _flag("EMP-1", date(2026, 8, 3), "LATE_START", evidence={"minutes": 9})
        result = build_queue(
            flags=[flag],
            decisions_by_identity={},
            employees_by_id={},
            outage_branch_dates=set(),
        )
        self.assertEqual(result["entries"][0]["flags"][0]["attendance_date"], "2026-08-03")

    def test_person_dates_lists_every_date_its_flags_fall_on(self):
        # One person, one code, two days — too few days to form a pattern, so this
        # stays a single person entry and proves `dates` spans what the entry holds.
        flags = [
            _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-1", DATE2, "LATE_START", evidence={"minutes": 11}),
        ]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id={"EMP-1": {"employee_name": "Sokheng Hon", "branch": "HQ"}},
            outage_branch_dates=set(),
        )
        entries = result["entries"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["dates"], [DATE, DATE2])

    def test_person_attendance_date_is_the_worst_unresolved_flags_date(self):
        # A 3-hour gap on DATE2 outranks a 9-minute late start on DATE, so the
        # person's headline date is DATE2 even though DATE sorts first.
        #
        # NOTE: this does not discriminate the selection rule itself — `by_person`
        # is keyed (employee, date_str) until Task 3, so `build_queue` never hands
        # `_person` a `person_flags` list spanning two dates; this passes even
        # under an "earliest date" rule. See `PersonUnitTests` below for coverage
        # that actually pins "worst", by calling `_person` directly with a span.
        flags = [
            _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-1", DATE2, "MISSING_TIME", evidence={"minutes": 192}),
        ]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id={"EMP-1": {"employee_name": "Sokheng Hon", "branch": "HQ"}},
            outage_branch_dates=set(),
        )
        self.assertEqual(result["entries"][0]["attendance_date"], DATE2)


class PersonUnitTests(unittest.TestCase):
    """`_person` exercised directly, not through `build_queue`.

    `build_queue` cannot hand `_person` a `person_flags` list spanning two dates
    until Task 3 — `by_person` is keyed `(employee, date_str)`, so every list it
    assembles today holds exactly one distinct date, which makes any
    date-selection rule (worst, earliest, last-in-list) agree by construction.
    `_person` itself already accepts a genuine span, so these tests build
    FlagOut dicts (via `_flag_out`, the real shape) directly and call `_person`.
    """

    def test_attendance_date_is_the_worst_flags_own_date_not_its_list_position(self):
        # Worst-first order (the precondition `_person` documents): the act-tier
        # gap sorts ahead of the routine late start because it outranks it, and
        # its OWN date happens to be the later one.
        gap = _flag_out(
            _flag("EMP-1", DATE2, "MISSING_TIME", evidence={"minutes": 192}), {}
        )
        late = _flag_out(_flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}), {})
        person = _person("EMP-1", [gap, late], {}, entry_key="p:EMP-1")
        self.assertEqual(person["attendance_date"], DATE2)

        # Same worst-first order, but the two flags' dates are now swapped: the
        # worst flag (still first in the list) now carries the EARLIER date. A
        # rule that returned "the later date" or "whichever date is last" would
        # still say DATE2 here; `_person` must instead say DATE, because it reads
        # the worst flag's own `attendance_date`, not a position or a min/max
        # over the list.
        gap_on_the_earlier_date = _flag_out(
            _flag("EMP-1", DATE, "MISSING_TIME", evidence={"minutes": 192}), {}
        )
        late_on_the_later_date = _flag_out(
            _flag("EMP-1", DATE2, "LATE_START", evidence={"minutes": 9}), {}
        )
        swapped = _person(
            "EMP-1", [gap_on_the_earlier_date, late_on_the_later_date], {}, entry_key="p:EMP-1"
        )
        self.assertEqual(swapped["attendance_date"], DATE)

    def test_dates_is_every_distinct_date_sorted_ascending(self):
        flags = [
            _flag_out(_flag("EMP-1", DATE2, "MISSING_TIME", evidence={"minutes": 192}), {}),
            _flag_out(_flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}), {}),
            _flag_out(_flag("EMP-1", DATE2, "NON_PRIMARY_SITE_PUNCH"), {}),
        ]
        person = _person("EMP-1", flags, {}, entry_key="p:EMP-1")
        self.assertEqual(person["dates"], [DATE, DATE2])

    def test_a_fully_settled_person_still_gets_a_date_from_their_worst_flag_overall(self):
        # flag_grouping.py:196 — every flag decided, so `unresolved` is empty and
        # `top` falls back to `person_flags[0]`. Uncovered until now, and the
        # branch most likely to silently regress to a bare `None`.
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})
        settled = _flag_out(flag, {flag["flag_identity"]: _decision(flag)})
        self.assertEqual(settled["decision_state"], "matched")

        person = _person("EMP-1", [settled], {}, entry_key="p:EMP-1")
        self.assertEqual(person["attendance_date"], DATE)
        self.assertEqual(person["rank"], 0)
        self.assertEqual(person["undecided_count"], 0)


class EntryKeyTests(unittest.TestCase):
    def test_entry_keys_are_distinct_and_correctly_scoped(self):
        # EMP-1/EMP-2 share a routine code -> a qualifying group of two.
        # EMP-3 is act tier with no outage -> a lone entry.
        # EMP-4 is the only holder of ITS routine code -> a would-be group of
        # one that degrades to a lone entry, exercising the member-stamping
        # loop's placement AFTER the `< GROUP_MIN_MEMBERS` demotion: a demoted
        # member must keep its lone key, not a group-scoped one that was never
        # assigned.
        flags = [
            _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-3", DATE, "UNNOTIFIED_ABSENCE"),
            _flag("EMP-4", DATE, "NON_PRIMARY_SITE_PUNCH"),
        ]
        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"),
                ("EMP-2", "Ben", "BR-A"),
                ("EMP-3", "Cy", "BR-B"),
                ("EMP-4", "Dee", "BR-C"),
            ),
            outage_branch_dates=set(),
        )

        routine = _groups(payload, "ROUTINE_CODE")
        self.assertEqual(len(routine), 1)
        group = routine[0]
        self.assertEqual([m["employee"] for m in group["members"]], ["EMP-1", "EMP-2"])

        loners = [e for e in payload["entries"] if e["kind"] == "person"]
        self.assertEqual(sorted(e["employee"] for e in loners), ["EMP-3", "EMP-4"])

        all_keys = [m["entry_key"] for m in group["members"]] + [e["entry_key"] for e in loners]
        self.assertEqual(len(all_keys), len(set(all_keys)))

        for member in group["members"]:
            self.assertTrue(
                member["entry_key"].startswith(group["group_key"] + "|p:"),
                member["entry_key"],
            )
            self.assertEqual(
                member["entry_key"], "{0}|p:{1}".format(group["group_key"], member["employee"])
            )

        # The lone form is `p:<employee>`: one entry now holds every leftover flag
        # of theirs, whatever date each falls on, so the key cannot carry a date.
        for loner in loners:
            self.assertEqual(loner["entry_key"], "p:{0}".format(loner["employee"]))


def _days(employee, code, dates, *, evidence=None):
    """person_day dicts for one employee hitting one code on several dates."""
    return [
        {
            "employee": employee,
            "date": d,
            "flags": [_flag_out_for(_flag(employee, d, code, evidence=evidence or {}))],
        }
        for d in dates
    ]


def _flag_out_for(flag):
    from dewey_time.attendance_engine.flag_grouping import _flag_out

    return _flag_out(flag, {})


D1, D2, D3, D4 = "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"


class PatternDetectionTests(unittest.TestCase):
    def test_three_days_two_people_qualifies(self):
        person_days = (
            _days("EMP-1", "LATE_START", [D1, D2, D3], evidence={"minutes": 9})
            + _days("EMP-2", "LATE_START", [D1, D2, D3], evidence={"minutes": 12})
        )
        self.assertEqual(_pattern_codes(person_days), {"LATE_START": {"EMP-1", "EMP-2"}})

    def test_two_days_is_not_a_pattern(self):
        person_days = (
            _days("EMP-1", "LATE_START", [D1, D2], evidence={"minutes": 9})
            + _days("EMP-2", "LATE_START", [D1, D2], evidence={"minutes": 12})
        )
        self.assertEqual(_pattern_codes(person_days), {})

    def test_one_person_alone_does_not_form_a_group(self):
        person_days = _days("EMP-1", "LATE_START", [D1, D2, D3, D4], evidence={"minutes": 9})
        self.assertEqual(_pattern_codes(person_days), {})

    def test_an_act_tier_flag_never_forms_a_pattern(self):
        # UNNOTIFIED_ABSENCE ranks 150 -> act. Four no-shows each for two people is
        # four things to look at, not a batch to excuse. Spec rule 4.
        person_days = (
            _days("EMP-1", "UNNOTIFIED_ABSENCE", [D1, D2, D3, D4])
            + _days("EMP-2", "UNNOTIFIED_ABSENCE", [D1, D2, D3, D4])
        )
        self.assertEqual(_pattern_codes(person_days), {})

    def test_a_review_tier_flag_does_form_a_pattern(self):
        # MISSING_TIME under 120 min ranks 60 -> review, which is pattern-eligible.
        person_days = (
            _days("EMP-1", "MISSING_TIME", [D1, D2, D3], evidence={"minutes": 45})
            + _days("EMP-2", "MISSING_TIME", [D1, D2, D3], evidence={"minutes": 50})
        )
        self.assertEqual(_pattern_codes(person_days), {"MISSING_TIME": {"EMP-1", "EMP-2"}})

    def test_act_tier_days_do_not_count_toward_a_pattern_of_the_same_code(self):
        # Same code, but only the review-tier days count. EMP-1 has two review-tier
        # MISSING_TIME days and one act-tier (3h) day: two days is not a pattern.
        person_days = (
            _days("EMP-1", "MISSING_TIME", [D1, D2], evidence={"minutes": 45})
            + _days("EMP-1", "MISSING_TIME", [D3], evidence={"minutes": 192})
            + _days("EMP-2", "MISSING_TIME", [D1, D2, D3], evidence={"minutes": 45})
        )
        self.assertEqual(_pattern_codes(person_days), {})

    def test_a_decided_flag_does_not_count_toward_a_pattern(self):
        person_days = _days("EMP-1", "LATE_START", [D1, D2, D3], evidence={"minutes": 9})
        for pd in person_days:
            pd["flags"][0]["decision_state"] = "matched"
        person_days += _days("EMP-2", "LATE_START", [D1, D2, D3], evidence={"minutes": 12})
        self.assertEqual(_pattern_codes(person_days), {})

    def test_several_flags_on_one_day_count_as_one_date_not_several(self):
        # flag_identity gives MISSING_TIME an evidence-keyed suffix, so several
        # mid-shift gaps on the SAME day survive build_queue's dedup as distinct
        # flags with distinct flag_identity values -- this is reachable in
        # production, not hypothetical. EMP-1 has three same-code flags on D1 and
        # one more on D2: four flags, but only two DISTINCT dates, which is one
        # short of PATTERN_MIN_DAYS. EMP-2 is a genuine 3-distinct-day qualifier so
        # the GROUP_MIN_MEMBERS gate doesn't itself hide a "counted flags, not
        # dates" bug -- if EMP-1 wrongly qualified too, the code would clear both
        # gates and this would stop being {}.
        day_one_gaps = [
            _flag_out_for(_flag(
                "EMP-1", D1, "MISSING_TIME", evidence={"minutes": 45},
                identity="AUTO-emp-1-{0}-missing-time-1".format(D1),
            )),
            _flag_out_for(_flag(
                "EMP-1", D1, "MISSING_TIME", evidence={"minutes": 40},
                identity="AUTO-emp-1-{0}-missing-time-2".format(D1),
            )),
            _flag_out_for(_flag(
                "EMP-1", D1, "MISSING_TIME", evidence={"minutes": 35},
                identity="AUTO-emp-1-{0}-missing-time-3".format(D1),
            )),
        ]
        person_days = [
            {"employee": "EMP-1", "date": D1, "flags": day_one_gaps},
            {
                "employee": "EMP-1",
                "date": D2,
                "flags": [_flag_out_for(_flag("EMP-1", D2, "MISSING_TIME", evidence={"minutes": 45}))],
            },
        ] + _days("EMP-2", "MISSING_TIME", [D1, D2, D3], evidence={"minutes": 45})

        self.assertEqual(_pattern_codes(person_days), {})


class DayTierTests(unittest.TestCase):
    """`_day_tier` exercised directly. It has no coverage through `build_queue` or
    `_pattern_codes` -- both tasks that consume it land in Task 3 -- so without
    tests of its own the unresolved-only filter (the whole point of the function:
    the ROUTINE_CODE guard's "and nothing else wrong that day") is unprotected.
    """

    def test_the_worst_unresolved_flag_sets_the_tier(self):
        gap = _flag_out_for(_flag("EMP-1", D1, "MISSING_TIME", evidence={"minutes": 45}))  # review
        late = _flag_out_for(_flag("EMP-1", D1, "LATE_START", evidence={"minutes": 9}))  # routine
        self.assertEqual(_day_tier([late, gap]), "review")
        self.assertEqual(_day_tier([gap, late]), "review")

    def test_a_decided_act_flag_does_not_raise_the_day_tier(self):
        # This is the case a filter-less `_day_tier` (ranking every flag on the day
        # regardless of decision_state) would get wrong: an already-dismissed
        # UNNOTIFIED_ABSENCE (act, rank 150) must not out-rank the still-open
        # LATE_START (routine, rank 20) just because it is on the same day.
        absence = _flag("EMP-1", D1, "UNNOTIFIED_ABSENCE")
        decided_absence = _flag_out(absence, {absence["flag_identity"]: _decision(absence)})
        self.assertEqual(decided_absence["decision_state"], "matched")
        late = _flag_out_for(_flag("EMP-1", D1, "LATE_START", evidence={"minutes": 9}))

        self.assertEqual(_day_tier([decided_absence, late]), "routine")

    def test_a_day_with_no_unresolved_flags_is_routine(self):
        # tier_for_rank(0) == "routine" -- the permissive answer for "nothing left
        # to look at today" is intentional; pin it rather than leaving it implicit.
        flag = _flag("EMP-1", D1, "LATE_START", evidence={"minutes": 9})
        decided = _flag_out(flag, {flag["flag_identity"]: _decision(flag)})
        self.assertEqual(_day_tier([decided]), "routine")


def _emps(*ids):
    return {e: {"employee_name": "Name {0}".format(e), "branch": "HQ"} for e in ids}


def _entries_by_kind(result, group_type=None):
    out = []
    for entry in result["entries"]:
        if group_type is None:
            out.append(entry)
        elif entry["kind"] == "group" and entry["group_type"] == group_type:
            out.append(entry)
    return out


class RepeatPatternTests(unittest.TestCase):
    def _late_pattern(self):
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
        return flags

    def test_a_person_with_flags_on_five_days_appears_once(self):
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3, D4, "2026-08-07"):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        appearances = [
            person
            for person in _iter_all_people(result["entries"])
            if person["employee"] == "EMP-1"
        ]
        self.assertEqual(len(appearances), 1)
        self.assertEqual(len(appearances[0]["flags"]), 5)

    def test_every_flag_appears_in_exactly_one_entry(self):
        # The invariant that replaced "a person appears once". Asserted over the
        # whole assembled set, not per entry.
        flags = self._late_pattern() + [
            _flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192}),
            _flag("EMP-3", D1, "UNNOTIFIED_ABSENCE"),
            # A would-be routine group of ONE, so the fixture exercises the
            # degradation path too. Without it this asserts only that no flag is
            # duplicated; a group that dropped its members' flags on demotion
            # instead of handing them back would slip through.
            _flag("EMP-4", D1, "NON_PRIMARY_SITE_PUNCH"),
        ]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2", "EMP-3", "EMP-4"),
            outage_branch_dates=set(),
        )
        seen = []
        for person in _iter_all_people(result["entries"]):
            seen.extend(f["flag_identity"] for f in person["flags"])
        self.assertEqual(len(seen), len(flags))
        self.assertEqual(len(set(seen)), len(flags))

    def test_a_pattern_group_holds_the_patterned_code_only(self):
        flags = self._late_pattern() + [_flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192})]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        groups = _entries_by_kind(result, "REPEAT_PATTERN")
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["flag_code"], "LATE_START")
        self.assertIsNone(groups[0]["attendance_date"])
        self.assertIsNone(groups[0]["branch"])
        codes = {f["flag_code"] for m in groups[0]["members"] for f in m["flags"]}
        self.assertEqual(codes, {"LATE_START"})

    def test_the_outlier_becomes_its_own_person_entry(self):
        flags = self._late_pattern() + [_flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192})]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        loners = [e for e in result["entries"] if e["kind"] == "person"]
        self.assertEqual(len(loners), 1)
        self.assertEqual(loners[0]["employee"], "EMP-1")
        self.assertEqual([f["flag_code"] for f in loners[0]["flags"]], ["MISSING_TIME"])

    def test_a_pattern_group_ranks_at_its_worst_members_rank(self):
        flags = self._late_pattern()
        # EMP-2's third late start is 90 minutes -> rank 65, above the 20s.
        flags[-1] = _flag("EMP-2", D3, "LATE_START", evidence={"minutes": 90})
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        group = _entries_by_kind(result, "REPEAT_PATTERN")[0]
        self.assertEqual(group["rank"], 65)
        self.assertEqual(group["tier"], "review")

    def test_a_branch_outage_claims_the_day_ahead_of_a_pattern(self):
        # Precedence 1 beats precedence 2: a device outage explains the flags
        # regardless of whether the people involved are also repeat offenders.
        flags = self._late_pattern()
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates={("HQ", D1)},
        )
        branch_groups = _entries_by_kind(result, "BRANCH_NO_DEVICE_DATA")
        self.assertEqual(len(branch_groups), 1)
        dates = {f["attendance_date"] for m in branch_groups[0]["members"] for f in m["flags"]}
        self.assertEqual(dates, {D1})
        # D1 is gone, so only D2 and D3 remain — two days, no longer a pattern.
        self.assertEqual(_entries_by_kind(result, "REPEAT_PATTERN"), [])

    def test_one_person_late_four_times_is_a_person_row_not_a_group(self):
        flags = [_flag("EMP-1", d, "LATE_START", evidence={"minutes": 9}) for d in (D1, D2, D3, D4)]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1"),
            outage_branch_dates=set(),
        )
        self.assertEqual(_entries_by_kind(result, "REPEAT_PATTERN"), [])
        self.assertEqual(len(result["entries"]), 1)
        self.assertEqual(len(result["entries"][0]["flags"]), 4)

    def test_the_routine_guard_reads_the_whole_day_not_what_the_pattern_left(self):
        # `_day_tier` is computed over the WHOLE day, BEFORE pattern claiming
        # removes anything, and carried on the leftover record. That is what keeps
        # the ROUTINE_CODE group's "and nothing else wrong that day" true — the
        # clause is about how bad the day was, not about which entry each flag
        # ended up in.
        #
        # D1 holds a review-tier MISSING_TIME (45 min -> rank 60) that the pattern
        # claims, plus a routine LATE_START that it does not. The day was review
        # tier, so the surviving late start must NOT be bulk-clearable in a
        # ROUTINE_CODE group; it falls through to its person's own row. Recompute
        # the tier on the leftovers instead and the day looks routine, which is the
        # bug this pins.
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3):
                flags.append(_flag(employee, d, "MISSING_TIME", evidence={"minutes": 45}))
            flags.append(_flag(employee, D1, "LATE_START", evidence={"minutes": 9}))
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )

        # The pattern forms and takes all six gaps.
        pattern = _entries_by_kind(result, "REPEAT_PATTERN")
        self.assertEqual(len(pattern), 1)
        self.assertEqual(pattern[0]["flag_code"], "MISSING_TIME")

        # …and the two late starts stay OUT of a routine group.
        self.assertEqual(_entries_by_kind(result, "ROUTINE_CODE"), [])
        loners = [e for e in result["entries"] if e["kind"] == "person"]
        self.assertEqual(sorted(e["employee"] for e in loners), ["EMP-1", "EMP-2"])
        for loner in loners:
            self.assertEqual([f["flag_code"] for f in loner["flags"]], ["LATE_START"])

    def test_a_routine_group_is_named_after_a_code_it_actually_contains(self):
        # The ROUTINE_CODE key comes from the worst REMAINING unresolved flag, not
        # the worst flag of the whole day: the day's worst may already have been
        # claimed by the pattern, and a group labelled with a code none of its
        # flags carry is a lie on the card and an unfindable bulk decision.
        #
        # D1 holds LATE_START (rank 20, the day's worst) which the pattern claims,
        # and NON_PRIMARY_SITE_PUNCH (rank 10) which survives. The group must be
        # named for the punch, not the late start.
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
            flags.append(_flag(employee, D1, "NON_PRIMARY_SITE_PUNCH"))
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )

        routine = _entries_by_kind(result, "ROUTINE_CODE")
        self.assertEqual(len(routine), 1)
        self.assertEqual(routine[0]["flag_code"], "NON_PRIMARY_SITE_PUNCH")
        self.assertEqual(
            routine[0]["group_key"], "ROUTINE_CODE:NON_PRIMARY_SITE_PUNCH:" + D1
        )

        # The general property, not just this fixture: every cause group named
        # after a code holds at least one flag bearing it.
        for group in _entries_by_kind(result, "ROUTINE_CODE") + _entries_by_kind(
            result, "REPEAT_PATTERN"
        ):
            codes = {f["flag_code"] for m in group["members"] for f in m["flags"]}
            self.assertIn(group["flag_code"], codes, group["group_key"])

    def test_entry_keys_are_unique_across_the_assembled_set(self):
        flags = self._late_pattern() + [_flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192})]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        keys = [p["entry_key"] for p in _iter_all_people(result["entries"])]
        self.assertEqual(len(keys), len(set(keys)))
        # EMP-1 is in two entries and must not collide with themselves.
        emp1 = sorted(p["entry_key"] for p in _iter_all_people(result["entries"]) if p["employee"] == "EMP-1")
        self.assertEqual(emp1, ["REPEAT_PATTERN:LATE_START|p:EMP-1", "p:EMP-1"])


class CrossReferenceTests(unittest.TestCase):
    def _split_person(self):
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
        flags.append(_flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192}))
        return build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )

    def test_a_person_in_two_entries_is_badged_in_both(self):
        result = self._split_person()
        appearances = [p for p in _iter_all_people(result["entries"]) if p["employee"] == "EMP-1"]
        self.assertEqual(len(appearances), 2)
        for person in appearances:
            self.assertEqual(person["also_count"], 1)

    def test_the_group_member_names_the_other_entry_as_an_outlier(self):
        result = self._split_person()
        member = next(
            p for p in _iter_all_people(result["entries"])
            if p["employee"] == "EMP-1" and p["entry_key"].startswith("REPEAT_PATTERN")
        )
        # The other entry is a lone person row — an outlier by construction.
        self.assertEqual(member["also_outlier_count"], 1)

    def test_the_outlier_row_does_not_count_itself(self):
        result = self._split_person()
        loner = next(
            p for p in _iter_all_people(result["entries"])
            if p["employee"] == "EMP-1" and p["entry_key"] == "p:EMP-1"
        )
        self.assertEqual(loner["also_count"], 1)
        # The OTHER entry is a group, not an outlier.
        self.assertEqual(loner["also_outlier_count"], 0)

    def test_a_person_in_one_entry_is_not_badged(self):
        result = self._split_person()
        emp2 = next(p for p in _iter_all_people(result["entries"]) if p["employee"] == "EMP-2")
        self.assertEqual(emp2["also_count"], 0)
        self.assertEqual(emp2["also_outlier_count"], 0)

    def test_counts_rows_equals_the_number_of_entries(self):
        result = self._split_person()
        self.assertEqual(result["counts"]["rows"], len(result["entries"]))
        self.assertEqual(result["counts"]["rows"], 2)

    def test_counts_people_counts_distinct_employees_including_group_members(self):
        result = self._split_person()
        self.assertEqual(result["counts"]["people"], 2)

    def test_a_person_in_two_group_entries_and_no_lone_row_has_zero_outliers(self):
        # EMP-1 sits in a REPEAT_PATTERN group (their late starts) AND a
        # ROUTINE_CODE group (a branch punch shared with EMP-3 on D4) — two
        # entries, neither one a lone person row. This is the fixture that
        # distinguishes counting `kind == "person"` from counting
        # `kind == "group"`: with exactly one of each kind (the split-person
        # fixture above) the two counting rules produce the same number by
        # coincidence, so only an all-group appearance set actually pins which
        # kind the outlier count is counting.
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
        for employee in ("EMP-1", "EMP-3"):
            flags.append(_flag(employee, D4, "NON_PRIMARY_SITE_PUNCH"))

        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2", "EMP-3"),
            outage_branch_dates=set(),
        )

        appearances = [p for p in _iter_all_people(result["entries"]) if p["employee"] == "EMP-1"]
        self.assertEqual(len(appearances), 2)
        self.assertTrue(all(p["entry_key"] != "p:EMP-1" for p in appearances))
        for person in appearances:
            self.assertEqual(person["also_count"], 1)
            self.assertEqual(person["also_outlier_count"], 0)


class EmployeeImageTests(unittest.TestCase):
    def test_a_persons_photo_reaches_the_entry(self):
        result = build_queue(
            flags=[_flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})],
            decisions_by_identity={},
            employees_by_id={
                "EMP-1": {
                    "employee_name": "Sokheng Hon",
                    "branch": "HQ",
                    "image": "/files/sokheng.jpg",
                }
            },
            outage_branch_dates=set(),
        )
        self.assertEqual(result["entries"][0]["employee_image"], "/files/sokheng.jpg")

    def test_an_employee_with_no_photo_carries_none_not_a_missing_key(self):
        result = build_queue(
            flags=[_flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})],
            decisions_by_identity={},
            employees_by_id={"EMP-1": {"employee_name": "Sokheng Hon", "branch": "HQ"}},
            outage_branch_dates=set(),
        )
        self.assertIsNone(result["entries"][0]["employee_image"])


class RecountAgreementTests(unittest.TestCase):
    """flag_queue_api's tier filter calls `recount()` over a SLICE of the exact
    entries `build_queue` returns. Synthetic entry dicts can't close the gap the
    two-definitions bug hid in — a shape drift between what `build_queue`
    assembles and what a hand-written recount expects would still agree on
    fixtures built by hand. This runs `recount` over REAL `build_queue` output
    instead, on a fixture with at least one group AND one lone entry so
    `iter_people` has to walk both shapes it supports.
    """

    def test_recount_over_real_entries_matches_build_queues_own_counts(self):
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
        flags.append(_flag("EMP-3", D1, "UNNOTIFIED_ABSENCE"))

        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2", "EMP-3"),
            outage_branch_dates=set(),
        )

        # A REPEAT_PATTERN group (EMP-1, EMP-2) and a lone person entry (EMP-3):
        # the two entry shapes `iter_people` has to flatten identically.
        self.assertEqual({e["kind"] for e in result["entries"]}, {"group", "person"})

        self.assertEqual(
            recount(result["entries"]),
            {"rows": result["counts"]["rows"], "people": result["counts"]["people"]},
        )


if __name__ == "__main__":
    unittest.main()
