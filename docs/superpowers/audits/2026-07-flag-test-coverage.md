# Flag-Engine Test Coverage Map — 2026-07-04

**Purpose:** Quantify what the synthetic (mocked/fixture) unit tests already prove about flag-generation logic, and identify what residual scenarios must be verified against real production punch data.

**Branch:** `docs/pre-rollout-readiness-spec`

---

## How to run the synthetic suite (no prod backup needed)

```bash
# Requires a running Docker bench (frappe-sandbox), NOT the prod backup seed.
cd dev/sandbox
./frappe-sandbox up
./frappe-sandbox test --backend   # runs all dewey_time.tests.* except test_integration_pilot_matrix

# To also run the real-bench integration matrix (needs a bench DB, not prod data):
./frappe-sandbox test --backend --module test_integration_pilot_matrix
```

The integration matrix (`test_integration_pilot_matrix.py`) seeds its own fixtures inside the bench and self-skips when the real `frappe` module is absent (fast-lane / CI with monkeypatched frappe).

---

## Test infrastructure: how frappe context is established

All synthetic tests (every file except `test_integration_pilot_matrix.py`) use a module-level `_install_frappe_mock()` call (defined in `test_closeout.py`, re-used via import) that installs a `MagicMock` in `sys.modules["frappe"]` before any engine code is imported. This means:

- **No real Frappe bench is required** for the synthetic suite.
- All `frappe.get_cached_doc`, `frappe.get_all`, `frappe.db.*`, `frappe.enqueue` calls are replaced with controllable mocks.
- Engine functions are tested against **constructed Python inputs** — the logic is exercised but the data retrieval layer is fully stubbed.

`test_integration_pilot_matrix.py` is the sole exception: it detects whether `frappe` is a `MagicMock` at import time and `@unittest.skipUnless`-gates all tests on `_HAS_REAL_BENCH`. It uses `FrappeTestCase`, seeds real DocType rows, and reads actual `Attendance Flag` records. It needs a bench DB but not the anonymized prod backup.

---

## Coverage table

| Flag code | Tested? | Test file : function(s) | Scenarios covered (synthetic unless noted) | Notable gaps |
|---|---|---|---|---|
| `LATE_START` | YES | `test_closeout.py:TestLateAndEarlyFlags::test_closeout_late_start_and_left_early` (30 min late past 10 min grace); `test_late_start_respects_hrms_grace_when_custom_zero` (8:10 vs 15 min HRMS grace — fires at :16, not :10); `test_late_start_not_flagged_for_timedelta_shift_start` (timedelta start_time format); `test_late_start_suppressed_with_single_punch`; `test_integration_pilot_matrix.py:TestPilotMatrix::test_late_start` (real-bench, 20 min late) | Basic late > grace fires; HRMS grace takes precedence over custom_grace_minutes=0; timedelta shift start does not misfire; single-punch suppression; holiday suppression via `test_holiday_wins_emits_only_off_shift_punch_when_checkins_exist` | Overnight shift (start_time crossing midnight); exactly-at-grace-boundary (off-by-one); late IN + late OUT (co-occurrence with LEFT_EARLY on same day not asserted); >2 punches (e.g. 4-punch day, first IN is late); DST spring-forward; employee with no shift_meta (shift_meta=None path) |
| `LEFT_EARLY` | YES | `test_closeout.py:TestLateAndEarlyFlags::test_closeout_late_start_and_left_early` (OUT at 16:00 vs 17:00 end, 10 min grace); `test_integration_pilot_matrix.py:TestPilotMatrix::test_left_early` (real-bench, OUT at 16:45) | Basic early exit past grace fires; co-occurrence with LATE_START on same day; grace=0 path | Overnight shift (end_time crosses midnight); exactly-at-grace-boundary; 4-punch day (last OUT is early vs. shift end); early OUT on a day that also has MISSING_TIME; DST fall-back |
| `MISSING_TIME` | YES | `test_absence_flags.py:TestAbsenceIntervals::test_missing_expected_leading_gap_35_minutes` (leading gap); `test_away_gap_between_segments` (60 min away gap with lunch window); `test_intraday.py:TestIntradayRefresh::test_missing_time_when_zero_checkins` (intraday path, evaluate_missing mocked); `test_integration_pilot_matrix.py:TestPilotMatrix::test_missing_time_intra_shift_gap` (real-bench, 45 min mid-morning gap) | Leading gap >30 min detected; away gap (mid-shift absence) with lunch exclusion zone; intraday provisional flag (day_closed=0); delivery-fail suppression; holiday skip | Trailing gap (left early + no OUT vs shift end — distinct from LEFT_EARLY); overnight shift (gap crossing midnight); multiple simultaneous gaps on same day (only single gap asserted); exact-threshold boundary (29 vs 30 vs 31 min); lunch-window exclusion interplay with custom_lunch_start=None; absence_threshold_minutes configured to non-default via frappe.conf |
| `ATTENDANCE_ISSUE` | YES (partial) | `test_closeout.py:TestDeviceCloseoutFlags::test_device_closeout_creates_delivery_failed_without_absence` (delivery_failed reason); `test_integration_pilot_matrix.py:TestPilotMatrix::test_single_checkin_attendance_issue` (real-bench, single punch) | `delivery_failed` reason on zero-checkin device closeout; single_checkin reason (real-bench); co-exclusion with UNNOTIFIED_ABSENCE asserted in test_sandbox_verify.py | `unpaired_punch` reason (odd number of punches ≥3) not directly asserted in synthetic tests; `unknown_device_branch` reason (punch with empty/null device branch) not directly asserted; `missing_lunch_pair` reason not asserted; evaluate_record_issue_flags is called through closeout but its per-reason paths only touched by integration test (single_checkin) |
| `UNNOTIFIED_ABSENCE` | YES | `test_intraday.py:TestIntradayRefresh::test_missing_time_when_zero_checkins` (not emitted in intraday); `test_closeout.py:TestDeviceCloseoutFlags::test_device_closeout_creates_delivery_failed_without_absence` (suppressed when undelivered_items present); `test_closeout.py:TestDeviceCloseoutFlags::test_company_fallback_skips_open_branch_alert`; `test_integration_pilot_matrix.py:TestPilotMatrix::test_unnotified_absence` (real-bench, zero checkins on-shift day) | Suppressed when device has open alert; suppressed when delivery failed; not emitted in intraday pass; real-bench zero-checkin on-shift triggers exactly UNNOTIFIED_ABSENCE | Employee on leave (Leave Application record) with no checkins — leave suppression path not tested (no `should_skip_absence_flags` synthetic test); employee with no branch (employee_branch=None) and open alert; company fallback path for multi-company |
| `OFF_SHIFT_PUNCH` | YES | `test_absence_flags.py:TestOffShiftGate::test_off_shift_only_off_shift_punch` (no shift, one punch); `test_closeout.py:TestLateAndEarlyFlags::test_holiday_wins_emits_only_off_shift_punch_when_checkins_exist` (holiday with checkins); `test_holiday_wins_creates_no_flags_when_no_checkins` (holiday + no checkins = no flag); `test_integration_pilot_matrix.py:TestPilotMatrix::test_holiday_punch_is_off_shift_only` (real-bench) | No shift assignment + checkins present; holiday overrides shift; holiday + no checkins = silent; mutual exclusion with UNNOTIFIED_ABSENCE and MISSING_TIME verified in test_sandbox_verify.py | Weekly off day (shift assignment exists but day is off-day — depends on shift_assignment.py returning None correctly; not directly tested end-to-end); punch on terminated employee; double-booked employee (two shift types on same day); off-shift punch on a day employee also has an active shift for a different branch |
| `NON_PRIMARY_SITE_PUNCH` | YES | `test_closeout.py:TestLateAndEarlyFlags::test_closeout_late_start_and_left_early` (all punches from same branch — no NON_PRIMARY, implicit); `test_intraday.py` (NON_PRIMARY_SITE_PUNCH emitted at line 107 of intraday.py per grep); `test_integration_pilot_matrix.py:TestPilotMatrix::test_non_primary_site_punch` + `test_intraday_provisional_non_primary_site` (real-bench, all punches from ALT_BRANCH) | Real-bench: all punches from alt branch fires flag; intraday provisional path (day_closed=0) verified; co-occurrence with LATE_START/LEFT_EARLY allowed (test_sandbox_verify.py) | Mixed-branch day (some punches primary, some alt) — non_primary_hits partial count not directly asserted in synthetic tests; employee with no branch (employee_branch=None, so non_primary_hits=0 skipped) not asserted; single alt-branch punch vs. all alt-branch |
| `LATE_FROM_LUNCH` | YES | `test_lunch_flags.py:TestLunchFlags::test_late_from_lunch_after_grace` (returned at 13:30 vs 13:00 end, 15 min grace → fires); `test_no_flags_when_lunch_out_in_present` (on-time return = no flag); `test_missing_lunch_when_no_pair_in_window` (no OUT/IN pair in window = no LATE_FROM_LUNCH, no MISSING_LUNCH); `test_ignores_short_pair_and_does_not_flag_late_from_lunch` (15 min pair in 60 min window ignored as non-lunch); `test_skips_short_shift_without_lunch_fields` (no custom_lunch_start/end = skip) | Late return fires after grace; on-time return clean; absent lunch pair does not misfire; short pair (< half scheduled) ignored; no lunch fields = skip | Exactly-at-grace-boundary (30 min late with 30 min grace); multiple lunch pairs (employee leaves/returns twice in lunch window); overnight lunch (shift crosses midnight); LATE_FROM_LUNCH co-occurrence with MISSING_TIME not asserted at system level; lunch detection when custom_lunch_start and custom_lunch_end are timedelta objects vs. time objects |

---

## What synthetic tests DO verify

The ~5,700-line synthetic suite, running against a `MagicMock` frappe without any real DB, verifies the following about the flag logic:

1. **Decision rules are correctly applied to structured inputs.** Given a shift_meta dict with known start/end/grace values and a checkins list with known timestamps, the correct flag codes are produced (or suppressed). This covers the core arithmetic: `first_in > late_threshold → LATE_START`, `last_out < early_threshold → LEFT_EARLY`, `gap_minutes >= threshold → MISSING_TIME`, etc.

2. **Grace precedence is correct.** `max(custom_grace_minutes, late_entry_grace_period)` governs start; `max(custom_grace_minutes, early_exit_grace_period)` governs end. Both the max-selection and the evidence dict are asserted.

3. **Short-circuit / suppression logic is correct.** Holiday overrides shift; off-shift suppresses on-shift flags; single-punch suppresses LATE_START; delivery-failed suppresses UNNOTIFIED_ABSENCE; open device alert suppresses company fallback; intraday skips holidays; delivery-failed skips MISSING_TIME.

4. **Shift assignment range lookup is correct.** The range-aware `_get_shift_assignment_query` correctly includes mid-block dates (Tue in Mon–Sat block), excludes post-block dates, prefers Active over Inactive for historical dates, and uses HRMS fallback correctly.

5. **Lunch detection boundary conditions.** Short pairs inside the window are excluded as non-lunch; on-time vs. late return is detected relative to `custom_lunch_end + grace_minutes`.

6. **Result integrity oracles.** `test_sandbox_verify.py` verifies the post-condition rules (no duplicates, mutual exclusion, no provisional-after-closeout) as standalone pure-Python functions — so the oracles themselves are pre-validated before use against real data.

7. **Intraday vs. closeout path separation.** `day_closed=0` (provisional) vs. `day_closed=1` (final) is asserted for the intraday path.

---

## What still needs real production data (residual-risk list)

The synthetic tests are constructed-input tests: they prove the logic, not correctness on the full distribution of real-world punch patterns. The following risks are NOT resolved by synthetic coverage and must be verified in the real-data pass (Tasks 7–8):

1. **Overnight shift flag arithmetic.** No test exercises a shift whose `start_time > end_time` (e.g. 22:00–06:00). The `combine_date_time` helper and `shift_time_to_minutes` are tested but the closeout engine's overnight path (end_dt on date+1) is not covered. `LATE_START`, `LEFT_EARLY`, and `MISSING_TIME` arithmetic on overnight shifts may be wrong.

2. **Odd-punch-count (3, 5, 7 punches) ATTENDANCE_ISSUE.** The `unpaired_punch` reason in `record_issue_flags.py` is exercised only by the real-bench single-checkin test; a 3-punch day (unpaired trailing IN) is not covered synthetically. This is a common real-world pattern.

3. **Mixed-branch days (some primary, some alt-branch).** `NON_PRIMARY_SITE_PUNCH` is tested with all punches from alt-branch, but a realistic scenario where an employee punches IN at their primary branch and OUT at an alt-branch is not asserted. The `non_primary_hits` partial-count logic is untested.

4. **Employee with no branch (`employee.branch = None`).** The engine skips `NON_PRIMARY_SITE_PUNCH` when `employee_branch` is falsy. Correct behavior is that no flag is emitted and no error is raised — this is not explicitly tested.

5. **Leave suppression for UNNOTIFIED_ABSENCE.** `should_skip_absence_flags` is called before inserting `UNNOTIFIED_ABSENCE`, but no synthetic test covers an employee who has an approved Leave Application on the target date. Real data will include leave days; the suppression must be verified.

6. **Multi-MISSING_TIME gaps on a single day.** The engine can emit multiple `MISSING_TIME` flags for multiple gaps. Only single-gap scenarios are asserted. A day with a leading gap AND an away gap (e.g. arrived late, left for an errand) is not covered.

7. **DST transitions.** No test covers a day where clocks spring forward or fall back. `combine_date_time` and the ZoneInfo-based closeout window logic are both untested under DST. This is particularly relevant for the company fallback "is it 03:00?" check.

8. **`unknown_device_branch` ATTENDANCE_ISSUE reason.** Punches where `custom_device_branch` is empty or None yield an `ATTENDANCE_ISSUE(reason=unknown_device_branch)`. No test asserts this reason fires correctly.

9. **Duplicate punches / idempotency.** The engine assumes checkins are deduplicated by the Bridge service. If a day contains two identical timestamps (same employee, same time), segment derivation behavior is unverified.

10. **`ATTENDANCE_ISSUE(reason=missing_lunch_pair)`.** The `MISSING_LUNCH` path in `record_issue_flags.py` is called when a shift has a lunch window and the observed lunch pair is absent. No synthetic or integration test asserts this reason specifically.

---

## Verdict

**7 of 8 flag codes have meaningful synthetic test coverage** (`LATE_START`, `LEFT_EARLY`, `MISSING_TIME`, `ATTENDANCE_ISSUE`, `UNNOTIFIED_ABSENCE`, `OFF_SHIFT_PUNCH`, `NON_PRIMARY_SITE_PUNCH`, `LATE_FROM_LUNCH`). The one partial case is `ATTENDANCE_ISSUE`, where only the `delivery_failed` and `single_checkin` reasons are directly asserted — the `unpaired_punch`, `unknown_device_branch`, and `missing_lunch_pair` sub-reasons are not.

**The biggest residual risk is the overnight shift path:** no synthetic or integration test exercises `LATE_START`, `LEFT_EARLY`, or `MISSING_TIME` on a shift crossing midnight, yet the arithmetic in those three detectors is different for overnight shifts.
