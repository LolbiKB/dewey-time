# Flag engine MVP — scope and sign-off

Single source of truth for **what the zkteco_hr flag engine must do for a pilot** vs what is deferred. Policy definitions remain in [`FRAPPE_ATTENDANCE_RULES.md`](./FRAPPE_ATTENDANCE_RULES.md). Implementation lives in **https://github.com/LolbiKB/zkteco_hr**.

**MVP bar:** trustworthy for **5 employees × 20 days** with manual spot-checks — not every rule in the policy doc.

---

## What the flag engine is

```text
Employee Checkin (bridge ledger)
       +
Shift Assignment (submitted, active, date range)
       ↓
zkteco_hr: intraday (day_closed=0) + closeout (day_closed=1) + 03:00 fallback
       ↓
Attendance Flag rows + /hr-attendance calendar display
```

No ERPNext **Attendance** (payroll) status. No **`Attendance Day`** projection table.

---

## P0 — Ship blockers (before pilot)

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1 | **Range-aware Shift Assignment lookup** | zkteco_hr | **Done in repo** — see below |
| 2 | Bridge **device closeout** → `notify_device_closeout_status` | bridge + zkteco_hr | Code done; verify on Cloud + bridge env |
| 3 | **Frappe scheduler** on Cloud | ops | In `hooks.py`; enable on site |
| 4 | **Shift setup** per pilot employee | HR | Data — submitted **Active** assignments covering pilot dates |
| 5 | **Pilot matrix** 5 × 20 | HR + eng | Process — expected vs actual `flag_code` spreadsheet |

### P0 #1 — Shift assignment lookup (verified in repo)

**Module:** `zkteco_hr/zkteco_hr/attendance_engine/shift_assignment.py` — `get_shift_assignment(employee, attendance_date)`.

Do **not** duplicate logic in `closeout.py`. All callers import this module:

- `hr_calendar.py` — expected shift band / off-day
- `intraday.py` — on-shift intraday flags
- `closeout.py` — closeout flag generation

**Behavior:**

1. Prefer HRMS `get_shifts_for_date(employee, noon on D)`.
2. Fallback query: `docstatus == 1`, `status == "Active"`, `start_date <= D`, `end_date` null or `>= D`.

**Tests:** `zkteco_hr/zkteco_hr/tests/test_shift_assignment.py` — Mon–Sat block → on-shift Tue–Sat (not only Monday); day after block end → off.

**Deploy note:** Confirm the build on Frappe Cloud includes this module. Historical AUTO flags created before the fix are **not** auto-corrected — wipe AUTO flags and re-run intraday/closeout for affected dates if needed ([`TEST_ENV_RESET_AND_SEED.md`](./TEST_ENV_RESET_AND_SEED.md)).

---

## In scope — MVP flag set (v0)

| Flag | When | `day_closed` | Requires |
|------|------|----------------|----------|
| `LATE_START` | Intraday + closeout | 0 / 1 | On-shift; `Shift Type.start_time`, `custom_grace_minutes` |
| `NO_CHECKIN_YET` | Intraday only | 0 | On-shift; no checkins; after start + grace (default 2h); no open device alert; no `DELIVERY_FAILED` today |
| `OFF_SHIFT_PUNCH` | Closeout | 1 | **Off-shift** (no assignment) but has checkins |
| `MISSING_IN_OR_OUT` | Closeout | 1 | On-shift; exactly one checkin |
| `NON_PRIMARY_SITE_PUNCH` | Intraday + closeout | 0 / 1 | `Employee.branch` ≠ `custom_device_branch` |
| `UNKNOWN_DEVICE_BRANCH` | Closeout | 1 | Checkin missing `custom_device_branch` |
| `DELIVERY_FAILED` | Closeout | 1 | Bridge `undelivered[]` on `status=closed` |
| `UNNOTIFIED_ABSENCE` | **03:00 company fallback only** | 1 | On-shift; zero checkins; no open device closeout alert for branch |
| `MISSING_LUNCH` | Closeout | 1 | Full-day shift with lunch window; no plausible out/in pair |
| `LATE_FROM_LUNCH` | Closeout | 1 | Full-day shift; return after `lunch_end + grace` |

### Rules doc aliases and intentional gaps

| Rules doc | Code / behavior |
|-----------|-----------------|
| `MISSING_ALL_PUNCHES` | **`UNNOTIFIED_ABSENCE`** (same intent: on-shift, no checkins at closeout/fallback) |
| Per-device closeout absence for all on-shift staff | **Not MVP** — by design only **03:00 fallback** creates `UNNOTIFIED_ABSENCE` |
| Device closeout | Flags employees who **punched on that device** (+ `undelivered`); not company-wide absence sweep |

### Why P0 #1 mattered (historical)

| Area | Before range fix | With `shift_assignment.py` |
|------|------------------|----------------------------|
| `/hr-attendance` shift band | Often only block **start** day | Mon–Sat inside block |
| `OFF_SHIFT_PUNCH` | False positives Tue–Sat | Correct |
| `LATE_START`, `NO_CHECKIN_YET` | Mostly **Monday** only | All on-shift days in block |
| `UNNOTIFIED_ABSENCE` (fallback) | Mostly **Monday** only | All on-shift days with no checkins |

---

## Out of scope — MVP (P1+)

| Item | Tier | Notes |
|------|------|--------|
| Lunch rule tuning (pair heuristic edge cases) | **P1** | Implemented in `lunch_flags.py`; refine with pilot matrix |
| Holiday List as distinct “off” type | **P1** | MVP: no **Shift Assignment** = off; no separate holiday engine |
| HR approve/reject / employee explain in React SPA | **P1** | MVP: ERPNext **Attendance Flag** list |
| Payroll Present / Absent | **Deferred** | [`FRAPPE_ATTENDANCE_RULES.md`](./FRAPPE_ATTENDANCE_RULES.md) |
| Midnight shifts, multi-interval minutes | **Deferred** | |
| `SUSPICIOUS_SEQUENCE` | **P2** | Optional in rules doc |

---

## UI MVP (`/hr-attendance`)

| In | Out |
|----|-----|
| Week view, punches, shift ghost band, per-day flag chips | Full HR workflow in SPA |
| Device closeout banners, provisional vs final (`day_closed`) | Approve/reject in SPA |
| Employee picker, weekly schedule sheet | Employee picker filters (P1) |

---

## Operational go-live checklist

- [ ] Bridge: `FRAPPE_URL`, `FRAPPE_API_KEY` / secret, optional `FRAPPE_BRIDGE_SECRET`
- [ ] Supabase `devices.location` matches Frappe **`Branch.name`**
- [ ] Pilot employees: submitted **Active** **Shift Assignment** covering pilot window (range rows Mon–Sat OK)
- [ ] Frappe Cloud scheduler enabled
- [x] P0 **range-aware `get_shift_assignment`** in repo (`shift_assignment.py` + tests) — [ ] deployed / verified on Cloud
- [ ] Close device day (or wait for 03:00 fallback) to produce `day_closed = 1` flags
- [ ] Pilot matrix signed off (5 employees × 20 days)

---

## Pilot acceptance (from rules doc, MVP subset)

- [ ] Late start flags match manual expectations (sample of 20 days × 5 employees)
- [ ] Off-shift punches visible; no payroll **Attendance** created
- [ ] Saturday short shift (`FT_0800_1200`) does **not** require lunch flags (lunch flags P1 anyway)
- [ ] Edge cases documented: missing checkins, device downtime, `DELIVERY_FAILED`
- [ ] ~~Lunch late flags~~ — **P1**, not MVP gate

---

## Recommended next slices (P0 code complete; pilot + ops remain)

| Option | Focus |
|--------|--------|
| **A (recommended)** | Pilot matrix, go-live checklist, re-flag dates if pre-fix data exists |
| **B** | Implement `MISSING_LUNCH` / `LATE_FROM_LUNCH` in closeout (P1) |
| **C** | Filter by `flag_code` in React (P1) |

---

## Related docs

| Doc | Role |
|-----|------|
| [`FRAPPE_ATTENDANCE_RULES.md`](./FRAPPE_ATTENDANCE_RULES.md) | Policy source of truth |
| [`FRAPPE_ATTENDANCE_ENGINE_PLAN.md`](./FRAPPE_ATTENDANCE_ENGINE_PLAN.md) | Architecture |
| [`FRAPPE_CUSTOM_APP_AGENT_GUIDE.md`](./FRAPPE_CUSTOM_APP_AGENT_GUIDE.md) | Agent constraints |
| [`MVP_ATTENDANCE_ENGINE_TEST_GUIDE.md`](./MVP_ATTENDANCE_ENGINE_TEST_GUIDE.md) | E2E test steps |
| [`BRIDGE_FRAPPE_CLOSEOUT_E2E.md`](./BRIDGE_FRAPPE_CLOSEOUT_E2E.md) | Closeout webhook |
| [`FRAPPE_SHIFT_SETUP.md`](./FRAPPE_SHIFT_SETUP.md) | Shift Assignment prerequisites |

**Frappe app repo:** https://github.com/LolbiKB/zkteco_hr  
**Bridge closeout client:** [`gcr-fastify/src/lib/frappe-closeout.ts`](../gcr-fastify/src/lib/frappe-closeout.ts)
