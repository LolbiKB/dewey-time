"""Envelope tests for the HR flag queue read API.

Scope: what flag_queue_api itself is responsible for — the permission gate, the range
cap, the FIXED query budget, truncation, the cache, and the device-outage/alert
assembly. Ranking, person-dedup and grouping belong to flag_grouping and are covered by
test_flag_grouping.py, so build_queue is stubbed here and asserted on its INPUTS.
"""

import json
import sys
import unittest
from contextlib import contextmanager
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# hooks.py imports the asset-sync helpers, which pull in `requests`; stub it exactly as
# test_hooks_launcher_tiles.py:12-19 does so the doc_events wiring test can import hooks.
if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

import dewey_time.hooks as hooks  # noqa: E402
from dewey_time.attendance_engine import (  # noqa: E402
    flag_decision_api,
    flag_grouping,
    flag_identity,
    flag_queue_api,
    rollout,
)

INVALIDATOR = "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache"


def _real_getdate(value):
    """The shared frappe mock stubs getdate to identity (test_closeout.py:35), which
    breaks the range arithmetic get_flag_queue does. Give the module a real one."""
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


class _FakeCache:
    """Minimal stand-in for frappe.cache() — a real dict so the second call in a test
    actually hits the cache instead of just recording that set_value happened."""

    def __init__(self):
        self.store = {}
        self.set_calls = []
        self.deleted_prefixes = []

    def get_value(self, key):
        return self.store.get(key)

    def set_value(self, key, value, expires_in_sec=None):
        self.store[key] = value
        self.set_calls.append((key, expires_in_sec))

    def delete_keys(self, prefix):
        self.deleted_prefixes.append(prefix)
        self.store = {k: v for k, v in self.store.items() if not k.startswith(prefix)}


class _Recorder:
    """Stands in for frappe.get_all: serves canned rows and records every call, so a
    test can assert the query COUNT and the filters each query was issued with."""

    def __init__(self, rows_by_doctype):
        self.rows_by_doctype = rows_by_doctype
        self.calls = []

    @staticmethod
    def _matches(row, filters):
        """Honour SCALAR EQUALITY filters, and only for a key the canned row carries.

        Operator filters (["between", …], ["in", …], ["is", "not set"]) are still
        ignored — every fixture here is deliberately inside the range or set they
        express — but an equality filter like source == "AUTO" is a correctness
        invariant, and a fake that ignores it lets a mutant deleting the filter pass
        with the suite green. That is exactly the blindness Task 5's review found in
        the decision-write harness; this is the same repair on the read side.
        """
        for field, expected in filters.items():
            if isinstance(expected, (list, tuple)):
                continue
            if field in row and row[field] != expected:
                return False
        return True

    @staticmethod
    def _ordered(rows, order_by):
        """Honour `order_by` before the limit slice.

        A fake that ignores ordering cannot tell "keep the newest 5000" from "keep the
        oldest 5000" — it slices whatever order the fixture happened to be written in,
        so a mutant flipping the direction stays green. That is the same blindness
        _matches was repaired for above, on the axis that decides WHICH rows survive
        truncation rather than whether they match.

        Sorts are stable, so applying the clauses right-to-left yields the multi-key
        order. Values are compared as strings: an ISO date sorts identically either
        way, and it keeps a date object and its string form from raising on compare.
        """
        for clause in reversed([c.strip() for c in str(order_by or "").split(",") if c.strip()]):
            parts = clause.split()
            field = parts[0]
            if not any(field in row for row in rows):
                continue
            rows = sorted(
                rows,
                key=lambda row: (row.get(field) is None, str(row.get(field))),
                reverse=len(parts) > 1 and parts[1].lower() == "desc",
            )
        return rows

    def __call__(self, doctype, **kwargs):
        self.calls.append((doctype, kwargs))
        rows = [
            row
            for row in self.rows_by_doctype.get(doctype, [])
            if self._matches(row, kwargs.get("filters") or {})
        ]
        rows = self._ordered(rows, kwargs.get("order_by"))
        limit = kwargs.get("limit_page_length")
        if limit:
            rows = rows[:limit]
        # Copies: the API stringifies dates in place, and a shared row would leak
        # between the two calls of the cache test.
        return [dict(row) for row in rows]

    @property
    def count(self):
        return len(self.calls)

    def doctypes(self):
        return [name for name, _kwargs in self.calls]

    def kwargs_for(self, doctype):
        return [kwargs for name, kwargs in self.calls if name == doctype]


def _empty_queue():
    return {
        "entries": [],
        "counts": {"open": 0, "needs_re_review": 0, "decided": 0, "people": 0, "rows": 0},
        "orphans": {"orphaned_flag_gone": 0, "orphaned_evidence_changed": 0},
    }


@contextmanager
def _harness(rows_by_doctype=None, *, hr=True, queue=None, cache=None):
    import frappe

    recorder = _Recorder(rows_by_doctype or {})
    fake_cache = cache or _FakeCache()
    build = MagicMock(return_value=queue if queue is not None else _empty_queue())

    # frappe.db is shared across every test module using this mock; reset the two calls
    # a per-employee implementation would reach for so `assert_not_called` is meaningful.
    frappe.db.get_value.reset_mock()
    frappe.db.exists.reset_mock()

    with patch.object(flag_queue_api, "getdate", _real_getdate), patch.object(
        flag_queue_api.frappe, "get_all", recorder
    ), patch.object(
        flag_queue_api.frappe, "cache", MagicMock(return_value=fake_cache)
    ), patch.object(
        flag_queue_api, "build_queue", build
    ), patch(
        # The gate itself is covered by test_hr_calendar.py; here we only need to drive
        # it. flag_queue_api holds a reference to _require_hr_role, which reads
        # hr_calendar's module-global _is_hr_staff, so patching that drives both.
        "dewey_time.attendance_engine.hr_calendar._is_hr_staff",
        return_value=hr,
    ):
        yield SimpleNamespace(recorder=recorder, cache=fake_cache, build=build, frappe=frappe)


def _flag_row(employee, attendance_date="2026-08-03", flag_code="LATE_START", **extra):
    row = {
        "employee": employee,
        "attendance_date": attendance_date,
        "flag_code": flag_code,
        "severity": "WARNING",
        "day_closed": 1,
        "evidence": '{"minutes": 12}',
        # Carried so the recorder's equality filter can act on it — the module
        # never selects `source`, it only filters by it.
        "source": "AUTO",
    }
    row.update(extra)
    return row


def _employee_row(employee, branch="BR-A"):
    return {"name": employee, "employee_name": f"Name {employee}", "branch": branch}


def _roster(n, *, branch="BR-A", attendance_date="2026-08-03"):
    """n employees, each with exactly one flag on the same day."""
    ids = [f"HR-EMP-{i:05d}" for i in range(n)]
    return {
        "Attendance Flag": [_flag_row(e, attendance_date=attendance_date) for e in ids],
        "Attendance Flag Decision": [],
        "Employee": [_employee_row(e, branch=branch) for e in ids],
        "Device Closeout Alert": [],
        "Device Sync Status": [{"branch": branch, "local_date": attendance_date}],
    }


class TestQueuePermissionAndRange(unittest.TestCase):
    def test_non_hr_session_is_rejected_before_any_query(self):
        with _harness(_roster(2), hr=False) as h:
            with self.assertRaises(Exception):
                flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            self.assertEqual(h.recorder.count, 0)

    def test_range_longer_than_the_cap_is_rejected(self):
        with _harness(_roster(2)) as h:
            with self.assertRaises(Exception):
                # 32 days inclusive, one over QUEUE_MAX_RANGE_DAYS.
                flag_queue_api.get_flag_queue("2026-08-01", "2026-09-01")
            self.assertEqual(h.recorder.count, 0)

    def test_range_exactly_at_the_cap_is_accepted(self):
        with _harness(_roster(2)):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-31")  # 31 days
        self.assertEqual(payload["start_date"], "2026-08-01")
        self.assertEqual(payload["end_date"], "2026-08-31")

    def test_inverted_range_is_rejected(self):
        with _harness(_roster(2)):
            with self.assertRaises(Exception):
                flag_queue_api.get_flag_queue("2026-08-07", "2026-08-01")


class TestQueryBudget(unittest.TestCase):
    def test_query_count_is_independent_of_employee_count(self):
        with _harness(_roster(3)) as small:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            small_count = small.recorder.count
            small_doctypes = sorted(small.recorder.doctypes())

        with _harness(_roster(300)) as large:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            large_count = large.recorder.count
            large_doctypes = sorted(large.recorder.doctypes())
            large.frappe.db.get_value.assert_not_called()
            large.frappe.db.exists.assert_not_called()

        self.assertEqual(small_count, large_count)
        self.assertEqual(small_doctypes, large_doctypes)

    def test_each_doctype_is_queried_exactly_once(self):
        with _harness(_roster(300)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            doctypes = h.recorder.doctypes()
        for doctype in (
            "Attendance Flag",
            "Attendance Flag Decision",
            "Employee",
            "Device Closeout Alert",
            "Device Sync Status",
        ):
            self.assertEqual(doctypes.count(doctype), 1, f"{doctype} queried {doctypes.count(doctype)}x")

    def test_flag_query_carries_no_employee_filter(self):
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            filters = h.recorder.kwargs_for("Attendance Flag")[0]["filters"]
        self.assertNotIn("employee", filters)
        self.assertIn("attendance_date", filters)


class TestTruncation(unittest.TestCase):
    def test_flag_query_is_capped_at_the_flag_limit(self):
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            kwargs = h.recorder.kwargs_for("Attendance Flag")[0]
        self.assertEqual(kwargs.get("limit_page_length"), flag_queue_api.QUEUE_FLAG_LIMIT)

    def test_truncated_is_set_when_the_flag_query_hits_the_cap(self):
        with _harness(_roster(3)), patch.object(flag_queue_api, "QUEUE_FLAG_LIMIT", 3):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertTrue(payload["truncated"])

    def test_not_truncated_below_the_cap(self):
        with _harness(_roster(3)):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertFalse(payload["truncated"])

    def test_open_is_marked_capped_when_the_scan_hits_the_limit(self):
        """`open` counts the flags the scan returned, so at the cap it IS the cap.
        Without this the toolbar renders a constant as a measured total."""
        with _harness(_roster(3)), patch.object(flag_queue_api, "QUEUE_FLAG_LIMIT", 3):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertTrue(payload["counts"]["open_capped"])

    def test_open_is_not_marked_capped_below_the_limit(self):
        with _harness(_roster(3)):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertFalse(payload["counts"]["open_capped"])

    def test_open_capped_survives_the_tier_filter_recount(self):
        """recount() rewrites people/rows for a filtered list; open_capped describes
        the whole-range scan and must not be dropped on the way through."""
        with _harness(_roster(3)), patch.object(flag_queue_api, "QUEUE_FLAG_LIMIT", 3):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertTrue(payload["counts"]["open_capped"])

    def test_the_flag_scan_asks_for_the_newest_flags_first(self):
        """One word, and the queue starts hiding today's work — see _flag_rows."""
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            order_by = h.recorder.kwargs_for("Attendance Flag")[0]["order_by"]
        self.assertTrue(
            order_by.startswith("attendance_date desc"),
            f"expected the scan to lead with attendance_date desc, got {order_by!r}",
        )

    def test_truncation_drops_the_oldest_flags_not_the_newest(self):
        days = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]
        rows = {
            "Attendance Flag": [_flag_row("HR-EMP-00000", attendance_date=day) for day in days],
            "Attendance Flag Decision": [],
            "Employee": [_employee_row("HR-EMP-00000")],
            "Device Closeout Alert": [],
            "Device Sync Status": [],
        }
        # Cap of 2 against 5 days of flags: only the two newest may survive.
        with _harness(rows) as h, patch.object(flag_queue_api, "QUEUE_FLAG_LIMIT", 2):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            flags = h.build.call_args.kwargs["flags"]

        self.assertTrue(payload["truncated"])
        self.assertEqual(sorted(flag["attendance_date"] for flag in flags), ["2026-08-04", "2026-08-05"])

    def test_the_surviving_flags_reach_build_queue_oldest_first(self):
        """The scan runs newest-first; everything downstream still sees ascending
        order, so the dedupe's last-wins tiebreak does not flip with the query."""
        days = ["2026-08-01", "2026-08-02", "2026-08-03"]
        rows = {
            "Attendance Flag": [_flag_row("HR-EMP-00000", attendance_date=day) for day in days],
            "Attendance Flag Decision": [],
            "Employee": [_employee_row("HR-EMP-00000")],
            "Device Closeout Alert": [],
            "Device Sync Status": [],
        }
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            flags = h.build.call_args.kwargs["flags"]
        self.assertEqual([flag["attendance_date"] for flag in flags], days)

    def test_the_decision_scan_asks_for_the_newest_decisions_first(self):
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            order_by = h.recorder.kwargs_for("Attendance Flag Decision")[0]["order_by"]
        self.assertTrue(
            order_by.startswith("decided_at desc"),
            f"expected the decision scan to lead with decided_at desc, got {order_by!r}",
        )

    def test_both_capped_scans_drop_the_same_end(self):
        """The invariant, not just the direction.

        Flags and decisions share one cap. If one keeps its newest rows while the
        other keeps its oldest, the tails stop lining up: a flag survives while the
        decision that settled it is dropped, so a settled flag reads as open again
        and counts["decided"] undercounts. Asserting the two orderings agree is what
        stops a later edit fixing one scan and forgetting the other.
        """
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            flags = h.recorder.kwargs_for("Attendance Flag")[0]
            decisions = h.recorder.kwargs_for("Attendance Flag Decision")[0]

        self.assertEqual(flags["limit_page_length"], decisions["limit_page_length"])
        for kwargs in (flags, decisions):
            self.assertIn(" desc", kwargs["order_by"], f"{kwargs['order_by']!r} is not newest-first")

    def test_a_decided_flag_keeps_its_decision_when_the_scans_are_capped(self):
        """The behaviour the invariant above protects: at the cap, the newest flag
        and the decision that settled it must both survive."""
        rows = {
            "Attendance Flag": [
                _flag_row("HR-EMP-00000", attendance_date=day)
                for day in ("2026-08-01", "2026-08-02", "2026-08-05")
            ],
            "Attendance Flag Decision": [
                {
                    "name": f"AFD-{day}",
                    "flag_identity": f"AUTO-{day}",
                    "employee": "HR-EMP-00000",
                    "attendance_date": day,
                    "flag_code": "LATE_START",
                    "outcome": "EXCUSED",
                    "reason": "DEVICE_OR_DATA_FAULT",
                    "note": "",
                    "evidence_fingerprint": "fp",
                    "group_key": "AFD-batch",
                    "decided_by": "hr@example.com",
                    "decided_at": f"{day} 09:00:00",
                }
                for day in ("2026-08-01", "2026-08-02", "2026-08-05")
            ],
            "Employee": [_employee_row("HR-EMP-00000")],
            "Device Closeout Alert": [],
            "Device Sync Status": [],
        }
        with _harness(rows) as h, patch.object(flag_queue_api, "QUEUE_FLAG_LIMIT", 1):
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            decisions = h.build.call_args.kwargs["decisions_by_identity"]
        # The newest decision survived, not the oldest — matching the newest flag.
        self.assertEqual(list(decisions), ["AUTO-2026-08-05"])

    def test_entry_limit_slices_and_marks_truncated(self):
        entries = [
            {"kind": "person", "employee": f"HR-EMP-{i:05d}", "tier": "routine"} for i in range(4)
        ]
        queue = {**_empty_queue(), "entries": entries}
        with _harness(_roster(4), queue=queue):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", limit=2)
        self.assertEqual(len(payload["entries"]), 2)
        self.assertTrue(payload["truncated"])


class TestQueueInputs(unittest.TestCase):
    def test_flags_are_handed_to_build_queue_with_identities_and_parsed_evidence(self):
        with _harness(_roster(2)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            kwargs = h.build.call_args.kwargs
        flags = kwargs["flags"]
        self.assertEqual(len(flags), 2)
        self.assertTrue(all(f["flag_identity"] for f in flags))
        self.assertEqual(len({f["flag_identity"] for f in flags}), 2)
        self.assertEqual(flags[0]["evidence"], {"minutes": 12})
        self.assertEqual(flags[0]["attendance_date"], "2026-08-03")
        self.assertEqual(
            kwargs["employees_by_id"]["HR-EMP-00000"],
            {"employee_name": "Name HR-EMP-00000", "branch": "BR-A", "image": None},
        )

    def test_only_auto_flags_reach_the_queue(self):
        # flag_identity hard-prefixes "AUTO-" whatever the row's real source, so an
        # HR-created flag for the same employee/date would be decided under an
        # identity that belongs to the engine's row. Every other reader and writer
        # on this feature filters source == "AUTO" for exactly this reason, and the
        # missing-filter bug has already shipped twice on this branch.
        rows = _roster(1)
        rows["Attendance Flag"] = [
            _flag_row("HR-EMP-00000", flag_code="LATE_START"),
            _flag_row("HR-EMP-00000", flag_code="OFF_SHIFT_PUNCH", source="HR"),
        ]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            flags = h.build.call_args.kwargs["flags"]
            filters = h.recorder.kwargs_for("Attendance Flag")[0]["filters"]

        self.assertEqual(filters["source"], "AUTO")
        self.assertEqual([f["flag_code"] for f in flags], ["LATE_START"])

    def test_the_flag_scan_selects_rollout_phase(self):
        # A field absent from the scan means every flag reads as blank, which reads
        # as LIVE (_rollout_block), which silently disables the whole banner. Mutation
        # testing found that deleting this from the fields list survives the rest of
        # the suite unnoticed, because every other test here builds its own flag
        # dicts rather than going through this query. This pins the query itself.
        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            fields = h.recorder.kwargs_for("Attendance Flag")[0]["fields"]
        self.assertIn("rollout_phase", fields)

    def test_provisional_and_final_rows_collapse_to_the_final_flag(self):
        # flag_identity deliberately excludes day_closed, so during the closeout window
        # the same identity can arrive twice; the final row must win, once.
        rows = _roster(1)
        rows["Attendance Flag"] = [
            _flag_row("HR-EMP-00000", day_closed=0),
            _flag_row("HR-EMP-00000", day_closed=1),
        ]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            flags = h.build.call_args.kwargs["flags"]
        self.assertEqual(len(flags), 1)
        self.assertEqual(flags[0]["day_closed"], 1)

    def test_live_decisions_are_keyed_by_identity_and_filtered_to_superseded_zero(self):
        rows = _roster(1)
        rows["Attendance Flag Decision"] = [
            {
                "name": "AFD-0001",
                "flag_identity": "AUTO-hr-emp-00000-2026-08-03-late-start",
                "outcome": "EXCUSED",
                "reason": "MANAGER_APPROVED",
                "note": None,
                "evidence_fingerprint": "abc",
                "group_key": None,
                "decided_by": "hr@example.com",
                "decided_at": "2026-08-04 09:00:00",
            }
        ]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            decisions = h.build.call_args.kwargs["decisions_by_identity"]
            filters = h.recorder.kwargs_for("Attendance Flag Decision")[0]["filters"]
        self.assertEqual(filters["superseded"], 0)
        self.assertEqual(
            decisions["AUTO-hr-emp-00000-2026-08-03-late-start"]["outcome"], "EXCUSED"
        )

    def test_branch_date_with_no_sync_row_is_an_outage(self):
        rows = _roster(2)
        rows["Device Sync Status"] = []  # nothing ever reported for BR-A that day
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            outage = h.build.call_args.kwargs["outage_branch_dates"]
        self.assertIn(("BR-A", "2026-08-03"), outage)

    def test_branch_date_with_a_sync_row_and_no_alert_is_not_an_outage(self):
        with _harness(_roster(2)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            outage = h.build.call_args.kwargs["outage_branch_dates"]
        self.assertEqual(outage, set())

    def test_unresolved_alert_makes_the_branch_date_an_outage_even_with_sync_rows(self):
        rows = _roster(2)
        rows["Device Closeout Alert"] = [
            {
                "branch": "BR-A",
                "local_date": "2026-08-03",
                "status": "closure_failed",
                "last_error": "timeout",
            }
        ]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            outage = h.build.call_args.kwargs["outage_branch_dates"]
        self.assertIn(("BR-A", "2026-08-03"), outage)


class TestEmployeePhoto(unittest.TestCase):
    def test_the_employee_query_selects_the_photo_column(self):
        # A column, not a query: the fixed five-query budget is the defining
        # constraint of this endpoint.
        with _harness(_roster(2)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            fields = h.recorder.kwargs_for("Employee")[0]["fields"]
        self.assertIn("image", fields)

    def test_the_photo_reaches_build_queue_on_the_employee_meta(self):
        rows = _roster(1)
        rows["Employee"] = [{**_employee_row("HR-EMP-00000"), "image": "/files/sokheng.jpg"}]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            employees = h.build.call_args.kwargs["employees_by_id"]
        self.assertEqual(employees["HR-EMP-00000"]["image"], "/files/sokheng.jpg")

    def test_an_employee_with_no_photo_carries_none(self):
        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            employees = h.build.call_args.kwargs["employees_by_id"]
        self.assertIsNone(employees["HR-EMP-00000"]["image"])


class TestOutageDatesInPayload(unittest.TestCase):
    def test_a_branch_day_with_no_sync_row_reaches_the_payload(self):
        rows = _roster(2)
        rows["Device Sync Status"] = []  # nothing ever reported for BR-A that day
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["outage_dates"], [{"branch": "BR-A", "date": "2026-08-03"}])

    def test_a_branch_day_that_reported_is_not_an_outage(self):
        with _harness(_roster(2)):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["outage_dates"], [])

    def test_an_unresolved_alert_is_an_outage_even_with_a_sync_row(self):
        # `alerts` alone is not the signal and neither is the watermark: the
        # strip's grey state needs _outage_branch_dates' combination of both.
        rows = _roster(2)
        rows["Device Closeout Alert"] = [
            {
                "branch": "BR-A",
                "local_date": "2026-08-03",
                "status": "closure_failed",
                "last_error": None,
            }
        ]
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["outage_dates"], [{"branch": "BR-A", "date": "2026-08-03"}])

    def test_outage_dates_are_json_safe(self):
        # The payload is cached and returned over the wire; a set of tuples is
        # neither serialisable nor stably ordered.
        rows = _roster(2)
        rows["Device Sync Status"] = []
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        json.dumps(payload["outage_dates"])
        self.assertIsInstance(payload["outage_dates"], list)

    def test_outage_dates_are_returned_in_a_stable_sorted_order(self):
        # Five branch-days, deliberately built (and inserted) out of sorted
        # order: a plain `list(a_set)` has no defined iteration order — Python
        # randomises str hashing per process, so a missing `sorted()` matches
        # this expected order only by coincidence. Three elements gave that a
        # 1-in-6 chance of a false pass (observed in practice); five brings it
        # to 1-in-120. The payload is Redis-cached, so a cache hit and a cache
        # miss have to hand the strip the identical array or two requests for
        # the same range silently render the fortnight differently.
        rows = {
            "Attendance Flag": [
                _flag_row("HR-EMP-00000", attendance_date="2026-08-05"),
                _flag_row("HR-EMP-00001", attendance_date="2026-08-03"),
                _flag_row("HR-EMP-00002", attendance_date="2026-08-04"),
                _flag_row("HR-EMP-00003", attendance_date="2026-08-07"),
                _flag_row("HR-EMP-00004", attendance_date="2026-08-06"),
            ],
            "Attendance Flag Decision": [],
            "Employee": [
                _employee_row("HR-EMP-00000", branch="BR-Z"),
                _employee_row("HR-EMP-00001", branch="BR-A"),
                _employee_row("HR-EMP-00002", branch="BR-M"),
                _employee_row("HR-EMP-00003", branch="BR-Y"),
                _employee_row("HR-EMP-00004", branch="BR-C"),
            ],
            "Device Closeout Alert": [],
            "Device Sync Status": [],  # none of the five branch-days ever reported
        }
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(
            payload["outage_dates"],
            [
                {"branch": "BR-A", "date": "2026-08-03"},
                {"branch": "BR-C", "date": "2026-08-06"},
                {"branch": "BR-M", "date": "2026-08-04"},
                {"branch": "BR-Y", "date": "2026-08-07"},
                {"branch": "BR-Z", "date": "2026-08-05"},
            ],
        )


class TestAlerts(unittest.TestCase):
    def test_alerts_include_a_branch_with_an_unresolved_alert_and_zero_flags(self):
        # The fallback path skips these employees entirely, so NO flag exists — the whole
        # point of the alert list. It must therefore not be filtered by flag branches.
        rows = {
            "Attendance Flag": [],
            "Attendance Flag Decision": [],
            "Employee": [],
            "Device Closeout Alert": [
                {
                    "branch": "Phnom Penh HQ",
                    "local_date": "2026-08-03",
                    "status": "deferred_offline",
                    "last_error": None,
                }
            ],
            "Device Sync Status": [],
        }
        with _harness(rows) as h:
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            filters = h.recorder.kwargs_for("Device Closeout Alert")[0]["filters"]
        self.assertEqual(len(payload["alerts"]), 1)
        self.assertEqual(payload["alerts"][0]["branch"], "Phnom Penh HQ")
        self.assertEqual(payload["alerts"][0]["local_date"], "2026-08-03")
        self.assertNotIn("branch", filters)

    def test_alerts_never_carry_a_device_serial(self):
        rows = {
            "Attendance Flag": [],
            "Attendance Flag Decision": [],
            "Employee": [],
            "Device Closeout Alert": [
                {
                    "branch": "BR-A",
                    "local_date": "2026-08-03",
                    "status": "closure_failed",
                    "last_error": None,
                    "device_sn": "ZK-99",
                }
            ],
            "Device Sync Status": [],
        }
        with _harness(rows) as h:
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            fields = h.recorder.kwargs_for("Device Closeout Alert")[0]["fields"]
        self.assertNotIn("device_sn", fields)
        self.assertNotIn("device_sn", payload["alerts"][0])

    def test_two_devices_failing_at_one_branch_are_one_alert_card(self):
        rows = {
            "Attendance Flag": [],
            "Attendance Flag Decision": [],
            "Employee": [],
            "Device Closeout Alert": [
                {"branch": "BR-A", "local_date": "2026-08-03", "status": "closure_failed", "last_error": None},
                {"branch": "BR-A", "local_date": "2026-08-03", "status": "deferred_offline", "last_error": None},
            ],
            "Device Sync Status": [],
        }
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(len(payload["alerts"]), 1)


class TestTierFilter(unittest.TestCase):
    def test_tier_filters_entries(self):
        # undecided_count is present because the tier filter recounts `people`
        # against it (TestTierFilterCounts) — a real build_queue person entry
        # always carries it.
        entries = [
            {"kind": "person", "employee": "A", "tier": "act", "undecided_count": 1},
            {"kind": "person", "employee": "B", "tier": "routine", "undecided_count": 1},
        ]
        with _harness(_roster(2), queue={**_empty_queue(), "entries": entries}):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertEqual([e["employee"] for e in payload["entries"]], ["A"])

    def test_unknown_tier_is_rejected(self):
        with _harness(_roster(2)):
            with self.assertRaises(Exception):
                flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="urgent")


class TestIncludeDecided(unittest.TestCase):
    """The opt-in that makes an applied decision reachable again. Everything the
    default does is pinned by the tests above, so what matters here is that the
    default is genuinely unmoved — same argument to build_queue, same cache key —
    and that the wire's string "1" turns the flag on.
    """

    def test_the_default_request_asks_for_no_decided_people(self):
        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertIs(h.build.call_args.kwargs["include_decided"], False)

    def test_truthy_wire_values_turn_it_on(self):
        # Frappe hands whitelisted arguments over as strings; frappeCall
        # JSON-encodes a number, so the SPA's `1` arrives as "1".
        for value in (1, "1", True, "true", "yes"):
            with self.subTest(value=value):
                with _harness(_roster(1)) as h:
                    flag_queue_api.get_flag_queue(
                        "2026-08-01", "2026-08-07", include_decided=value
                    )
                self.assertIs(h.build.call_args.kwargs["include_decided"], True)

    def test_falsy_wire_values_leave_it_off(self):
        for value in (0, "0", "", None, False, "false"):
            with self.subTest(value=value):
                with _harness(_roster(1)) as h:
                    flag_queue_api.get_flag_queue(
                        "2026-08-01", "2026-08-07", include_decided=value
                    )
                self.assertIs(h.build.call_args.kwargs["include_decided"], False)

    def test_the_two_views_are_separate_cache_entries(self):
        # Sharing one key would serve the toggled request the default page — the
        # settled people would simply never appear, with nothing to show for it.
        cache = _FakeCache()
        with _harness(_roster(1), cache=cache) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            after_first = h.recorder.count
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", include_decided=1)
            self.assertGreater(h.recorder.count, after_first)

        self.assertEqual(
            [key for key, _ttl in cache.set_calls],
            [
                # The default key is unchanged — the suffix is only ever added.
                "flag_queue:v4:2026-08-01:2026-08-07:all",
                "flag_queue:v4:2026-08-01:2026-08-07:all:decided",
            ],
        )


class TestQueueCache(unittest.TestCase):
    def test_second_call_issues_no_further_queries(self):
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            after_first = h.recorder.count
            self.assertGreater(after_first, 0)
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            self.assertEqual(h.recorder.count, after_first)

    def test_cache_key_and_ttl_match_the_contract(self):
        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            self.assertEqual(h.cache.set_calls, [("flag_queue:v4:2026-08-01:2026-08-07:all", 60)])

        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
            self.assertEqual(h.cache.set_calls[0][0], "flag_queue:v4:2026-08-01:2026-08-07:act")

    def test_a_different_range_is_a_different_cache_entry(self):
        cache = _FakeCache()
        with _harness(_roster(1), cache=cache) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            after_first = h.recorder.count
            flag_queue_api.get_flag_queue("2026-08-08", "2026-08-14")
            self.assertGreater(h.recorder.count, after_first)

    def test_invalidate_drops_every_cached_page(self):
        cache = _FakeCache()
        with _harness(_roster(1), cache=cache):
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            self.assertEqual(len(cache.store), 1)
            flag_queue_api.invalidate_flag_queue_cache()
        self.assertEqual(cache.deleted_prefixes, ["flag_queue:v4"])
        self.assertEqual(cache.store, {})

    def test_invalidate_accepts_doc_event_args(self):
        cache = _FakeCache()
        with _harness(cache=cache):
            # Frappe doc_events call handlers as (doc, method); must not raise.
            flag_queue_api.invalidate_flag_queue_cache(doc=object(), method="on_update")
        self.assertEqual(cache.deleted_prefixes, ["flag_queue:v4"])


class TestDriverDateShapes(unittest.TestCase):
    """Not in the envelope above, but the two ways this module can fail with no error at
    all: an identity the decide path cannot match, and an outage set the grouper cannot
    look up. Both hinge on how a date column coming back from the driver is normalised.
    """

    # frappe hands a Date column back as datetime.date, a client hands the same value
    # back as a string, and a datetime-typed column would arrive as datetime — all three
    # must produce one identity, or a decision recorded against one shape stops matching
    # the flag read back in another.
    ROW_SHAPES = (
        ("date object", _flag_row("HR-EMP-00000", attendance_date=date(2026, 8, 3))),
        ("iso string", _flag_row("HR-EMP-00000")),
        ("datetime object", _flag_row("HR-EMP-00000", attendance_date=datetime(2026, 8, 3, 0, 0))),
        (
            "evidence-keyed suffix",
            _flag_row(
                "HR-EMP-00000",
                attendance_date=date(2026, 8, 3),
                flag_code="MISSING_TIME",
                evidence='{"minutes": 45, "interval_start": "2026-08-03 08:15:00"}',
            ),
        ),
    )

    def _queue_identities(self, flag_rows):
        with _harness({"Attendance Flag": flag_rows}) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            return [f["flag_identity"] for f in h.build.call_args.kwargs["flags"]]

    def test_identity_matches_the_one_the_decision_writer_recomputes(self):
        """flag_decision_api matches a decision to a live flag by exact string equality
        against an identity it recomputes itself (flag_decision_api.py:164-169). If the
        queue normalises a row differently, every decide returns "No live AUTO flag
        matches this identity" while both modules' own tests stay green — so run the real
        writer lookup over the same row the queue just read.
        """
        for label, row in self.ROW_SHAPES:
            with self.subTest(label):
                identities = self._queue_identities([row])
                self.assertEqual(len(identities), 1)

                # The recorder ignores `filters`, which is harmless here: the single
                # canned row is inside the range the writer derives from the identity,
                # so the only thing this can prove or disprove is string equality.
                recorder = _Recorder({"Attendance Flag": [row]})
                with patch.object(flag_decision_api.frappe, "get_all", recorder):
                    matched = flag_decision_api._live_flags_by_identity(identities)

                self.assertEqual(
                    sorted(matched),
                    sorted(identities),
                    f"queue identity {identities[0]!r} is unmatchable by the decide path",
                )

    def test_outage_pairs_are_iso_strings_when_the_driver_returns_dates(self):
        # flag_grouping tests membership of this set with a raw tuple built from its own
        # str()[:10] normalisation (flag_grouping.py:191), so a set keyed by
        # datetime.date yields zero branch groups and raises nothing.
        rows = _roster(2)
        rows["Attendance Flag"] = [
            _flag_row(f"HR-EMP-{i:05d}", attendance_date=date(2026, 8, 3)) for i in range(2)
        ]
        rows["Device Sync Status"] = []
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            kwargs = h.build.call_args.kwargs
        self.assertEqual(kwargs["outage_branch_dates"], {("BR-A", "2026-08-03")})
        self.assertEqual({f["attendance_date"] for f in kwargs["flags"]}, {"2026-08-03"})

    def test_a_sync_row_returned_as_a_date_still_clears_the_outage(self):
        # The other half of the same membership test: the candidate pair and the sync
        # pair must normalise identically or every branch looks like an outage.
        rows = _roster(2)
        rows["Device Sync Status"] = [{"branch": "BR-A", "local_date": date(2026, 8, 3)}]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            outage = h.build.call_args.kwargs["outage_branch_dates"]
        self.assertEqual(outage, set())


class TestOrphanClassificationInputs(unittest.TestCase):
    def test_decisions_carry_the_fields_orphan_classification_needs(self):
        # flag_grouping._orphans (flag_grouping.py:266-273) reads employee /
        # attendance_date / flag_code off the decision row. Omit them from the SELECT and
        # every orphan silently classifies as orphaned_flag_gone.
        rows = _roster(1)
        rows["Attendance Flag Decision"] = [
            {
                "name": "AFD-0001",
                "flag_identity": "AUTO-hr-emp-00000-2026-08-03-late-start",
                "employee": "HR-EMP-00000",
                "attendance_date": date(2026, 8, 3),
                "flag_code": "LATE_START",
                "outcome": "EXCUSED",
                "reason": "MANAGER_APPROVED",
                "note": None,
                "evidence_fingerprint": "abc",
                "group_key": None,
                "decided_by": "hr@example.com",
                "decided_at": "2026-08-04 09:00:00",
            }
        ]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            fields = h.recorder.kwargs_for("Attendance Flag Decision")[0]["fields"]
            decision = h.build.call_args.kwargs["decisions_by_identity"][
                "AUTO-hr-emp-00000-2026-08-03-late-start"
            ]
        for field in ("employee", "attendance_date", "flag_code"):
            self.assertIn(field, fields)
        self.assertEqual(decision["employee"], "HR-EMP-00000")
        self.assertEqual(decision["flag_code"], "LATE_START")
        # Same "YYYY-MM-DD" shape the flag side uses, so _orphans' code_key can match.
        self.assertEqual(decision["attendance_date"], "2026-08-03")


class TestSharedDateNormaliser(unittest.TestCase):
    """The outage tuples this module builds are looked up by flag_grouping with a raw
    membership test (flag_grouping.py:191), and the decision code keys it builds are
    compared in flag_grouping._orphans. If the two modules ever normalise a date
    differently the result is zero outage groups and everything classified
    orphaned_flag_gone — no exception, no failing test. Pin them to one implementation.
    """

    SHAPES = (
        None,
        "",
        date(2026, 8, 3),
        datetime(2026, 8, 3, 14, 30),
        "2026-08-03",
        "2026-08-03 00:00:00",
    )

    def test_both_modules_delegate_to_the_same_normaliser(self):
        self.assertIs(flag_queue_api.date_key, flag_identity.date_key)
        self.assertIs(flag_grouping.date_key, flag_identity.date_key)

    def test_every_date_shape_normalises_identically_in_both_modules(self):
        for value in self.SHAPES:
            with self.subTest(repr(value)):
                self.assertEqual(flag_queue_api._date_key(value), flag_grouping._date_str(value))

    def test_date_key_yields_one_iso_key_per_calendar_day(self):
        for value in (date(2026, 8, 3), datetime(2026, 8, 3, 14, 30), "2026-08-03", "2026-08-03 00:00:00"):
            with self.subTest(repr(value)):
                self.assertEqual(flag_identity.date_key(value), "2026-08-03")
        # Never "None": an absent date must not collide with a real one.
        self.assertEqual(flag_identity.date_key(None), "")

    def test_identity_formatting_is_left_alone(self):
        # flag_identity._format_date is a THIRD normaliser with deliberately different
        # behaviour (it strftimes objects). It must not be folded into date_key: the
        # identity string is what flag_decision_api matches on, and this test is here so
        # a later "finish the job" refactor of the two into one fails.
        self.assertEqual(flag_identity._format_date(datetime(2026, 8, 3, 14, 30)), "2026-08-03")
        self.assertEqual(flag_identity._format_date("2026-08-03 00:00:00"), "2026-08-03 00:00:00")


class TestTierFilterCounts(unittest.TestCase):
    """The header and the list must count the same thing — under a filter too."""

    def _queue(self):
        return {
            **_empty_queue(),
            "entries": [
                {"kind": "person", "entry_key": "p:A", "employee": "A", "tier": "act",
                 "undecided_count": 1},
                {"kind": "person", "entry_key": "p:B", "employee": "B", "tier": "routine",
                 "undecided_count": 1},
            ],
            "counts": {"open": 2, "needs_re_review": 0, "decided": 0, "people": 2, "rows": 2},
        }

    def test_a_tier_filter_recounts_people_and_rows(self):
        with _harness(_roster(2), queue=self._queue()):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertEqual(len(payload["entries"]), 1)
        self.assertEqual(payload["counts"]["people"], 1)
        self.assertEqual(payload["counts"]["rows"], 1)

    def test_state_totals_stay_whole_range_under_a_filter(self):
        # open/needs_re_review/decided are the size of the job, not a description
        # of the filtered list, and the toolbar renders them as such.
        with _harness(_roster(2), queue=self._queue()):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertEqual(payload["counts"]["open"], 2)

    def test_without_a_filter_counts_are_passed_through_untouched(self):
        # Sentinel values a recount over these two entries could never produce
        # (two entries recount to people<=2, rows==2) — deliberately
        # inconsistent with the entries on purpose, so this test can only pass
        # via pass-through and not by coincidence. Do NOT "fix" these to be
        # consistent with the entries; that would silently reopen the gap this
        # test exists to close (a recompute-always bug would then read back
        # the same numbers and this test would stay green either way).
        queue = {
            **self._queue(),
            "counts": {"open": 2, "needs_re_review": 0, "decided": 0, "people": 7, "rows": 9},
        }
        with _harness(_roster(2), queue=queue):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["counts"]["people"], 7)
        self.assertEqual(payload["counts"]["rows"], 9)

    def test_group_members_count_toward_the_filtered_people(self):
        # A person inside a pattern group is still a person with something open.
        queue = {
            **_empty_queue(),
            "entries": [
                {
                    "kind": "group",
                    "group_key": "REPEAT_PATTERN:LATE_START",
                    "tier": "routine",
                    "members": [
                        {"employee": "A", "undecided_count": 2},
                        {"employee": "B", "undecided_count": 1},
                    ],
                }
            ],
            "counts": {"open": 3, "needs_re_review": 0, "decided": 0, "people": 2, "rows": 1},
        }
        with _harness(_roster(2), queue=queue):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="routine")
        self.assertEqual(payload["counts"]["people"], 2)
        self.assertEqual(payload["counts"]["rows"], 1)

    def test_a_settled_person_does_not_count_toward_filtered_people(self):
        # Same rule as build_queue's own `people`: it means "people with something
        # open", and include_decided must not inflate it.
        queue = {
            **_empty_queue(),
            "entries": [
                {"kind": "person", "entry_key": "p:A", "employee": "A", "tier": "act",
                 "undecided_count": 0},
            ],
            "counts": {"open": 0, "needs_re_review": 0, "decided": 1, "people": 0, "rows": 1},
        }
        with _harness(_roster(2), queue=queue):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertEqual(payload["counts"]["people"], 0)
        self.assertEqual(payload["counts"]["rows"], 1)

    def test_an_employee_in_both_a_group_and_a_lone_entry_counts_once(self):
        # flag_grouping._stamp_cross_references exists because one employee can
        # occupy two entries at once, and a group's tier is tier_for_rank(max
        # member rank) — so both entries can land in the same tier. `people`
        # means distinct EMPLOYEES, not distinct appearances: A must count once
        # even though A shows up in both the group and the lone entry.
        queue = {
            **_empty_queue(),
            "entries": [
                {
                    "kind": "group",
                    "group_key": "REPEAT_PATTERN:LATE_START",
                    "tier": "routine",
                    "members": [{"employee": "A", "undecided_count": 1}],
                },
                {"kind": "person", "entry_key": "p:A", "employee": "A", "tier": "routine",
                 "undecided_count": 1},
                {"kind": "person", "entry_key": "p:B", "employee": "B", "tier": "routine",
                 "undecided_count": 1},
            ],
            "counts": {"open": 3, "needs_re_review": 0, "decided": 0, "people": 2, "rows": 3},
        }
        with _harness(_roster(2), queue=queue):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="routine")
        self.assertEqual(payload["counts"]["people"], 2)

    def test_a_filtered_read_does_not_corrupt_counts_for_a_later_unfiltered_read(self):
        # build_queue is stubbed to a single fixed return value for the life of this
        # harness (the real function is pure and allocates a fresh dict every call —
        # test_flag_grouping.py:91 — but nothing here should rely on that). If the
        # tier branch recomputed `people`/`rows` into queue["counts"] IN PLACE instead
        # of a copy, the mutation would still be sitting in that shared dict when the
        # next request reads it back — exactly what the 60s cache serves to whichever
        # request (filtered or not) asks next.
        queue = self._queue()
        with _harness(_roster(2), queue=queue):
            filtered = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
            self.assertEqual(filtered["counts"]["people"], 1)
            unfiltered = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(unfiltered["counts"]["people"], 2)
        self.assertEqual(unfiltered["counts"]["rows"], 2)


class TestHooksWiring(unittest.TestCase):
    def test_decision_writes_invalidate_the_queue_cache(self):
        events = hooks.doc_events["Attendance Flag Decision"]
        for event in ("after_insert", "on_update", "on_trash"):
            self.assertEqual(events[event], INVALIDATOR)

    def test_engine_flag_writes_are_deliberately_not_hooked(self):
        # invalidate_flag_queue_cache is a delete_keys() prefix scan — a blocking Redis
        # KEYS over the whole keyspace — and intraday re-inserts flags on every checkin
        # (intraday.py:132,153), so hooking Attendance Flag would run that scan on the
        # engine's hottest write path all day for freshness the 60s TTL already provides.
        # It could not have made the cache correct either: the engine's deletes go through
        # raw frappe.db.delete() and fire no hooks. Pinned so a well-meaning re-add fails
        # loudly instead of silently reintroducing the scan.
        self.assertNotIn("Attendance Flag", hooks.doc_events)


class TestRolloutBlock(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import flag_queue_api

        self.api = flag_queue_api

    def _block(
        self,
        phases,
        branches=("BR-A",),
        configured=True,
        visible_phases=None,
        dates_by_branch=None,
    ):
        """`flags` describe the whole date range; `entries` describe the VISIBLE
        list `_rollout_block` now counts pilot flags over (IMPORTANT-3). Every
        test below that is not specifically about the range-vs-list split wants
        the two to agree, so `visible_phases` defaults to mirroring `phases` --
        nothing filtered out of view.

        `entries` is built minimal: `_rollout_block` only ever reads
        person.get("flags") -> flag_out.get("rollout_phase") through
        iter_people, so a bare {"kind": "person", "flags": [...]} is the whole
        shape it needs.

        `dates_by_branch` maps a branch (None included) to the pair
        rollout_dates_for_branch would return for it. Left None, every branch
        gets the same pair -- which is all a test about counts or ordering
        needs. Given, it is what lets a test prove WHICH branch each window's
        dates were read for.
        """
        if visible_phases is None:
            visible_phases = phases
        flags = [
            {"employee": f"EMP-{i}", "rollout_phase": phase}
            for i, phase in enumerate(phases)
        ]
        entries = [
            {"kind": "person", "flags": [{"rollout_phase": phase}]}
            for phase in visible_phases
        ]
        employees_by_id = {
            f"EMP-{i}": {"branch": branches[i % len(branches)]}
            for i in range(len(phases))
        }

        def _dates_for(branch):
            if dates_by_branch is None:
                return (date(2026, 8, 15), date(2026, 9, 1))
            return dates_by_branch[branch]

        with patch.object(
            self.api.rollout, "phases_configured", return_value=configured
        ), patch.object(
            self.api.rollout,
            "rollout_dates_for_branch",
            side_effect=_dates_for,
        ):
            return self.api._rollout_block(
                flags=flags, entries=entries, employees_by_id=employees_by_id
            )

    def test_an_all_live_range_reports_live(self):
        block = self._block(["LIVE", "LIVE"])
        self.assertEqual(block["range_phase"], "LIVE")
        self.assertEqual(block["testing_flag_count"], 0)
        self.assertEqual(block["windows"], [])

    def test_an_all_pilot_range_reports_testing_and_names_its_window(self):
        block = self._block(["TESTING", "TESTING"])
        self.assertEqual(block["range_phase"], "TESTING")
        self.assertEqual(block["testing_flag_count"], 2)
        self.assertEqual(
            block["windows"],
            [{"branch": "BR-A", "testing_start": "2026-08-15", "go_live": "2026-09-01"}],
        )

    def test_a_range_spanning_go_live_reports_mixed_with_a_count(self):
        block = self._block(["TESTING", "LIVE", "LIVE"])
        self.assertEqual(block["range_phase"], "MIXED")
        self.assertEqual(block["testing_flag_count"], 1)
        self.assertEqual(block["total_flag_count"], 3)

    def test_a_blank_stored_phase_counts_as_live(self):
        # Every row written before this feature has a blank rollout_phase, and blank
        # is read as LIVE -- consistent with unset dates meaning LIVE.
        block = self._block([None, None])
        self.assertEqual(block["range_phase"], "LIVE")

    def test_no_dates_anywhere_reports_not_configured(self):
        block = self._block(["LIVE"], configured=False)
        self.assertFalse(block["phases_configured"])

    def test_multiple_pilot_branches_each_get_a_window(self):
        block = self._block(["TESTING", "TESTING"], branches=("BR-A", "BR-B"))
        self.assertEqual([w["branch"] for w in block["windows"]], ["BR-A", "BR-B"])

    def test_a_tier_filtered_out_pilot_flag_still_moves_the_range_phase_but_not_the_count(self):
        # The ruling this pins: range_phase/windows are a property of the DATES
        # the caller asked for, computed over the whole `flags` range regardless
        # of what a tier filter hid from `entries`; testing_flag_count/
        # total_flag_count describe only the VISIBLE list. A pilot flag that
        # exists in the range but was filtered out of entries must still show up
        # in range_phase (the pilot period did not change) while contributing
        # zero to testing_flag_count (HR cannot see it on this page). "0 of 1
        # flags here are from the pilot period" is the intended, correct output.
        block = self._block(["TESTING", "LIVE"], visible_phases=["LIVE"])
        self.assertEqual(block["range_phase"], "MIXED")
        self.assertEqual(block["testing_flag_count"], 0)
        self.assertEqual(block["total_flag_count"], 1)

    def test_a_branchless_pilot_roster_still_gets_a_window(self):
        # The likeliest real rollout, not an edge case: the design calls the
        # global pair "the primary path, not the fallback" because a great many
        # employees have no branch set. Built from the branches present in the
        # result set alone, this case reports range_phase TESTING with
        # windows: [] -- a pilot banner in Phase B with no dates to put in it.
        block = self._block(["TESTING"], branches=(None,))
        self.assertEqual(block["range_phase"], "TESTING")
        self.assertEqual(
            block["windows"],
            [{"branch": None, "testing_start": "2026-08-15", "go_live": "2026-09-01"}],
        )

    def test_a_mixed_roster_puts_the_branchless_window_last(self):
        # Two things at once, because they only mean something together: the
        # branchless window is APPENDED after the sorted branch names (None has
        # no place in a sort of branch names, so its position has to be chosen
        # and pinned for Phase B to rely on), and it carries the GLOBAL pair
        # rather than any named branch's.
        block = self._block(
            ["TESTING", "TESTING"],
            branches=("BR-A", None),
            dates_by_branch={
                "BR-A": (date(2026, 8, 15), date(2026, 9, 1)),
                None: (date(2026, 7, 1), date(2026, 7, 20)),
            },
        )
        self.assertEqual(
            block["windows"],
            [
                {"branch": "BR-A", "testing_start": "2026-08-15", "go_live": "2026-09-01"},
                {"branch": None, "testing_start": "2026-07-01", "go_live": "2026-07-20"},
            ],
        )

    def test_an_empty_range_reports_live(self):
        # `testing == 0` is evaluated before `testing == total`, so an empty
        # queue reports LIVE -- correct, because there is no pilot data to warn
        # about. Swapping those two branches would make an empty range report
        # TESTING (0 == 0) and nothing else in this suite would notice.
        block = self._block([])
        self.assertEqual(block["range_phase"], "LIVE")
        self.assertEqual(block["windows"], [])

    def test_a_pilot_branch_with_no_configured_dates_yields_a_window_of_nulls(self):
        # Reachable: a branch can be mid-pilot by way of the global dates while
        # rollout_dates_for_branch answers with the (None, None) of a settings
        # doc whose dates were cleared between the flags being written and the
        # queue being read. Phase B receives nulls, so the shape is pinned here
        # rather than discovered there.
        block = self._block(["TESTING"], dates_by_branch={"BR-A": (None, None)})
        self.assertEqual(
            block["windows"],
            [{"branch": "BR-A", "testing_start": None, "go_live": None}],
        )


class TestRolloutBlockReachesThePayload(unittest.TestCase):
    """TestRolloutBlock above calls _rollout_block directly, so it stays green on
    a payload that never carries the block at all, and on a scan that selects
    rollout_phase but drops it before _flag_rows hands the row on. Both mutations
    survive the whole suite otherwise; this end-to-end test through
    get_flag_queue is what catches them."""

    def test_the_rollout_block_is_on_the_payload_and_reflects_the_stored_phase(self):
        rows = _roster(1)
        rows["Attendance Flag"] = [_flag_row("HR-EMP-00000", rollout_phase="TESTING")]
        with _harness(rows), patch.object(
            flag_queue_api.rollout, "phases_configured", return_value=True
        ), patch.object(
            flag_queue_api.rollout,
            "rollout_dates_for_branch",
            return_value=(date(2026, 8, 15), date(2026, 9, 1)),
        ):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["rollout"]["range_phase"], "TESTING")
        self.assertEqual(payload["rollout"]["windows"][0]["branch"], "BR-A")


class TestFlagGroupingAgreesWithRolloutOnLive(unittest.TestCase):
    """flag_grouping._flag_out normalises a blank stored phase with a bare
    "LIVE" literal rather than rollout.LIVE, because that module is frappe-free
    by design and rollout.py imports frappe (the reasoning is spelled out on
    _flag_out's own rollout_phase key). That constraint stays; what was missing
    was anything holding the two values equal. Rename rollout.LIVE and
    flag_grouping keeps stamping the old string into every FlagOut while
    _rollout_block's TESTING comparison goes on working -- the payload splits
    silently instead of the suite going red.

    Here rather than in test_flag_grouping.py because this file imports both
    sides: test_flag_grouping.py runs with no frappe mock installed, on
    purpose, and so cannot import rollout at all.
    """

    def test_the_blank_phase_flag_grouping_emits_is_rollout_dot_live(self):
        flag_out = flag_grouping._flag_out(_flag_row("HR-EMP-00000"), {})
        self.assertEqual(flag_out["rollout_phase"], rollout.LIVE)


class TestQueueCachePrefix(unittest.TestCase):
    def test_the_prefix_is_v4(self):
        # flag_queue_api.py:40-53: a deploy does not clear Redis, so a payload-shape
        # change without a new prefix means old keys answering new callers for a
        # full TTL. This assertion is the enforcement of that comment.
        from dewey_time.attendance_engine.flag_queue_api import _QUEUE_CACHE_PREFIX

        self.assertEqual(_QUEUE_CACHE_PREFIX, "flag_queue:v4")


if __name__ == "__main__":
    unittest.main()
