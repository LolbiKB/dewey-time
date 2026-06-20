# zkteco_hr — Architecture Reference

> Agent-readable quick reference. Covers the full stack: Frappe integration,
> Python backend, React SPA, asset pipeline, and deployment.

---

## 1. What This App Is

`zkteco_hr` is a **Frappe custom app** that auto-generates `Attendance Flag` records
from ZKTeco device punch data. It consists of:

- A Python business-logic backend (20+ modules in `attendance_engine/`)
- Three custom DocTypes (MariaDB tables)
- A React 18 SPA served at `/hr-attendance` and `/hr-schedule`
- An external Bridge service integration with its own webhook auth
- Scheduled attendance-flag generation (30-min intraday + daily EOD closeout)

---

## 2. Directory Layout

```
zkteco_hr/                          ← git repo root
└── zkteco_hr/                      ← Python package (installed by Frappe)
    ├── hooks.py                    ← ALL Frappe integration lives here
    ├── patches.txt                 ← migration manifest (must update when adding patches)
    ├── patches/                    ← one-time data/schema patch scripts
    ├── zkteco_hr/
    │   └── doctype/
    │       ├── attendance_flag/
    │       ├── device_closeout_alert/
    │       └── device_sync_status/
    ├── attendance_engine/          ← core Python business logic
    │   ├── api.py                  ← general whitelisted APIs (get_my_week, run_engine)
    │   ├── hr_calendar.py          ← read API: employee list + calendar data
    │   ├── closeout.py             ← EOD final flag generation + Bridge closeout webhook
    │   ├── intraday.py             ← provisional flags; triggered every 30 min + on checkin
    │   ├── schedule_api.py         ← weekly schedule wizard write APIs
    │   ├── schedule_import.py      ← bulk schedule CSV/xlsx import + validation
    │   ├── schedule_resolver.py    ← ShiftType/ShiftSchedule/SSA matching logic
    │   ├── shift_assignment.py     ← range-aware Shift Assignment lookup
    │   ├── absence_flags.py        ← MISSING_TIME gap detection
    │   ├── lunch_detection.py      ← observed lunch gap detection
    │   ├── lunch_flags.py          ← LATE_FROM_LUNCH flag generation
    │   ├── bridge_auth.py          ← API key + X-Bridge-Secret webhook auth
    │   └── dev_tools.py            ← backfill + clear-schedule dev APIs
    ├── utils/
    │   └── sync_hr_attendance_assets.py  ← copies Vite build to sites/assets/
    ├── public/
    │   └── hr_attendance/          ← Vite build output (committed to git)
    │       └── assets/index.js, index.css
    ├── www/
    │   ├── hr-attendance.html      ← Jinja entry page (injects CSRF token)
    │   ├── hr-attendance.py        ← Python context provider for above
    │   ├── hr-schedule.html
    │   └── hr-schedule.py
    ├── docs/                       ← you are here
    └── frontend/
        └── hr_attendance/          ← React source (not served directly)
            ├── src/
            │   ├── main.tsx                  ← FrappeProvider + BrowserRouter + routes
            │   ├── ui/App.tsx                ← attendance week view (main calendar)
            │   ├── ui/WeeklySchedulePage.tsx ← schedule wizard
            │   ├── ui/SpreadsheetImportDialog.tsx ← bulk import UI
            │   ├── hooks/useHrAttendanceData.ts   ← calendar data fetching
            │   └── hooks/useCalendarSession.ts    ← client-side filter state
            ├── package.json
            └── vite.config.ts
```

---

## 3. hooks.py — How Frappe Discovers the App

`hooks.py` is the single file Frappe reads at startup to find every integration
point. All registrations go here — nothing else is auto-discovered.

### Key hooks used

```python
# SPA routing — rewrites sub-paths to Jinja entry page for React Router
website_route_rules = [
    {"from_route": "/hr-attendance/<path:app_path>", "to_route": "hr-attendance"},
    {"from_route": "/hr-attendance",                 "to_route": "hr-attendance"},
    {"from_route": "/hr-schedule/<path:app_path>",   "to_route": "hr-schedule"},
    {"from_route": "/hr-schedule",                   "to_route": "hr-schedule"},
]

# Scheduled jobs (Frappe RQ)
scheduler_events = {
    "daily": ["zkteco_hr.attendance_engine.closeout.run_company_fallback_closeout"],
    "cron": {
        "*/30 * * * *": ["zkteco_hr.attendance_engine.intraday.run_intraday_scheduler"],
    },
}

# Doc event hooks — fire on any Employee Checkin save
doc_events = {
    "Employee Checkin": {
        "after_insert": "zkteco_hr.attendance_engine.intraday.on_employee_checkin_after_insert",
        "on_update":    "zkteco_hr.attendance_engine.intraday.on_employee_checkin_on_update",
    },
}

# Publishes SPA/branding/ADMS bundles to sites/assets/ after every bench migrate.
# Runs FIRST and is internally guarded so a failing DB handler can't starve assets.
after_migrate = [
    "zkteco_hr.utils.publish_assets.publish_assets_after_migrate",
    "zkteco_hr.setup.custom_fields.make_custom_fields",
    "zkteco_hr.attendance_engine.dashboard_auth.ensure_adms_roles",
]
```

---

## 4. Python API Pattern (`@frappe.whitelist`)

Any Python function decorated with `@frappe.whitelist()` is automatically callable at:

```
POST /api/method/<python.dotted.module.path.function_name>
```

Frappe handles auth, CSRF validation, JSON serialisation, and error formatting.
No routing file or URL registration needed.

```python
@frappe.whitelist()
def list_calendar_employees(include_all: str = "0") -> dict:
    _require_hr_role()   # throws PermissionError → 403
    ...
    return {"employees": employees}
```

### API modules and their methods

| Module | Methods |
|---|---|
| `hr_calendar.py` | `list_calendar_employees`, `get_employee_calendar` |
| `schedule_api.py` | `get_employee_schedule_context`, `resolve_weekly_schedule_plan`, `apply_weekly_schedule`, `list_weekly_schedule_templates`, `get_holiday_preview` |
| `schedule_import.py` | `parse_schedule_upload` |
| `api.py` | `get_my_week`, `run_engine` |
| `dev_tools.py` | `run_engine_for_employee`, `clear_employee_schedule` |
| `closeout.py` | `notify_device_closeout_status` *(Bridge webhook)* |
| `device_sync.py` | `notify_device_sync_status` *(Bridge webhook)* |

Bridge webhooks use API key auth (`bridge_auth.py`), not session cookies.

---

## 5. DocTypes (Database Tables)

| DocType | Table / Purpose |
|---|---|
| `Attendance Flag` | Core record — one flag per employee × issue × day. Stores `flag_type`, `severity`, `status`, evidence JSON, HR decision fields, audit trail. |
| `Device Closeout Alert` | EOD closeout triggers from the Bridge service per device/date. |
| `Device Sync Status` | Last-successful-sync watermark per ZKTeco device — drives the data-freshness banner in the SPA. |

DocTypes are defined as JSON files in `zkteco_hr/doctype/`. `bench migrate`
syncs them to the database. The controller class lives at
`doctype/<name>/<name>.py` and subclasses `frappe.model.document.Document`.

---

## 6. React SPA Integration

### Build → deploy flow

```
npm run build
    → public/hr_attendance/assets/index.js   (stable filename, no hash)
    → public/hr_attendance/assets/index.css
    → www/hr-attendance.html                  (cache-busted: ?v=<timestamp>)
    → www/hr-schedule.html
git commit public/ www/*.html
git push → Frappe Cloud deploy → bench migrate
    → sync_hr_attendance_assets copies to sites/assets/zkteco_hr/hr_attendance/
```

Built assets are **committed to git** because Frappe Cloud does not run `npm build`
on deploy.

### CSRF token injection

The `www/hr-attendance.py` Python context provider runs on every page load and
injects the session CSRF token into the Jinja template:

```html
<!-- www/hr-attendance.html -->
<script>window.csrf_token = "{{ frappe.session.csrf_token }}";</script>
<script type="module" src="/assets/zkteco_hr/hr_attendance/assets/index.js?v=..."></script>
```

`frappe-react-sdk` picks up `window.csrf_token` and includes it in every POST.

### frappe-react-sdk usage

```typescript
// GET (SWR-cached)
const { data } = useFrappeGetCall<EmployeesResponse>(
    "zkteco_hr.attendance_engine.hr_calendar.list_calendar_employees",
    { include_all: "0" },
    "list_calendar_employees:0"   // SWR cache key
);

// POST
const { call } = useFrappePostCall(
    "zkteco_hr.attendance_engine.schedule_api.apply_weekly_schedule"
);
```

The full Python dotted path is the only identifier needed — no base URL config.

### Dev server

```bash
npm run dev:hr        # HMR on :8080, proxies /api → localhost:8000
npm run dev:hr:cloud  # HMR on :8080, proxies /api → Frappe Cloud site
```

---

## 7. Data Flow

```
ZKTeco Devices
    │ HTTP POST (Employee Checkin records)
    ▼
Bridge Service ──► Frappe Resource API ──► Employee Checkin (DocType)
    │                                            │
    │                                    doc_events.after_insert
    │                                            │
    │                                    intraday.py → provisional flags (day_closed=0)
    │
    ├──► notify_device_closeout_status ──► closeout.py → final flags (day_closed=1)
    │
    └──► notify_device_sync_status ──► Device Sync Status (DocType)

Scheduler every 30 min → intraday.run_intraday_scheduler
Scheduler daily        → closeout.run_company_fallback_closeout
```

### Attendance Flag types

| Flag | Condition |
|---|---|
| `LATE_START` | Clocked in after shift start + grace (closeout only) |
| `LEFT_EARLY` | Clocked out before shift end (closeout only) |
| `MISSING_TIME` | Intra-shift gap ≥ 30 min |
| `ATTENDANCE_ISSUE` | Incomplete / inconsistent punch data |
| `UNNOTIFIED_ABSENCE` | On shift, zero checkins |
| `MISSING_IN_OR_OUT` | On shift, exactly one checkin |
| `OFF_SHIFT_PUNCH` | Checkins present but off-shift or holiday |
| `NON_PRIMARY_SITE_PUNCH` | Employee branch ≠ device branch |
| `LATE_FROM_LUNCH` | Returned late from observed lunch |
| `NO_CHECKIN_YET` | Intraday placeholder |

### Flag lifecycle

```
day_closed=0  provisional (intraday engine, overwrites itself every 30 min)
day_closed=1  final       (closeout engine, overwrites intraday)

Status: OPEN → EXPLAINED → APPROVED | REJECTED → CLOSED
```

---

## 8. Authentication

### Browser (SPA)
Session cookie + CSRF token. All `@frappe.whitelist()` endpoints validate both.
Role guard pattern:
```python
def _require_hr_role():
    if not frappe.has_permission("Attendance Flag", "read"):
        frappe.throw("HR role required", frappe.PermissionError)
```

### Bridge service (webhooks)
```
Authorization: token <api_key>:<api_secret>
X-Bridge-Secret: <shared_secret>   # optional, from site_config.json
```
Validated in `bridge_auth.py`. Uses Frappe's built-in User + API key system —
no separate auth database needed.

---

## 9. Shift Schedule Architecture (SSA/SA/Holiday)

The weekly schedule wizard (`schedule_api.py` + `schedule_resolver.py`) operates
on these Frappe HRMS DocTypes:

| DocType | Role |
|---|---|
| `Shift Type` | Named shift with start/end times. Auto-named `FT_HHMM_HHMM`. |
| `Shift Schedule` | Pattern (PAT) linking multiple Shift Types to days of week. Auto-named `PAT_..._FT_..._L...`. |
| `Shift Schedule Assignment (SSA)` | Links Employee ↔ Shift Schedule with an `effective_from` date. One enabled SSA per employee at a time. |
| `Shift Assignment (SA)` | Individual daily assignments generated by `ssa.create_shifts(start, end)`. |
| `Holiday List` | Company-level; read by attendance engine at flag-generation time. Not touched by import. |

Key constraints:
- An employee can only get a new SSA if they have **no enabled SSAs** (`employee_has_enabled_ssas()`).
- `apply_weekly_schedule` hard-blocks if an enabled SSA exists — `confirm_create=1` only bypasses the "create new records?" prompt, not this block.
- Shift generation window: `DEFAULT_SHIFT_GENERATION_DAYS = 90`.
- Grace minutes are fixed at 10 for all employees (hardcoded in `WeekPattern` builder).

---

## 10. Schedule Import

`schedule_import.py` / `SpreadsheetImportDialog.tsx`

**Canonical CSV format:**
```
employee_id, email, am_from, am_to, pm_from, pm_to, days_off
DI-0159, alice@example.com, 07:30, 12:00, 13:00, 17:00, Saturday(am)|Sunday
```

**Supported schedule shapes:**

| Shape | am_from | am_to | pm_from | pm_to |
|---|---|---|---|---|
| Full day + lunch | time | time | time | time |
| AM only | time | time | `off` | `off` |
| PM only | `off` | `off` | time | time |
| Continuous (no lunch) | time | `off` | `off` | time |

Raw spreadsheets should be normalised with Claude Haiku first — see
`docs/SCHEDULE_IMPORT_PROMPT.md` for the copy-paste prompt.

---

## 11. Does the Backend Have to Be Python?

**Yes** for Frappe-native concerns:
- `hooks.py` and all hook handlers
- DocType controllers (`Document` subclass)
- Scheduled jobs (RQ workers)
- `@frappe.whitelist()` API endpoints
- Migrations and patches

**No** for everything else:
- AI/LLM calls — Python makes HTTP requests to any external API
- Heavy compute — delegate to an external microservice via HTTP
- External data pipelines — the Bridge pushes to Frappe; Frappe never pulls
- Frontend logic — entirely TypeScript/React

---

## 12. Deployment

```bash
# After any frontend change:
npm run build                       # from frontend/hr_attendance/
git add zkteco_hr/public/hr_attendance/ zkteco_hr/www/*.html
git push origin main
# Then on Frappe Cloud: deploy → bench migrate

# Force asset resync (if 404 after deploy):
# Add a new patch file + entry in patches.txt that calls
# force_sync_hr_attendance_assets() — runs on next migrate
```

After any backend change:
```bash
bench --site <site> migrate         # syncs DocTypes, runs patches
```

---

## 13. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Frappe 15/16, Python 3.11+ |
| Database | MariaDB (via Frappe ORM) |
| Job queue | Redis + RQ (Frappe-managed) |
| Frontend | React 18, TypeScript, Vite 8 |
| Styling | TailwindCSS 4, shadcn/ui (Radix UI) |
| Data fetching | frappe-react-sdk (SWR-based) |
| Routing | React Router v7 |
| Date handling | date-fns |
| Icons | Lucide React |
| Spreadsheet parsing | openpyxl (server-side) |
| Bridge auth | Frappe API key + optional X-Bridge-Secret |

---

## 14. Common Commands

```bash
# Run tests
bench --site <site> pytest zkteco_hr
bench --site <site> pytest zkteco_hr --path zkteco_hr/zkteco_hr/tests/test_closeout.py

# Python REPL with Frappe context
bench --site <site> console

# Migrate (syncs DocTypes, runs patches, copies assets)
bench --site <site> migrate

# Frontend dev
npm run build           # build SPA (from frontend/hr_attendance/)
npm run dev:hr          # HMR dev server → local Frappe
npm run dev:hr:cloud    # HMR dev server → Frappe Cloud
```
