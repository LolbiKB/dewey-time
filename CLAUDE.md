# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Frappe custom app** (`zkteco_hr`) that auto-generates `Attendance Flag` records from ZKTeco device punch data (`Employee Checkin`). It includes a React SPA served at `/hr-attendance` and `/hr-schedule`.

The app lives inside `zkteco_hr/zkteco_hr/` (the outer directory is the repo root; the inner is the Python package installed by Frappe).

## Commands

### Python (backend)

Run the full test suite via Frappe bench (from the bench directory, not this repo):
```bash
bench --site <site> pytest zkteco_hr
```

Run a specific test file:
```bash
bench --site <site> pytest zkteco_hr --path zkteco_hr/zkteco_hr/tests/test_closeout.py
```

Open a Python REPL with Frappe context:
```bash
bench --site <site> console
```

Migrate (runs patches, syncs assets after code changes):
```bash
bench --site <site> migrate
```

### Frontend (React SPA)

```bash
# From repo root — builds the SPA into public/hr_attendance/
npm run build

# Dev server with HMR (proxies API calls to local Frappe)
npm run dev:hr

# Dev server pointing at Frappe Cloud
npm run dev:hr:cloud
```

The Vite dev server starts at `http://localhost:5173`. The built output goes to `zkteco_hr/zkteco_hr/public/hr_attendance/` and is copied to `sites/assets/` on `bench migrate`.

## Architecture

### Data flow

```
Bridge service (external)
  └─ POSTs Employee Checkin punch records
  └─ POSTs closeout/sync webhooks

Flag Engine (Python, attendance_engine/)
  ├─ intraday.py   — runs every 30 min (scheduler + on_employee_checkin_after_insert hook)
  │                  writes provisional Attendance Flags (day_closed=0)
  └─ closeout.py   — triggered by Bridge closeout webhook or daily fallback
                     finalises flags (day_closed=1), overwrites intraday flags

React SPA (frontend/hr_attendance/src/)
  ├─ /hr-attendance  → WeekView grid + DayTimeline + FlagDetailPanel (HR review)
  └─ /hr-schedule    → WeeklySchedulePage (wizard for bulk shift assignment)
```

### Key backend modules (`zkteco_hr/zkteco_hr/attendance_engine/`)

| Module | Role |
|---|---|
| `closeout.py` | EOD final flag generation; device closeout webhook handler |
| `intraday.py` | Provisional flags; triggered every 30 min and on checkin insert |
| `hr_calendar.py` | Read API: employee list + calendar data (shifts, holidays, flags, checkins) |
| `schedule_api.py` | Write APIs for weekly schedule wizard (PAT resolve, save, clear) |
| `schedule_resolver.py` | Shift Assignment + PAT group matching; handles effective_from, duplicates |
| `shift_assignment.py` | Range-aware Shift Assignment lookup (not just `start_date == date`) |
| `absence_flags.py` | `MISSING_TIME` gap detection (≥30 min intra-shift gaps) |
| `lunch_detection.py` + `lunch_flags.py` | Observed lunch gap detection → `LATE_FROM_LUNCH` |
| `bridge_auth.py` | API key + optional `X-Bridge-Secret` validation for Bridge webhooks |
| `api.py` | General whitelisted APIs (`my_week`, `run_engine`, etc.) |
| `dev_tools.py` | `run_engine_for_employee` backfill API for testing |

### Frappe hooks (`hooks.py`)

- **Scheduler**: `daily` → `closeout.run_company_fallback_closeout`; `*/30 * * * *` → `intraday.run_intraday_scheduler`
- **Doc event**: `Employee Checkin.after_insert` → `intraday.on_employee_checkin_after_insert`
- **After migrate**: `utils.sync_hr_attendance_assets.sync_hr_attendance_assets` copies built SPA to `sites/assets/`
- **Website routes**: `/hr-attendance/<path>` and `/hr-schedule/<path>` both rewrite to their respective HTML entry points for client-side routing

### Frontend structure (`frontend/hr_attendance/src/`)

- `main.tsx` — React root, `BrowserRouter`, two routes (`/hr-attendance`, `/hr-schedule`)
- `ui/HrAppShell.tsx` — SPA shell with top nav and tabs
- `ui/App.tsx` — Attendance week view (main calendar)
- `ui/WeeklySchedulePage.tsx` — Schedule wizard
- `hooks/useHrAttendanceData.ts` — Fetches calendar data and checkins from Frappe API
- `hooks/useCalendarSession.ts` — Client-side session/filter state (week, employee selection)

Stack: React 18, TypeScript, Vite, TailwindCSS, shadcn/ui (Radix UI), date-fns, frappe-react-sdk.

## Attendance Flag Types

AUTO-generated flag values (stored in `Attendance Flag.flag_type`):

- `LATE_START`, `LEFT_EARLY` — shift boundary violations (closeout only)
- `MISSING_TIME` — intra-shift gap ≥30 min
- `ATTENDANCE_ISSUE` — incomplete punch data
- `UNNOTIFIED_ABSENCE` — on-shift, zero checkins
- `MISSING_IN_OR_OUT` — on-shift, exactly 1 checkin
- `OFF_SHIFT_PUNCH` — checkins present but employee is off-shift or on holiday
- `NON_PRIMARY_SITE_PUNCH` — employee branch ≠ checkin device branch
- `LATE_FROM_LUNCH` — returned late from observed lunch
- `NO_CHECKIN_YET` — intraday placeholder

Flags with `day_closed=0` are provisional (intraday); `day_closed=1` are final (closeout).

## Bridge Webhooks

Two inbound webhooks from the Bridge service authenticate via `bridge_auth.py` (API key in `site_config.json`, optional `X-Bridge-Secret`):

1. **`notify_device_closeout_status`** — triggers EOD closeout for a device's date
2. **`notify_device_sync_status`** — upserts `Device Sync Status` watermark (data freshness)

Employee Checkin punches arrive via the standard Frappe Resource API with `custom_supabase_log_id` for idempotency.

## Deployment Notes

- After any frontend change, run `npm run build` then `bench migrate` to push assets to `sites/assets/`.
- On Frappe Cloud, asset MIME/404 issues are documented in `zkteco_hr/zkteco_hr/docs/HR_ATTENDANCE_DEPLOY.md`.
- The `patches.txt` manifest must be updated whenever a new patch file is added under `zkteco_hr/zkteco_hr/patches/`.
