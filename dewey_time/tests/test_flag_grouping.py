import json
import unittest
from datetime import date, datetime

# No frappe mock is installed here on purpose: flag_grouping and both modules it
# imports (flag_identity, flag_triage) are frappe-free by design — flag_identity
# carries its own local `_scrub` rather than calling `frappe.scrub`, exactly so
# these modules import without a bench. Same shape as test_flag_identity.py and
# test_flag_triage.py, which mock nothing either.
from dewey_time.attendance_engine.flag_grouping import build_queue
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
    people = []
    for entry in payload["entries"]:
        if entry["kind"] == "group":
            people.extend(entry["members"])
        else:
            people.append(entry)
    return people


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

    def test_one_employee_flagged_on_two_days_is_two_entries_but_one_person(self):
        payload = build_queue(
            flags=[
                _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE"),
                _flag("EMP-1", DATE2, "UNNOTIFIED_ABSENCE"),
            ],
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(len(payload["entries"]), 2)
        self.assertEqual(sorted(e["attendance_date"] for e in payload["entries"]), [DATE, DATE2])
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
            payload["counts"], {"open": 0, "needs_re_review": 1, "decided": 0, "people": 1}
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
            payload["counts"], {"open": 0, "needs_re_review": 0, "decided": 1, "people": 0}
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
            payload["counts"], {"open": 2, "needs_re_review": 0, "decided": 2, "people": 2}
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

        self.assertEqual(len(_person_days(payload)), 6)
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
            payload["counts"], {"open": 1, "needs_re_review": 1, "decided": 1, "people": 2}
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
        # inflate it — and no other count moves either.
        self.assertEqual(self._fixture()["counts"], self._fixture(include_decided=True)["counts"])
        self.assertEqual(self._fixture(include_decided=True)["counts"]["people"], 1)

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

    @unittest.expectedFailure  # Task 3 merges a person's leftover days into one entry.
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


if __name__ == "__main__":
    unittest.main()
