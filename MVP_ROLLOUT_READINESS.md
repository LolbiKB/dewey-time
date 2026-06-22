# MVP rollout — readiness report

Companion to [`FLAG_ENGINE_MVP.md`](FLAG_ENGINE_MVP.md). Turns the go-live checklist
into a **verified** status: what is proven done (with evidence) vs. what is yours to
execute (ops / data / deploy). Produced from a local Dockerized bench
(`dev/sandbox`) — no production data or systems were touched.

**Bottom line:** the engine is now **real-DB verified** for the MVP flag set. The
remaining rollout gates are operational (production deploy, device/branch config,
HR shift data, live pilot sign-off) — none are blocked on further engine code.

---

## 1. Engine trustworthiness — ✅ VERIFIED (real DB)

Until now the whole test suite (169 tests) mocked `frappe` — green tests proved the
*logic*, not that the engine produces correct flags against a **real Frappe DB**
(real `Shift Assignment` submission, real `Attendance Flag` inserts, real SQL). That
gap is now closed by an automated pilot matrix that runs the **actual** closeout core
(`_generate_for_employee_date`) against a seeded real bench and asserts the actual
`Attendance Flag.flag_code` rows:

| Scenario (1 employee-day) | Expected flags | Result |
|---|---|---|
| Clean on-time day | _(none)_ | ✅ |
| Late arrival (09:20, grace 0) | `LATE_START` | ✅ |
| Left early (out 16:45) | `LEFT_EARLY` | ✅ |
| On-shift, zero checkins | `UNNOTIFIED_ABSENCE` | ✅ |
| Single checkin | `ATTENDANCE_ISSUE` | ✅ |
| Holiday + punches | `OFF_SHIFT_PUNCH` only | ✅ |
| Punch at non-home branch | `NON_PRIMARY_SITE_PUNCH` | ✅ |
| 45-min intra-shift gap | `MISSING_TIME` | ✅ |
| Intraday refresh, non-home branch | provisional `NON_PRIMARY_SITE_PUNCH` (`day_closed=0`) | ✅ |

Plus the **invariant oracle** (`sandbox_verify`: no duplicate flags, no
mutually-exclusive combinations, no provisional-after-closeout) holds on every
scenario.

Reproduce (from `dev/sandbox/`, Docker running):

```bash
./frappe-sandbox ready                                              # cold start (idempotent)
./frappe-sandbox test --backend --module test_integration_pilot_matrix
```

Source: `dewey_time/tests/test_integration_pilot_matrix.py` (branch
`mvp/real-db-pilot-matrix`).

### Not yet covered by the automated matrix (P1 / follow-up)
- `LATE_FROM_LUNCH` (needs `custom_lunch_start/end` + observed-lunch gap) — implemented, not yet in the matrix.
- `DELIVERY_FAILED` (bridge `undelivered[]` path) — exercised only via mocks.
- Closeout is the primary path covered; intraday is proven for the
  `NON_PRIMARY_SITE_PUNCH` provisional case (intraday `MISSING_TIME` is the obvious next add).

---

## 2. Test-suite finding — global `frappe` mock leak (follow-up, not a ship blocker)

14 of 18 test modules call `_install_frappe_mock()` **at import time**, which does
`sys.modules["frappe"] = MagicMock()` — process-wide. Consequences:

- **`bench run-tests --app dewey_time` is not real-DB "CI parity."** Once a mock
  module is imported, the rest of the suite (and HRMS's `before_tests` bootstrap)
  runs against the MagicMock. The "169 tests in 0.1s" under bench is the same mock
  run as the no-Docker fast lane, not DB-backed execution.
- **Real-DB tests can't join the `--app` suite** — their `import frappe` gets the
  MagicMock. The new pilot matrix therefore runs as an isolated `--module` lane and
  self-skips elsewhere.

**Recommended follow-up (separate change):** scope the mock to `setUp`/`tearDown`
(or a context manager / dependency injection) instead of replacing `sys.modules`
globally, so mock-based unit tests and real-DB integration tests can coexist in one
`bench run-tests --app` run and CI parity becomes real. Larger refactor across 14
modules — deliberately left out of the rollout branch.

---

## 3. Go-live checklist — code vs. ops

### Code — ✅ in repo & verified
- Range-aware `get_shift_assignment` (P0 #1) — in repo; covered by the matrix's submitted-assignment path.
- Scheduler wiring — `hooks.py`: `daily` → `closeout.run_company_fallback_closeout`; `*/30` → `intraday.run_intraday_scheduler`.
- Checkin → intraday — `doc_events` `after_insert`/`on_update`.
- Custom fields — shipped on `after_install` **and** `after_migrate` (`setup/custom_fields.make_custom_fields`).
- Bridge webhooks — `notify_device_closeout_status` / `notify_device_sync_status` (`bridge_auth` validated).

### Ops / data / deploy — ⛔ YOURS to execute (production; not done autonomously)
1. **Deploy the current `main`/release to Frappe Cloud** and `bench migrate` (applies custom fields, registers hooks).
2. **Enable the Frappe scheduler** on the Cloud site (`bench --site <site> scheduler enable`; confirm it is not paused).
3. **Bridge env**: `FRAPPE_URL`, `FRAPPE_API_KEY`/secret, optional `FRAPPE_BRIDGE_SECRET`.
4. **Supabase `devices.location` == Frappe `Branch.name`** (drives `custom_device_branch` → `NON_PRIMARY_SITE_PUNCH`).
5. **Pilot employees**: submitted **Active** `Shift Assignment` covering the pilot window, correct `Employee.branch`, and a `Holiday List` set as the company `default_holiday_list`.
6. **Re-flag pre-fix dates** if needed: wipe AUTO flags and re-run intraday/closeout for affected dates (range-fix is not retroactive — see `FLAG_ENGINE_MVP.md`).

### Pilot sign-off — ⛔ blocked on real data
The live 5×20 pilot matrix (expected vs. actual on real employees) needs real shift
data in production. Current prod is an **empty pilot** (no shifts / minimal checkins),
so the live matrix can't run yet. The automated matrix above is the engine-side
stand-in until then.

---

## 4. Suggested order of operations
1. Deploy + migrate to Cloud, enable scheduler (steps 1–2).
2. Enter pilot shift data + holiday list + branch mapping (steps 4–5).
3. Wire Bridge env and confirm device closeout webhook fires (step 3).
4. Let a few days close; spot-check flags against expectations (live pilot matrix).
5. (Engineering, parallel) tackle the §2 mock-leak refactor so CI parity is real.
