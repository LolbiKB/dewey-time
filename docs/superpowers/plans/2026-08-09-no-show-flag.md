# A No-Show Gets To Say So — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A day nobody turned up for reads as one "Did not show up", not as two "missing 4 hours" rows split by a lunch nobody was there to take.

**Architecture:** Three independent changes, none touching closeout. `absence_intervals.py` stops splitting one absence in two across an unattended scheduled lunch. `intraday.py` emits a provisional `UNNOTIFIED_ABSENCE` for a zero-punch day instead of `MISSING_TIME` rows. `dev_tools.py` gains a System Manager-only bulk regenerator so the change can actually be seen across the existing scratch data.

**Tech Stack:** Python 3, Frappe/ERPNext app (`dewey_time`), `unittest` + `unittest.mock`. No frontend work — `UNNOTIFIED_ABSENCE` is already fully rendered (label "Did not show up", hatched empty timeline, "Punches: 0" fact).

**Spec:** `docs/superpowers/specs/2026-08-09-no-show-flag-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

1. **Do not modify `closeout.py` behaviour.** It is already correct: `closeout.py:568` raises `UNNOTIFIED_ABSENCE` for a zero-punch on-shift day and returns before MISSING_TIME is evaluated; `closeout.py:534` returns for an unscheduled day. Importing helpers from it is fine. Changing what it emits is out of scope and a review failure.
2. **Shift times in test fixtures are `datetime.time` or `datetime.timedelta` — NEVER `datetime.datetime`.** `shift_time_to_minutes` (`shift_times.py:14`) parses a `datetime` by falling through to string splitting, which raises `ValueError` on `"2026-05-28 08"` and returns `None`. Every interval function then returns `[]` and the whole suite passes while proving nothing. House style in `test_absence_flags.py` is `dt_time(9, 0)`.
3. **The evidence `reason` for the new flag is exactly `"on_shift_no_checkins_intraday"`** — distinct from closeout's `"on_shift_no_checkins"` so the two origins are tellable apart in evidence.
4. **A bridged interval's `minutes` is the SUM of its parts, not `endMin - startMin`.** The unpaid lunch hour stays unbilled. `minutes != endMin - startMin` for a bridged row is intended, not a bug.
5. **No migration patch.** Existing flag data is pre-go-live scratch. Orphaned decisions are accepted; do not write a patch to preserve them.
6. **Every behavioural test is mutation-checked two-sided:** revert the change, confirm the new test FAILS, restore, confirm it passes. A test that passes both ways proves nothing. Record the mutation result in the task report.
7. **Test command:** `bash dev/sandbox/frappe-sandbox test --backend --fast --module <module>` from the repo root. Single test: `PYTHONPATH=$(pwd) python3 -m unittest dewey_time.tests.<module>.<Class>.<test> -v`. Do not use `python3` for anything else — it is 3.9.6.
8. **Report test counts, not just "green".** A module that fails to import reports zero tests and looks like success in a grep.

## Resolved before execution — read before Task 1

**The spec and this plan agree.** An earlier draft of the spec required a third bridging
condition, that `detect_observed_lunch` found no observed lunch. It was ruled unreachable
and removed from the spec on 2026-08-09 before any task was dispatched: exact abutment on
*both* sides means the employee was absent across the whole lunch window, and an observed
lunch requires punches at its boundaries, so the two can never both hold. Bridging is on
the two conditions the spec now lists — a valid scheduled lunch window, and exact abutment
on both sides.

Nothing here is a deviation. If a reviewer flags a missing observed-lunch gate, the answer
is that the spec no longer asks for one.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `dewey_time/attendance_engine/absence_intervals.py` | Add `_bridge_scheduled_lunch`; call it from `compute_missing_time_intervals`. | 1 |
| `dewey_time/tests/test_absence_flags.py` | New `TestUnattendedLunchBridging` class appended. Existing 19 tests untouched. | 1 |
| `dewey_time/attendance_engine/intraday.py` | Add `UNNOTIFIED_ABSENCE` to `INTRADAY_FLAG_CODES`; branch the absence block on `checkins_count == 0`. | 2 |
| `dewey_time/tests/test_intraday.py` | New `TestIntradayNoShow` class appended (6 tests), plus `test_missing_time_when_zero_checkins` repointed onto the punched-day path — it pins the old behaviour and would otherwise fail. | 2 |
| `dewey_time/attendance_engine/dev_tools.py` | Add `preview_regenerate_flags_for_range_api` and `regenerate_flags_for_range_api`. | 3 |
| `dewey_time/tests/test_dev_tools.py` | New `TestRegenerateFlagsForRange` class appended. | 3 |

No new files. No frontend files. No DocType changes.

---

### Task 1: An unattended lunch stops splitting one absence in two

**Files:**
- Modify: `dewey_time/attendance_engine/absence_intervals.py` (add helper after `_merge_intervals`, which ends at line 225; call it inside `compute_missing_time_intervals` at lines 331-334)
- Test: `dewey_time/tests/test_absence_flags.py` (append a new class at end of file)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `_bridge_scheduled_lunch(intervals: list[dict], *, lunch_start: int | None, lunch_end: int | None) -> list[dict]` — module-private, used only by `compute_missing_time_intervals`. Task 2 depends on the *observable* result only: a zero-punch day yields one interval, not two.

**Background the implementer needs:** `derive_missing_expected_intervals` subtracts the scheduled lunch from the expected working window unconditionally (lines 77-80). That is right when someone took a lunch and wrong when nobody was there to take one — an all-day absence becomes two findings. Interval dicts carry `startMin`, `endMin`, `minutes`, `kind`, with minutes since local midnight (an overnight shift's end is `+1440`).

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_absence_flags.py`:

```python
class TestUnattendedLunchBridging(unittest.TestCase):
    """A lunch nobody was there to take must not split one absence into two.

    Shift times are dt_time, never datetime: shift_time_to_minutes parses a
    datetime by falling through to string splitting and returns None, after
    which every case yields zero intervals and these tests pass vacuously.
    """

    SHIFT = {
        "start_time": dt_time(8, 0),
        "end_time": dt_time(17, 0),
        "custom_grace_minutes": 0,
        "custom_lunch_start": dt_time(12, 0),
        "custom_lunch_end": dt_time(13, 0),
    }
    DAY = date(2026, 5, 28)

    def _intervals(self, checkins):
        from dewey_time.attendance_engine.absence_intervals import (
            compute_missing_time_intervals,
        )

        return compute_missing_time_intervals(
            checkins=checkins, shift_meta=self.SHIFT, attendance_date=self.DAY
        )

    def _punch(self, hour, minute):
        return {
            "name": f"P-{hour:02d}{minute:02d}",
            "time": datetime(2026, 5, 28, hour, minute),
            "custom_device_branch": "BRANCH-A",
        }

    def test_stray_punch_day_is_one_absence_not_two(self):
        # Badged in and straight out again at 08:05, then nothing. Before this
        # change: 08:05-12:00 and 13:00-17:00, two findings for one absence.
        intervals = self._intervals([self._punch(8, 0), self._punch(8, 5)])

        self.assertEqual(len(intervals), 1, f"expected one absence, got {intervals}")
        self.assertEqual(intervals[0]["startMin"], 8 * 60 + 5)
        self.assertEqual(intervals[0]["endMin"], 17 * 60)

    def test_bridged_minutes_exclude_the_unpaid_lunch(self):
        # 235 + 240, NOT the 535-minute span. The lunch hour is not owed.
        intervals = self._intervals([self._punch(8, 0), self._punch(8, 5)])

        self.assertEqual(intervals[0]["minutes"], 475)
        self.assertNotEqual(
            intervals[0]["minutes"],
            intervals[0]["endMin"] - intervals[0]["startMin"],
            "minutes must be the sum of the parts, not the span",
        )

    def test_zero_punch_day_is_one_absence(self):
        intervals = self._intervals([])

        self.assertEqual(len(intervals), 1, f"expected one absence, got {intervals}")
        self.assertEqual(intervals[0]["startMin"], 8 * 60)
        self.assertEqual(intervals[0]["endMin"], 17 * 60)
        self.assertEqual(intervals[0]["minutes"], 480)

    def test_worked_the_morning_only_is_unchanged(self):
        # The regression guard for the rule that was rejected. This person
        # stopped exactly at lunch; billing them for the lunch hour would be
        # wrong, and a naive "don't carve the lunch when nobody is there
        # after it" rule does exactly that.
        intervals = self._intervals([self._punch(8, 0), self._punch(12, 0)])

        self.assertEqual(len(intervals), 1)
        self.assertEqual(intervals[0]["startMin"], 13 * 60)
        self.assertEqual(intervals[0]["endMin"], 17 * 60)
        self.assertEqual(intervals[0]["minutes"], 240)

    def test_a_gap_that_merely_contains_the_lunch_is_not_bridged(self):
        # Only an EXACT abutment on both sides is a lunch split. Two intervals
        # that happen to sit either side of midday without touching it are two
        # real findings and must stay two.
        from dewey_time.attendance_engine.absence_intervals import (
            _bridge_scheduled_lunch,
        )

        intervals = [
            {"startMin": 480, "endMin": 700, "minutes": 220, "kind": "leading"},
            {"startMin": 800, "endMin": 1020, "minutes": 220, "kind": "leading"},
        ]
        out = _bridge_scheduled_lunch(intervals, lunch_start=720, lunch_end=780)

        self.assertEqual(len(out), 2)

    def test_no_scheduled_lunch_configured_is_a_no_op(self):
        from dewey_time.attendance_engine.absence_intervals import (
            _bridge_scheduled_lunch,
        )

        intervals = [
            {"startMin": 480, "endMin": 720, "minutes": 240, "kind": "leading"},
            {"startMin": 780, "endMin": 1020, "minutes": 240, "kind": "leading"},
        ]
        out = _bridge_scheduled_lunch(intervals, lunch_start=None, lunch_end=None)

        self.assertEqual(len(out), 2)
```

- [ ] **Step 2: Run them and watch them fail**

```bash
bash dev/sandbox/frappe-sandbox test --backend --fast --module test_absence_flags
```

Expected: `test_stray_punch_day_is_one_absence_not_two`, `test_bridged_minutes_exclude_the_unpaid_lunch` and `test_zero_punch_day_is_one_absence` FAIL on the interval count (2, not 1). The two `_bridge_scheduled_lunch` tests FAIL with `ImportError` / `AttributeError`. `test_worked_the_morning_only_is_unchanged` PASSES already — it is a regression guard, and it passing now is correct.

- [ ] **Step 3: Add the helper**

In `dewey_time/attendance_engine/absence_intervals.py`, immediately after `_merge_intervals` (which ends at line 225):

```python
def _bridge_scheduled_lunch(
    intervals: list[dict], *, lunch_start: int | None, lunch_end: int | None
) -> list[dict]:
    """Join two missing intervals that abut the scheduled lunch exactly.

    `derive_missing_expected_intervals` carves the scheduled lunch out of the
    expected window unconditionally. That is right for someone who took a
    lunch and wrong for someone who was not there to take one: a day with a
    stray punch and nothing else came out as 08:05-12:00 and 13:00-17:00 --
    two findings for one absence, and the shape that made a no-show
    unreadable in the queue.

    Exact abutment on BOTH sides is the whole test. It can only happen when
    the employee was absent across the entire lunch window, so a gap that
    merely straddles midday is left as the two separate findings it is.

    `minutes` is the SUM of the parts, never the span: the unpaid hour is
    still not owed. A bridged row therefore has
    `minutes != endMin - startMin`, deliberately, and the copy that renders
    it has to say so.
    """
    if lunch_start is None or lunch_end is None or lunch_end <= lunch_start:
        return intervals

    out: list[dict] = []
    for interval in intervals:
        previous = out[-1] if out else None
        if (
            previous is not None
            and previous["endMin"] == lunch_start
            and interval["startMin"] == lunch_end
        ):
            previous["endMin"] = interval["endMin"]
            previous["minutes"] = previous["minutes"] + interval["minutes"]
            continue
        out.append(dict(interval))
    return out
```

- [ ] **Step 4: Call it**

In `compute_missing_time_intervals`, replace lines 331-334:

```python
    combined = _merge_intervals(missing_expected + away_intervals)
    for interval in combined:
        interval["kind"] = _classify_interval_kind(interval, segments)
    return combined
```

with:

```python
    combined = _merge_intervals(missing_expected + away_intervals)
    # After merging, not before: _merge_intervals sorts, and bridging compares
    # each interval against the one before it.
    combined = _bridge_scheduled_lunch(
        combined,
        lunch_start=_parse_shift_time_to_minutes(shift_meta.get("custom_lunch_start")),
        lunch_end=_parse_shift_time_to_minutes(shift_meta.get("custom_lunch_end")),
    )
    for interval in combined:
        interval["kind"] = _classify_interval_kind(interval, segments)
    return combined
```

- [ ] **Step 5: Run the full module**

```bash
bash dev/sandbox/frappe-sandbox test --backend --fast --module test_absence_flags
```

Expected: all tests pass. **The count must be 19 + 6 = 25.** If it is not 25, a test did not run — report that rather than proceeding.

- [ ] **Step 6: Mutation-check both halves (Global Constraint 6)**

Comment out the `combined = _bridge_scheduled_lunch(...)` call. Re-run. Expected: the three integration tests fail. Restore.

Then change `previous["minutes"] = previous["minutes"] + interval["minutes"]` to `previous["minutes"] = previous["endMin"] - previous["startMin"]`. Re-run. Expected: `test_bridged_minutes_exclude_the_unpaid_lunch` fails with 535 != 475. Restore, re-run, confirm 25 pass.

Record both results in the report.

- [ ] **Step 7: Run the whole backend suite for regressions**

```bash
bash dev/sandbox/frappe-sandbox test --backend
```

Expected: no failures. `test_absence_flags`' existing 19 and `test_integration_pilot_matrix` matter most — the latter pins closeout's zero-punch behaviour, which must be untouched.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/attendance_engine/absence_intervals.py dewey_time/tests/test_absence_flags.py
git commit -m "fix(absence): a lunch nobody took stops splitting one absence in two

An all-day absence came out as two findings, 08:00-12:00 and 13:00-17:00,
because the scheduled lunch is carved out of the expected window whether or
not anyone was there to take it. Bridge intervals that abut the lunch
exactly on both sides, which can only happen when the employee was absent
across it.

Minutes are summed from the parts, not recomputed from the span, so the
unpaid hour stays unbilled: a bridged row has minutes != endMin - startMin
on purpose.

Worked-the-morning-only is pinned unchanged -- it stops exactly at lunch,
and the simpler rule 'do not carve the lunch when nobody is there after it'
would bill it for an hour it correctly stopped for."
```

---

### Task 2: A no-show says so before the day ends

**Files:**
- Modify: `dewey_time/attendance_engine/intraday.py` (`INTRADAY_FLAG_CODES` at lines 25-28; the absence block at lines 145-160)
- Test: `dewey_time/tests/test_intraday.py` (append a new class at end of file)

**Interfaces:**
- Consumes: Task 1's bridging is already in place, so a zero-punch day now yields one interval rather than two. This task does not depend on that count — it depends only on the list being non-empty.
- Produces: no new public function. Behaviour only.

**Background the implementer needs:**

`refresh_intraday_flags_for_employee_date` runs every ~30 minutes and on every checkin edit. Its first act is to delete its own previous provisional rows, scoped to `INTRADAY_FLAG_CODES` (line 79). **Adding a flag code to what intraday writes without adding it to that list means the row is never cleaned up** — a provisional no-show would survive the employee actually turning up. That is the single most important line in this task.

`skip_absence` (line 120) already suppresses absence flags when the branch has an open device-closeout alert or the employee had a delivery/record failure. Reuse it unchanged; a dead device must not produce a branch-wide wave of false no-shows.

**Timing must hold structurally.** The claim is that the no-show appears at exactly the moment the first `MISSING_TIME` appears today — no earlier, no louder (both codes are CRITICAL). Do NOT re-derive the 30-minute threshold. Call `evaluate_missing_time_flags` as now and emit the no-show **iff it returned rows**. Then the timing is true by construction.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_intraday.py`:

```python
class TestIntradayNoShow(unittest.TestCase):
    """Zero punches reads as 'Did not show up', not as missing-time fragments.

    Closeout already says this (closeout.py:568) and skips MISSING_TIME the
    same way. Intraday could not, because it withholds UNNOTIFIED_ABSENCE for
    a day that is not over -- so it said nothing, and MISSING_TIME filled the
    silence in the least legible available shape.
    """

    def _shift_meta(self):
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

        return enrich_shift_meta(
            {
                "start_time": dt_time(8, 0),
                "end_time": dt_time(17, 0),
                "custom_lunch_start": dt_time(12, 0),
                "custom_lunch_end": dt_time(13, 0),
                "custom_grace_minutes": 5,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 0,
            }
        )

    def _employee(self):
        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        return employee

    MISSING = [
        (
            "MISSING_TIME",
            {
                "interval_start": "2026-05-28T08:00:00",
                "interval_end": "2026-05-28T17:00:00",
                "minutes": 480,
                "kind": "leading",
                "threshold_minutes": 30,
            },
        )
    ]

    @patch("dewey_time.attendance_engine.intraday.evaluate_missing_time_flags")
    @patch("dewey_time.attendance_engine.intraday._insert_flag")
    @patch("dewey_time.attendance_engine.intraday.has_delivery_or_record_failure_today", return_value=False)
    @patch("dewey_time.attendance_engine.intraday.has_open_device_closeout_alert", return_value=False)
    @patch("dewey_time.attendance_engine.intraday.missing_time_max_end_min_for_date", return_value=900)
    @patch("dewey_time.attendance_engine.intraday._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.intraday._get_shift_meta")
    @patch("dewey_time.attendance_engine.intraday._get_shift_assignment")
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.get_cached_doc")
    def _run(
        self,
        get_cached_doc,
        delete_flags,
        get_shift,
        get_shift_meta,
        _checkins,
        _max_end,
        _open_alert,
        _delivery_failed,
        insert_flag,
        evaluate_missing,
        *,
        missing=None,
        checkins=None,
        open_alert=False,
        delivery_failed=False,
    ):
        """Drive one intraday refresh and hand back the mocks worth asserting."""
        from dewey_time.attendance_engine.intraday import (
            refresh_intraday_flags_for_employee_date,
        )

        get_cached_doc.return_value = self._employee()
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._shift_meta()
        evaluate_missing.return_value = self.MISSING if missing is None else missing
        _checkins.return_value = checkins or []
        _open_alert.return_value = open_alert
        _delivery_failed.return_value = delivery_failed

        refresh_intraday_flags_for_employee_date("DI-1138", date(2026, 5, 28))
        return insert_flag, delete_flags

    @staticmethod
    def _codes(insert_flag):
        return [c.kwargs["flag_code"] for c in insert_flag.call_args_list]

    def test_zero_punches_raises_one_no_show_and_no_missing_time(self):
        insert_flag, _ = self._run()

        self.assertEqual(self._codes(insert_flag), ["UNNOTIFIED_ABSENCE"])

    def test_the_no_show_is_provisional_and_names_its_origin(self):
        insert_flag, _ = self._run()

        kwargs = insert_flag.call_args_list[0].kwargs
        self.assertEqual(kwargs["day_closed"], 0)
        self.assertEqual(
            kwargs["evidence"]["reason"], "on_shift_no_checkins_intraday"
        )
        # The frontend's "Punches: 0" fact reads this, and the zero IS the
        # finding (flagNarrative.test.ts:1198).
        self.assertEqual(kwargs["evidence"]["checkins_count"], 0)

    def test_below_the_threshold_nothing_is_raised_at_all(self):
        # No interval cleared absence_threshold_minutes, so today no
        # MISSING_TIME row would exist either. The no-show must not appear
        # earlier than the row it replaces.
        insert_flag, _ = self._run(missing=[])

        self.assertEqual(self._codes(insert_flag), [])

    def test_an_open_device_alert_suppresses_the_no_show(self):
        # A dead device must not produce a branch-wide wave of no-shows.
        insert_flag, _ = self._run(open_alert=True)

        self.assertEqual(self._codes(insert_flag), [])

    def test_a_delivery_failure_suppresses_the_no_show(self):
        insert_flag, _ = self._run(delivery_failed=True)

        self.assertEqual(self._codes(insert_flag), [])

    def test_the_provisional_no_show_is_cleaned_up_on_the_next_pass(self):
        # The self-healing guarantee. Intraday deletes its own previous
        # provisional rows scoped to INTRADAY_FLAG_CODES; if UNNOTIFIED_ABSENCE
        # is missing from that list the no-show survives the employee actually
        # turning up, and they are recorded absent for a day they worked.
        from dewey_time.attendance_engine.intraday import INTRADAY_FLAG_CODES

        self.assertIn("UNNOTIFIED_ABSENCE", INTRADAY_FLAG_CODES)

        _, delete_flags = self._run()
        self.assertIn(
            "UNNOTIFIED_ABSENCE", delete_flags.call_args.kwargs["flag_codes"]
        )
```

Add `dt_time` to the existing datetime import at the top of the file — it is currently
`from datetime import date, datetime` and `dt_time` is needed:

```python
from datetime import date, datetime, time as dt_time
```

- [ ] **Step 1a: Repoint the existing test that pins the old behaviour**

`TestIntradayRefresh.test_missing_time_when_zero_checkins` (line 22) sets up exactly the
scenario this task changes — zero checkins, both gates open, `evaluate_missing_time_flags`
returning one row — and asserts the **old** outcome, including
`self.assertNotIn("UNNOTIFIED_ABSENCE", flag_codes)`. After Step 4 all three of its
outcome assertions fail and its `next(...)` raises `StopIteration`.

Do not delete it. It carries two assertions nothing else makes: that the delete call is
scoped to `day_closed=0`, and that the `MISSING_TIME` insert is written provisionally. Move
it onto the punched-day path, where those assertions stay true and its
`assertNotIn("UNNOTIFIED_ABSENCE", ...)` becomes a genuine guard — a day with punches must
never produce a no-show.

Rename the method:

```python
    def test_missing_time_is_written_provisionally(
```

and change its `_get_checkins_for_day` patch (line 18) from `return_value=[]` to a single
punch whose branch matches the employee's, so the non-primary-site check stays silent and
the insert list holds `MISSING_TIME` alone:

```python
    @patch(
        "dewey_time.attendance_engine.intraday._get_checkins_for_day",
        return_value=[
            {
                "name": "IN-1",
                "time": datetime(2026, 5, 28, 8, 0),
                "custom_device_branch": "BRANCH-A",
            }
        ],
    )
```

Leave every assertion in its body unchanged. Leave its `datetime(...)` shift-meta values
alone too — they parse to `None` under Global Constraint 2, but this test mocks
`evaluate_missing_time_flags`, so nothing depends on them. Fixing that is not this task.

- [ ] **Step 2: Run them and watch them fail**

```bash
bash dev/sandbox/frappe-sandbox test --backend --fast --module test_intraday
```

Expected: `test_zero_punches_raises_one_no_show_and_no_missing_time` fails with `['MISSING_TIME'] != ['UNNOTIFIED_ABSENCE']`; `test_the_no_show_is_provisional_and_names_its_origin` fails on `KeyError: 'reason'`; `test_the_provisional_no_show_is_cleaned_up_on_the_next_pass` fails on the `assertIn` against `INTRADAY_FLAG_CODES`. The two suppression tests and the repointed `test_missing_time_is_written_provisionally` PASS already — they are regression guards, and the repointed one passing both before and after is the point: Step 1a moved it off the behaviour this task changes and onto behaviour it must not change.

- [ ] **Step 3: Add the code to the delete list**

Replace lines 25-28 of `dewey_time/attendance_engine/intraday.py`:

```python
INTRADAY_FLAG_CODES = [
    "MISSING_TIME",
    "NON_PRIMARY_SITE_PUNCH",
]
```

with:

```python
# Everything intraday writes MUST be listed here. This is the delete list at
# the top of every refresh, so a code intraday emits but does not list is
# never cleaned up: the provisional row survives the punch that disproves it.
INTRADAY_FLAG_CODES = [
    "MISSING_TIME",
    "NON_PRIMARY_SITE_PUNCH",
    "UNNOTIFIED_ABSENCE",
]
```

- [ ] **Step 4: Branch the absence block**

Replace lines 145-160:

```python
    if not skip_absence:
        max_end_min = missing_time_max_end_min_for_date(attendance_date)
        for flag_code, extra in evaluate_missing_time_flags(
            checkins=checkins,
            shift_meta=shift_meta,
            attendance_date=attendance_date,
            max_end_min=max_end_min,
        ):
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code=flag_code,
                evidence={**evidence, **extra},
                day_closed=0,
            )
```

with:

```python
    if not skip_absence:
        max_end_min = missing_time_max_end_min_for_date(attendance_date)
        missing = list(
            evaluate_missing_time_flags(
                checkins=checkins,
                shift_meta=shift_meta,
                attendance_date=attendance_date,
                max_end_min=max_end_min,
            )
        )

        if checkins_count == 0 and missing:
            # Nobody turned up. Closeout says exactly this and skips
            # MISSING_TIME the same way (closeout.py:568); intraday could not,
            # because it withholds UNNOTIFIED_ABSENCE for a day that is not
            # over yet. So it says it PROVISIONALLY, and withdraws it the
            # moment a punch lands -- this function re-runs on every checkin
            # edit and deletes its own previous rows first, which is why
            # UNNOTIFIED_ABSENCE has to be in INTRADAY_FLAG_CODES.
            #
            # Gated on `missing` rather than on a threshold of its own: the
            # row must appear when the first MISSING_TIME would have, not
            # sooner. Below absence_threshold_minutes there is no interval to
            # report and this list is empty, so the timing is identical to
            # what shipped before by construction rather than by arithmetic
            # repeated in two places. Both codes are CRITICAL, so nothing
            # gets louder either.
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code="UNNOTIFIED_ABSENCE",
                evidence={**evidence, "reason": "on_shift_no_checkins_intraday"},
                day_closed=0,
            )
        else:
            for flag_code, extra in missing:
                _insert_flag(
                    employee=employee,
                    company=employee_company,
                    attendance_date=attendance_date,
                    flag_code=flag_code,
                    evidence={**evidence, **extra},
                    day_closed=0,
                )
```

- [ ] **Step 5: Run the module**

```bash
bash dev/sandbox/frappe-sandbox test --backend --fast --module test_intraday
```

Expected: all pass. **The count must be 8 + 6 = 14** — six new tests, and the existing zero-checkin test repointed rather than added to. Report the number.

- [ ] **Step 6: Mutation-check both halves (Global Constraint 6)**

Remove `"UNNOTIFIED_ABSENCE"` from `INTRADAY_FLAG_CODES`. Re-run. Expected: `test_the_provisional_no_show_is_cleaned_up_on_the_next_pass` fails on both assertions. Restore.

Then change `if checkins_count == 0 and missing:` to `if checkins_count == 0:`. Re-run. Expected: `test_below_the_threshold_nothing_is_raised_at_all` fails — the no-show appears when no MISSING_TIME would have, which is the "no new noise" claim breaking. Restore, re-run, confirm 15 pass.

Record both results in the report.

- [ ] **Step 7: Run the whole backend suite**

```bash
bash dev/sandbox/frappe-sandbox test --backend
```

Expected: no failures. `test_integration_pilot_matrix.py:203` and `test_closeout.py:551` both pin closeout's zero-punch behaviour and must still pass untouched — if either moves, Global Constraint 1 has been broken.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/attendance_engine/intraday.py dewey_time/tests/test_intraday.py
git commit -m "feat(intraday): a no-show gets to say so before the day ends

A day nobody turned up for showed two 'missing 4 hours' rows split by a
lunch nobody was there to take. Closeout already calls this UNNOTIFIED_ABSENCE
and skips MISSING_TIME (closeout.py:568). Intraday could not, because it
withholds the code for a day that is not over -- so it said nothing, and
MISSING_TIME filled the silence.

It now says it provisionally, gated on evaluate_missing_time_flags having
returned rows rather than on a threshold of its own, so the row appears at
exactly the moment the first MISSING_TIME did and at the same CRITICAL
severity. No new rows, no new urgency -- the row that said 'missing 4 hours'
says 'did not show up'.

UNNOTIFIED_ABSENCE joins INTRADAY_FLAG_CODES, which is what makes it
withdrawable: that list is the delete set at the top of every refresh, and
without it the provisional no-show would survive the employee turning up."
```

---

### Task 3: A bulk regenerator, so the change can be seen

**Files:**
- Modify: `dewey_time/attendance_engine/dev_tools.py` (add a constant near `MAX_RANGE_DAYS` at line 24; add two whitelisted functions at end of file)
- Test: `dewey_time/tests/test_dev_tools.py` (append a new class at end of file)

**Interfaces:**
- Consumes: Tasks 1 and 2 are what makes this worth running, but this task has no code dependency on either.
- Produces: `preview_regenerate_flags_for_range_api(start_date, end_date)` and `regenerate_flags_for_range_api(start_date, end_date, confirm=None, mode="both")`, both `@frappe.whitelist`.

**Why this exists:** after Tasks 1 and 2 deploy, only re-processed days take the new shape; older days keep their split rows. Opening `/hr-flags` to judge the change would mean reading a blend of before and after — an artifact that looks like a result. It will be run more than once before go-live, once per threshold adjustment.

**Background the implementer needs:**

- `_require_system_manager_for_clear()` (line 132) and `_parse_confirm()` (line 124) are the existing destructive-tool conventions. Follow `clear_employee_schedule_api` (line 150) exactly: no confirm → return `{"needs_confirm": True, "preview": ...}` and change nothing.
- **`add_days` and `getdate` are bound at import time**, and the shared frappe mock defines `add_days` as `lambda value, days: value` — a no-op that turns any date loop into an infinite hang. `test_dev_tools.py` already installs real ones and force-reloads the module for exactly this reason (lines 14-39). Your new tests inherit that setup because they live in the same file; do not add a second mock installation.
- `_delete_auto_flags_for_employee_date` is not currently imported into `dev_tools.py`. Add it to the existing `from ...closeout import` block at line 8.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_dev_tools.py`:

```python
class TestRegenerateFlagsForRange(unittest.TestCase):
    """Bulk wipe-and-rebuild, so the queue speaks one language after a change.

    The module-level setup in this file installs real getdate/add_days and
    reloads dev_tools; the shared frappe mock's add_days is a no-op that would
    hang every date loop below.
    """

    def setUp(self):
        frappe.db.commit.reset_mock()
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["System Manager"]

    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=7)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_without_confirm_it_previews_and_changes_nothing(self, get_all, _count):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}, {"name": "DI-2"}]

        with patch(
            "dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date"
        ) as delete_flags:
            result = regenerate_flags_for_range_api(
                start_date="2026-05-01", end_date="2026-05-03"
            )

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["employees"], 2)
        self.assertEqual(result["preview"]["days"], 3)
        self.assertEqual(result["preview"]["auto_flags_in_range"], 7)
        delete_flags.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_confirmed_it_wipes_and_rebuilds_every_employee_day(
        self, get_all, _count, delete_flags, refresh_intraday, generate_closeout
    ):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}, {"name": "DI-2"}]

        result = regenerate_flags_for_range_api(
            start_date="2026-05-01", end_date="2026-05-02", confirm=True
        )

        # 2 employees x 2 days
        self.assertEqual(delete_flags.call_count, 4)
        self.assertEqual(refresh_intraday.call_count, 4)
        self.assertEqual(generate_closeout.call_count, 4)
        self.assertEqual(result["employees_processed"], 2)
        self.assertEqual(result["days_processed"], 4)

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_mode_intraday_skips_closeout(
        self, get_all, _count, _delete_flags, refresh_intraday, generate_closeout
    ):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}]

        regenerate_flags_for_range_api(
            start_date="2026-05-01",
            end_date="2026-05-01",
            confirm=True,
            mode="intraday",
        )

        refresh_intraday.assert_called_once()
        generate_closeout.assert_not_called()

    def test_a_non_system_manager_is_refused(self):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        frappe.get_roles.return_value = ["HR User"]

        with self.assertRaises(Exception):
            regenerate_flags_for_range_api(
                start_date="2026-05-01", end_date="2026-05-02", confirm=True
            )

    def test_an_over_long_range_is_refused(self):
        from dewey_time.attendance_engine.dev_tools import (
            MAX_BULK_RANGE_DAYS,
            regenerate_flags_for_range_api,
        )

        with self.assertRaises(Exception):
            regenerate_flags_for_range_api(
                start_date="2026-01-01",
                end_date=str(date(2026, 1, 1) + timedelta(days=MAX_BULK_RANGE_DAYS)),
                confirm=True,
            )

    def test_an_unknown_mode_is_refused(self):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        with self.assertRaises(Exception):
            regenerate_flags_for_range_api(
                start_date="2026-05-01",
                end_date="2026-05-01",
                confirm=True,
                mode="sideways",
            )
```

- [ ] **Step 2: Run them and watch them fail**

```bash
bash dev/sandbox/frappe-sandbox test --backend --fast --module test_dev_tools
```

Expected: every new test fails with `ImportError: cannot import name 'regenerate_flags_for_range_api'`.

- [ ] **Step 3: Add the import and the constant**

In `dewey_time/attendance_engine/dev_tools.py`, change line 8:

```python
from dewey_time.attendance_engine.closeout import _generate_for_employee_date
```

to:

```python
from dewey_time.attendance_engine.closeout import (
    _delete_auto_flags_for_employee_date,
    _generate_for_employee_date,
)
```

And after `MAX_RANGE_DAYS = 31` (line 24):

```python
# The per-employee tool is capped at 31 days because it is a spot-check. This
# one is a deliberate bulk rebuild, so it needs a wider range and a harder
# stop: a quarter is enough to re-shape everything anyone is looking at
# before go-live, and short enough that an all-time run cannot be a typo.
MAX_BULK_RANGE_DAYS = 92
```

- [ ] **Step 4: Add the two functions at the end of the file**

```python
def _validate_bulk_range(start_date, end_date):
    if not start_date or not end_date:
        frappe.throw("start_date and end_date are required")

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be on or after start_date")

    day_count = (end - start).days + 1
    if day_count > MAX_BULK_RANGE_DAYS:
        frappe.throw(f"Date range cannot exceed {MAX_BULK_RANGE_DAYS} days")
    return start, end


def _active_employee_names() -> list[str]:
    return [
        row["name"]
        for row in frappe.get_all(
            "Employee", filters={"status": "Active"}, fields=["name"], order_by="name"
        )
    ]


@frappe.whitelist()
def preview_regenerate_flags_for_range_api(start_date=None, end_date=None):
    """Dev-only: what a bulk flag rebuild would touch, before it touches it."""
    _require_system_manager_for_clear()
    start, end = _validate_bulk_range(
        start_date or frappe.form_dict.get("start_date"),
        end_date or frappe.form_dict.get("end_date"),
    )
    return {
        "start_date": str(start),
        "end_date": str(end),
        "days": (end - start).days + 1,
        "employees": len(_active_employee_names()),
        "auto_flags_in_range": frappe.db.count(
            "Attendance Flag",
            {"source": "AUTO", "attendance_date": ["between", [start, end]]},
        ),
    }


@frappe.whitelist(methods=["POST"])
def regenerate_flags_for_range_api(
    start_date=None, end_date=None, confirm=None, mode="both"
):
    """Dev-only: wipe and rebuild AUTO flags for every active employee in a range.

    Exists because a change to what the engine emits only reaches days that
    are re-processed. Without this the queue shows the old and the new shape
    at once, and the data being used to judge the change becomes an artifact
    that looks like a result.

    Destructive, so it follows the same contract as the clear_* tools: System
    Manager only, and no confirm means a preview and nothing else.
    """
    _require_system_manager_for_clear()
    start, end = _validate_bulk_range(
        start_date or frappe.form_dict.get("start_date"),
        end_date or frappe.form_dict.get("end_date"),
    )

    mode = (mode or "both").strip().lower()
    if mode not in VALID_MODES:
        frappe.throw(f"mode must be one of: {', '.join(sorted(VALID_MODES))}")

    confirm_value = confirm
    if confirm_value is None:
        confirm_value = frappe.form_dict.get("confirm")
    if not _parse_confirm(confirm_value):
        return {
            "needs_confirm": True,
            "preview": preview_regenerate_flags_for_range_api(
                start_date=str(start), end_date=str(end)
            ),
        }

    employees = _active_employee_names()
    days_processed = 0
    for employee in employees:
        current = start
        while current <= end:
            # Explicit, because mode="intraday" alone would otherwise leave
            # stale finals behind: refresh_intraday only deletes its own
            # provisional rows, scoped to INTRADAY_FLAG_CODES.
            _delete_auto_flags_for_employee_date(
                employee=employee, attendance_date=current
            )
            if mode in ("intraday", "both"):
                refresh_intraday_flags_for_employee_date(employee, current)
            if mode in ("closeout", "both"):
                _generate_for_employee_date(
                    employee=employee,
                    attendance_date=current,
                    include_unnotified_absence=True,
                )
            days_processed += 1
            current = add_days(current, 1)
        # Per employee, not once at the end: a bulk run over a quarter should
        # not be a single transaction held open for its whole duration.
        frappe.db.commit()

    return {
        "start_date": str(start),
        "end_date": str(end),
        "mode": mode,
        "employees_processed": len(employees),
        "days_processed": days_processed,
    }
```

- [ ] **Step 5: Run the module**

```bash
bash dev/sandbox/frappe-sandbox test --backend --fast --module test_dev_tools
```

Expected: all pass. **The count must be 6 + 6 = 12.** Report the number.

- [ ] **Step 6: Mutation-check the confirm gate (Global Constraint 6)**

Change `if not _parse_confirm(confirm_value):` to `if False:`. Re-run. Expected: `test_without_confirm_it_previews_and_changes_nothing` fails, because the wipe now runs unconfirmed. Restore.

Then change `_require_system_manager_for_clear()` to a bare `pass` in `regenerate_flags_for_range_api`. Re-run. Expected: `test_a_non_system_manager_is_refused` fails. Restore, re-run, confirm all pass.

- [ ] **Step 7: Verify against a real bench (Global Constraint 6 is not enough here)**

This function deletes rows. Mocked tests cannot show that the delete filter matches what was intended, and a wipe verified only against mocks has been wrong in this project before.

Bring up the sandbox and exercise it for real:

```bash
cd dev/sandbox
bash ./frappe-sandbox up
bash ./frappe-sandbox install-app
bash ./frappe-sandbox seed --clean
```

Then, in the bench, confirm three things and record the numbers in the report:

1. `preview_regenerate_flags_for_range_api` reports a non-zero `auto_flags_in_range` for a range that has flags.
2. Calling `regenerate_flags_for_range_api` **without** confirm changes that count by zero.
3. Calling it **with** `confirm=True` leaves a flag set for a zero-punch day that is exactly `{"UNNOTIFIED_ABSENCE"}` — the end-to-end proof that Tasks 1-3 compose.

If the sandbox cannot be brought up, report BLOCKED with the error rather than marking this step done.

- [ ] **Step 8: Run the whole backend suite**

```bash
bash dev/sandbox/frappe-sandbox test --backend
```

Expected: no failures.

- [ ] **Step 9: Commit**

```bash
git add dewey_time/attendance_engine/dev_tools.py dewey_time/tests/test_dev_tools.py
git commit -m "feat(dev-tools): bulk flag regeneration, so a change to the engine can be seen

A change to what the engine emits only reaches days that are re-processed,
so after one the queue shows the old and the new shape at once and the data
being used to judge the change becomes an artifact that looks like a result.

System Manager only, preview-before-delete, and capped at a quarter --
following the clear_* contract rather than inventing a second one. Commits
per employee so a long run is not one transaction held open throughout."
```

---

## Self-Review

**Spec coverage.** Decision 1 → Task 2. Decision 2 → Task 1. Decision 3 → Task 3. Spec's testing table: every row maps to a named test above except "observed lunch present; lunch still carved out, no bridging", which the deviation note removes as unreachable, and "zero punches, closeout — unchanged" / "no schedule — unchanged", which are covered by Task 2 Step 7 re-running `test_integration_pilot_matrix` and `test_closeout` rather than by new tests, since those pins already exist. Spec's Risks table: each mitigation has a test except the last two, which are documentation-only by design.

**Placeholder scan.** No TBD/TODO. Every code step carries the literal code. Every test step carries the literal test. Every run step carries the literal command and the expected result.

**Type consistency.** `_bridge_scheduled_lunch(intervals, *, lunch_start, lunch_end)` is defined in Task 1 Step 3 and called in Step 4 with keyword arguments matching. `MAX_BULK_RANGE_DAYS` is defined in Task 3 Step 3 and imported by the test in Step 1. `_validate_bulk_range` and `_active_employee_names` are defined before their callers in the same step. `INTRADAY_FLAG_CODES` is imported by name in Task 2's test and modified in Task 2 Step 3. The evidence key `reason` matches Global Constraint 3 in both the test and the implementation.

## Open item, before Task 1

The spec's open question is unresolved: whether closed past days also carry split `MISSING_TIME`. The SQL is in the spec. If it returns any `day_closed=1` rows, that is a separate closeout defect and a fourth task belongs in this plan — closeout deletes and regenerates both provisional and final rows, so a properly closed day cannot keep them, and any that exist mean days that never closed. Nothing in Tasks 1-3 depends on the answer, so execution can start; but do not close the plan without it.
