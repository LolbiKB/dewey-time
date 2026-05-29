# zkteco_hr

Minimal Frappe custom app for the **attendance engine MVP**:

- `Employee Checkin` is the immutable punch ledger (written by the bridge).
- This app generates persisted workflow rows in `Attendance Flag` (AUTO closeout-only).
- A simple read API returns “My Week” data (checkins + computed minutes + flags).

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

## HR Attendance Calendar (Desk)

- Open from Awesomebar: **HR Attendance Calendar** or route `/app/hr-attendance-calendar`
- Module sidebar: **ZKTeco HR** (Frappe v16 `Workspace Sidebar` fixture)

HR calendar API:

- `zkteco_hr.attendance_engine.hr_calendar.list_calendar_employees(include_without_shifts=True)`
- `zkteco_hr.attendance_engine.hr_calendar.get_employee_calendar(employee, start_date, end_date)`

Calendar filter semantics (Shift Assignment docstatus, leave, flags): see `zkteco_hr/zkteco_hr/docs/CALENDAR_DATA_CONTRACT.md`.

## React + Vite HR Attendance (local dev)

This repo includes a Vite+React frontend scaffold under:

- `zkteco_hr/zkteco_hr/frontend/hr_attendance/`

### Run with mock data (fast UI iteration)

From your bench's app folder (or from the repo), run:

```bash
cd zkteco_hr/zkteco_hr/frontend/hr_attendance
npm install
npm run dev
```

### Build and load inside Frappe Desk

Build assets into `zkteco_hr/zkteco_hr/public/hr_attendance/`:

```bash
cd zkteco_hr/zkteco_hr/frontend/hr_attendance
npm install
npm run build
```

Then open the Desk page:

- `/app/hr-attendance-calendar-react`
