# dewey_time

Minimal Frappe custom app for the **attendance engine MVP**:

- `Employee Checkin` is the immutable punch ledger (written by the bridge).
- This app generates persisted **`Attendance Flag`** rows: **intraday provisional** (`day_closed=0`) and **closeout final** (`day_closed=1`).
- HR calendar APIs + React SPA at **`/hr-attendance`** return checkins, shift context, holidays, flags, and timeline data.

**Policy:** [`docs/FRAPPE_ATTENDANCE_RULES.md`](docs/FRAPPE_ATTENDANCE_RULES.md) · **Pilot scope:** [`FLAG_ENGINE_MVP.md`](FLAG_ENGINE_MVP.md)

## Install (bench)

From your bench:

```bash
bench get-app /path/to/this/repo dewey_time
bench --site <site> install-app dewey_time
bench --site <site> migrate
```

## MVP jobs / APIs

- Bridge contract (checkins, closeout, intraday sync): [`docs/BRIDGE_AGENT_HANDOFF.md`](docs/BRIDGE_AGENT_HANDOFF.md)
- Bridge closeout webhook (POST, API key + optional `X-Bridge-Secret`):
  - `dewey_time.attendance_engine.closeout.notify_device_closeout_status`
  - Args: `device_sn`, `local_date`, `status` (`closed|deferred_offline|closure_failed`), `device_branch`, `last_error`, `undelivered` (JSON list when `closed`)
- Bridge intraday sync webhook (POST, same auth):
  - `dewey_time.attendance_engine.device_sync.notify_device_sync_status`
  - Args: `device_sn`, `local_date`, `device_branch`, `last_device_log_at`, `last_delivered_at`, optional `pending_count`, `last_error`, `bridge_env`
  - Site config (optional): `bridge_closeout_secret` in `site_config.json`
- Company fallback closeout (scheduler, ~03:00 company TZ): `dewey_time.attendance_engine.closeout.run_company_fallback_closeout`
  - Creates `UNNOTIFIED_ABSENCE` only; skips employees whose branch has an open `Device Closeout Alert`
- Manual full-day closeout (console, legacy):

```python
from dewey_time.attendance_engine.closeout import generate_auto_flags_for_date
generate_auto_flags_for_date("2026-05-28")
```

- Device-scoped closeout (enqueued when bridge reports `closed`):

```python
from dewey_time.attendance_engine.closeout import generate_auto_flags_for_device_date
generate_auto_flags_for_device_date("DEVICE-SN", "2026-05-28", undelivered=[])
```

- “My Week” API (whitelisted):
  - `dewey_time.attendance_engine.api.get_my_week(employee, start_date, end_date)`

## Dev testing (flag engine backfill)

Seeded or historical **Employee Checkin** rows do not always produce **Attendance Flag** rows (System Console cannot enqueue intraday jobs; cron only refreshes today; closeout requires a device webhook).

**Whitelisted API** (System Manager / HR User):

- `dewey_time.attendance_engine.dev_tools.run_engine_for_employee(employee, start_date, end_date, mode)`
- `mode`: `intraday` | `closeout` | `both` (max 31-day range)
- `both` runs intraday then closeout per day; final AUTO flags are `day_closed=1` (closeout wins)

**UI (`/hr-attendance`):**

1. **Run flag engine** dialog (dev) — select employee and date range; run **Both** after seeding checkins.
2. Open a day → **Flags** tab → click a flag for the **HR review panel** (summary, evidence, link to Desk).
3. Week header **`OFF_SHIFT`** chip opens the same flag review for that day.
4. Verify rows in Desk **Attendance Flag**.

**UI (`/hr-schedule`, System Manager):**

| Dev action | What it removes |
|------------|-----------------|
| **Clear schedule (dev)** | One employee: SSAs, Shift Assignments, Attendance Flags, linked checkins/attendance in those windows |
| **Clear all (dev)** | Same, for every employee with schedule data |
| **Wipe patterns (dev)** | All **Shift Schedules (PAT)** + **Shift Types** site-wide; optionally runs **Clear all** first — full reset before bulk import |

Shared PAT/FT masters are **not** deleted by Clear all alone; use **Wipe patterns** when you want import to recreate every pattern from scratch.

Closeout is **idempotent for AUTO flags**: each run deletes and recreates AUTO rows for that employee/date; HR and employee-sourced flags are untouched.

## HR Attendance Calendar

- **React SPA:** **`/hr-attendance`** (primary HR week view)
- **Weekly Schedule:** **`/hr-schedule`** (same SPA bundle)
- **Desk:** **`/desk`** — open **Dewey Time** from the app switcher (`add_to_apps_screen`) or Awesomebar → `/hr-attendance`
- **App switcher:** **Dewey Time** → `/hr-attendance`
- **SPA shell:** top bar links back to **Desk**, **Flags inbox**, and tabs between Attendance / Weekly Schedule
- **Awesomebar:** `Cmd+K` → “HR Attendance” or “Weekly Schedule”

HR calendar API:

- `dewey_time.attendance_engine.hr_calendar.list_calendar_employees(include_without_shifts=True)`
- `dewey_time.attendance_engine.hr_calendar.get_employee_calendar(employee, start_date, end_date)`

Calendar filter semantics (Shift Assignment docstatus, leave, holidays, flags): see [`dewey_time/docs/CALENDAR_DATA_CONTRACT.md`](dewey_time/docs/CALENDAR_DATA_CONTRACT.md).

## Weekly Schedule wizard

- Route: **`/hr-schedule`** (same SPA bundle as `/hr-attendance`; tab in the SPA shell)
- APIs (`System Manager` / `HR User`):
  - `dewey_time.attendance_engine.schedule_api.get_employee_schedule_context(employee)`
  - `dewey_time.attendance_engine.schedule_api.resolve_weekly_schedule_plan(employee, week_pattern, effective_from)`
  - `dewey_time.attendance_engine.schedule_api.get_holiday_preview(employee, start_date, end_date)`
  - `dewey_time.attendance_engine.schedule_api.apply_weekly_schedule(employee, week_pattern, create_shifts_after, generate_through, confirm_create)`

Effective-from defaults to **tomorrow** (site date). On save, HRMS **`create_shifts`** runs for each new SSA through the chosen **Generate through** date, or **90 days** after effective-from when open-ended (same default as Desk). HRMS background jobs can extend further later.

**Policy:** Save is allowed only when the employee has **no active SSA** (greenfield setup). If SSAs already exist, the wizard is **preview-only** — disable old SSAs and adjust Shift Assignments in Desk, then return after cleanup.

**Manual acceptance (Frappe Cloud after deploy + migrate):**

1. Employee **with no active SSA** — fill grid, preview PAT match, Save & generate, verify bands on `/hr-attendance`.
2. Employee **with active SSA(s)** — amber banner, Save disabled, preview still shows resolved PAT groups.
3. After Desk cleanup (SSAs disabled) — same employee can save a fresh plan.
4. New FT/PAT — confirm modal, then success link to `/hr-attendance`.

## React + Vite HR Attendance (local dev)

Frontend scaffold:

- `dewey_time/frontend/hr_attendance/`

### Run with mock data (fast UI iteration)

```bash
cd dewey_time/frontend/hr_attendance
npm install
npm run dev
```

### Build and load inside Frappe

```bash
cd dewey_time/frontend/hr_attendance
npm install
npm run build
```

**Frappe Cloud deploy** (after `git push`):

1. Let the site **deploy** finish (app code + `public/hr_attendance/assets/` from git).
2. Run **Migrate** on the site (Dashboard → Migrate, or `bench --site <site> migrate`).
   - `after_migrate` runs `sync_hr_attendance_assets` (copies bundle into `sites/assets/` when missing or `build-id.txt` changed).
   - One-time repair patches (e.g. `resync_hr_attendance_assets_v9`) also run on migrate.
3. Hard-refresh `/hr-attendance` (check `www/hr-attendance.html` has a new `?v=` on CSS/JS).

**404 on `index.css` / MIME type `text/html`:** the asset path 404s — Frappe returns an HTML error page. Almost always fixed by **Migrate** after deploy. Full troubleshooting: [`dewey_time/docs/HR_ATTENDANCE_DEPLOY.md`](dewey_time/docs/HR_ATTENDANCE_DEPLOY.md).

**Bench console repair** (if migrate is not enough):

```python
from dewey_time.utils.sync_hr_attendance_assets import force_sync_hr_attendance_assets
force_sync_hr_attendance_assets()
import frappe
frappe.db.commit()  # not required for files; included for consistency in console
```
