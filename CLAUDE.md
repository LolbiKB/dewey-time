# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Frappe custom app** (`dewey_time`) that auto-generates `Attendance Flag` records from ZKTeco device punch data (`Employee Checkin`). It serves two React SPAs: the HR attendance app (a single bundle with two routes, `/hr-attendance` and `/hr-schedule`) and a separate ADMS device-admin dashboard at `/adms`.

The app is a standard Frappe layout: the Python package `dewey_time/` sits directly at the repo root, and the per-module code lives under `dewey_time/dewey_time/`.

### Reference docs

Deeper context lives in companion docs — read the relevant one before large changes:

- `FRAPPE_CUSTOM_APP_AGENT_GUIDE.md` (repo root) — self-described single source of truth for this app
- `dewey_time/docs/ARCHITECTURE.md` — flag-engine architecture
- `dewey_time/docs/CALENDAR_DATA_CONTRACT.md` — calendar API contract (frontend ↔ backend)
- `dewey_time/docs/SCHEDULE_IMPORT_PROMPT.md` — schedule import format
- `docs/BRIDGE_AGENT_HANDOFF.md` — Bridge service integration handoff
- `FRAPPE_ATTENDANCE_RULES.md` + `FLAG_ENGINE_MVP.md` (repo root) — flag rules / MVP spec

## Commands

### Python (backend)

Run the full test suite via Frappe bench (from the bench directory, not this repo):
```bash
bench --site <site> run-tests --app dewey_time
```

Run a specific test module (tests are `unittest`-based; CI uses `run-tests`, not pytest):
```bash
bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_closeout
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
# From dewey_time/ (where the package.json with these scripts lives — there is no repo-root package.json)
# Builds the SPA into public/hr_attendance/
npm run build

# Dev server with HMR (proxies API calls to local Frappe)
npm run dev:hr

# Dev server proxying to live prod (https://dewey.frappehr.com) — writes hit production data
npm run dev:hr:cloud
```

The Vite dev server starts at `http://localhost:8080` (set in `frontend/hr_attendance/vite.config.ts`). The built output goes to `dewey_time/public/hr_attendance/` and is copied to `sites/assets/` on `bench migrate`.

> **Build prerequisite:** the SPA depends on the private package `@lolbikb/dewey-ui` published to GitHub Packages (`frontend/hr_attendance/.npmrc` points `@lolbikb` at `npm.pkg.github.com`). A fresh `npm install` returns **401** unless `NODE_AUTH_TOKEN` is set to a GitHub PAT with `read:packages`.

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

ADMS dashboard (prebuilt bundle in public/adms/ — no source in repo)
  └─ /adms           → device-admin SPA, gated by dashboard_auth token exchange
```

### Key backend modules (`dewey_time/attendance_engine/`)

| Module | Role |
|---|---|
| `closeout.py` | EOD final flag generation; device closeout webhook handler |
| `intraday.py` | Provisional flags; triggered every 30 min and on checkin insert |
| `hr_calendar.py` | Read API: employee list + calendar data (shifts, holidays, flags, checkins) |
| `schedule_api.py` | Write APIs for weekly schedule wizard (PAT resolve, holiday preview, apply) |
| `schedule_resolver.py` | Shift Assignment + PAT group matching; handles effective_from, duplicates |
| `shift_assignment.py` | Range-aware Shift Assignment lookup (not just `start_date == date`) |
| `absence_flags.py` | `MISSING_TIME` gap detection (≥30 min intra-shift gaps) |
| `lunch_detection.py` + `lunch_flags.py` | Observed lunch gap detection → `LATE_FROM_LUNCH` |
| `bridge_auth.py` | API key + optional `X-Bridge-Secret` validation for Bridge webhooks |
| `api.py` | General whitelisted read API (`get_my_week`); `run_engine` backfill lives in `dev_tools.py` |
| `dev_tools.py` | `run_engine_for_employee` backfill API for testing |
| `device_sync.py` | `notify_device_sync_status` webhook; upserts + dedupes `Device Sync Status` watermark rows |
| `record_issue_flags.py` | `ATTENDANCE_ISSUE` detection (single-checkin / missing-lunch / unknown-branch reasons) |
| `absence_intervals.py` | Grace-aware interval math backing `MISSING_TIME` |
| `attendance_segments.py` | Checkin segmentation + punch-branch helpers (shared) |
| `shift_times.py` | Shift start/end datetime resolution (overnight-aware) |
| `shift_grace.py` | Effective grace-minute resolution helpers |
| `holidays.py` | Company holiday lookup over a date range |
| `schedule_import.py` | Spreadsheet/CSV bulk schedule import (canonical column format) |
| `dashboard_auth.py` | ADMS token exchange (`get_dashboard_token`) + `ensure_adms_roles` |

### Custom DocTypes (`dewey_time/dewey_time/doctype/`)

- `Attendance Flag` — the generated flags (`flag_code`, `day_closed`, `source`, `attendance_date`, …)
- `Device Sync Status` — per-device/date data-freshness watermark (upserted by the sync webhook)
- `Device Closeout Alert` — per-device closeout status / alert records
- `Dewey Time Settings` — single doctype holding app settings (e.g. VAPID keys for web push)
- `Dewey Time Push Subscription` — one row per browser push endpoint (PWA notifications)

### Frappe hooks (`hooks.py`)

- **Scheduler**: `daily` → `closeout.run_company_fallback_closeout`; `*/30 * * * *` → `intraday.run_intraday_scheduler`
- **Doc events**: `Employee Checkin.after_insert` **and** `.on_update` → `intraday.on_employee_checkin_after_insert` / `on_employee_checkin_on_update` (both fire the intraday engine)
- **After migrate** (five handlers): `setup.custom_fields.make_custom_fields` (ensures custom fields), `utils.sync_hr_attendance_assets.sync_hr_attendance_assets` (HR SPA → `sites/assets/`), `utils.sync_adms_assets.sync_adms_assets` (ADMS bundle), `attendance_engine.dashboard_auth.ensure_adms_roles` (creates the `ADMS Admin` / `ADMS Super Admin` roles), and `webpush.ensure_vapid_keys` (web-push VAPID keypair)
- **Website routes**: `/hr-attendance/<path>` and `/hr-schedule/<path>` both rewrite to their HTML entry points for client-side routing (`/adms` is served by the `www/adms.py` page, not a route rule)

### Frontend structure (`frontend/hr_attendance/src/`)

- `main.tsx` — React root, `BrowserRouter`, two routes (`/hr-attendance`, `/hr-schedule`)
- `ui/HrAppShell.tsx` — SPA shell with top nav and tabs
- `ui/App.tsx` — Attendance week view (main calendar)
- `ui/WeeklySchedulePage.tsx` — Schedule wizard
- `hooks/useHrAttendanceData.ts` — Fetches calendar data and checkins from Frappe API
- `hooks/useCalendarSession.ts` — Fetches the HR session (whether the current user is HR staff + their linked employee id) via `get_calendar_session`

Stack: React (pinned `latest`, currently React 19), TypeScript, Vite, TailwindCSS v4, shadcn/ui (Radix UI), react-router-dom v7, date-fns v4, frappe-react-sdk.

### ADMS dashboard (`/adms`)

A second SPA for device administration, separate from the HR attendance app:

- Served via the Frappe `www/` page convention — `www/adms.html` (shell) + `www/adms.py` (`get_context` redirects Guests to `/login`).
- Shipped as a **prebuilt bundle in `public/adms/`** — there is no source in this repo; build it in its own project and drop the output here.
- Copied to `sites/assets/` by `utils/sync_adms_assets.py` on `after_migrate`.
- Access is gated by `attendance_engine/dashboard_auth.py`: the SPA calls `get_dashboard_token`, and the two desk-less roles `ADMS Admin` / `ADMS Super Admin` (auto-created by `ensure_adms_roles`) scope access.

## Attendance Flag Types

AUTO-generated flag values (stored in `Attendance Flag.flag_code`):

- `LATE_START`, `LEFT_EARLY` — shift boundary violations (closeout only)
- `MISSING_TIME` — intra-shift gap ≥30 min
- `ATTENDANCE_ISSUE` — incomplete punch data
- `UNNOTIFIED_ABSENCE` — on-shift, zero checkins
- `MISSING_IN_OR_OUT` — *declared/reserved but not currently emitted*; the single-checkin case emits `ATTENDANCE_ISSUE` (reason `single_checkin`)
- `OFF_SHIFT_PUNCH` — checkins present but employee is off-shift or on holiday
- `NON_PRIMARY_SITE_PUNCH` — employee branch ≠ checkin device branch
- `LATE_FROM_LUNCH` — returned late from observed lunch
- `NO_CHECKIN_YET` — *declared/reserved but not currently emitted*

Additional codes are declared in `AUTO_FLAG_CODES` but produced outside the normal detectors:

- `DELIVERY_FAILED` — punch delivery / record failure (created on the delivery path; queried during closeout)
- `MISSING_LUNCH`, `UNKNOWN_DEVICE_BRANCH` — detected but currently folded into `ATTENDANCE_ISSUE`

Flags with `day_closed=0` are provisional (intraday); `day_closed=1` are final (closeout).

## Bridge Webhooks

Two inbound webhooks from the Bridge service authenticate via `bridge_auth.py` (Frappe `Authorization: token <api_key>:<api_secret>` validated against a User record, plus an optional `X-Bridge-Secret` enforced when `bridge_closeout_secret` is set in site config):

1. **`notify_device_closeout_status`** — triggers EOD closeout for a device's date
2. **`notify_device_sync_status`** — upserts `Device Sync Status` watermark (data freshness)

Employee Checkin punches arrive via the standard Frappe Resource API with `custom_supabase_log_id` for idempotency.

## Deployment Notes

- After any frontend change, run `npm run build` then `bench migrate` to push assets to `sites/assets/`.
- On Frappe Cloud, asset MIME/404 issues are documented in `dewey_time/docs/HR_ATTENDANCE_DEPLOY.md`.
- The `patches.txt` manifest (at `dewey_time/patches.txt`) must be updated whenever a new patch file is added under `dewey_time/patches/`.
