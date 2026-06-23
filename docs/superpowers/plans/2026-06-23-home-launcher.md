# Dewey Home Launcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a minimal, on-brand React SPA at `/home` that becomes every user's post-login landing, showing only the app tiles they can open ("Dewey's take on Desk", v1 = launcher slice).

**Architecture:** A thin whitelisted backend resolver `get_launcher()` does all per-user gating server-side and returns a ready-to-render tile list + greeting. A new React SPA in `dewey_time/frontend/home/` (sibling of `frontend/hr_attendance/`, same scaffold, reuses `@lolbikb/dewey-ui`) renders it, served by a `www/home` page. Landing is wired via a piloted, DB-revertible home page.

**Tech Stack:** Python/Frappe (v16) backend; React 19 + Vite + TailwindCSS v4 + `@lolbikb/dewey-ui` + `frappe-react-sdk` + `react-router-dom` v7 frontend; mock-based `unittest` tests.

## Global Constraints

- **Frappe v16.** `/apps` and `/app` redirect to `/desk`; the launcher route is `/home`.
- **Gating is cosmetic; the per-app route is the real security boundary.** An over-shown tile merely refuses on click.
- **Fail policy:** gate errors → **broad apps fail-open, admin apps fail-closed**; all errors logged via `frappe.log_error`.
- **Tests:** plain `unittest.TestCase`, mock-based (`from dewey_time.tests.test_closeout import _install_frappe_mock`). Run one module: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.<module>`.
- **Frontend build base path:** `/assets/dewey_time/home/`; **build outDir:** `dewey_time/public/home`. `npm install` requires `NODE_AUTH_TOKEN` (GitHub PAT, `read:packages`) because of `@lolbikb` on GitHub Packages.
- **CSS import order (Tailwind v4, exact):** `tailwindcss` → `tw-animate-css` → `shadcn/tailwind.css` → `@lolbikb/dewey-ui/theme.css` → brand tokens → `@source` the dewey-ui dist.
- **Brand:** primary green `#066031` / `--brand-primary`, accent orange `#c2410c` / `--brand-accent`; light-only; font Geist Variable. **Do not tint surfaces with green — color is signal only.**
- **Curated registry:** the launcher enumerates only `dewey_time`'s own `add_to_apps_screen` entries (+ a synthesized Desk tile). No third-party auto-discovery.

---

## File Structure

**Backend (new):**
- `dewey_time/attendance_engine/launcher.py` — resolver `get_launcher()` + gating predicates + curated registry. One responsibility: assemble the current user's tiles.
- `dewey_time/tests/test_launcher.py` — per-persona gating tests (mock-based).

**Backend (modified):**
- `dewey_time/hooks.py` — add `website_route_rules` for `/home`; add `sync_home_assets` to `after_migrate`.
- `dewey_time/utils/sync_hr_attendance_assets.py` — generalize the copy helper so a `sync_home_assets()` can reuse it.

**Serving (new):**
- `dewey_time/www/home.html` — generated SPA shell (by the home `copy-html-entry`).
- `dewey_time/www/home.py` — `get_context`: Guest → `/login`, set csrf + boot.

**Frontend (new SPA, `dewey_time/frontend/home/`):** clones of the hr_attendance scaffold + launcher UI:
- `package.json`, `.npmrc`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.cjs`, `components.json`, `index.html`, `scripts/copy-html-entry.mjs` — cloned with exact edits.
- `src/main.tsx` — React root, FrappeProvider, single route.
- `src/index.css` — the import chain (reuses HR app brand via relative import — single source).
- `src/Launcher.tsx` — the launcher page (fetch + tiles + states).
- `src/types.ts` — the `get_launcher` response type.

**Assets (new):**
- `dewey_time/public/images/dewey-time-animated.svg` — shared self-contained animated dial.

**Cleanup:**
- delete `dewey_time/www/hr-personal.html`; update the brand-wiring test that asserts its favicon.

---

## Task 1: Backend resolver `get_launcher()` + gating

**Files:**
- Create: `dewey_time/attendance_engine/launcher.py`
- Test: `dewey_time/tests/test_launcher.py`

**Interfaces:**
- Consumes: `dewey_time.attendance_engine.hr_calendar._is_hr_staff()`, `._employee_linked_to_user()`; `dewey_time.attendance_engine.dashboard_auth.ALLOWED_ROLES`; `dewey_time.utils.sync_hr_attendance_assets.SITE_FAVICON_LOGO`.
- Produces: `get_launcher() -> {"user": {"full_name": str, "initials": str}, "apps": [{"name": str, "title": str, "route": str, "logo": str, "admin": bool}, ...]}` (whitelisted; raises `frappe.AuthenticationError` for Guest).

- [ ] **Step 1: Write the failing tests**

Create `dewey_time/tests/test_launcher.py`:

```python
import unittest
from types import SimpleNamespace
from unittest.mock import patch

# Installs the shared MagicMock `frappe` into sys.modules (no bench needed).
from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import launcher as mod  # noqa: E402

# Make the mock's exception classes real so `raises`/policy checks behave.
mod.frappe.AuthenticationError = type("AuthenticationError", (Exception,), {})
mod.frappe.PermissionError = PermissionError

# The two curated tiles, as they appear in hooks.add_to_apps_screen.
_ENTRIES = [
    {"name": "dewey_time", "title": "Dewey Time", "logo": "/x/dewey.svg", "route": "/hr-attendance"},
    {"name": "adms", "title": "ADMS Bridge", "logo": "/x/adms.svg", "route": "/adms"},
]


def _run(*, user="u@x.com", roles=None, hr=False, employee=None, desk=False):
    """Invoke get_launcher() with a fully mocked persona."""
    roles = roles or []
    with patch.object(mod.frappe, "session", SimpleNamespace(user=user)), \
         patch.object(mod.frappe, "get_roles", return_value=roles), \
         patch.object(mod.frappe, "get_hooks", return_value=_ENTRIES), \
         patch.object(mod, "_is_hr_staff", return_value=hr), \
         patch.object(mod, "_employee_linked_to_user", return_value=employee), \
         patch.object(mod, "_has_desk_access", return_value=desk), \
         patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
        return mod.get_launcher()


def _names(result):
    return [a["name"] for a in result["apps"]]


class GetLauncherTests(unittest.TestCase):
    def test_guest_is_rejected(self):
        with patch.object(mod.frappe, "session", SimpleNamespace(user="Guest")):
            with self.assertRaises(mod.frappe.AuthenticationError):
                mod.get_launcher()

    def test_linked_employee_sees_only_hr(self):
        self.assertEqual(_names(_run(employee="EMP-001")), ["dewey_time"])

    def test_adms_admin_sees_only_adms(self):
        self.assertEqual(_names(_run(roles=["ADMS Admin"])), ["adms"])

    def test_hr_user_sees_hr_and_desk(self):
        self.assertEqual(_names(_run(hr=True, desk=True)), ["dewey_time", "desk"])

    def test_system_manager_no_adms(self):
        # System Manager is HR staff + desk, but NOT an ADMS role.
        out = _names(_run(roles=["System Manager"], hr=True, desk=True))
        self.assertEqual(out, ["dewey_time", "desk"])

    def test_no_apps_returns_empty(self):
        self.assertEqual(_names(_run()), [])

    def test_greeting_initials(self):
        self.assertEqual(_run(employee="EMP-001")["user"], {"full_name": "Maria Rossi", "initials": "MR"})

    def test_broad_gate_error_fails_open(self):
        with patch.object(mod, "_is_hr_staff", side_effect=RuntimeError("boom")), \
             patch.object(mod, "_employee_linked_to_user", side_effect=RuntimeError("boom")):
            self.assertIn("dewey_time", _names(_run()))

    def test_admin_gate_error_fails_closed(self):
        with patch.object(mod, "_has_desk_access", side_effect=RuntimeError("boom")):
            self.assertNotIn("desk", _names(_run(hr=True)))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_launcher`
Expected: FAIL — `ModuleNotFoundError: dewey_time.attendance_engine.launcher` (module doesn't exist yet).

- [ ] **Step 3: Implement `launcher.py`**

Create `dewey_time/attendance_engine/launcher.py`:

```python
"""Home launcher resolver.

Assembles the per-user app-tile list for the /home launcher SPA. Gating here is
COSMETIC — each app's own route enforces real auth — so the policy is:
broad apps fail-open, admin apps fail-closed (see _visible).
"""

import frappe
from frappe import _

from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES as ADMS_ROLES
from dewey_time.attendance_engine.hr_calendar import (
    _employee_linked_to_user,
    _is_hr_staff,
)
from dewey_time.utils.sync_hr_attendance_assets import SITE_FAVICON_LOGO

_BROAD = "broad"
_ADMIN = "admin"


def _can_see_hr() -> bool:
    return bool(_is_hr_staff() or _employee_linked_to_user())


def _can_see_adms() -> bool:
    return bool(set(frappe.get_roles()) & ADMS_ROLES)


def _has_desk_access(roles=None) -> bool:
    """True if any of the user's roles enables Desk access (Role.desk_access=1).

    Role-field based (matches how this app reasons about desk-less roles). The
    framework alternative is `frappe.get_user().has_desk_access()`.
    """
    roles = roles if roles is not None else frappe.get_roles()
    if not roles:
        return False
    return bool(
        frappe.get_all(
            "Role",
            filters={"name": ["in", list(roles)], "desk_access": 1},
            limit=1,
        )
    )


# Gate + fail-policy per curated app (keyed by add_to_apps_screen `name`).
_APP_GATES = {
    "dewey_time": {"gate": _can_see_hr, "policy": _BROAD},
    "adms": {"gate": _can_see_adms, "policy": _ADMIN},
}


def _visible(gate, policy: str) -> bool:
    try:
        return bool(gate())
    except Exception:
        frappe.log_error(title="launcher gate error")
        return policy == _BROAD  # fail-open for broad, fail-closed for admin


def _initials(full_name: str) -> str:
    parts = (full_name or "").split()
    return ("".join(p[0] for p in parts[:2]).upper()) or "?"


@frappe.whitelist()
def get_launcher():
    """Return the current user's launcher tiles + greeting."""
    if frappe.session.user in (None, "", "Guest"):
        frappe.throw(_("Login required"), frappe.AuthenticationError)

    full_name = frappe.utils.get_fullname(frappe.session.user) or frappe.session.user
    user = {"full_name": full_name, "initials": _initials(full_name)}

    apps = []
    try:
        entries = frappe.get_hooks("add_to_apps_screen", app_name="dewey_time") or []
        for entry in entries:
            cfg = _APP_GATES.get(entry.get("name"))
            if not cfg:
                continue  # curated: skip apps without a known gate
            if _visible(cfg["gate"], cfg["policy"]):
                apps.append({
                    "name": entry["name"],
                    "title": entry["title"],
                    "route": entry["route"],
                    "logo": entry["logo"],
                    "admin": cfg["policy"] == _ADMIN,
                })
        # Synthesized Desk tile (not a dewey_time app entry).
        if _visible(_has_desk_access, _ADMIN):
            apps.append({
                "name": "desk",
                "title": "Frappe Desk",
                "route": "/desk",
                "logo": SITE_FAVICON_LOGO,
                "admin": True,
            })
    except Exception:
        frappe.log_error(title="get_launcher failed")  # never 500 the front door

    return {"user": user, "apps": apps}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_launcher`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/launcher.py dewey_time/tests/test_launcher.py
git commit -m "feat(home): add get_launcher resolver with per-user gating"
```

---

## Task 2: Shared animated dial SVG

**Files:**
- Create: `dewey_time/public/images/dewey-time-animated.svg`

**Interfaces:**
- Produces: a self-contained animated SVG served at `/assets/dewey_time/images/dewey-time-animated.svg` (after migrate), usable via `<img>` by any app. Draws its ring + sweeps the minute hand on load; static-finished under `prefers-reduced-motion`.

- [ ] **Step 1: Create the SVG** (port of `public/images/dewey-time.svg` + the `dw-*` keyframes from `src/brand/base.css`, self-contained so it animates inside an `<img>`)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="Dewey Time">
  <style>
    .ring   { stroke: #066031; stroke-dasharray: 201.06; animation: draw 1.05s cubic-bezier(0.65,0,0.35,1) both; }
    .hand-h { stroke: #066031; animation: fadeh 1.05s linear both; }
    .hand-m { stroke: #C2410C; transform-box: view-box; transform-origin: 48px 48px; animation: sweep 1.05s cubic-bezier(0.65,0,0.35,1) both; }
    .pivot  { fill: #066031; }
    @keyframes draw  { from { stroke-dashoffset: 201.06; } to { stroke-dashoffset: 0; } }
    @keyframes sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes fadeh { 0%,35% { opacity: 0; } 100% { opacity: 1; } }
    @media (prefers-color-scheme: dark) {
      .ring, .hand-h { stroke: #3f9168; } .pivot { fill: #3f9168; } .hand-m { stroke: #F4A24B; }
    }
    @media (prefers-reduced-motion: reduce) {
      .ring, .hand-h, .hand-m { animation: none; } .ring { stroke-dashoffset: 0; } .hand-h { opacity: 1; }
    }
  </style>
  <circle class="ring"   cx="48" cy="48" r="32" fill="none" stroke-width="8"/>
  <line   class="hand-h" x1="48" y1="48" x2="35" y2="41" stroke-width="8" stroke-linecap="round"/>
  <line   class="hand-m" x1="48" y1="48" x2="66" y2="38" stroke-width="8" stroke-linecap="round"/>
  <circle class="pivot"  cx="48" cy="48" r="4.5"/>
</svg>
```

- [ ] **Step 2: Verify it renders + animates** — open the file directly in a browser; the ring should draw and the orange hand sweep once. (No automated test for a static asset.)

- [ ] **Step 3: Commit**

```bash
git add dewey_time/public/images/dewey-time-animated.svg
git commit -m "feat(home): add shared self-contained animated dial SVG"
```

---

## Task 3: Scaffold the `frontend/home/` SPA

**Files:** create `dewey_time/frontend/home/` by cloning the hr_attendance scaffold, then applying exact edits.

**Interfaces:**
- Produces: `cd dewey_time/frontend/home && NODE_AUTH_TOKEN=<pat> npm install && npm run build` emits `dewey_time/public/home/assets/index.js` + `index.css` and a generated `dewey_time/www/home.html`.

- [ ] **Step 1: Clone the scaffold files**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend
mkdir -p home/src home/scripts
cp hr_attendance/.npmrc home/.npmrc
cp hr_attendance/package.json home/package.json
cp hr_attendance/vite.config.ts home/vite.config.ts
cp hr_attendance/tsconfig.json home/tsconfig.json
cp hr_attendance/tailwind.config.js home/tailwind.config.js
cp hr_attendance/postcss.config.cjs home/postcss.config.cjs
cp hr_attendance/components.json home/components.json
cp hr_attendance/index.html home/index.html
cp hr_attendance/scripts/copy-html-entry.mjs home/scripts/copy-html-entry.mjs
```

- [ ] **Step 2: Apply the path/name edits** (read each file; change every `hr_attendance` occurrence to `home`)

- `home/package.json`: set `"name": "home"`; in `"build"` change `--base=/assets/dewey_time/hr_attendance/` → `--base=/assets/dewey_time/home/`. Remove `test:web`/`test:e2e`/`@playwright/test` (the new SPA has no Playwright suite). Keep all runtime deps (`@lolbikb/dewey-ui`, `react`, `react-dom`, `react-router-dom`, `frappe-react-sdk`, `lucide-react`, `@fontsource-variable/geist`, tailwind set).
- `home/vite.config.ts`: change the production `base` to `/assets/dewey_time/home/`; change `build.outDir` to `path.resolve(__dirname, "../../public/home")`. Leave `server.port: 8080`, proxy, and `@`→`./src` alias.
- `home/scripts/copy-html-entry.mjs`: change every `hr_attendance` path segment to `home` (source `public/home/assets`, output `www/home.html`) and the asset URL base to `/assets/dewey_time/home/assets/`.
- `home/index.html`: change the manifest `href` and any `/assets/dewey_time/hr_attendance/` references to `/home/`. **Keep** the `window.csrf_token = "{{ frappe.session.csrf_token }}"` script verbatim.

- [ ] **Step 3: Write `home/src/index.css`** (mirror the HR import order; reuse the HR brand layer by relative import — single source, no duplication; **no** `base.css` since the dial is the self-contained SVG)

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@lolbikb/dewey-ui/theme.css";
@import "../../hr_attendance/src/brand/tokens.css";
@source "../node_modules/@lolbikb/dewey-ui/dist";
```

- [ ] **Step 4: Write `home/src/types.ts`**

```ts
export interface LauncherApp {
  name: string;
  title: string;
  route: string;
  logo: string;
  admin: boolean;
}
export interface LauncherData {
  user: { full_name: string; initials: string };
  apps: LauncherApp[];
}
```

- [ ] **Step 5: Write `home/src/main.tsx`** (single route; FrappeProvider config copied from the HR app — same-origin + `window.csrf_token`, `enableSocket={false}`)

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FrappeProvider } from "frappe-react-sdk";
import { Launcher } from "./Launcher";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FrappeProvider enableSocket={false}>
      <Launcher />
    </FrappeProvider>
  </StrictMode>
);
```

- [ ] **Step 6: Write `home/src/Launcher.tsx`** (fetch + states + tiles; dewey-ui `Card`; brand green as signal only)

```tsx
import { useFrappeGetCall } from "frappe-react-sdk";
import { Card } from "@lolbikb/dewey-ui";
import type { LauncherData } from "./types";

const METHOD = "dewey_time.attendance_engine.launcher.get_launcher";
const DIAL = "/assets/dewey_time/images/dewey-time-animated.svg";

export function Launcher() {
  const { data, error, isLoading } = useFrappeGetCall<{ message: LauncherData }>(
    METHOD, undefined, METHOD
  );
  const launcher = data?.message;

  if (isLoading) return <Shell><p className="text-muted-foreground text-sm">Loading…</p></Shell>;

  if (error) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load your apps.</p>
          <div className="flex gap-2">
            <button className="rounded-md border border-border px-3 py-1.5 text-sm"
              onClick={() => location.reload()}>Retry</button>
            <a className="rounded-md border border-border px-3 py-1.5 text-sm" href="/desk">Go to Desk</a>
            <a className="rounded-md border border-border px-3 py-1.5 text-sm" href="/api/method/logout">Log out</a>
          </div>
        </div>
      </Shell>
    );
  }

  const apps = launcher?.apps ?? [];
  return (
    <Shell user={launcher?.user}>
      <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Your apps</p>
      {apps.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No apps assigned yet — contact your administrator.
        </p>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(186px,1fr))" }}>
          {apps.map((a) => (
            <a key={a.name} href={a.route} className="block">
              <Card className="relative flex flex-col items-center gap-3 p-6 text-center transition-colors hover:bg-muted/40">
                {a.admin && (
                  <span className="absolute right-3 top-3 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Admins
                  </span>
                )}
                <div className="flex size-[62px] items-center justify-center rounded-2xl border border-border bg-muted">
                  <img src={a.logo} alt="" className="size-9" />
                </div>
                <p className="text-[15px] font-semibold tracking-tight">{a.title}</p>
              </Card>
            </a>
          ))}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, user }: { children: React.ReactNode; user?: LauncherData["user"] }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <img src={DIAL} alt="" className="size-7" />
          <span className="text-base font-semibold tracking-tight">Dewey<span className="text-primary">·</span>Time</span>
        </div>
        {user && (
          <div className="flex size-8 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold text-muted-foreground">
            {user.initials}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-5 py-7">
        {user && <p className="mb-5 text-lg font-semibold tracking-tight">Good day, {user.full_name}</p>}
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Build to verify the SPA compiles and emits assets**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/home
NODE_AUTH_TOKEN=<gh_pat_read_packages> npm install
npm run build
ls ../../public/home/assets   # expect index.js, index.css
ls ../../www/home.html        # expect the generated shell
```
Expected: build succeeds; the three files exist.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/frontend/home dewey_time/public/home dewey_time/www/home.html
git commit -m "feat(home): scaffold launcher SPA (frontend/home)"
```

---

## Task 4: Serve `/home` with Guest gating

**Files:**
- Create: `dewey_time/www/home.py`
- Modify: `dewey_time/hooks.py` (add `website_route_rules`)

**Interfaces:**
- Consumes: the generated `www/home.html`.
- Produces: `/home` and `/home/<path>` resolve to the SPA shell for logged-in users; Guests redirect to `/login?redirect-to=/home`.

- [ ] **Step 1: Write `dewey_time/www/home.py`** (Guest redirect like `www/adms.py`; csrf + boot like `www/hr-attendance.py`)

```python
import frappe


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/home"
        raise frappe.Redirect

    frappe.db.commit()  # ensure csrf token row persists
    context.no_cache = 1
    context.csrf_token = frappe.sessions.get_csrf_token()
    context.boot = frappe._dict(
        frappe_version=frappe.__version__,
        site_name=frappe.local.site,
        system_timezone=frappe.utils.get_system_timezone(),
    )
    return context
```

- [ ] **Step 2: Add the route rules** — in `dewey_time/hooks.py`, extend `website_route_rules`:

```python
website_route_rules = [
    {"from_route": "/hr-attendance/<path:app_path>", "to_route": "hr-attendance"},
    {"from_route": "/hr-attendance", "to_route": "hr-attendance"},
    {"from_route": "/hr-schedule/<path:app_path>", "to_route": "hr-schedule"},
    {"from_route": "/hr-schedule", "to_route": "hr-schedule"},
    {"from_route": "/home/<path:app_path>", "to_route": "home"},
    {"from_route": "/home", "to_route": "home"},
]
```

- [ ] **Step 3: Manual verification** (needs a bench)

```bash
bench --site <site> migrate
bench --site <site> clear-cache
```
Then in a browser: visit `/home` logged in → the launcher renders with your tiles; log out and visit `/home` → redirected to `/login`.

- [ ] **Step 4: Commit**

```bash
git add dewey_time/www/home.py dewey_time/hooks.py
git commit -m "feat(home): serve /home SPA with Guest gating + route rules"
```

---

## Task 5: Sync `public/home` assets on migrate

**Files:**
- Modify: `dewey_time/utils/sync_hr_attendance_assets.py` (extract a reusable copy helper)
- Create: `dewey_time/utils/sync_home_assets.py`
- Modify: `dewey_time/hooks.py` (`after_migrate`)

**Interfaces:**
- Consumes: the existing copy logic in `sync_hr_attendance_assets`.
- Produces: `sync_home_assets()` callable that copies `public/home` → `sites/assets/dewey_time/home` on `after_migrate`.

- [ ] **Step 1: Read `dewey_time/utils/sync_hr_attendance_assets.py`** and identify the copy routine that moves `public/hr_attendance` into `sites/assets/dewey_time/hr_attendance`.

- [ ] **Step 2: Generalize** — extract that routine into a module-level helper `def _sync_public_subdir(subdir: str):` (parameterizing the `hr_attendance` literal), and make `sync_hr_attendance_assets()` call `_sync_public_subdir("hr_attendance")`. Keep the logo constants (`SITE_FAVICON_LOGO`, `ATTENDANCE_APP_LOGO`, `ADMS_APP_LOGO`) unchanged.

- [ ] **Step 3: Create `dewey_time/utils/sync_home_assets.py`**

```python
from dewey_time.utils.sync_hr_attendance_assets import _sync_public_subdir


def sync_home_assets():
    """Copy built /home SPA assets into sites/assets on migrate."""
    _sync_public_subdir("home")
```

- [ ] **Step 4: Wire `after_migrate`** — in `dewey_time/hooks.py`, add to the list:

```python
after_migrate = [
    "dewey_time.setup.custom_fields.make_custom_fields",
    "dewey_time.utils.sync_hr_attendance_assets.sync_hr_attendance_assets",
    "dewey_time.utils.sync_home_assets.sync_home_assets",
    "dewey_time.utils.sync_adms_assets.sync_adms_assets",
    "dewey_time.attendance_engine.dashboard_auth.ensure_adms_roles",
    "dewey_time.webpush.ensure_vapid_keys",
]
```

- [ ] **Step 5: Verify**

```bash
bench --site <site> migrate
ls sites/assets/dewey_time/home/assets   # expect index.js, index.css
```

- [ ] **Step 6: Commit**

```bash
git add dewey_time/utils/sync_hr_attendance_assets.py dewey_time/utils/sync_home_assets.py dewey_time/hooks.py
git commit -m "feat(home): sync /home assets to sites/assets on migrate"
```

---

## Task 6: Delete the orphaned `hr-personal.html`

**Files:**
- Delete: `dewey_time/www/hr-personal.html`
- Modify: the brand-wiring test that asserts its favicon.

- [ ] **Step 1: Find the asserting test**

Run: `grep -rn "hr-personal" dewey_time/`
Expected: a reference in `frontend/hr_attendance/.../brandWiring.test.ts` (and the file itself).

- [ ] **Step 2: Delete the file**

```bash
git rm dewey_time/www/hr-personal.html
```

- [ ] **Step 3: Remove the `hr-personal` assertion** from `brandWiring.test.ts` (delete only the lines that reference `hr-personal`; leave the other favicon assertions).

- [ ] **Step 4: Run the brand-wiring test**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:web
```
Expected: PASS (no `hr-personal` reference remains).

- [ ] **Step 5: Commit**

```bash
git add -A dewey_time/www dewey_time/frontend/hr_attendance
git commit -m "chore(home): remove orphaned hr-personal.html shell"
```

---

## Task 7: Pilot the landing, then go global (kill-switch)

No code; ordered ops steps. Validates real v16 landing for both user types before any broad change.

- [ ] **Step 1: Pilot on a test Role** — Frappe Cloud → site → **Login as Administrator**. In Desk: create Role `Home Landing Test` (desk_access = your choice), set its **Home Page** = `/home`. Assign it to **one throwaway test user only**.

- [ ] **Step 2: Clear cache + verify** — Frappe Cloud → site → **Clear Cache**. In an incognito window, log in as the test user → confirm landing on `/home` with the right tiles. Confirm a normal user is unaffected.

- [ ] **Step 3: Confirm the global knob** — verify which DB-settable home reliably lands **both** System and Website users on `/home` (Website Settings `home_page`; if Website Users bypass it via `get_default_path()`, fall back to role-based assignment). Document the working knob.

- [ ] **Step 4: Go global** — set the confirmed DB home value; Clear Cache; spot-check one user of each type.

- [ ] **Step 5: Record the kill-switch** — note the exact field to blank for instant revert (no deploy), in `docs/` or the runbook.

---

## Self-Review

- **Spec coverage:** Landing (Task 7) · Registry curated (Task 1, reads `add_to_apps_screen`) · Gating + fail policy (Task 1) · Resolver thin/forward-compatible (Task 1) · Rendering React SPA in-repo (Tasks 3–5) · Robustness: never-500 (Task 1), static shell + states + safety net (Task 3 `Launcher.tsx`), empty state (Task 3), kill-switch (Task 7) · Shared dial (Task 2) · Cleanup (Task 6). All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO; every code step has real code; `<pat>`/`<site>` are intentional user-supplied secrets, not code placeholders.
- **Type consistency:** `get_launcher()` return shape in Task 1 matches `LauncherData` in Task 3 (`user.full_name`, `user.initials`, `apps[].{name,title,route,logo,admin}`). `_has_desk_access`, `_is_hr_staff`, `_employee_linked_to_user` names are consistent between `launcher.py` and the test patches.
- **Known verify-on-bench points (flagged, not placeholders):** the exact global-landing knob (Task 7 Step 3); `_has_desk_access` role-field approach (framework alt noted in code); generalizing the asset-sync helper requires reading the real file first (Task 5 Step 1).
