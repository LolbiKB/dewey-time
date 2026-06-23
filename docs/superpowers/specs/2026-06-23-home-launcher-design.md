# Dewey Home — Branded App Launcher (post-login home)

- **Date:** 2026-06-23
- **Status:** Draft — awaiting review
- **Author:** LolbiKB (with Claude)

## Summary

A new, minimal, on-brand **home launcher** becomes the page every user lands on after login, replacing Frappe v16's built-in "desktop screen" (which the team finds poor). It shows a clean grid of app tiles — only the apps the signed-in user can actually open — using the real Dewey design system. It is built as a **React SPA that imports `@lolbikb/dewey-ui`**, served by Frappe exactly like the existing HR Attendance and ADMS SPAs.

This is **Dewey's own take on the Frappe Desk** — the custom shell users land in instead of `/desk`. v1 is the *launcher slice* of that surface; it is designed to grow (status, notifications, in-shell navigation) without a rewrite. Because it's Dewey's home (welded to `dewey_time`'s backend), its source lives **in-repo** at `dewey_time/frontend/home/`; the only separately-versioned piece is the shared `@lolbikb/dewey-ui` library.

This is v1: **static tiles only** (no live status numbers). The same engine grows into a Workday-style status home later (v2).

## Problem & motivation

- After login, every user currently lands in the **Frappe Desk** (`/app`, redirected to `/desk` in v16). The Desk is overwhelming for non-technical staff: a large module sidebar, the global "awesome bar" search, and the full DocType surface.
- The natural Frappe answer — its built-in app launcher — is, in **v16, the "desktop screen" inside `/desk`**: the old `/apps` page is deprecated and redirected to `/desk` (verified against `frappe` `version-16` `website_redirects`). The team finds this desktop screen visually poor, and it still requires desk access (Website Users can't open `/desk` at all).
- The team is rolling out functionality **one app at a time** and wants a controlled, branded entry point that scales: each new app should appear on the home with minimal effort, gated to the right people.

## Goals

1. Everyone lands on **our** branded home after login — not the Desk/desktop screen.
2. Each user sees **only the apps they can open** (cosmetic gating; see Security).
3. Looks like the real Dewey product (tokens, fonts, logo, motion) by **reusing** `@lolbikb/dewey-ui`, not re-creating it.
4. Adding a future app to the home is a **one-entry** change.
5. Minimal to build and maintain; fast to load.

## Non-goals (v1)

- **No live status badges / counts** ("12 flags to review"). Deferred to v2.
- Not changing or weakening any app's own authentication.
- Not removing the Desk for admins — they keep access via a Desk tile.
- No in-launcher search, drag-reorder, or personalization settings.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Rendering | **React SPA** importing `@lolbikb/dewey-ui` | Reuses real components (incl. animated dial) 1:1; one change in dewey-ui updates all apps + launcher |
| App registry | **Curated** — only *your* `add_to_apps_screen` entries (+ synthesized Desk) | Single source of truth in `hooks.py`; new app = one reviewed line; no unvetted third-party tiles on the front door |
| Gating | Per-app `has_permission` predicates reusing existing logic; **fail-open for broad apps, fail-closed for admin apps** | Rules already exist (`get_calendar_session`, ADMS roles, `has_desk_access`); never lock a user out of their only app, never flash admin tiles on error |
| Resolver | One **thin** whitelisted `get_launcher()` — backend-computed, **forward-compatible** shape | Single source of truth in Python; client renders only; v2 status badges slot in without a rewrite |
| Landing | Pilot on a test Role → **global via a DB-settable home (instant kill-switch)** | v16-verified; gradual rollout + seconds-not-minutes rollback, no deploy to revert |
| Shared dial | Promote the animated dial into `@lolbikb/dewey-ui` | So HR app + launcher import the same component; edit once, both update |
| v1 scope | Static tiles, no badges | Ship the minimal "just works" launcher; badges are v2 |
| Code layout | **In-repo** at `dewey_time/frontend/home/` (not a separate repo) | It's Dewey's Desk-replacement home, welded to `dewey_time`'s backend; "distributed monolith" avoided. Shared UI is already separated via `@lolbikb/dewey-ui` |
| Positioning | **"Dewey Desk"** — a Desk-replacement surface; v1 = launcher slice | Long-lived strategic shell; engine + route + dewey-ui reuse all extend without a rewrite |

## Architecture — the engine (5 layers)

```
 User logs in
   → ① LANDING    home_page → launcher route   (everyone arrives here)
   → ② REGISTRY   add_to_apps_screen           (what apps exist)
   → ③ GATING     has_permission per app       (may THIS user see it)
   → ④ RESOLVER   get_launcher()               (assemble my tiles + greeting)
   → ⑤ RENDERING  React SPA (dewey-ui)         (draw it)
 User taps a tile → app's own route re-checks its own auth (the real boundary)
```

### ① Landing
Verified against `frappe` `version-16`:
- **System Users** (≥1 role with `desk_access=1`) land via `get_home_page()` → resolution order: **Role DocType `home_page` field (DB)** → Portal Settings → hooks (`role_home_page`, then `home_page`) → Website Settings `home_page` → fallback `/desk`.
- **Website Users** (all roles `desk_access=0`) land via `get_default_path()` then `get_home_page()`; they **cannot** open `/desk`.
- `get_home_page()` is **cached per user** — cache must be cleared after a change.
- **Rollout:** pilot by setting a dedicated test **Role's `home_page`** to the launcher route (Desk-only, no deploy, reversible — Role.home_page wins over the hook). Then go global via a **DB-settable home (Website Settings home page / role-based)** so it can be flipped off instantly with no deploy — the kill-switch. Admins still land here and use the Desk tile to jump to `/desk`.

### ② Registry
`add_to_apps_screen` in `dewey_time/hooks.py` is the source of truth. Each entry: `name`, `title`, `logo`, `route`, optional `has_permission` (a dotted path to a callable that **must explicitly return `True`** in v16). The resolver reads this registry rather than Frappe's `get_apps()` (which has quirks: skips the core `frappe` app, applies a setup-wizard filter, and gates the Desk tile to System Managers only).

### ③ Gating
A predicate per tile, reusing existing logic:

| Tile | Visible when | Reuses |
|---|---|---|
| **HR Attendance** (`/hr-attendance`) | user is HR staff **or** has an active linked Employee | `hr_calendar.HR_STAFF_ROLES` (`System Manager`, `HR User`, `HR Manager`) + the `get_calendar_session` logic |
| **ADMS Bridge** (`/adms`) | user holds `ADMS Admin` / `ADMS Super Admin` | `dashboard_auth.ALLOWED_ROLES` |
| **Frappe Desk** (`/desk`) | user has desk access (can open `/desk`) | Frappe `has_desk_access()` — note: broader than Frappe's own `check_app_permission`, which is System-Manager-only |

### ④ Resolver
`get_launcher()` — new whitelisted method (e.g. `dewey_time/attendance_engine/launcher.py`). For `frappe.session.user`:
- Walk the registry, run each gate, collect visible tiles.
- Return greeting data (`full_name`, derived initials).

**API contract:**
```jsonc
// GET (whitelisted) dewey_time.attendance_engine.launcher.get_launcher
{
  "user": { "full_name": "Maria Rossi", "initials": "MR" },
  "apps": [
    { "name": "dewey_time", "title": "HR Attendance", "route": "/hr-attendance",
      "logo": "/assets/dewey_time/images/dewey-time.svg", "admin": false },
    { "name": "adms", "title": "ADMS Bridge", "route": "/adms",
      "logo": "/assets/dewey_time/images/adms-bridge.svg", "admin": true },
    { "name": "desk", "title": "Frappe Desk", "route": "/desk",
      "logo": "/assets/dewey_time/images/DI-logo.svg", "admin": true }
  ]
}
```

### ⑤ Rendering — React SPA
A new SPA mirroring the existing pattern:
- Source: `dewey_time/frontend/home/` (Vite + React 19 + TS + Tailwind v4 + `@lolbikb/dewey-ui`).
- Built to `dewey_time/public/home/`; synced to `sites/assets/` on `after_migrate` (extend/generalize `utils/sync_hr_attendance_assets.py`).
- Served by `www/home.html` + `www/home.py` (`get_context` redirects Guests to `/login`), with `website_route_rules` for `/home` and `/home/<path>`.
- UI: top bar (dial wordmark + user avatar/initials), optional greeting line, section label "Your apps", responsive tile grid (1 col phone / 2 tablet / 3 desktop). Tiles: **big logo + name only**, neutral white card, brand green as signal, animated dial on hover/intro. Reuses dewey-ui `Card` + the promoted `Dial` component; applies house motion (`dw-rise` entrance stagger, `scale(0.97)` press, restrained bg-shift hover).

## Shared design system

The animated dial currently lives only in the HR app's `src/brand/`. To get true "edit once, updates everywhere":
- **Promote the dial into `@lolbikb/dewey-ui`** as a self-contained component (its `dw-*` keyframes travelling with it), publish a new package version, and have **both** the HR app and the launcher import it.
- Design tokens already ship in dewey-ui's `theme.css`; ensure the keyframes/motion tokens are there too.
- Static brand assets (`DI-logo.svg`, `dewey-time.svg`, `adms-bridge.svg`) are already shared via `/assets/dewey_time/images/…`.

## Tile inventory (v1)

Three tiles, each gated (see ③). Schedule is **not** a tile — it's an HR-only tab inside HR Attendance (same bundle); a separate tile would duplicate/confuse.

## Security model

Launcher gating is **cosmetic** — it decides what to *show*, never what a user may *do*. The real boundary stays at each app's route: `/adms` performs its bridge token exchange, `/hr-attendance` calls `get_calendar_session`, `/desk` enforces desk access. Worst case the launcher shows a tile that then refuses entry. Defense in depth; the gating need not be security-critical.

## Robustness & failure modes

The launcher is the **front door**, so its failure modes matter more than its happy path. Locked decisions (one per core aspect):

- **Registry — curated.** The resolver reads only `dewey_time`'s own `add_to_apps_screen` entries plus a synthesized Desk tile. Third-party apps installed later do **not** auto-appear; adding one is a deliberate one-line opt-in.
- **Gating — fail-direction by tile.** Each predicate is wrapped in try/except and logged. On error, **broad apps fail-open** (HR Attendance still shows — a transient hiccup never locks a user out of their only app) and **admin-gated apps fail-closed** (ADMS/Desk hide rather than flash to non-admins). Gating is cosmetic; the per-app route is the real boundary, so an over-shown tile merely refuses on click.
- **Resolver — never 500s.** `get_launcher()` wraps the whole assembly; on internal error it returns a minimal safe payload (greeting + whatever tiles resolved) instead of failing the page. Shape is forward-compatible (tiles can later gain an optional `badge`/`status` field for v2).
- **Shell — always renders.** `www/home.html` is static HTML with no server logic, so the page itself can't fail to load; the SPA then handles data states.
- **SPA states.** Explicit **loading** (skeleton), **empty** ("No apps yet — contact your administrator", for brand-new users with no roles/employee link), and **error** states.
- **Safety net when broken.** The error screen offers **Retry** + a context-aware escape: a "Go to Desk" link for desk-access users and "Log out" for everyone — nobody is ever trapped behind a broken home.
- **Kill-switch + rollout.** The global landing is a **DB-settable value, flippable off instantly with no deploy**. Rollout is pilot-first (a throwaway test Role's `home_page`, which validates real v16 landing for **both** System and Website users) → then global.
- **Freshness.** Tiles are recomputed each load (cheap: one shared `get_roles()`, ≤1 query per gate). Role changes need a Clear Cache to drop the per-user `home_page` redirect cache.
- **Observability.** Gate exceptions log app + user, so "why don't I see app X?" is debuggable.

## Cleanup (in scope)

Delete the orphaned `www/hr-personal.html` (no route, stale asset hash, not in the React router; the "personal" view is already HR Attendance's "My calendar" mode). Check `brandWiring.test.ts` (asserts its favicon) and update/remove that assertion.

## Build & deploy sequence (high-level; detailed plan to follow)

1. Promote dial → `@lolbikb/dewey-ui`; publish; bump HR app to consume it (no visual change).
2. Backend: `launcher.py` `get_launcher()` + gating predicates + tests.
3. Frontend: scaffold `frontend/home/` SPA; tiles + grid + greeting reusing dewey-ui; fetch `get_launcher`.
4. Serving: `www/home.{html,py}`, `website_route_rules`, asset sync.
5. Build → push → Frappe Cloud Deploy → Migrate.
6. Landing rollout: pilot on a test Role's `home_page`; verify; then set global `home_page`.
7. Remove `hr-personal.html`.

## Testing

- **Backend:** unit-test `get_launcher()` gating for each persona (linked employee, HR staff, ADMS admin, desk admin, plain user) — assert exactly the right tiles. `unittest` via `bench run-tests --app dewey_time`.
- **Frontend:** render tests for the tile grid / responsive columns / empty-ish states.
- **Manual:** log in as each persona on the pilot role; confirm tiles, animation, and that per-app routes still enforce their own auth.

## Risks / open questions

- **Landing for Website vs System users:** confirmed they differ; the pilot (Role.home_page) validates real behavior on the live site before global rollout. The exact DB-settable *global* knob that reliably catches **both** user types (Website Settings home page may be bypassed for Website Users via `get_default_path()`) must be confirmed during the pilot; fall back to role-based global assignment if needed.
- **dewey-ui publish flow:** promoting the dial requires a package release + `NODE_AUTH_TOKEN` (GitHub Packages) in CI/build.
- **A 4th SPA's overhead:** accepted deliberately (chosen for 1:1 component reuse over a lighter server-rendered page).
- **Admins landing on home instead of Desk:** intended; revisit if power users prefer landing in `/desk` (could exempt System Manager via `role_home_page`).
- **Route name:** spec assumes `/home`; confirm it doesn't collide with Frappe's default website home page (Website Settings `home_page` / a `www/home`). Fallback names: `/launcher` or `/start`. Decide before scaffolding `www/`.
