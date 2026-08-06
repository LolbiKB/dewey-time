"""Envelope tests for the HR flag queue read API.

Scope: what flag_queue_api itself is responsible for — the permission gate, the range
cap, the FIXED query budget, truncation, the cache, and the device-outage/alert
assembly. Ranking, person-dedup and grouping belong to flag_grouping and are covered by
test_flag_grouping.py, so build_queue is stubbed here and asserted on its INPUTS.
"""

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

    def __call__(self, doctype, **kwargs):
        self.calls.append((doctype, kwargs))
        rows = [
            row
            for row in self.rows_by_doctype.get(doctype, [])
            if self._matches(row, kwargs.get("filters") or {})
        ]
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
        "counts": {"open": 0, "needs_re_review": 0, "decided": 0, "people": 0},
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
            {"employee_name": "Name HR-EMP-00000", "branch": "BR-A"},
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
        entries = [
            {"kind": "person", "employee": "A", "tier": "act"},
            {"kind": "person", "employee": "B", "tier": "routine"},
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
                "flag_queue:v1:2026-08-01:2026-08-07:all",
                "flag_queue:v1:2026-08-01:2026-08-07:all:decided",
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
            self.assertEqual(h.cache.set_calls, [("flag_queue:v1:2026-08-01:2026-08-07:all", 60)])

        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
            self.assertEqual(h.cache.set_calls[0][0], "flag_queue:v1:2026-08-01:2026-08-07:act")

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
        self.assertEqual(cache.deleted_prefixes, ["flag_queue:v1"])
        self.assertEqual(cache.store, {})

    def test_invalidate_accepts_doc_event_args(self):
        cache = _FakeCache()
        with _harness(cache=cache):
            # Frappe doc_events call handlers as (doc, method); must not raise.
            flag_queue_api.invalidate_flag_queue_cache(doc=object(), method="on_update")
        self.assertEqual(cache.deleted_prefixes, ["flag_queue:v1"])


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


if __name__ == "__main__":
    unittest.main()
