# Flag engine MVP — scope and sign-off

Single source of truth for **what the dewey_time flag engine must do for a pilot** vs what is deferred. Policy definitions: [`docs/FRAPPE_ATTENDANCE_RULES.md`](docs/FRAPPE_ATTENDANCE_RULES.md). Implementation: **https://github.com/LolbiKB/dewey-time**.

**MVP bar:** trustworthy for **5 employees × 20 days** with manual spot-checks — not every rule in the policy doc.

---

## What the flag engine is

```text
Employee Checkin (bridge ledger)
       +
Shift Assignment (submitted, active, date range)
       +
Company Holiday List (holiday wins at flag time)
       ↓
dewey_time: intraday (day_closed=0) + closeout (day_closed=1) + 03:00 fallback
       ↓
Attendance Flag rows + /hr-attendance calendar display
```

No ERPNext **Attendance** (payroll) status. No **`Attendance Day`** projection table.

---

## Implemented in repo (Jun 2026)

Engine and HR calendar UI code for MVP scope is **in the repository**. Remaining gate is **ops setup + pilot matrix sign-off** (see checklist below).

| Module | Role |
|--------|------|
| `shift_assignment.py` | Range-aware on-shift lookup |
| `shift_grace.py` | Effective grace resolution |
| `shift_times.py` | Shift time parsing |
| `holidays.py` | Holiday List metadata; holiday wins |
| `intraday.py` | Provisional flags |
| `closeout.py` | Final AUTO flags |
| `lunch_flags.py` / `lunch_detection.py` | Observed lunch; `LATE_FROM_LUNCH` |
| `hr_calendar.py` | Calendar API |
| `frontend/hr_attendance/` | Week view, day inspector, HR flag review panel |

---

## P0 — Ship blockers (before pilot)

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1 | **Range-aware Shift Assignment lookup** | dewey_time | **Done in repo** |
| 2 | Bridge **device closeout** → `notify_device_closeout_status` | bridge + dewey_time | Code done; verify on Cloud + bridge env |
| 3 | **Frappe scheduler** on Cloud | ops | In `hooks.py`; enable on site |
| 4 | **Shift setup** per pilot employee | HR | Data — submitted **Active** assignments covering pilot dates |
| 5 | **Pilot matrix** 5 × 20 | HR + eng | Process — expected vs actual `flag_code` spreadsheet |

Items 2–5 are **ops/process** — not blocked on further engine code in repo.

### P0 #1 — Shift assignment lookup

**Module:** `dewey_time/attendance_engine/shift_assignment.py` — `get_shift_assignment(employee, attendance_date)`.

Callers: `hr_calendar.py`, `intraday.py`, `closeout.py`.

**Deploy note:** Historical AUTO flags before the range fix are **not** auto-corrected — wipe AUTO flags and re-run intraday/closeout for affected dates if needed.

---

## In scope — MVP flag set (v0)

| Flag | When | `day_closed` | Requires / notes |
|------|------|----------------|------------------|
| `LATE_START` | **Closeout only** | 1 | On-shift; **≥2 checkins**; `first_in` > start + effective start grace |
| `LEFT_EARLY` | Closeout | 1 | On-shift; ≥2 checkins; last punch before end − effective end grace |
| `MISSING_TIME` | Intraday + closeout | 0 / 1 | On-shift gap **≥30 min** |
| `ATTENDANCE_ISSUE` | Closeout | 1 | Incomplete punch data — **CRITICAL** |
| `OFF_SHIFT_PUNCH` | Closeout | 1 | Off-shift or **holiday wins**; has checkins — **only** flag that day |
| `MISSING_IN_OR_OUT` | Closeout | 1 | On-shift; exactly one checkin |
| `NON_PRIMARY_SITE_PUNCH` | Intraday + closeout | 0 / 1 | `Employee.branch` ≠ `custom_device_branch` |
| `UNKNOWN_DEVICE_BRANCH` | Closeout | 1 | Missing `custom_device_branch` |
| `DELIVERY_FAILED` | Closeout | 1 | Bridge `undelivered[]` on `status=closed` |
| `UNNOTIFIED_ABSENCE` | Closeout + **03:00 fallback** | 1 | On-shift; zero checkins at close |
| `LATE_FROM_LUNCH` | Closeout | 1 | Valid observed lunch; return after lunch end + grace |

### Intraday provisional (`day_closed=0`)

**Only:** `MISSING_TIME`, `NON_PRIMARY_SITE_PUNCH`. Skips holidays. No `LATE_START`, no `UNNOTIFIED_ABSENCE`.

### Intentionally not emitted (MVP)

| Flag | Status |
|------|--------|
| `MISSING_LUNCH` | **Suppressed** — assume scheduled lunch when no valid observed pair |
| `NO_CHECKIN_YET` | Doctype constant only; engine does not generate |

### Rules doc aliases

| Rules doc | Code |
|-----------|------|
| `MISSING_ALL_PUNCHES` | **`UNNOTIFIED_ABSENCE`** |
| Per-device closeout + branch sweep | **Done** |
| Holiday off-day | **`holiday_by_date_for_company`** + holiday wins in closeout/intraday |

---

## Out of scope — MVP (P1+)

| Item | Tier | Notes |
|------|------|--------|
| Lunch rule tuning (`LATE_FROM_LUNCH` edge cases) | **P1** | Implemented; refine with pilot matrix |
| **`MISSING_LUNCH` flag** | **P1** | Suppressed in MVP |
| Holiday-aware SSA (skip assignment on holidays) | **P1** | MVP uses holiday wins at flag time only |
| HR approve/reject / employee explain in React SPA | **P1** | Desk **Attendance Flag** + read-only review panel in SPA |
| Payroll Present / Absent | **Deferred** | [`docs/FRAPPE_ATTENDANCE_RULES.md`](docs/FRAPPE_ATTENDANCE_RULES.md) |
| Midnight shifts, multi-interval minutes | **Deferred** | |
| `SUSPICIOUS_SEQUENCE` | **P2** | |

---

## UI MVP (`/hr-attendance`)

| In | Out |
|----|-----|
| Week view, timeline, shift bands, holiday display | Full HR workflow in SPA |
| Day inspector (segments, punches, flags list) | Approve/reject in SPA |
| **HR flag review panel** in day inspector (summary, evidence, Review in Desk) | Employee self-service explain in SPA |
| Week **`OFF_SHIFT`** chip → opens flag review | Flag filter by code (P1) |
| Device closeout banners; provisional vs final (`day_closed`) | |
| Employee picker; `/hr-schedule` wizard | Employee picker filters (P1) |
| Run flag engine dialog (dev) | |

Route: **`/hr-attendance`** (React SPA). Desk: **HR Attendance Calendar** / `/app/hr-attendance-calendar`.

---

## Operational go-live checklist

**Engine/UI code is in repo.** Unchecked items below are **ops and pilot validation only.**

- [ ] Bridge: `FRAPPE_URL`, `FRAPPE_API_KEY` / secret, optional `FRAPPE_BRIDGE_SECRET`
- [ ] Supabase `devices.location` matches Frappe **`Branch.name`**
- [ ] Pilot employees: submitted **Active** **Shift Assignment** covering pilot window
- [ ] Frappe Cloud scheduler enabled
- [x] P0 **range-aware `get_shift_assignment`** in repo — [ ] deployed / verified on Cloud
- [ ] Close device day (or 03:00 fallback) → final `day_closed = 1` flags
- [ ] Pilot matrix signed off (5 employees × 20 days)

---

## Pilot acceptance (MVP subset)

- [ ] Late start flags match manual expectations (20 days × 5 employees); closeout + completed days only
- [ ] Holiday dates: no on-shift flags; punches → `OFF_SHIFT_PUNCH` only
- [ ] Off-shift punches visible; no payroll **Attendance** created
- [ ] Saturday short shift does not require lunch flags
- [ ] Edge cases documented: missing checkins, device downtime, `DELIVERY_FAILED`
- [ ] ~~`MISSING_LUNCH`~~ — not MVP gate; **`LATE_FROM_LUNCH`** — P1 tuning

---

## Recommended next slices

| Option | Focus |
|--------|--------|
| **A (recommended)** | Pilot matrix, go-live checklist, re-flag pre-fix dates on Cloud |
| **B** | Flag filter by `flag_code` in React (P1) |
| **C** | HR approve/reject in SPA (P1) |

---

## Related docs

| Doc | Role |
|-----|------|
| [`docs/FRAPPE_ATTENDANCE_RULES.md`](docs/FRAPPE_ATTENDANCE_RULES.md) | Policy source of truth |
| [`FRAPPE_ATTENDANCE_ENGINE_PLAN.md`](FRAPPE_ATTENDANCE_ENGINE_PLAN.md) | Architecture |
| [`FRAPPE_CUSTOM_APP_AGENT_GUIDE.md`](FRAPPE_CUSTOM_APP_AGENT_GUIDE.md) | Agent constraints |
| [`dewey_time/docs/CALENDAR_DATA_CONTRACT.md`](dewey_time/docs/CALENDAR_DATA_CONTRACT.md) | Calendar API contract |

**Frappe app repo:** https://github.com/LolbiKB/dewey-time
