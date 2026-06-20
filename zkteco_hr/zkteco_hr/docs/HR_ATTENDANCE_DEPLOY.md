# HR Attendance UI — build & Frappe Cloud deploy

SPA routes: `/hr-attendance`, `/hr-schedule` (shared bundle)  
Source: `frontend/hr_attendance/`  
Built output: `public/hr_attendance/` (commit JS/CSS to git)  
WWW entries: `www/hr-attendance.html`, `www/hr-schedule.html` + matching `.py` handlers (Jinja, `no_cache = 1`)

## Build

```bash
cd zkteco_hr/zkteco_hr/frontend/hr_attendance
npm install
npm run build
```

This writes:

- `public/hr_attendance/assets/index.js` / `index.css` (stable filenames)
- `public/hr_attendance/assets/build-id.txt` (timestamp for debugging)
- `www/hr-attendance.html` and `www/hr-schedule.html` with literal `?v=<timestamp>` on asset URLs (cache bust)
- copies the same HTML to `public/hr_attendance/index.html` (do **not** serve this as the app entry)

Commit `public/hr_attendance/assets/*`, `www/hr-attendance.html`, and `www/hr-schedule.html` with your code changes.

## How Frappe serves the bundle

| URL | Served from |
|-----|-------------|
| `/hr-attendance` | `www/hr-attendance.html` (Jinja — CSRF token) |
| `/hr-schedule` | `www/hr-schedule.html` (same bundle, different title) |
| `/assets/zkteco_hr/hr_attendance/assets/index.js` | `public/hr_attendance/assets/` (via bench symlink or sync copy) |

After deploy, Frappe Cloud usually symlinks:

`sites/assets/zkteco_hr/hr_attendance` → `apps/.../public/hr_attendance`

When that symlink exists, files are read **directly from `public/`** in the app repo. No copy step is required.

## `sync_hr_attendance_assets` (migrate hook)

Runs on every `bench migrate`, invoked **first** via `publish_assets.publish_assets_after_migrate` (`hooks.py` → `after_migrate`). The publisher runs the asset syncs **before** the DB-side handlers (`make_custom_fields`, `ensure_adms_roles`) and guards each step, so a failure there — or in one sync — can never abort migrate and leave `/assets/zkteco_hr/**` 404ing. (June 2026 incident: `make_custom_fields` ran first in `after_migrate`; when it threw, the asset syncs never ran and the whole app asset tree 404'd.)

**Purpose:** fallback when the bench symlink is missing (otherwise CSS/JS 404).

**Rules (do not break these):**

1. **If `index.js` and `index.css` exist under `sites/assets/.../hr_attendance` and `assets/build-id.txt` matches app `public/` → skip sync.**  
   Works for a healthy bench symlink or an up-to-date copy. Never partial-sync `assets/` through a symlink (that deletes the app bundle).

   When you ship a new frontend build, `build-id.txt` changes — migrate republishes the bundle automatically.

2. **If the bundle is missing** (empty dir, broken symlink, or wiped symlink target) → remove `dest` and **full `copytree`** of `public/hr_attendance/`, excluding `index.html`.  
   A dangling symlink is unlinked first; the copy is never written through a symlink.

3. **Do not use Jinja in asset URLs** (`?v={{ asset_version }}`).  
   Static asset paths are not rendered by Jinja. The browser requests the literal string `{{%20asset_version%20}}` and gets HTML → MIME type error.

4. **Cache bust with a build-time literal** in `copy-html-entry.mjs` (`?v=1730123456`), not server-side template vars.

One-time repair for sites that still 404 after deploy: latest `resync_hr_attendance_assets_v*` patch (currently **v9**) or bench console `force_sync_hr_attendance_assets()`. Older patches: v4 (SPA bundle), v5 (branding SVG under `public/images/`).

Implementation: `zkteco_hr/utils/sync_hr_attendance_assets.py`

### Site branding (`public/images/`)

| Asset | URL | Used for |
| --- | --- | --- |
| `DI-logo.svg` | `/assets/zkteco_hr/images/DI-logo.svg` | Site favicon / Desk login (`app_logo_url`, `website_context`, SPA `<link rel="icon">`) |
| `attendance-svgrepo-com.svg` | `/assets/zkteco_hr/images/attendance-svgrepo-com.svg` | App switcher logo (`add_to_apps_screen`) and SPA header |

Every migrate runs `sync_app_branding_assets()` (copies all of `public/images/`). Desk **Workspace / Desktop Icon** for ZKTeco HR are not created — patch `remove_zkteco_hr_desk_workspace` deletes them if present.

Verify both URLs return **200** SVG in the browser.

## Troubleshooting

### Symptom: `404` on `index.js` / `index.css`

The file is missing under `sites/assets/zkteco_hr/hr_attendance/assets/`.

- Confirm built files are in git and deployed (`public/hr_attendance/assets/index.css` ~120 KB).
- Run **Migrate** on Frappe Cloud (runs `sync_hr_attendance_assets` + any one-time repair patches).
- On bench SSH (if available):  
  `ls sites/assets/zkteco_hr/hr_attendance/assets/index.css`

### Symptom: MIME type `'text/html'` on CSS/JS

Almost always a **404 disguised as a stylesheet error** — Frappe returns its HTML error page.

Less common: URL contains unrendered Jinja (`?v={{ asset_version }}`). Fix: rebuild with current `copy-html-entry.mjs`.

### Symptom: UI unchanged after push

- Hard refresh, or check that `www/hr-attendance.html` has a new `?v=` timestamp from the latest build.
- Confirm deploy succeeded and migrate ran.

### Symptom: stale UI but assets load (200)

Browser cached old `index.js` (stable filename). Rebuild to bump `?v=` in HTML.

## Incident reference (May 2026)

Broken sync copied `assets/` onto itself via symlink → deleted bundle → 404 → browser reported `text/html` MIME on CSS. Fixed in commit `383ea8f0` (symlink detection + full copytree fallback + `resync_hr_attendance_assets_v2` patch).

`resync_hr_attendance_assets_v3` + updated `sync_hr_attendance_assets`: skip only when `index.js`/`index.css` exist at the resolved asset path; otherwise unlink broken symlinks and full-copy from app `public/`.
