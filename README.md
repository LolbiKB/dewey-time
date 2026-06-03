# zkteco_hr

Minimal Frappe custom app for the **attendance engine MVP**:

- `Employee Checkin` is the immutable punch ledger (written by the bridge).
- This app generates persisted **`Attendance Flag`** rows: **intraday provisional** (`day_closed=0`) and **closeout final** (`day_closed=1`).
- HR calendar APIs + React SPA at **`/hr-attendance`** return checkins, shift context, holidays, flags, and timeline data.

**Policy:** [`docs/FRAPPE_ATTENDANCE_RULES.md`](docs/FRAPPE_ATTENDANCE_RULES.md) · **Pilot scope:** [`FLAG_ENGINE_MVP.md`](FLAG_ENGINE_MVP.md)

## Install (bench)

From your bench:

```bash
bench get-app /path/to/this/repo zkteco_hr
bench --site <site> install-app zkteco_hr
bench --site <site> migrate
```

## MVP jobs / APIs

- Bridge closeout webhook (POST, API key + optional `X-Bridge-Secret`):
  - `zkteco_hr.attendance_engine.closeout.notify_device_closeout_status`
  - Args: `device_sn`, `local_date`, `status` (`closed|deferred_offline|closure_failed`), `device_branch`, `last_error`, `undelivered` (JSON list when `closed`)
  - Site config (optional): `bridge_closeout_secret` in `site_config.json`
- Company fallback closeout (scheduler, ~03:00 company TZ): `zkteco_hr.attendance_engine.closeout.run_company_fallback_closeout`
  - Creates `UNNOTIFIED_ABSENCE` only; skips employees whose branch has an open `Device Closeout Alert`
- Manual full-day closeout (console, legacy):

```python
from zkteco_hr.attendance_engine.closeout import generate_auto_flags_for_date
generate_auto_flags_for_date("2026-05-28")
```

- Device-scoped closeout (enqueued when bridge reports `closed`):

```python
from zkteco_hr.attendance_engine.closeout import generate_auto_flags_for_device_date
generate_auto_flags_for_device_date("DEVICE-SN", "2026-05-28", undelivered=[])
```

- “My Week” API (whitelisted):
  - `zkteco_hr.attendance_engine.api.get_my_week(employee, start_date, end_date)`

## Dev testing (flag engine backfill)

Seeded or historical **Employee Checkin** rows do not always produce **Attendance Flag** rows (System Console cannot enqueue intraday jobs; cron only refreshes today; closeout requires a device webhook).

**Whitelisted API** (System Manager / HR User):

- `zkteco_hr.attendance_engine.dev_tools.run_engine_for_employee(employee, start_date, end_date, mode)`
- `mode`: `intraday` | `closeout` | `both` (max 31-day range)
- `both` runs intraday then closeout per day; final AUTO flags are `day_closed=1` (closeout wins)

**UI (`/hr-attendance`):**

1. **Run flag engine** dialog (dev) — select employee and date range; run **Both** after seeding checkins.
2. Open a day → **Flags** tab → click a flag for the **HR review panel** (summary, evidence, link to Desk).
3. Week header **`OFF_SHIFT`** chip opens the same flag review for that day.
4. Verify rows in Desk **Attendance Flag**.

**UI (`/hr-schedule`):** **Clear schedule data (dev)** — removes SSAs, Shift Assignments, Attendance Flags, and linked checkins/attendance for re-testing.

Closeout is **idempotent for AUTO flags**: each run deletes and recreates AUTO rows for that employee/date; HR and employee-sourced flags are untouched.

## HR Attendance Calendar

- **React SPA:** **`/hr-attendance`** (primary HR week view)
- **Desk:** Awesomebar **HR Attendance Calendar** or `/app/hr-attendance-calendar`
- Module sidebar: **ZKTeco HR** (Frappe v16 `Workspace Sidebar` fixture)

HR calendar API:

- `zkteco_hr.attendance_engine.hr_calendar.list_calendar_employees(include_without_shifts=True)`
- `zkteco_hr.attendance_engine.hr_calendar.get_employee_calendar(employee, start_date, end_date)`

Calendar filter semantics (Shift Assignment docstatus, leave, holidays, flags): see [`zkteco_hr/zkteco_hr/docs/CALENDAR_DATA_CONTRACT.md`](zkteco_hr/zkteco_hr/docs/CALENDAR_DATA_CONTRACT.md).

## Weekly Schedule wizard

- Route: **`/hr-schedule`** (same SPA bundle as `/hr-attendance`)
- Link from the attendance toolbar: **Edit weekly schedule**
- APIs (`System Manager` / `HR User`):
  - `zkteco_hr.attendance_engine.schedule_api.get_employee_schedule_context(employee)`
  - `zkteco_hr.attendance_engine.schedule_api.resolve_weekly_schedule_plan(employee, week_pattern, effective_from)`
  - `zkteco_hr.attendance_engine.schedule_api.get_holiday_preview(employee, start_date, end_date)`
  - `zkteco_hr.attendance_engine.schedule_api.apply_weekly_schedule(employee, week_pattern, create_shifts_after, generate_through, confirm_create)`

Effective-from defaults to **tomorrow** (site date). On save, HRMS **`create_shifts`** runs for each new SSA through the chosen **Generate through** date, or **90 days** after effective-from when open-ended (same default as Desk). HRMS background jobs can extend further later.

**Policy:** Save is allowed only when the employee has **no active SSA** (greenfield setup). If SSAs already exist, the wizard is **preview-only** — disable old SSAs and adjust Shift Assignments in Desk, then return after cleanup.

**Manual acceptance (Frappe Cloud after deploy + migrate):**

1. Employee **with no active SSA** — fill grid, preview PAT match, Save & generate, verify bands on `/hr-attendance`.
2. Employee **with active SSA(s)** — amber banner, Save disabled, preview still shows resolved PAT groups.
3. After Desk cleanup (SSAs disabled) — same employee can save a fresh plan.
4. New FT/PAT — confirm modal, then success link to `/hr-attendance`.

## React + Vite HR Attendance (local dev)

Frontend scaffold:

- `zkteco_hr/zkteco_hr/frontend/hr_attendance/`

### Run with mock data (fast UI iteration)

```bash
cd zkteco_hr/zkteco_hr/frontend/hr_attendance
npm install
npm run dev
```

### Build and load inside Frappe

```bash
cd zkteco_hr/zkteco_hr/frontend/hr_attendance
npm install
npm run build
```

**Frappe Cloud deploy notes** (404 / MIME errors, sync pitfalls, cache bust): see [`docs/HR_ATTENDANCE_DEPLOY.md`](zkteco_hr/zkteco_hr/docs/HR_ATTENDANCE_DEPLOY.md).

Desk page (legacy entry): `/app/hr-attendance-calendar-react`
