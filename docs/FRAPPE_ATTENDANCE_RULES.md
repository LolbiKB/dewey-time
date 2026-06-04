# Attendance rules (MVP → later engine)

**Policy source of truth** for turning raw device punches (ERPNext **Employee Checkin**) into daily outcomes (late flags, missing punches, hours, exceptions) for ZKTeco bridge employees.

**Implementation:** [`zkteco_hr/zkteco_hr/attendance_engine/`](../zkteco_hr/zkteco_hr/attendance_engine/) — see [`FLAG_ENGINE_MVP.md`](../FLAG_ENGINE_MVP.md) for pilot scope and sign-off.

**Architecture plan:** [`FRAPPE_ATTENDANCE_ENGINE_PLAN.md`](../FRAPPE_ATTENDANCE_ENGINE_PLAN.md).

## Scope

- **In scope:** rule definitions, required data, expected outputs, review/approval workflow, and mapping to the current zkteco_hr engine + `/hr-attendance` UI.
- **Out of scope:** payroll Present/Absent statuses, midnight shifts, automatic penalties, approve/reject actions in the React SPA (P1 — use Desk **Attendance Flag**).

## Prerequisites (must already be true)

- **Shift setup** is complete: see [`FRAPPE_SHIFT_SETUP.md`](../FRAPPE_SHIFT_SETUP.md)
  - Shift Types named `FT_{HHMM}_{HHMM}`.
  - Shift Schedules named `PAT_{DAYS}_{SHIFT_TYPE}[_{LUNCH_HINT}]`.
    - Day segment uses compressed ranges: `MON-FRI`, `MON-SAT`, `MON-SUN`, `WED-FRI`, single days (`MON`, `SAT`, `SAT-AM` for half-day Saturday). When the week has a gap (e.g. Wed off), every working day is spelled out: `MON-TUE-THU-FRI-SAT`.
    - Reuse is structural: same `repeat_on_days` set + Shift Type + frequency on a submitted PAT — not by display name alone. New PATs created by the weekly wizard use the canonical `PAT_*` name.
  - Employees assigned via **Shift Schedule Assignment** (creates dated Shift Assignments).
  - Lunch custom fields on Shift Type: `custom_lunch_start`, `custom_lunch_end`, `custom_grace_minutes`.
  - HRMS grace fields on Shift Type: `late_entry_grace_period`, `early_exit_grace_period` (written by weekly schedule wizard when creating Shift Types).
- **Checkin delivery** is stable: see [`FRAPPE_EMPLOYEE_CHECKIN.md`](../FRAPPE_EMPLOYEE_CHECKIN.md)
  - Idempotent inserts via `custom_supabase_log_id`.
  - Bridge sends `skip_auto_attendance = 1` on device punches.
- **Company timezone** is correct (attendance day boundaries).

## Implementation modules (current)

| Module | Role |
|--------|------|
| `shift_assignment.py` | Range-aware on-shift lookup |
| `shift_grace.py` | Effective grace (`max` custom + HRMS fields) |
| `shift_times.py` | Shift time parsing / combine date+time |
| `holidays.py` | Company Holiday List → date metadata |
| `intraday.py` | Provisional flags (`day_closed=0`) |
| `closeout.py` | Final AUTO flags (`day_closed=1`) |
| `lunch_flags.py` / `lunch_detection.py` | Observed lunch + `LATE_FROM_LUNCH` |
| `hr_calendar.py` | Week/day API for `/hr-attendance` |

## Data model assumptions

### Inputs

- **Employee Checkin** — `employee`, `time`, `log_type`, `device_id`, `custom_device_branch`, `custom_supabase_log_id`, `skip_auto_attendance = 1`
- **Shift Assignment** — employee + date → Shift Type
- **Shift Type** — `start_time`, `end_time`, lunch custom fields, grace fields
- **Holiday List** (via `Company.default_holiday_list`) — weekly off + public holidays

### Outputs

**Persisted:** `Attendance Flag` rows (`source=AUTO`, `status=OPEN` until HR acts in Desk).

**Computed on read** (calendar API; not stored):

- `first_in`, `last_out`, `observed_lunch`, `gross_minutes`
- `day.holiday` — `{ description, weekly_off }` when date is on company Holiday List
- Worst open flag severity (informational; payroll statuses deferred)

## Definitions

- **Attendance day:** local calendar day in **company timezone**.
- **On-shift (flag logic):** not a holiday/weekly-off **and** a covering Shift Assignment exists — unless **holiday wins** (see §1).
- **Off-shift:** no Shift Assignment, or holiday/weekly-off (**holiday wins** over SSA-generated assignments).
- **Full-day shift:** Shift Type with lunch fields set.
- **Short shift:** no lunch fields (e.g. Saturday `FT_0800_1200`).
- **Completed day (for `LATE_START`):** at least **two** checkins on the day (paired IN/OUT context at closeout).

## Rule set (v0, implemented)

### 1) Determine expected shift for the day

For employee \(E\) on date \(D\):

1. Resolve holiday from **Company Default Holiday List** (`holiday_by_date_for_company`).
2. If \(D\) is a holiday / weekly off → **Off** for flag engine (**holiday wins**), even if SSA created a Shift Assignment row.
3. Else load Shift Assignment for \(E,D\) (range-aware; see `shift_assignment.py`).
   - **Today and future:** submitted **Active** row in range only.
   - **Past dates:** submitted **Active** in range; if none, **Inactive** in range (retired ERP slice — still on-shift for flags/UI; `schedule_superseded` on calendar).
   - If none → **Off**.
   - Else shift type = `FT_*`.

**Holiday wins (engine):** suppress all normal on-shift AUTO flags on that date. If checkins exist → emit **`OFF_SHIFT_PUNCH` only** (same as off-shift day with punches).

**UI:** holiday days show a holiday board on the timeline and amber header tint; treated as off-day in the week view.

### 2) Select relevant checkins for \(E,D\)

- All Employee Checkin rows for \(E\) in \([D 00:00, D 23:59:59]\) company timezone (midnight buffer deferred).
- Sort ascending by `time`.

### 3) Identify primary punches

**MVP heuristic (device-agnostic):**

- `first_in` = earliest checkin on \(D\)
- `last_out` = latest checkin on \(D\)

(Segments use order-based IN/OUT pairing; see §9.)

### 4) Late start (flag)

**Closeout only** (`day_closed=1`). Intraday does **not** emit `LATE_START`.

Applies on **on-shift** days with **≥2 checkins** (completed day):

- Expected start = Shift Type `start_time`
- **Start grace** = `max(custom_grace_minutes, late_entry_grace_period)` via `shift_grace.py`

Flag **LATE_START** if:

- `first_in` > \(start + start\_grace\)

If only one punch or no `first_in` → use missing-punch / record-issue rules instead.

### 5) Lunch window (full-day shifts only)

If shift type has `custom_lunch_start` and `custom_lunch_end`:

- **Lunch return grace** = same as start grace (`effective_lunch_return_grace` = start grace).

**Observed lunch** (shared by closeout, calendar API, UI):

- First plausible OUT→IN pair: OUT ≥ lunch start; IN after OUT and within lunch end + grace + 1h slack.
- **Validity guard:** ignore pair if duration < **half** of scheduled lunch length.
- If no valid observed lunch → **assume scheduled lunch** for timeline (not Away); **do not emit `MISSING_LUNCH`**.

Flags (closeout, `day_closed=1`):

- **`LATE_FROM_LUNCH`:** valid observed return after `lunch_end + grace`.
- **`MISSING_LUNCH`:** **not emitted in MVP** (suppressed intentionally).

### 5b) Early departure (flag)

Closeout only; on-shift with ≥2 checkins:

- **End grace** = `max(custom_grace_minutes, early_exit_grace_period)`
- **LEFT_EARLY** if `last_out` < \(end − end\_grace\)

### 6) Missing punches / insufficient data (flags)

- **`UNNOTIFIED_ABSENCE`** (code name; rules doc alias `MISSING_ALL_PUNCHES`): on-shift, zero checkins at closeout / 03:00 fallback.
- **`MISSING_IN_OR_OUT`:** on-shift, exactly one punch.
- **`MISSING_TIME`:** on-shift obligation gap ≥30 min (intraday provisional + closeout final).
- **`ATTENDANCE_ISSUE`:** record problems (`single_checkin`, `unpaired_punch`, etc.) — closeout.
- **`SUSPICIOUS_SEQUENCE`:** deferred (P2).

### 7) Off-shift / holiday punches (flag)

If day is **off** (including **holiday wins**) but checkins exist:

- **`OFF_SHIFT_PUNCH`** only — suppresses all other AUTO flags that day.

### 8) Work minutes (derived)

- `gross_minutes = last_out − first_in` when both exist and ordered.
- Net minutes / lunch deduction deferred for payroll.

### 9) Work segments (UI / derived intervals)

HR calendar **segments** are derived from punches (not stored). Pairing, lunch vs away bands, missing expected, scheduled reference, and week timeline scale apply as before.

**Open session (intraday):** On **today**, a trailing odd branch punch (employee still on site) renders as a green **open session** band, not a red unpaired error. **Past days** and **rogue** (no branch) punches stay alarming. When bridge posts **`Device Sync Status`**, the solid green band ends at `last_delivered_at`; a dashed amber extension shows possible in-transit punches when sync lags.

Bridge contract: [`docs/BRIDGE_AGENT_HANDOFF.md`](BRIDGE_AGENT_HANDOFF.md).

**Flags vs segments:** `MISSING_IN_OR_OUT` is day-level (one punch total). `NON_PRIMARY_SITE_PUNCH` is per punch vs `Employee.branch`.

## Grace resolution (implemented)

For each Shift Type, effective grace used by engine and calendar:

| Use | Formula |
|-----|---------|
| Start / lunch return | `max(custom_grace_minutes, late_entry_grace_period)` |
| End / early leave | `max(custom_grace_minutes, early_exit_grace_period)` |

Evidence JSON on flags includes both raw fields and effective values (`shift_grace.grace_evidence`).

## Decisions deferred (explicitly out of MVP)

- Payroll statuses: Present / Half Day / Absent.
- Shift spanning midnight.
- Device-specific IN/OUT mapping from verify types.
- Automatic approvals / penalties.
- **`NO_CHECKIN_YET`:** reserved on Attendance Flag doctype; **not generated** by current engine.
- **`MISSING_LUNCH`:** suppressed; P1 tuning if policy requires explicit flag.
- Holiday-aware SSA / skip Shift Assignment creation on holidays (P1); MVP uses **holiday wins at flag time** only.

## Review + approval workflow

### Async: intraday + closeout

- **Intraday (provisional, `day_closed=0`):** `MISSING_TIME`, `NON_PRIMARY_SITE_PUNCH` only. Skips holidays. No `UNNOTIFIED_ABSENCE`, no `LATE_START`.
- **Scheduler:** business-hours window → `refresh_intraday_flags_for_date(today)`.
- **Device closeout (final):** delete AUTO flags with `day_closed=0`, write final AUTO with `day_closed=1`.
- **Company fallback (~03:00):** `UNNOTIFIED_ABSENCE` for on-shift employees with no checkins (branch alert gating applies).
- Never mutate historical **Employee Checkin** rows.

### HR review in Desk

- Inbox: `Attendance Flag` where `status = OPEN`.
- HR approves, rejects, closes, or adds notes in Desk.

### HR review in `/hr-attendance` SPA (read-only MVP)

- **Day inspector → Flags tab:** list of flags for the day; click opens inline **flag review panel** (summary, supporting details, HR guidance).
- Status `OPEN` displayed as **Awaiting HR review**.
- Primary action: **Review in Desk** (opens Attendance Flag form).
- **View punches & timeline** returns to day inspector segments tab.
- Week header **`OFF_SHIFT`** chip opens day inspector directly on that flag’s review panel.
- Approve / reject / employee explain in SPA: **P1** (Desk remains system of record).

### Employee explanation (Desk)

- Employee `employee_note` + attachment → `status = EXPLAINED`; HR then approves or rejects in Desk.

## Pilot checklist (rules acceptance)

- [ ] Late start flags match manual expectations (20 random days × 5 employees); only on **completed** days at closeout
- [ ] Holiday dates suppress on-shift flags; punches on holiday → `OFF_SHIFT_PUNCH` only
- [ ] Off-shift punches visible; no payroll **Attendance** created
- [ ] Saturday short shift does not require lunch flags
- [ ] Edge cases documented: missing checkins, device downtime, `DELIVERY_FAILED`
- [ ] ~~`MISSING_LUNCH`~~ — **not MVP gate** (suppressed); **`LATE_FROM_LUNCH`** — **P1 tuning** with pilot matrix
