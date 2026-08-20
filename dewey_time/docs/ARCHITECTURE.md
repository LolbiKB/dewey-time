# dewey_time — Architecture Reference

> Agent-readable quick reference. Covers the full stack: Frappe integration,
> Python backend, React SPA, asset pipeline, and deployment.

---

## 1. What This App Is

`dewey_time` is a **Frappe custom app** that auto-generates `Attendance Flag` records
from ZKTeco device punch data. It consists of:

- A Python business-logic backend (20+ modules in `attendance_engine/`)
- A Telegram employee layer (`telegram/`): check-in notifications from a bot, and
  the **Mini App** at `/hr-me` — the employee's own record on their phone, inside
  Telegram. Its auth is Telegram `initData` HMAC, **not** a Frappe session (§8)
- Eight custom DocTypes (MariaDB tables)
- Three committed React SPAs: the HR console at `/hr-attendance` + `/hr-schedule`,
  the Telegram Mini App bundle at `/hr-me`, and the ADMS device-admin dashboard
  at `/adms`
- An external Bridge service integration with its own webhook auth
- Scheduled attendance-flag generation (30-min intraday + daily EOD closeout)

---

## 2. Directory Layout

```
dewey_time/                          ← git repo root
└── dewey_time/                      ← Python package (installed by Frappe)
    ├── hooks.py                    ← ALL Frappe integration lives here
    ├── patches.txt                 ← migration manifest (must update when adding patches)
    ├── patches/                    ← one-time data/schema patch scripts
    ├── dewey_time/
    │   └── doctype/
    │       ├── attendance_flag/
    │       ├── device_closeout_alert/
    │       ├── device_sync_status/
    │       ├── dewey_time_settings/          ← single doctype (bot token, VAPID keys, …)
    │       ├── dewey_time_push_subscription/
    │       ├── dewey_time_branch_rollout/
    │       ├── telegram_link/               ← one row per bound Telegram account
    │       └── telegram_link_token/         ← single-use invite tokens (SHA-256, 24h)
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
    ├── telegram/                   ← the Telegram employee layer
    │   ├── miniapp_auth.py         ← THE security boundary: initData HMAC → Employee
    │   ├── miniapp_api.py          ← Mini App read APIs; payload is an ALLOWLIST
    │   ├── binding.py              ← link lifecycle: invite tokens, redemption, revocation
    │   ├── transport.py            ← the only module that talks to api.telegram.org
    │   ├── receipt.py              ← causal punch-verb walk wording the notifications
    │   ├── notify.py               ← outbound check-in messages + delivery gates
    │   └── webhook.py              ← inbound allow_guest webhook (secret-header gated)
    ├── utils/
    │   ├── asset_publish.py                ← atomic copy-into-sites (temp + rename)
    │   ├── sync_hr_attendance_assets.py    ← publishes the HR bundle + branding
    │   ├── sync_miniapp_assets.py          ← publishes the Mini App bundle
    │   └── sync_adms_assets.py             ← publishes the ADMS bundle
    ├── public/                     ← Vite build output, ALL committed to git
    │   ├── hr_attendance/          ← assets/index.js, index.css (+ hashed fonts)
    │   ├── miniapp/                ← the Telegram Mini App bundle
    │   └── adms/                   ← the ADMS dashboard bundle
    ├── www/
    │   ├── hr-attendance.html      ← Jinja entry page (injects CSRF token)
    │   ├── hr-attendance.py        ← Python context provider for above
    │   ├── hr-schedule.html / .py
    │   ├── hr-me.html / hr-me.py   ← Mini App shell (guest-served; auth is initData)
    │   └── adms.html / adms.py     ← ADMS shell (redirects Guests to /login)
    ├── docs/                       ← you are here
    └── frontend/
        ├── adms/                   ← ADMS dashboard source (own build:frappe script)
        └── hr_attendance/          ← React source (not served directly)
            ├── src/
            │   ├── main.tsx                  ← FrappeProvider + BrowserRouter + routes
            │   ├── ui/App.tsx                ← attendance week view (main calendar)
            │   ├── ui/WeeklySchedulePage.tsx ← schedule wizard
            │   ├── miniapp/                  ← Mini App source (own bundle; shares src/lib + src/ui)
            │   ├── hooks/useHrAttendanceData.ts   ← calendar data fetching
            │   └── hooks/useCalendarSession.ts    ← HR session state
            ├── package.json
            ├── vite.config.ts               ← HR bundle
            └── vite.miniapp.config.ts       ← Mini App bundle
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
    "daily": ["dewey_time.attendance_engine.closeout.run_company_fallback_closeout"],
    "cron": {
        "*/30 * * * *": ["dewey_time.attendance_engine.intraday.run_intraday_scheduler"],
    },
}

# Doc event hooks — fire on any Employee Checkin save
doc_events = {
    "Employee Checkin": {
        "after_insert": "dewey_time.attendance_engine.intraday.on_employee_checkin_after_insert",
        "on_update":    "dewey_time.attendance_engine.intraday.on_employee_checkin_on_update",
    },
}

# Copies Vite build to sites/assets/ after every bench migrate
after_migrate = ["dewey_time.utils.sync_hr_attendance_assets.sync_hr_attendance_assets"]
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
| `Dewey Time Settings` | Single doctype: Telegram bot token/secret, VAPID keys, feature switches. |
| `Dewey Time Push Subscription` | One row per browser push endpoint (PWA notifications). |
| `Dewey Time Branch Rollout` | Per-branch rollout phase (PRELAUNCH / LIVE) — gates what the engine concludes. |
| `Telegram Link` | One row per bound Telegram account (`telegram_user_id` is the docname); `enabled=0` is the revocation, never a delete. |
| `Telegram Link Token` | Single-use invite tokens, stored as SHA-256 hashes, 24h expiry. |

DocTypes are defined as JSON files in `dewey_time/doctype/`. `bench migrate`
syncs them to the database. The controller class lives at
`doctype/<name>/<name>.py` and subclasses `frappe.model.document.Document`.

---

## 6. React SPA Integration

### Build → deploy flow

```
npm run build                      # builds BOTH hr_attendance and miniapp
    → public/hr_attendance/assets/index.js    (stable name; page adds ?v=)
    → public/hr_attendance/assets/index.css   (stable name; page adds ?v=)
    → public/hr_attendance/assets/*-<hash>.woff2   (content-hashed fonts)
    → public/miniapp/…                        (same shape, second bundle)
    → www/hr-attendance.html, www/hr-schedule.html, www/hr-me.html
      (each cache-busted: ?v=<timestamp>)
git commit public/ www/*.html
git push → Frappe Cloud deploy → bench migrate
    → sync_*_assets publish each bundle to sites/assets/dewey_time/<bundle>/
      (atomically: copied to a temp sibling, renamed into place — a killed
      migrate can never leave a half-copied bundle the freshness sentinel
      certifies; see utils/asset_publish.py)
```

Only `index.js` and `index.css` keep stable names — the www pages reference
those two directly with a `?v=` buster. Fonts are content-hashed because their
URLs live *inside* `index.css`, where no `?v=` can reach. Sourcemaps are OFF:
the bundles are committed and `/assets/` serves to guests, so a `.map` would
publish the full annotated source. `scripts/check-fonts.mjs` guards both
bundles' fonts after each build; a 6-hourly smoke workflow
(`frappe-asset-smoke.yml`) checks all three SPAs' live asset URLs and MIME.

Built assets are **committed to git** because Frappe Cloud does not run `npm build`
on deploy. A change to a shared module (`src/lib/`, `src/ui/`) reaches the Mini
App too — both bundles must be rebuilt and committed (CI's `bundle-freshness`
job enforces this).

### CSRF token injection

The `www/hr-attendance.py` Python context provider runs on every page load and
injects the session CSRF token into the Jinja template:

```html
<!-- www/hr-attendance.html -->
<script>window.csrf_token = "{{ frappe.session.csrf_token }}";</script>
<script type="module" src="/assets/dewey_time/hr_attendance/assets/index.js?v=..."></script>
```

`frappe-react-sdk` picks up `window.csrf_token` and includes it in every POST.

### frappe-react-sdk usage

```typescript
// GET (SWR-cached)
const { data } = useFrappeGetCall<EmployeesResponse>(
    "dewey_time.attendance_engine.hr_calendar.list_calendar_employees",
    { include_all: "0" },
    "list_calendar_employees:0"   // SWR cache key
);

// POST
const { call } = useFrappePostCall(
    "dewey_time.attendance_engine.schedule_api.apply_weekly_schedule"
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
| `NO_CHECKIN_YET` | Intraday: rostered, running, zero punches — withdrawn on the first punch |

### Flag lifecycle

```
day_closed=0  provisional (intraday engine, overwrites itself every 30 min)
day_closed=1  final       (closeout engine, overwrites intraday)

Status: OPEN → EXPLAINED → APPROVED | REJECTED → CLOSED
```

---

## 8. Authentication

Four models coexist. **"All endpoints validate session + CSRF" is NOT true of
this app** — the Mini App endpoints are `allow_guest` by design, and their
security rests entirely on the HMAC boundary below.

### HR console (`/hr-attendance`, `/hr-schedule`)
Session cookie + CSRF token, the standard Frappe model.
Role guard pattern:
```python
def _require_hr_role():
    if not frappe.has_permission("Attendance Flag", "read"):
        frappe.throw("HR role required", frappe.PermissionError)
```

### Telegram Mini App (`/hr-me`)
`@frappe.whitelist(allow_guest=True)` + Telegram `initData` validation —
**no Frappe session, no CSRF, and no Frappe permission backstop beneath it.**
`telegram/miniapp_auth.py` is the whole boundary: it verifies Telegram's HMAC
over the launch payload, checks staleness, and resolves the authenticated
Telegram user id to an Employee through the `Telegram Link` binding — or
raises. The endpoints take no employee-selecting parameter (the binding IS the
selection), and the response is narrowed through an explicit allowlist in
`miniapp_api.py`. Anything touching these two files is security-boundary work.

### Telegram webhook (inbound bot updates)
`allow_guest`, gated by the `X-Telegram-Bot-Api-Secret-Token` header matching
the secret registered with `setWebhook` (`telegram/webhook.py`). Validated
before the update is read.

### Bridge service (webhooks)
```
Authorization: token <api_key>:<api_secret>
X-Bridge-Secret: <shared_secret>   # optional, from site_config.json
```
Validated in `bridge_auth.py`. Uses Frappe's built-in User + API key system —
no separate auth database needed.

### ADMS dashboard (`/adms`)
Session login required by the shell (`www/adms.py` redirects Guests), then a
token exchange via `attendance_engine/dashboard_auth.py`, scoped by the
`ADMS Admin` / `ADMS Super Admin` roles.

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
npm run build                       # from frontend/hr_attendance/ — BOTH bundles
git add dewey_time/public/ dewey_time/www/*.html
git push origin main
# Then on Frappe Cloud: deploy → bench migrate
# (the ADMS bundle builds separately: frontend/adms → npm run build:frappe)

# Force asset resync (if 404 after deploy):
# Add a new patch file + entry in patches.txt that calls the bundle's
# force_sync_*_assets() — runs on next migrate. Safe against the bench-symlink
# self-delete and against interruption (utils/asset_publish.py).
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
| Frontend | React 19 (pinned `latest`), TypeScript, Vite 8 |
| Styling | TailwindCSS 4, shadcn/ui (Radix UI) |
| Data fetching | frappe-react-sdk (SWR-based) |
| Routing | React Router v7 |
| Date handling | date-fns |
| Icons | Lucide React |
| Spreadsheet parsing | openpyxl (server-side) |
| Bridge auth | Frappe API key + optional X-Bridge-Secret |

---

## 14. Engine Health Monitoring (T3-4)

The intraday scheduler (`run_intraday_scheduler`, cron `*/30 * * * *`) writes a
durable heartbeat to Frappe's global-default KV store after each successful run:

```
key:   dewey_time_last_intraday_run_at
store: tabDefaultValue (parent=__global)
write: frappe.db.set_global_default(key, iso_timestamp)
read:  frappe.defaults.get_global_default(key)
```

An external uptime monitor polls the health endpoint to detect a dead scheduler
(dead scheduler → heartbeat stops → endpoint reports `healthy=false`):

```
GET /api/method/dewey_time.attendance_engine.api.get_engine_health
Authorization: token <api_key>:<api_secret>
```

Response:
```json
{
  "healthy": true,
  "last_intraday_run_at": "2026-07-02T09:30:00",
  "minutes_since_last_run": 12.4,
  "stale_after_minutes": 90,
  "server_time": "2026-07-02T09:42:25"
}
```

- `healthy=true` means intraday ran within the last **90 minutes** (3 missed cycles).
- `healthy=false` or any non-200 response should trigger an alert.
- The monitor must authenticate with a Frappe API key — `@frappe.whitelist()` (no
  `allow_guest`) enforces this; guest requests are rejected before the handler runs.
- Recommended poll interval: every 15–30 minutes.

---

## 15. Common Commands  <!-- was §14 before T3-4 health section was added -->

```bash
# Run tests
bench --site <site> pytest dewey_time
bench --site <site> pytest dewey_time --path dewey_time/tests/test_closeout.py

# Python REPL with Frappe context
bench --site <site> console

# Migrate (syncs DocTypes, runs patches, copies assets)
bench --site <site> migrate

# Frontend dev
npm run build           # build SPA (from frontend/hr_attendance/)
npm run dev:hr          # HMR dev server → local Frappe
npm run dev:hr:cloud    # HMR dev server → Frappe Cloud
```
