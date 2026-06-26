# dewey_portal Extraction Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This plan spans **two repos**: `dewey_time` (this repo, branch `feat/dewey-portal-extraction`) and a **new sibling repo** `dewey-portal` at `/Users/lolbikb/projects/dewey-portal`.

**Goal:** Relocate the company portal (`/login`, `/home`, `Launcher Tile` registry, resolver, sync, landing, tile role-picker) out of `dewey_time` into a new neutral Frappe app `dewey_portal`, leaving `dewey_time` as the pure HR product — with the portal importing zero product code.

**Architecture:** New `dewey_portal` app (module "Dewey Portal", repo `/Users/lolbikb/projects/dewey-portal`). Backend Python in `dewey_portal/portal/`; DocTypes under `dewey_portal/dewey_portal/doctype/`; assets under `dewey_portal/public/`; SPA in `dewey_portal/frontend/home/`. The portal calls `dewey_time`'s gates only by dotted path via `frappe.get_attr` (runtime, no import) and aggregates two hooks `dewey_time` publishes (`dewey_launcher_tiles`, `dewey_portal_access_roles`).

**Tech Stack:** Frappe v16 app (Python 3.10+), mock-based `unittest` (no bench), React 19 + Vite (home SPA).

## Global Constraints

- This environment has **no bench** — install/migrate/Frappe-Cloud cannot run here. MVP = code complete + unit tests green + SPA builds + cutover runbook written. The live cutover is the user's step.
- The portal imports **zero `dewey_time` product code** (only `frappe`). Gates resolve by dotted path at runtime; product role labels arrive via the `dewey_portal_access_roles` hook.
- Portal Python whitelisted-method paths are `dewey_portal.portal.<module>.<fn>` (e.g. `dewey_portal.portal.launcher.get_launcher`).
- DocTypes `Launcher Tile`/`Launcher Tile Role` move to module **"Dewey Portal"** with a fresh `modified` timestamp (`2026-06-26 ...`) so migrate reimports.
- Asset namespace in moved files: `/assets/dewey_time/` → `/assets/dewey_portal/`. SPA method strings: `dewey_time.attendance_engine.{launcher,access,landing}` → `dewey_portal.portal.{launcher,access,landing}`.
- `dewey_time` KEEPS: `launcher_gates.py`, the `dewey_launcher_tiles` hook, the new `dewey_portal_access_roles` hook, all HR/ADMS code, the ADMS bundle. Tile-icon images stay in `dewey_time` (the hook stays there).
- Git: scoped `git add <exact paths>` only; never `git add -A`/`.`; never `checkout`/`switch`/`pull`/`reset` other branches. In `dewey_time` the untracked PNGs / schedule files are the user's — never touch. Each repo commits independently on its own branch.
- Do NOT run `npm install` in the portal — the moved `node_modules` is reused (avoids the GitHub-Packages token). Never echo tokens/`.npmrc`.

---

## File Structure (target `dewey_portal` repo)

```
dewey-portal/
  pyproject.toml, setup.py, MANIFEST.in, README.md, LICENSE, .gitignore
  dewey_portal/
    __init__.py            # __version__ = "0.0.1"
    hooks.py               # app meta, web_include_css, /home routes, after_migrate
    modules.txt            # "Dewey Portal"
    patches.txt            # dewey_portal.patches.reset_broken_website_theme
    patches/__init__.py, patches/reset_broken_website_theme.py
    portal/                # backend package
      __init__.py, launcher.py, launcher_sync.py, landing.py, access.py
    utils/__init__.py, utils/sync_home_assets.py
    dewey_portal/          # module "Dewey Portal"
      __init__.py
      doctype/__init__.py
        launcher_tile/(…json/.py/__init__.py), launcher_tile_role/(…)
    tests/
      __init__.py, frappe_mock.py, test_launcher.py, test_launcher_sync.py,
      test_landing.py, test_access.py, test_hooks_portal.py
    public/
      home/(built bundle), css/login_brand.css + geist-*.woff2,
      images/DI-logo.svg (+ any chrome svgs the SPA renders)
    www/home.html, www/home.py
    frontend/home/(SPA source + node_modules, vite base → /assets/dewey_portal/home/)
```

---

## Stage A — Scaffold the `dewey_portal` repo

### Task A1: Create the Frappe app skeleton + git repo

**Files (all under `/Users/lolbikb/projects/dewey-portal/`):** create the package skeleton below.

- [ ] **Step 1: Create the directory tree + package `__init__.py` files**

```bash
mkdir -p /Users/lolbikb/projects/dewey-portal/dewey_portal/{portal,utils,patches,tests,dewey_portal/doctype,public/css,public/images,www,frontend}
cd /Users/lolbikb/projects/dewey-portal
for d in dewey_portal dewey_portal/portal dewey_portal/utils dewey_portal/patches dewey_portal/tests dewey_portal/dewey_portal dewey_portal/dewey_portal/doctype; do touch "$d/__init__.py"; done
printf '%s\n' '__version__ = "0.0.1"' > dewey_portal/__init__.py
printf '%s\n' 'Dewey Portal' > dewey_portal/modules.txt
printf '%s\n' 'dewey_portal.patches.reset_broken_website_theme' > dewey_portal/patches.txt
```

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "dewey_portal"
version = "0.0.1"
description = "Dewey International portal — login + home launcher (Frappe v16)"
readme = "README.md"
requires-python = ">=3.10"
license = { file = "LICENSE" }

[tool.setuptools]
include-package-data = true

[tool.setuptools.packages.find]
include = ["dewey_portal", "dewey_portal.*"]

[tool.bench.frappe-dependencies]
frappe = ">=16.0.0,<17.0.0"
```

- [ ] **Step 3: Write `setup.py`, `MANIFEST.in`, `README.md`, `LICENSE`, `.gitignore`**

`setup.py`:
```python
from setuptools import find_packages, setup

setup(
    name="dewey_portal",
    version="0.0.1",
    description="Dewey International portal — login + home launcher (Frappe v16)",
    packages=find_packages(include=["dewey_portal", "dewey_portal.*"]),
    include_package_data=True,
    zip_safe=False,
)
```
`MANIFEST.in`:
```
recursive-include dewey_portal *.json *.js *.css *.html *.md *.png *.jpg *.svg *.txt *.woff2
recursive-include dewey_portal *.py
include README.md
include LICENSE
```
`README.md`: one line — `# dewey_portal\n\nDewey International portal (login + /home launcher). Extracted from dewey_time (Phase 2).`
`LICENSE`: copy `/Users/lolbikb/projects/dewey-time/LICENSE` verbatim.
`.gitignore`:
```
dewey_portal/frontend/*/node_modules/
**/__pycache__/
*.egg-info/
.DS_Store
.claude/
.superpowers/
```

- [ ] **Step 4: Write `dewey_portal/hooks.py`**

```python
app_name = "dewey_portal"
app_title = "Dewey Portal"
app_publisher = "Dewey International"
app_description = "Company portal — login + home launcher"
app_email = "noreply@example.com"
app_license = "MIT"

app_logo_url = "/assets/dewey_portal/images/DI-logo.svg"

website_context = {
    "favicon": "/assets/dewey_portal/images/DI-logo.svg",
    "splash_image": "/assets/dewey_portal/images/DI-logo.svg",
}

# Branded /login reskin (scoped to .for-login inside the CSS). ?v= busts the
# Frappe Cloud immutable asset cache — bump on every login_brand.css change.
web_include_css = ["/assets/dewey_portal/css/login_brand.css?v=1"]

# /home SPA client-side routing.
website_route_rules = [
    {"from_route": "/home/<path:app_path>", "to_route": "home"},
    {"from_route": "/home", "to_route": "home"},
]

after_migrate = [
    "dewey_portal.utils.sync_home_assets.sync_home_assets",
    "dewey_portal.portal.launcher_sync.sync_launcher_tiles",
]
```

- [ ] **Step 5: Init git + initial commit**

```bash
cd /Users/lolbikb/projects/dewey-portal
git init -q
git add -A
git commit -q -m "chore(portal): scaffold dewey_portal Frappe app skeleton

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```
Expected: one commit; `python3.13 -c "import ast; ast.parse(open('dewey_portal/hooks.py').read()); print('hooks ok')"` prints `hooks ok`.

---

## Stage B — Move the backend + DocTypes + port tests

### Task B1: Move backend modules into `dewey_portal/portal/` with seam edits

**Source (dewey_time) → Dest (dewey_portal):**
- `dewey_time/attendance_engine/launcher.py` → `dewey_portal/portal/launcher.py`
- `dewey_time/attendance_engine/launcher_sync.py` → `dewey_portal/portal/launcher_sync.py`
- `dewey_time/attendance_engine/landing.py` → `dewey_portal/portal/landing.py`
- `dewey_time/attendance_engine/access.py` → `dewey_portal/portal/access.py`
- `dewey_time/utils/sync_home_assets.py` → `dewey_portal/utils/sync_home_assets.py`

- [ ] **Step 1: Copy the five files to their dest paths** (read each source, write to dest verbatim).

- [ ] **Step 2: Edit `launcher.py` — drop the avatar product import**

Remove the import line `from dewey_time.attendance_engine.hr_calendar import _employee_linked_to_user`. Replace the `_user_image()` body with a User-image-only version:
```python
def _user_image() -> str | None:
    try:
        return frappe.db.get_value("User", frappe.session.user, "user_image") or None
    except Exception:
        frappe.log_error(title="launcher user image lookup failed")
        return None
```
(The gate dispatch is unchanged — it resolves `dewey_time.…launcher_gates.*` via `frappe.get_attr` at runtime, no import.)

- [ ] **Step 3: Edit `access.py` — drop product imports, aggregate the access-roles hook**

Remove both imports (`from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES as ADMS_ROLES` and `from dewey_time.attendance_engine.hr_calendar import HR_STAFF_ROLES`). Replace `get_access_overview` so the role groups come from the hook instead of constants:
```python
def _role_groups():
    """[(label, set(roles))] from the dewey_portal_access_roles hook across apps."""
    groups = []
    for entry in frappe.get_hooks("dewey_portal_access_roles") or []:
        label = entry.get("label") if isinstance(entry, dict) else None
        roles = entry.get("roles") if isinstance(entry, dict) else None
        if label and roles:
            groups.append((label, set(roles)))
    return groups


@frappe.whitelist()
def get_access_overview():
    frappe.only_for("System Manager")
    groups = _role_groups()
    group_roles = set().union(*[r for _l, r in groups]) if groups else set()
    landing_roles = set(
        frappe.get_all(
            "Role",
            filters={"home_page": ["in", [_LANDING_VALUE, "/" + _LANDING_VALUE]]},
            pluck="name",
        )
    )
    interesting = group_roles | landing_roles
    if not interesting:
        return {"users": [], "groups": [l for l, _r in groups]}

    by_user = defaultdict(set)
    for row in frappe.get_all(
        "Has Role", filters={"role": ["in", list(interesting)]}, fields=["parent", "role"]
    ):
        by_user[row["parent"]].add(row["role"])
    if not by_user:
        return {"users": [], "groups": [l for l, _r in groups]}

    info = {
        u["name"]: u
        for u in frappe.get_all(
            "User",
            filters={"name": ["in", list(by_user)], "enabled": 1},
            fields=["name", "full_name", "user_type"],
        )
    }
    users = []
    for user, uroles in by_user.items():
        u = info.get(user)
        if not u:
            continue
        row = {
            "user": user,
            "full_name": u.get("full_name") or user,
            "desk": u.get("user_type") == "System User",
            "lands_on_home": bool(uroles & landing_roles),
            "roles": sorted(uroles & interesting),
        }
        for label, roles in groups:
            row[label.lower()] = bool(uroles & roles)
        users.append(row)
    users.sort(key=lambda r: r["full_name"].lower())
    return {"users": users, "groups": [l for l, _r in groups]}
```
(Keep `get_assignable_roles`, `get_tile_roles`, `set_tile_roles`, and `_PSEUDO_ROLES`/`_LANDING_VALUE` unchanged.)

- [ ] **Step 4: Edit `sync_home_assets.py`** — replace every `dewey_time` / `/assets/dewey_time` reference with `dewey_portal` / `/assets/dewey_portal`. (Read it; rewrite the app-name string(s) + asset path(s) so it syncs `dewey_portal/public/home` → `sites/assets/dewey_portal/home`.) If it imports helpers from `dewey_time.utils.sync_hr_attendance_assets`, inline the small helpers it needs into this file so it has no `dewey_time` import.

- [ ] **Step 5: Verify import-cleanliness + syntax**

```bash
cd /Users/lolbikb/projects/dewey-portal
grep -rn "dewey_time" dewey_portal/portal dewey_portal/utils || echo "NO dewey_time refs — clean"
python3.13 -c "import ast,glob; [ast.parse(open(f).read()) for f in glob.glob('dewey_portal/portal/*.py')+glob.glob('dewey_portal/utils/*.py')]; print('syntax ok')"
```
Expected: `NO dewey_time refs — clean` and `syntax ok`. (Only allowed `dewey_time` strings are dotted gate paths *inside string literals* in launcher.py if any — there are none; gate paths arrive from the hook at runtime.)

- [ ] **Step 6: Commit** (in the portal repo)
```bash
cd /Users/lolbikb/projects/dewey-portal
git add dewey_portal/portal dewey_portal/utils
git commit -q -m "feat(portal): backend modules (launcher/sync/landing/access, user-image avatar, access-roles hook)"
```

### Task B2: Move the DocTypes into module "Dewey Portal"

- [ ] **Step 1: Copy the doctype dirs**
```bash
cp -R /Users/lolbikb/projects/dewey-time/dewey_time/dewey_time/doctype/launcher_tile /Users/lolbikb/projects/dewey-portal/dewey_portal/dewey_portal/doctype/
cp -R /Users/lolbikb/projects/dewey-time/dewey_time/dewey_time/doctype/launcher_tile_role /Users/lolbikb/projects/dewey-portal/dewey_portal/dewey_portal/doctype/
```
- [ ] **Step 2: Re-home both JSONs** — in `launcher_tile/launcher_tile.json` and `launcher_tile_role/launcher_tile_role.json` set `"module": "Dewey Portal"` (was "Dewey Time") and `"modified": "2026-06-26 00:00:00.000000"`. Leave all fields/permissions intact.
- [ ] **Step 3: Verify**
```bash
cd /Users/lolbikb/projects/dewey-portal
python3.13 -c "import json; a=json.load(open('dewey_portal/dewey_portal/doctype/launcher_tile/launcher_tile.json')); b=json.load(open('dewey_portal/dewey_portal/doctype/launcher_tile_role/launcher_tile_role.json')); assert a['module']==b['module']=='Dewey Portal'; assert a['modified']=='2026-06-26 00:00:00.000000'; print('doctypes re-homed OK')"
```
- [ ] **Step 4: Commit**
```bash
git add dewey_portal/dewey_portal
git commit -q -m "feat(portal): Launcher Tile + Launcher Tile Role doctypes under module Dewey Portal"
```

### Task B3: Port the backend test suites + the mock helper

- [ ] **Step 1: Create `dewey_portal/tests/frappe_mock.py`** — copy the `_install_frappe_mock` function (and any module-level helpers it depends on) verbatim from `dewey_time/tests/test_closeout.py`, so portal tests need no `dewey_time` import. Export `_install_frappe_mock`.

- [ ] **Step 2: Port the tests** — copy `dewey_time/tests/{test_launcher.py,test_launcher_sync.py,test_landing.py}` and the access test (`dewey_time/tests/test_access.py` if present) into `dewey_portal/tests/`. In each: change `from dewey_time.tests.test_closeout import _install_frappe_mock` → `from dewey_portal.tests.frappe_mock import _install_frappe_mock`; change `from dewey_time.attendance_engine import <mod> as mod` → `from dewey_portal.portal import <mod> as mod`; rewrite any other `dewey_time.attendance_engine.{launcher,launcher_sync,landing,access}` strings → `dewey_portal.portal.…`. For `test_launcher.py`'s `_user_image` tests, drop the employee-photo cases and keep only the User-image / None cases (matching the new avatar logic). For `test_access.py`, adapt `get_access_overview` expectations to the hook-driven shape (`groups` from a patched `frappe.get_hooks("dewey_portal_access_roles")`).

- [ ] **Step 3: Run the ported suites**
```bash
cd /Users/lolbikb/projects/dewey-portal
python3.13 -m unittest dewey_portal.tests.test_launcher dewey_portal.tests.test_launcher_sync dewey_portal.tests.test_landing dewey_portal.tests.test_access -v
```
Expected: all green. (If `test_access`/`test_landing` don't exist in dewey_time, port only what exists and note it.)

- [ ] **Step 4: Commit**
```bash
git add dewey_portal/tests
git commit -q -m "test(portal): port launcher/sync/landing/access suites + standalone frappe mock"
```

---

## Stage C — Move the SPA + login + assets

### Task C1: Move chrome assets (login CSS, fonts, images) with path rewrites

- [ ] **Step 1: Copy assets**
```bash
cp /Users/lolbikb/projects/dewey-time/dewey_time/public/css/login_brand.css /Users/lolbikb/projects/dewey-portal/dewey_portal/public/css/
cp /Users/lolbikb/projects/dewey-time/dewey_time/public/css/geist-latin.woff2 /Users/lolbikb/projects/dewey-time/dewey_time/public/css/geist-latin-ext.woff2 /Users/lolbikb/projects/dewey-portal/dewey_portal/public/css/
cp /Users/lolbikb/projects/dewey-time/dewey_time/public/images/DI-logo.svg /Users/lolbikb/projects/dewey-portal/dewey_portal/public/images/
```
- [ ] **Step 2: Rewrite `login_brand.css`** — replace every `/assets/dewey_time/` with `/assets/dewey_portal/` (the 2 font/image refs).
- [ ] **Step 3: Move the theme-reset patch** — copy `dewey_time/patches/reset_broken_website_theme.py` → `dewey_portal/patches/reset_broken_website_theme.py`; if it references `dewey_time` anywhere, rewrite to `dewey_portal` (it should be app-agnostic — a Website Settings reset).
- [ ] **Step 4: Verify + commit**
```bash
cd /Users/lolbikb/projects/dewey-portal
grep -c "/assets/dewey_portal" dewey_portal/public/css/login_brand.css; grep -c "/assets/dewey_time" dewey_portal/public/css/login_brand.css || true
git add dewey_portal/public/css dewey_portal/public/images dewey_portal/patches
git commit -q -m "feat(portal): login reskin css + Geist fonts + DI logo + theme-reset patch"
```
Expected: `/assets/dewey_portal` count ≥2, `/assets/dewey_time` count 0.

### Task C2: Move the SPA source, vendor brand tokens, rewrite paths/methods

- [ ] **Step 1: Copy the SPA tree (incl. node_modules so build needs no install)**
```bash
cp -R /Users/lolbikb/projects/dewey-time/dewey_time/frontend/home /Users/lolbikb/projects/dewey-portal/dewey_portal/frontend/home
cp /Users/lolbikb/projects/dewey-time/dewey_time/www/home.html /Users/lolbikb/projects/dewey-time/dewey_time/www/home.py /Users/lolbikb/projects/dewey-portal/dewey_portal/www/
mkdir -p /Users/lolbikb/projects/dewey-portal/dewey_portal/frontend/home/src/brand
cp /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance/src/brand/tokens.css /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance/src/brand/base.css /Users/lolbikb/projects/dewey-portal/dewey_portal/frontend/home/src/brand/
```
- [ ] **Step 2: Vendor brand tokens in `index.css`** — change `@import "../../hr_attendance/src/brand/tokens.css";` (and the `base.css` import if present) to local `@import "./brand/tokens.css";` / `@import "./brand/base.css";`. Rewrite `/assets/dewey_time/` → `/assets/dewey_portal/`.
- [ ] **Step 3: Rewrite the Vite config** — in `frontend/home/vite.config.ts`, change the build base `"/assets/dewey_time/home/"` → `"/assets/dewey_portal/home/"`. (`outDir: ../../public/home` stays — it now resolves inside the portal repo.)
- [ ] **Step 4: Rewrite SPA asset + method strings** — in `frontend/home/src/*` replace `/assets/dewey_time/` → `/assets/dewey_portal/` and `dewey_time.attendance_engine.` → `dewey_portal.portal.` (covers the `get_launcher`, access role-picker, and landing method constants in `Launcher.tsx`, `AdminTiles.tsx`, `LandingControl.tsx`, `AccessOverview.tsx`). Rewrite the same in `www/home.html`.
- [ ] **Step 5: Verify no stale refs**
```bash
cd /Users/lolbikb/projects/dewey-portal/dewey_portal/frontend/home
grep -rn "dewey_time\|hr_attendance/src/brand" src www 2>/dev/null || echo "clean"
grep -rn "dewey_time" /Users/lolbikb/projects/dewey-portal/dewey_portal/www/home.html || echo "www clean"
```
Expected: `clean` (no `dewey_time` / cross-app brand import remains).
- [ ] **Step 6: Commit**
```bash
cd /Users/lolbikb/projects/dewey-portal
git add dewey_portal/frontend/home dewey_portal/www
git commit -q -m "feat(portal): home SPA + www entry; vendored brand tokens; dewey_portal asset/method paths"
```

### Task C3: Build the SPA + commit the bundle

- [ ] **Step 1: Type-check + build (reusing the moved node_modules — do NOT npm install)**
```bash
cd /Users/lolbikb/projects/dewey-portal/dewey_portal/frontend/home
npx tsc --noEmit
npm run build
```
Expected: `tsc` no source errors; Vite build writes `dewey_portal/public/home/assets/index.{js,css}`; `copy-html-entry.mjs` rewrites `www/home.html` with a `?v=` bust. (If `copy-html-entry.mjs` hardcodes a `dewey_time` path, fix it to `dewey_portal` and rebuild.)
- [ ] **Step 2: Verify the built bundle references dewey_portal assets**
```bash
grep -c "/assets/dewey_portal/home" /Users/lolbikb/projects/dewey-portal/dewey_portal/public/home/index.html
grep -rl "dewey_time" /Users/lolbikb/projects/dewey-portal/dewey_portal/public/home/ || echo "bundle clean of dewey_time"
```
Expected: ≥1 and `bundle clean of dewey_time`.
- [ ] **Step 3: Commit**
```bash
cd /Users/lolbikb/projects/dewey-portal
git add dewey_portal/public/home dewey_portal/www/home.html
git commit -q -m "build(portal): home SPA bundle under /assets/dewey_portal/home"
```

### Task C4: Portal wiring test

- [ ] **Step 1: Create `dewey_portal/tests/test_hooks_portal.py`** asserting the portal `hooks.py` is well-formed: `web_include_css` points at `/assets/dewey_portal/css/login_brand.css?...`; `website_route_rules` contains both `/home` rules; `after_migrate` contains `dewey_portal.utils.sync_home_assets.sync_home_assets` and `dewey_portal.portal.launcher_sync.sync_launcher_tiles`. Use the `frappe_mock` helper to import `dewey_portal.hooks`.
- [ ] **Step 2: Run + commit**
```bash
cd /Users/lolbikb/projects/dewey-portal
python3.13 -m unittest dewey_portal.tests.test_hooks_portal -v
git add dewey_portal/tests/test_hooks_portal.py
git commit -q -m "test(portal): hooks wiring (web_include_css, /home routes, after_migrate)"
```

---

## Stage D — `dewey_time`: publish the access-roles hook (TDD)

### Task D1: Add `dewey_portal_access_roles` hook to dewey_time

**Repo:** `dewey_time` (branch `feat/dewey-portal-extraction`).
**Files:** Modify `dewey_time/hooks.py`; Test `dewey_time/tests/test_hooks_launcher_tiles.py` (extend).

**Interfaces:**
- Produces: `dewey_portal_access_roles = [{"label", "roles"}]` — consumed by the portal's `access.get_access_overview` (Task B1 Step 3) via `frappe.get_hooks`.

- [ ] **Step 1: Extend the wiring test** — in `dewey_time/tests/test_hooks_launcher_tiles.py` add:
```python
    def test_access_roles_hook_well_formed(self):
        groups = hooks.dewey_portal_access_roles
        self.assertIsInstance(groups, list)
        labels = {g["label"] for g in groups}
        self.assertIn("HR", labels)
        self.assertIn("ADMS", labels)
        for g in groups:
            self.assertIsInstance(g["roles"], (list, tuple))
            self.assertTrue(g["roles"])
```
- [ ] **Step 2: Run → RED** (`AttributeError: … has no attribute 'dewey_portal_access_roles'`):
`cd /Users/lolbikb/projects/dewey-time && python3.13 -m unittest dewey_time.tests.test_hooks_launcher_tiles -v`
- [ ] **Step 3: Add the hook to `dewey_time/hooks.py`** — add near `dewey_launcher_tiles`:
```python
# Role groups the portal's Access overview labels users by. The portal aggregates
# this hook (frappe.get_hooks) so it needs no import of dewey_time's role sets.
from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES as _ADMS_ROLES
from dewey_time.attendance_engine.hr_calendar import HR_STAFF_ROLES as _HR_ROLES

dewey_portal_access_roles = [
    {"label": "HR", "roles": sorted(_HR_ROLES)},
    {"label": "ADMS", "roles": sorted(_ADMS_ROLES)},
]
```
(Place the two imports with the other top-of-file imports; keep them module-level.)
- [ ] **Step 4: Run → GREEN** (same command). Then full launcher-related suite still green:
`python3.13 -m unittest dewey_time.tests.test_launcher_gates dewey_time.tests.test_hooks_launcher_tiles -v`
- [ ] **Step 5: Commit**
```bash
git add dewey_time/hooks.py dewey_time/tests/test_hooks_launcher_tiles.py
git commit -m "feat(launcher): publish dewey_portal_access_roles hook for the portal's access overview"
```

---

## Stage E — Slim `dewey_time` (remove the moved portal)

### Task E1: Delete moved files + strip portal hooks/patches

**Repo:** `dewey_time` (branch `feat/dewey-portal-extraction`).

- [ ] **Step 1: Remove moved code/assets** (`git rm`)
```bash
cd /Users/lolbikb/projects/dewey-time
git rm -r dewey_time/frontend/home dewey_time/public/home dewey_time/www/home.html dewey_time/www/home.py
git rm dewey_time/public/css/login_brand.css
git rm dewey_time/attendance_engine/launcher.py dewey_time/attendance_engine/launcher_sync.py dewey_time/attendance_engine/landing.py dewey_time/attendance_engine/access.py
git rm dewey_time/utils/sync_home_assets.py
git rm -r dewey_time/dewey_time/doctype/launcher_tile dewey_time/dewey_time/doctype/launcher_tile_role
git rm dewey_time/patches/reset_broken_website_theme.py
```
(Leave the Geist `geist-*.woff2` and `images/DI-logo.svg` in dewey_time — dewey_time still uses DI-logo for its favicon/tile icons and may use Geist elsewhere. Removing them is a separate cleanup; out of scope.)

- [ ] **Step 2: Edit `dewey_time/hooks.py`** — remove these entries:
  - the whole `web_include_css = [...]` line;
  - the two `/home` rules from `website_route_rules` (keep the hr-attendance/hr-schedule rules);
  - from `after_migrate`, remove `"dewey_time.utils.sync_home_assets.sync_home_assets"` and `"dewey_time.attendance_engine.launcher_sync.sync_launcher_tiles"`.
  Keep `dewey_launcher_tiles`, `dewey_portal_access_roles`, `add_to_apps_screen`, `doc_events`, `scheduler_events`, the remaining `after_migrate` entries, and the website favicon context.

- [ ] **Step 3: Edit `dewey_time/patches.txt`** — remove the line `dewey_time.patches.reset_broken_website_theme`.

- [ ] **Step 4: Remove/retarget moved tests** — `git rm dewey_time/tests/test_launcher.py dewey_time/tests/test_launcher_sync.py` (ported to portal); if `test_landing.py`/`test_access.py` exist, `git rm` them too. In `dewey_time/tests/test_hooks_launcher_tiles.py` **delete** the `test_sync_registered_in_after_migrate` test (the sync moved to the portal); keep the `dewey_launcher_tiles` + `dewey_portal_access_roles` assertions.

- [ ] **Step 5: Verify dewey_time still imports + its suite is green**
```bash
cd /Users/lolbikb/projects/dewey-time
grep -rn "launcher\b\|launcher_sync\|sync_home_assets\|attendance_engine.landing\|attendance_engine.access\|/home\b\|login_brand" dewey_time/hooks.py dewey_time/patches.txt || echo "hooks/patches clean of portal refs"
python3.13 -c "import ast; ast.parse(open('dewey_time/hooks.py').read()); print('hooks.py ok')"
python3.13 -m unittest dewey_time.tests.test_launcher_gates dewey_time.tests.test_hooks_launcher_tiles -v
```
Expected: clean; `hooks.py ok`; tests green.

- [ ] **Step 6: Confirm nothing else in dewey_time imports the removed modules**
```bash
grep -rn "attendance_engine.launcher\b\|attendance_engine.launcher_sync\|attendance_engine.landing\|attendance_engine.access\|utils.sync_home_assets" dewey_time --include=*.py | grep -v "/tests/" || echo "no dangling imports"
```
Expected: `no dangling imports`. (If any appear, they are real breakage — fix or report.)

- [ ] **Step 7: Commit**
```bash
git add -u dewey_time/hooks.py dewey_time/patches.txt
git add dewey_time/tests/test_hooks_launcher_tiles.py
git commit -m "refactor(dewey_time): remove portal (home/login/launcher/landing/access) — moved to dewey_portal"
```
(The `git rm` deletions from Steps 1 & 4 are already staged; this commits them together. Use `git status` first to confirm ONLY portal files + hooks/patches/tests are staged — no user PNGs/schedule files.)

---

## Stage F — Cutover runbook

### Task F1: Write the cutover runbook

- [ ] **Step 1: Create `dewey_time/docs/DEWEY_PORTAL_CUTOVER.md`** documenting the user's bench/Cloud steps:
  1. Get the app onto the bench: `bench get-app /path/to/dewey-portal` (or the GitHub URL once pushed); `bench --site <site> install-app dewey_portal`.
  2. Frappe Cloud: add `dewey_portal` to the bench group; deploy `dewey_portal` **and** the slimmed `dewey_time` in the **same** deploy.
  3. `bench --site <site> migrate` — portal DocType import re-homes `Launcher Tile`/`Launcher Tile Role` to module "Dewey Portal" (records persist in the table); `after_migrate` runs `sync_home_assets` + `sync_launcher_tiles`; `/home` + `/login` now serve from the portal; assets under `/assets/dewey_portal`.
  4. `bench --site <site> clear-cache`.
  5. Smoke: `/login` (brand reskin), `/home` (tiles render + per-persona gating), `/home/admin` (managed badge; Landing; Access). Confirm `select count(*) from \`tabLauncher Tile\`` is unchanged from before.
  6. Rollback: re-deploy the previous images (pre-slim `dewey_time`, no `dewey_portal`); the `tabLauncher Tile` table is untouched by a rollback.
- [ ] **Step 2: Commit**
```bash
cd /Users/lolbikb/projects/dewey-time
git add dewey_time/docs/DEWEY_PORTAL_CUTOVER.md
git commit -m "docs(portal): dewey_portal cutover runbook (bench/Cloud)"
```

---

## Self-Review

**Spec coverage:** target shape (Stage A,B,C) ✓; untie 3 seams — avatar B1.2, access-roles B1.3+D1, role-picker/landing move B1.1 ✓; brand tokens C2.1-2 ✓; asset namespace C ✓; DocType move + data safety B2 + runbook F ✓; slim dewey_time E ✓; cutover runbook F ✓; testing B3/C4/D1/E5 ✓; out-of-scope respected (no live cutover, no avatar-hook, no dewey-ui hoist, no route rename) ✓.

**Placeholder scan:** new code shown in full (portal hooks.py, access aggregation, avatar, access-roles hook, scaffold); moves are exact source→dest + explicit rewrite rules; verification commands concrete. No TBD.

**Consistency:** method paths `dewey_portal.portal.<mod>` used identically in B1 (backend), B3 (tests), C2 (SPA strings), C4 (wiring). DocType module "Dewey Portal" + `modified 2026-06-26` consistent B2/spec. `dewey_portal_access_roles` shape `{label, roles}` identical in D1 (producer) and B1.3 (consumer). after_migrate entries identical in A4 (hooks) and C4 (test).
