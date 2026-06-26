# Launcher Registration Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/home` launcher pluggable — any installed Dewey app contributes tiles (and owns each tile's visibility gate) via a `dewey_launcher_tiles` hook, reconciled into the `Launcher Tile` DocType — all built inside `dewey_time` (no new app, no moved files).

**Architecture:** Apps publish `dewey_launcher_tiles` in `hooks.py`. An `after_migrate` reconcile (`sync_launcher_tiles`) upserts code-owned fields into `Launcher Tile` rows while preserving admin-owned `enabled`/`tile_order`, and prunes tiles whose app is gone. `get_launcher` reads enabled rows and dispatches each tile's `gate` — a built-in name (`desk`/`roles`) or a dotted path to an app-owned `() -> bool` — with fail-open (broad) / fail-closed (admin) policy. `dewey_time` registers itself (Dewey Time, ADMS, Desk) like any other app; its HR/ADMS gate predicates move into a module it owns.

**Tech Stack:** Python 3 (Frappe v16), mock-based `unittest` (no bench needed), React 19 + TypeScript + Vite (home SPA).

## Global Constraints

- The launcher tile for the attendance product is titled **"Dewey Time"** — never "HR Attendance" in any user-visible string.
- Gating is **cosmetic**; policy is **fail-open for broad tiles (`is_admin` false), fail-closed for admin tiles (`is_admin` true)** — preserve exactly.
- Gate resolution order: built-in (`desk`, `roles`) → dotted path (contains `.`) via `frappe.get_attr` → else **skip the tile**.
- Reconcile, **never replace**: code owns `title`/`route`/`icon`/`is_admin`/`gate`/`source_app`; admin owns `enabled` (default 1 on insert) and `tile_order` (seeded from hook `order` on insert, never clobbered).
- `source_app` non-empty ⇒ code-managed (sync owns it, prune-eligible); empty/NULL ⇒ admin hand-made (never edited or pruned).
- Tile key = the existing **`app_name`** field (unique, autoname). No DocType identity migration.
- Never raise out of `after_migrate` or `get_launcher`: wrap in try/except + `frappe.log_error`.
- Tests are mock-based and run **without a bench**. Do **not** run `npm install` (node_modules + `@lolbikb/dewey-ui` are present; a fresh install needs a GitHub PAT). Never echo tokens or `.npmrc`.
- Commit with **scoped `git add` of exact paths only** — never `git add -A`/`.` (the working tree has unrelated untracked files).
- Run commands from repo root: `/Users/lolbikb/projects/dewey-time`.

---

## File Structure

**Create:**
- `dewey_time/attendance_engine/launcher_gates.py` — `dewey_time`'s own gate predicates (`can_see_attendance`, `can_see_adms`). Stays with `dewey_time` in Phase 2.
- `dewey_time/attendance_engine/launcher_sync.py` — `sync_launcher_tiles()` reconcile (after_migrate).
- `dewey_time/tests/test_launcher_gates.py` — gate predicate tests.
- `dewey_time/tests/test_launcher_sync.py` — reconcile tests.
- `dewey_time/tests/test_hooks_launcher_tiles.py` — hook well-formedness + wiring tests.

**Modify:**
- `dewey_time/attendance_engine/launcher.py` — gate dispatch via built-ins + dotted path; drop hardcoded HR/ADMS predicates.
- `dewey_time/tests/test_launcher.py` — rewrite fixtures/harness for dotted-path gates.
- `dewey_time/dewey_time/doctype/launcher_tile/launcher_tile.json` — `gate` Select→Data; add `source_app`.
- `dewey_time/hooks.py` — add `dewey_launcher_tiles`; add sync to `after_migrate`.
- `dewey_time/patches.txt` — remove the `seed_launcher_tiles` line.
- `dewey_time/frontend/home/src/tileTypes.ts` — `gate: string`; add `source_app?`; `GATE_OPTIONS = ["roles","desk"]`.
- `dewey_time/frontend/home/src/AdminTiles.tsx` — managed-tile guardrails (badge; enable/reorder only).
- `dewey_time/public/home/**` + `dewey_time/www/home.html` — rebuilt bundle (Task 5 build output).

**Delete:**
- `dewey_time/patches/seed_launcher_tiles.py` — superseded by the after_migrate reconcile.

---

### Task 1: `dewey_time` gate module

Extract `dewey_time`'s product-specific gate predicates out of the resolver into a module it owns, referenced later by dotted path.

**Files:**
- Create: `dewey_time/attendance_engine/launcher_gates.py`
- Test: `dewey_time/tests/test_launcher_gates.py`

**Interfaces:**
- Consumes: `dewey_time.attendance_engine.hr_calendar._is_hr_staff`, `._employee_linked_to_user`; `dewey_time.attendance_engine.dashboard_auth.ALLOWED_ROLES`.
- Produces: `can_see_attendance() -> bool`, `can_see_adms() -> bool` (the dotted-path gate targets used by the hook in Task 4 and the resolver in Task 2).

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_launcher_gates.py`:

```python
"""Tests for dewey_time's launcher-tile gate predicates."""

import sys
import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# dashboard_auth imports `requests` at module level; stub it when absent.
if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

from dewey_time.attendance_engine import launcher_gates as mod  # noqa: E402


class CanSeeAttendanceTests(unittest.TestCase):
    def test_true_for_hr_staff(self):
        with patch.object(mod, "_is_hr_staff", return_value=True), \
             patch.object(mod, "_employee_linked_to_user", return_value=None):
            self.assertTrue(mod.can_see_attendance())

    def test_true_for_linked_employee(self):
        with patch.object(mod, "_is_hr_staff", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value="EMP-1"):
            self.assertTrue(mod.can_see_attendance())

    def test_false_for_neither(self):
        with patch.object(mod, "_is_hr_staff", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value=None):
            self.assertFalse(mod.can_see_attendance())


class CanSeeAdmsTests(unittest.TestCase):
    def test_true_when_holding_adms_role(self):
        with patch.object(mod, "ADMS_ROLES", {"ADMS Admin"}), \
             patch.object(mod.frappe, "get_roles", return_value=["ADMS Admin", "Other"]):
            self.assertTrue(mod.can_see_adms())

    def test_false_without_adms_role(self):
        with patch.object(mod, "ADMS_ROLES", {"ADMS Admin"}), \
             patch.object(mod.frappe, "get_roles", return_value=["Other"]):
            self.assertFalse(mod.can_see_adms())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_launcher_gates.py -v` (or `python -m unittest dewey_time.tests.test_launcher_gates -v`)
Expected: FAIL — `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.launcher_gates'`.

- [ ] **Step 3: Write the implementation**

Create `dewey_time/attendance_engine/launcher_gates.py`:

```python
"""Dewey Time's own launcher-tile visibility gates.

These predicates encode product knowledge (HR staff, linked employees, ADMS
roles) that the launcher resolver must NOT know about. The resolver reaches them
only by dotted path (see the `dewey_launcher_tiles` hook), so when the launcher
moves to dewey_portal in Phase 2 these gates stay here, with the product that
owns them.

Each gate is a zero-arg callable returning bool. They are cheap and
side-effect-free; the resolver wraps them with fail-open/fail-closed policy.
"""

import frappe

from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES as ADMS_ROLES
from dewey_time.attendance_engine.hr_calendar import (
    _employee_linked_to_user,
    _is_hr_staff,
)


def can_see_attendance() -> bool:
    """Visible to HR staff and to any user linked to an Employee."""
    return bool(_is_hr_staff() or _employee_linked_to_user())


def can_see_adms() -> bool:
    """Visible to holders of an ADMS role."""
    return bool(set(frappe.get_roles()) & ADMS_ROLES)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_launcher_gates.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/launcher_gates.py dewey_time/tests/test_launcher_gates.py
git commit -m "feat(launcher): extract dewey_time gate predicates into launcher_gates"
```

---

### Task 2: Resolver gate dispatch (built-ins + dotted path)

Replace the hardcoded `_GATE_FUNCS` enum dispatch with a generic resolver: built-in `desk`/`roles`, dotted-path via `frappe.get_attr`, unknown → skip. Drop the HR/ADMS predicates (now in `launcher_gates`). Keep fail-open/closed, the `enabled` filter, and order.

**Files:**
- Modify: `dewey_time/attendance_engine/launcher.py` (full rewrite of the module — content below)
- Test: `dewey_time/tests/test_launcher.py` (rewrite fixtures + harness — content below)

**Interfaces:**
- Consumes: tile rows from `Launcher Tile` (`name, app_name, title, route, icon, is_admin, gate`); dotted-path gates resolved via `frappe.get_attr` (e.g. Task 1's `can_see_attendance`).
- Produces: `get_launcher()` returning `{"user": {...}, "apps": [{"name","title","route","logo","admin"}]}`. Keeps module-level `_has_desk_access`, `_can_see_by_roles`, `_visible`, `_predicate`.

- [ ] **Step 1: Rewrite the test first (it will fail against the old module)**

Replace the entire contents of `dewey_time/tests/test_launcher.py` with:

```python
"""Tests for the home launcher resolver."""

import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

# Installs the shared MagicMock `frappe` into sys.modules (no bench needed).
from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# dashboard_auth imports requests at module level; stub it when absent.
if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

from dewey_time.attendance_engine import launcher as mod  # noqa: E402

mod.frappe.AuthenticationError = type("AuthenticationError", (Exception,), {})
mod.frappe.PermissionError = PermissionError


def _throw(msg, exc=None, *args, **kwargs):
    raise (exc or Exception)(msg)


def _patched_throw():
    return patch.object(mod.frappe, "throw", side_effect=_throw)


_GATE_ATT = "dewey_time.attendance_engine.launcher_gates.can_see_attendance"
_GATE_ADMS = "dewey_time.attendance_engine.launcher_gates.can_see_adms"

# The three curated tiles, as they appear in the Launcher Tile DocType.
_TILES = [
    {"name": "dewey_time", "app_name": "dewey_time", "title": "Dewey Time", "route": "/hr-attendance", "icon": "/x/d.svg", "is_admin": 0, "gate": _GATE_ATT},
    {"name": "adms", "app_name": "adms", "title": "ADMS", "route": "/adms", "icon": "/x/a.svg", "is_admin": 1, "gate": _GATE_ADMS},
    {"name": "desk", "app_name": "desk", "title": "Frappe Desk", "route": "/desk", "icon": "/x/k.svg", "is_admin": 1, "gate": "desk"},
]


def _get_all(tiles=None, tile_roles=None):
    tiles = _TILES if tiles is None else tiles
    tile_roles = tile_roles or []
    def _impl(doctype, *a, **kw):
        if doctype == "Launcher Tile":
            return list(tiles)
        if doctype == "Launcher Tile Role":
            return list(tile_roles)
        return []
    return _impl


def _attr_for(*, hr, employee, adms):
    """Stub frappe.get_attr: map a dotted gate path to a persona-aware predicate."""
    def _impl(path):
        if path.endswith("can_see_attendance"):
            return lambda: bool(hr or employee)
        if path.endswith("can_see_adms"):
            return lambda: bool(adms)
        raise ImportError(path)
    return _impl


def _run(*, user="u@x.com", roles=None, hr=False, employee=None, desk=False, tiles=None, tile_roles=None):
    """Invoke get_launcher() with a fully mocked persona."""
    roles = roles or []
    adms = bool(set(roles) & {"ADMS Admin", "ADMS Super Admin"})
    with patch.object(mod.frappe, "session", SimpleNamespace(user=user)), \
         patch.object(mod.frappe, "get_roles", return_value=roles), \
         patch.object(mod.frappe, "get_all", side_effect=_get_all(tiles, tile_roles)), \
         patch.object(mod.frappe, "get_attr", side_effect=_attr_for(hr=hr, employee=employee, adms=adms)), \
         patch.object(mod, "_has_desk_access", return_value=desk), \
         patch.object(mod, "_employee_linked_to_user", return_value=employee), \
         patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
        return mod.get_launcher()


def _names(result):
    return [a["name"] for a in result["apps"]]


class GetLauncherTests(unittest.TestCase):
    def test_guest_is_rejected(self):
        with _patched_throw(), patch.object(mod.frappe, "session", SimpleNamespace(user="Guest")):
            with self.assertRaises(mod.frappe.AuthenticationError):
                mod.get_launcher()

    def test_linked_employee_sees_only_attendance(self):
        self.assertEqual(_names(_run(employee="EMP-001")), ["dewey_time"])

    def test_adms_admin_sees_only_adms(self):
        self.assertEqual(_names(_run(roles=["ADMS Admin"])), ["adms"])

    def test_hr_user_sees_attendance_and_desk(self):
        self.assertEqual(_names(_run(hr=True, desk=True)), ["dewey_time", "desk"])

    def test_disabled_tiles_excluded_via_filter(self):
        captured = {}
        def _impl(doctype, *a, **kw):
            if doctype == "Launcher Tile":
                captured["filters"] = kw.get("filters")
                captured["order_by"] = kw.get("order_by")
                return list(_TILES)
            return []
        with _patched_throw(), patch.object(mod.frappe, "session", SimpleNamespace(user="u@x.com")), \
             patch.object(mod.frappe, "get_roles", return_value=[]), \
             patch.object(mod.frappe, "get_all", side_effect=_impl), \
             patch.object(mod.frappe, "get_attr", side_effect=_attr_for(hr=False, employee=None, adms=False)), \
             patch.object(mod, "_has_desk_access", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.utils, "get_fullname", return_value="X"):
            mod.get_launcher()
        self.assertEqual(captured["filters"], {"enabled": 1})
        self.assertEqual(captured["order_by"], "tile_order asc")

    def test_order_preserved_from_get_all(self):
        reordered = list(reversed(_TILES))
        self.assertEqual(_names(_run(hr=True, desk=True, tiles=reordered)), ["desk", "dewey_time"])

    def test_roles_gate_matches_user_role(self):
        tile = [{"name": "crm", "app_name": "crm", "title": "CRM", "route": "/crm", "icon": "/x/c.svg", "is_admin": 1, "gate": "roles"}]
        roles_rows = [{"role": "Sales User"}]
        self.assertEqual(_names(_run(roles=["Sales User"], tiles=tile, tile_roles=roles_rows)), ["crm"])
        self.assertEqual(_names(_run(roles=["Other"], tiles=tile, tile_roles=roles_rows)), [])

    def test_unknown_gate_skipped(self):
        tile = [{"name": "x", "app_name": "x", "title": "X", "route": "/x", "icon": "", "is_admin": 0, "gate": "bogus"}]
        self.assertEqual(_names(_run(tiles=tile)), [])

    def test_no_tiles_returns_empty(self):
        self.assertEqual(_names(_run(tiles=[])), [])

    def test_admin_flag_passthrough(self):
        apps = {a["name"]: a for a in _run(hr=True, desk=True)["apps"]}
        self.assertFalse(apps["dewey_time"]["admin"])
        self.assertTrue(apps["desk"]["admin"])

    def test_can_manage_tiles_true_for_system_manager(self):
        self.assertTrue(_run(roles=["System Manager"], hr=True, desk=True)["user"]["can_manage_tiles"])

    def test_can_manage_tiles_false_otherwise(self):
        self.assertFalse(_run(employee="EMP-001")["user"]["can_manage_tiles"])

    def test_greeting_initials(self):
        out = _run(employee="EMP-001")["user"]
        self.assertEqual(out["full_name"], "Maria Rossi")
        self.assertEqual(out["initials"], "MR")
        self.assertEqual(out["image_url"], None)
        self.assertIn("can_manage_tiles", out)

    def test_broad_gate_error_fails_open(self):
        def _attr(path):
            if path.endswith("can_see_attendance"):
                def _boom():
                    raise RuntimeError("boom")
                return _boom
            return lambda: False
        with patch.object(mod.frappe, "session", SimpleNamespace(user="u@x.com")), \
             patch.object(mod.frappe, "get_roles", return_value=[]), \
             patch.object(mod.frappe, "get_all", side_effect=_get_all()), \
             patch.object(mod.frappe, "get_attr", side_effect=_attr), \
             patch.object(mod, "_has_desk_access", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
            self.assertIn("dewey_time", _names(mod.get_launcher()))

    def test_admin_gate_error_fails_closed(self):
        def _attr(path):
            if path.endswith("can_see_attendance"):
                return lambda: True
            return lambda: False
        with patch.object(mod.frappe, "session", SimpleNamespace(user="u@x.com")), \
             patch.object(mod.frappe, "get_roles", return_value=[]), \
             patch.object(mod.frappe, "get_all", side_effect=_get_all()), \
             patch.object(mod.frappe, "get_attr", side_effect=_attr), \
             patch.object(mod, "_has_desk_access", side_effect=RuntimeError("boom")), \
             patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
            self.assertNotIn("desk", _names(mod.get_launcher()))

    def test_user_image_employee_photo_takes_precedence(self):
        with patch.object(mod, "_employee_linked_to_user", return_value="EMP-001"), \
             patch.object(mod.frappe.db, "get_value", side_effect=lambda dt, name, field: (
                 "/files/emp.jpg" if dt == "Employee" else "/files/user.jpg"
             )):
            self.assertEqual(mod._user_image(), "/files/emp.jpg")

        with patch.object(mod, "_employee_linked_to_user", return_value="EMP-001"), \
             patch.object(mod.frappe.db, "get_value", side_effect=lambda dt, name, field: (
                 None if dt == "Employee" else "/files/user.jpg"
             )):
            self.assertEqual(mod._user_image(), "/files/user.jpg")

        with patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.db, "get_value", return_value="/files/user.jpg"):
            self.assertEqual(mod._user_image(), "/files/user.jpg")

        with patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.db, "get_value", return_value=None):
            self.assertIsNone(mod._user_image())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_launcher.py -v`
Expected: FAIL — `test_unknown_gate_skipped` and the dotted-path tests fail against the old `_GATE_FUNCS` dispatch (old module still has `gate == "hr_or_employee"` logic; the new fixtures use dotted paths/`bogus`).

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `dewey_time/attendance_engine/launcher.py` with:

```python
"""Home launcher resolver.

Assembles the per-user app-tile list for the /home launcher SPA. Gating here is
COSMETIC — each app's own route enforces real auth — so the policy is:
broad tiles fail-open, admin tiles fail-closed (see _visible).

Tiles are registered by apps via the `dewey_launcher_tiles` hook and reconciled
into the Launcher Tile DocType (see launcher_sync.py). A tile's `gate` is either
a built-in name (desk, roles) or a dotted path to a `() -> bool` callable owned
by the registering app — so this resolver knows no product internals for gating.
"""

import frappe
from frappe import _

# Sole remaining product dependency: the employee-photo avatar lookup. Cleaned up
# in Phase 2 when the resolver relocates to dewey_portal.
from dewey_time.attendance_engine.hr_calendar import _employee_linked_to_user

_BROAD = "broad"
_ADMIN = "admin"


def _has_desk_access(roles=None) -> bool:
    """True if any of the user's roles enables Desk access (Role.desk_access=1)."""
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


def _can_see_by_roles(tile_name: str) -> bool:
    wanted = {
        r["role"]
        for r in frappe.get_all(
            "Launcher Tile Role", filters={"parent": tile_name}, fields=["role"]
        )
    }
    return bool(wanted & set(frappe.get_roles()))


def _predicate(gate: str, tile_name: str):
    """Resolve a tile's `gate` to a zero-arg bool predicate, or None to skip.

    - built-in `desk`/`roles` → the generic predicates here
    - dotted path (contains '.') → frappe.get_attr(path), an app-owned callable
    - anything else → None (unknown gate → tile skipped, curated safety)
    """
    if gate == "desk":
        return _has_desk_access
    if gate == "roles":
        return lambda: _can_see_by_roles(tile_name)
    if gate and "." in gate:
        return lambda: bool(frappe.get_attr(gate)())
    return None


def _visible(predicate, policy: str) -> bool:
    try:
        return bool(predicate())
    except Exception:
        frappe.log_error(title="launcher gate error")
        return policy == _BROAD  # fail-open for broad, fail-closed for admin


def _initials(full_name: str) -> str:
    parts = (full_name or "").split()
    return ("".join(p[0] for p in parts[:2]).upper()) or "?"


def _user_image() -> str | None:
    try:
        emp = _employee_linked_to_user()
        if emp:
            img = frappe.db.get_value("Employee", emp, "image")
            if img:
                return img
        return frappe.db.get_value("User", frappe.session.user, "user_image") or None
    except Exception:
        frappe.log_error(title="launcher user image lookup failed")
        return None


@frappe.whitelist()
def get_launcher():
    """Return the current user's launcher tiles + greeting."""
    if frappe.session.user in (None, "", "Guest"):
        frappe.throw(_("Login required"), frappe.AuthenticationError)

    full_name = frappe.utils.get_fullname(frappe.session.user) or frappe.session.user
    user = {
        "full_name": full_name,
        "initials": _initials(full_name),
        "image_url": _user_image(),
        "can_manage_tiles": "System Manager" in set(frappe.get_roles()),
    }

    apps = []
    try:
        tiles = frappe.get_all(
            "Launcher Tile",
            filters={"enabled": 1},
            fields=["name", "app_name", "title", "route", "icon", "is_admin", "gate"],
            order_by="tile_order asc",
        )
        for t in tiles:
            policy = _ADMIN if t.get("is_admin") else _BROAD
            predicate = _predicate(t.get("gate"), t["name"])
            if predicate is None:
                continue  # unknown gate → skip (curated safety)
            if _visible(predicate, policy):
                apps.append({
                    "name": t["app_name"],
                    "title": t["title"],
                    "route": t["route"],
                    "logo": t.get("icon") or "",
                    "admin": bool(t.get("is_admin")),
                })
    except Exception:
        frappe.log_error(title="get_launcher failed")  # never 500 the front door

    return {"user": user, "apps": apps}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_launcher.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/launcher.py dewey_time/tests/test_launcher.py
git commit -m "feat(launcher): dispatch gates via built-ins + dotted path"
```

---

### Task 3: Reconcile sync + DocType fields

Add the `after_migrate` reconcile and the two DocType field changes it depends on (`gate` Select→Data; new read-only `source_app`).

**Files:**
- Create: `dewey_time/attendance_engine/launcher_sync.py`
- Modify: `dewey_time/dewey_time/doctype/launcher_tile/launcher_tile.json`
- Test: `dewey_time/tests/test_launcher_sync.py`

**Interfaces:**
- Consumes: `frappe.get_installed_apps()`, `frappe.get_hooks("dewey_launcher_tiles", app_name=app)`, `frappe.db.exists`, `frappe.get_doc`, `frappe.get_all`, `frappe.delete_doc`.
- Produces: `sync_launcher_tiles()` (wired into `after_migrate` in Task 4).

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_launcher_sync.py`:

```python
"""Tests for the launcher-tile reconcile sync."""

import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import launcher_sync as mod  # noqa: E402


class _FakeDoc:
    def __init__(self, data):
        self.data = dict(data)
    def set(self, k, v):
        self.data[k] = v


def _tile(key, **over):
    t = {"key": key, "title": key.title(), "route": f"/{key}", "icon": f"/i/{key}.svg",
         "is_admin": False, "gate": f"app.gates.{key}", "order": 10}
    t.update(over)
    return t


def _run(*, installed, hooks_by_app, existing=None, prune_rows=None):
    existing = existing or {}
    prune_rows = prune_rows or []
    created, updated, deleted, get_all_calls = [], [], [], []

    def _get_hooks(hook, app_name=None, **kw):
        return list(hooks_by_app.get(app_name, []))

    def _exists(dt, name):
        return name in existing

    def _get_doc(arg, *a, **kw):
        if isinstance(arg, dict):
            d = _FakeDoc(arg)
            d.insert = lambda **k: created.append(dict(d.data))
            return d
        name = a[0]
        d = _FakeDoc({"name": name, **existing.get(name, {})})
        d.save = lambda **k: updated.append(dict(d.data))
        return d

    def _get_all(dt, filters=None, fields=None, **kw):
        get_all_calls.append({"doctype": dt, "filters": filters})
        return list(prune_rows)

    with patch.object(mod.frappe, "get_installed_apps", return_value=installed), \
         patch.object(mod.frappe, "get_hooks", side_effect=_get_hooks), \
         patch.object(mod.frappe.db, "exists", side_effect=_exists), \
         patch.object(mod.frappe, "get_doc", side_effect=_get_doc), \
         patch.object(mod.frappe, "get_all", side_effect=_get_all), \
         patch.object(mod.frappe, "delete_doc", side_effect=lambda dt, name, **k: deleted.append(name)), \
         patch.object(mod.frappe, "clear_cache"), \
         patch.object(mod.frappe, "log_error"):
        mod.sync_launcher_tiles()
    return {"created": created, "updated": updated, "deleted": deleted, "get_all": get_all_calls}


class SyncTests(unittest.TestCase):
    def test_insert_sets_code_and_seed_fields(self):
        r = _run(installed=["dewey_time"],
                 hooks_by_app={"dewey_time": [_tile("dewey_time", title="Dewey Time", is_admin=False)]})
        self.assertEqual(len(r["created"]), 1)
        c = r["created"][0]
        self.assertEqual(c["app_name"], "dewey_time")
        self.assertEqual(c["title"], "Dewey Time")
        self.assertEqual(c["source_app"], "dewey_time")
        self.assertEqual(c["enabled"], 1)
        self.assertEqual(c["tile_order"], 10)
        self.assertEqual(c["is_admin"], 0)

    def test_update_refreshes_code_only_keeps_admin_owned(self):
        r = _run(installed=["dewey_time"],
                 hooks_by_app={"dewey_time": [_tile("dewey_time", title="Dewey Time", order=10)]},
                 existing={"dewey_time": {"enabled": 0, "tile_order": 99, "title": "Old"}})
        self.assertEqual(len(r["updated"]), 1)
        u = r["updated"][0]
        self.assertEqual(u["title"], "Dewey Time")     # code-owned refreshed
        self.assertEqual(u["source_app"], "dewey_time")
        self.assertEqual(u["enabled"], 0)              # admin-owned preserved
        self.assertEqual(u["tile_order"], 99)          # admin-owned preserved

    def test_prune_removes_managed_tile_no_longer_declared(self):
        r = _run(installed=["dewey_time"],
                 hooks_by_app={"dewey_time": [_tile("dewey_time")]},
                 existing={"dewey_time": {}},
                 prune_rows=[{"name": "dewey_time", "source_app": "dewey_time"},
                             {"name": "gone", "source_app": "oldapp"}])
        self.assertEqual(r["deleted"], ["gone"])

    def test_prune_query_filters_to_managed_only(self):
        r = _run(installed=["dewey_time"], hooks_by_app={"dewey_time": [_tile("dewey_time")]},
                 existing={"dewey_time": {}})
        tile_calls = [c for c in r["get_all"] if c["doctype"] == "Launcher Tile"]
        self.assertTrue(any(c["filters"] == {"source_app": ["is", "set"]} for c in tile_calls))

    def test_key_collision_first_wins(self):
        r = _run(installed=["a", "b"],
                 hooks_by_app={"a": [_tile("x", title="From A")], "b": [_tile("x", title="From B")]})
        self.assertEqual(len(r["created"]), 1)
        self.assertEqual(r["created"][0]["title"], "From A")

    def test_missing_key_skipped(self):
        r = _run(installed=["a"], hooks_by_app={"a": [{"title": "No Key", "route": "/x", "gate": "desk"}]})
        self.assertEqual(r["created"], [])

    def test_exception_is_swallowed(self):
        with patch.object(mod.frappe, "get_installed_apps", side_effect=RuntimeError("boom")), \
             patch.object(mod.frappe, "log_error") as log:
            mod.sync_launcher_tiles()  # must not raise
        self.assertTrue(log.called)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_launcher_sync.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.launcher_sync'`.

- [ ] **Step 3: Write the implementation**

Create `dewey_time/attendance_engine/launcher_sync.py`:

```python
"""Reconcile `dewey_launcher_tiles` hook declarations into Launcher Tile rows.

Runs on after_migrate. Reconcile, not replace: code owns
title/route/icon/is_admin/gate (+ source_app provenance); admins own enabled +
tile_order (seeded once from the hook's `order`). Managed tiles whose registering
app is gone are pruned; hand-made tiles (blank source_app) are never touched.
"""

import frappe

_DOCTYPE = "Launcher Tile"


def _declared_tiles():
    """[(declaring_app, tile_dict)] across installed apps; first-wins on key clash."""
    seen = {}
    out = []
    for app in frappe.get_installed_apps():
        for tile in frappe.get_hooks("dewey_launcher_tiles", app_name=app) or []:
            key = tile.get("key")
            if not key:
                frappe.log_error(title="launcher tile missing key", message=str(tile))
                continue
            if key in seen:
                frappe.log_error(
                    title="launcher tile key collision",
                    message=f"{key}: kept {seen[key]}, ignored {app}",
                )
                continue
            seen[key] = app
            out.append((app, tile))
    return out


def sync_launcher_tiles():
    try:
        declared = _declared_tiles()
        declared_keys = {tile["key"] for _app, tile in declared}

        for app, tile in declared:
            key = tile["key"]
            code_fields = {
                "title": tile.get("title"),
                "route": tile.get("route"),
                "icon": tile.get("icon") or "",
                "is_admin": 1 if tile.get("is_admin") else 0,
                "gate": tile.get("gate"),
                "source_app": app,
            }
            if frappe.db.exists(_DOCTYPE, key):
                doc = frappe.get_doc(_DOCTYPE, key)
                for field, value in code_fields.items():
                    doc.set(field, value)
                doc.save(ignore_permissions=True)  # enabled + tile_order untouched
            else:
                doc = frappe.get_doc({
                    "doctype": _DOCTYPE,
                    "app_name": key,
                    "enabled": 1,
                    "tile_order": tile.get("order") or 0,
                    **code_fields,
                })
                doc.insert(ignore_permissions=True)

        # Prune managed tiles (source_app set) whose app no longer declares them.
        for row in frappe.get_all(
            _DOCTYPE, filters={"source_app": ["is", "set"]}, fields=["name", "source_app"]
        ):
            if row["name"] not in declared_keys:
                frappe.delete_doc(_DOCTYPE, row["name"], ignore_permissions=True, force=True)

        frappe.clear_cache()
    except Exception:
        frappe.log_error(title="sync_launcher_tiles failed")  # never break migrate
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_launcher_sync.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Apply the DocType field changes**

Edit `dewey_time/dewey_time/doctype/launcher_tile/launcher_tile.json`:

Change the `field_order` array to insert `source_app` after `icon`:
```json
  "field_order": [
    "app_name", "title", "route", "icon", "source_app", "column_break_1",
    "tile_order", "enabled", "is_admin", "gate", "visible_to_roles"
  ],
```

Add this field object to the `fields` array (immediately after the `icon` field object):
```json
    {"fieldname": "source_app", "fieldtype": "Data", "label": "Source App", "read_only": 1, "description": "App that registered this tile via the dewey_launcher_tiles hook (blank = added manually)"},
```

Replace the existing `gate` field object with (Select → Data; drop `options`):
```json
    {"fieldname": "gate", "fieldtype": "Data", "label": "Visibility Gate", "reqd": 1, "default": "roles", "description": "Built-in name (desk, roles) or dotted path to a () -> bool callable owned by the registering app"},
```

- [ ] **Step 6: Verify the JSON parses**

Run: `cd /Users/lolbikb/projects/dewey-time && python -c "import json; d=json.load(open('dewey_time/dewey_time/doctype/launcher_tile/launcher_tile.json')); fo=d['field_order']; fns=[f['fieldname'] for f in d['fields']]; g=[f for f in d['fields'] if f['fieldname']=='gate'][0]; assert 'source_app' in fo and 'source_app' in fns, 'source_app missing'; assert g['fieldtype']=='Data' and 'options' not in g, 'gate not Data'; print('OK')"`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/launcher_sync.py dewey_time/tests/test_launcher_sync.py dewey_time/dewey_time/doctype/launcher_tile/launcher_tile.json
git commit -m "feat(launcher): reconcile sync + Launcher Tile source_app/gate fields"
```

---

### Task 4: Wire up the hook + after_migrate; remove the seed patch

Register `dewey_time`'s three tiles, run the reconcile on migrate, and delete the now-redundant seed patch.

**Files:**
- Modify: `dewey_time/hooks.py`
- Modify: `dewey_time/patches.txt`
- Delete: `dewey_time/patches/seed_launcher_tiles.py`
- Test: `dewey_time/tests/test_hooks_launcher_tiles.py`

**Interfaces:**
- Consumes: `launcher_gates.can_see_attendance` / `.can_see_adms` (Task 1); `launcher_sync.sync_launcher_tiles` (Task 3); logo constants `ATTENDANCE_APP_LOGO`, `ADMS_APP_LOGO`, `SITE_FAVICON_LOGO` (already imported at the top of `hooks.py`).
- Produces: `dewey_launcher_tiles` hook list; sync entry in `after_migrate`.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_hooks_launcher_tiles.py`:

```python
"""Wiring tests: the dewey_launcher_tiles hook is well-formed and resolvable."""

import importlib
import sys
import unittest
from unittest.mock import MagicMock

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

import dewey_time.hooks as hooks  # noqa: E402

_BUILTINS = {"desk", "roles"}


def _resolve(path):
    mod_path, attr = path.rsplit(".", 1)
    return getattr(importlib.import_module(mod_path), attr)


class HookShapeTests(unittest.TestCase):
    def test_is_list_of_tiles(self):
        self.assertIsInstance(hooks.dewey_launcher_tiles, list)
        self.assertGreaterEqual(len(hooks.dewey_launcher_tiles), 3)

    def test_required_keys_present(self):
        for t in hooks.dewey_launcher_tiles:
            for field in ("key", "title", "route", "gate"):
                self.assertIn(field, t, f"{t} missing {field}")

    def test_keys_unique(self):
        keys = [t["key"] for t in hooks.dewey_launcher_tiles]
        self.assertEqual(len(keys), len(set(keys)))

    def test_dewey_time_tile_titled_dewey_time(self):
        by_key = {t["key"]: t for t in hooks.dewey_launcher_tiles}
        self.assertEqual(by_key["dewey_time"]["title"], "Dewey Time")

    def test_gates_resolve(self):
        for t in hooks.dewey_launcher_tiles:
            gate = t["gate"]
            if gate in _BUILTINS:
                continue
            self.assertIn(".", gate, f"{gate} is neither built-in nor dotted")
            self.assertTrue(callable(_resolve(gate)), f"{gate} not callable")

    def test_sync_registered_in_after_migrate(self):
        self.assertIn(
            "dewey_time.attendance_engine.launcher_sync.sync_launcher_tiles",
            hooks.after_migrate,
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_hooks_launcher_tiles.py -v`
Expected: FAIL — `AttributeError: module 'dewey_time.hooks' has no attribute 'dewey_launcher_tiles'`.

- [ ] **Step 3: Add the hook to `hooks.py`**

In `dewey_time/hooks.py`, add this block immediately after the `add_to_apps_screen = [...]` list (before `website_route_rules`):

```python
# Home-launcher registry. Each app contributes tiles here; the after_migrate
# reconcile (launcher_sync) upserts them into Launcher Tile rows, and
# get_launcher gates each tile. `gate` is a built-in (desk, roles) or a dotted
# path to a () -> bool callable the registering app owns. dewey_time registers
# itself like any other app — including the ADMS bundle it hosts.
dewey_launcher_tiles = [
    {
        "key": "dewey_time",
        "title": "Dewey Time",
        "route": "/hr-attendance",
        "icon": ATTENDANCE_APP_LOGO,
        "order": 10,
        "is_admin": False,
        "gate": "dewey_time.attendance_engine.launcher_gates.can_see_attendance",
    },
    {
        "key": "adms",
        "title": "ADMS",
        "route": "/adms",
        "icon": ADMS_APP_LOGO,
        "order": 20,
        "is_admin": True,
        "gate": "dewey_time.attendance_engine.launcher_gates.can_see_adms",
    },
    {
        "key": "desk",
        "title": "Frappe Desk",
        "route": "/desk",
        "icon": SITE_FAVICON_LOGO,
        "order": 30,
        "is_admin": True,
        "gate": "desk",
    },
]
```

Then add the reconcile to the `after_migrate` list (append as the last entry):

```python
after_migrate = [
    "dewey_time.setup.custom_fields.make_custom_fields",
    "dewey_time.utils.sync_hr_attendance_assets.sync_hr_attendance_assets",
    "dewey_time.utils.sync_home_assets.sync_home_assets",
    "dewey_time.utils.sync_adms_assets.sync_adms_assets",
    "dewey_time.attendance_engine.dashboard_auth.ensure_adms_roles",
    "dewey_time.webpush.ensure_vapid_keys",
    "dewey_time.attendance_engine.launcher_sync.sync_launcher_tiles",
]
```

- [ ] **Step 4: Remove the seed patch**

Delete the file:
```bash
git rm dewey_time/patches/seed_launcher_tiles.py
```

Remove this line from `dewey_time/patches.txt` (the last line):
```
dewey_time.patches.seed_launcher_tiles
```
(Leave `dewey_time.patches.reset_broken_website_theme` as the final line.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_hooks_launcher_tiles.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full Python launcher suite for regressions**

Run: `cd /Users/lolbikb/projects/dewey-time && python -m pytest dewey_time/tests/test_launcher.py dewey_time/tests/test_launcher_gates.py dewey_time/tests/test_launcher_sync.py dewey_time/tests/test_hooks_launcher_tiles.py -v`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add dewey_time/hooks.py dewey_time/patches.txt dewey_time/tests/test_hooks_launcher_tiles.py
git commit -m "feat(launcher): register dewey_time tiles via hook; reconcile on migrate; drop seed patch"
```

---

### Task 5: Admin UI guardrails for managed tiles

Stop the `/home/admin` UI from offering edits that the reconcile would silently revert: managed tiles (with `source_app`) show a badge and allow only enable/reorder.

**Files:**
- Modify: `dewey_time/frontend/home/src/tileTypes.ts`
- Modify: `dewey_time/frontend/home/src/AdminTiles.tsx`
- Build output (committed): `dewey_time/public/home/**`, `dewey_time/www/home.html`

**Interfaces:**
- Consumes: `Launcher Tile` rows now carrying `source_app` (Task 3).
- Produces: managed-aware admin list; no new exported symbols.

- [ ] **Step 1: Update the tile type + gate options**

Replace the entire contents of `dewey_time/frontend/home/src/tileTypes.ts` with:

```ts
export interface LauncherTile {
  name: string;
  app_name: string;
  title: string;
  route: string;
  icon?: string;
  tile_order: number;
  enabled: number; // 0 | 1
  is_admin: number; // 0 | 1
  gate: string; // built-in name ("desk"/"roles") or a dotted path
  source_app?: string; // set ⇒ app-managed (code-owned), blank ⇒ hand-made
}

// Gates an admin can choose without code. App-registered tiles carry code-owned
// gates (often dotted paths) and are not editable here.
export const GATE_OPTIONS: string[] = ["roles", "desk"];
```

- [ ] **Step 2: Fetch `source_app` and add the managed helper in `AdminTiles.tsx`**

In `dewey_time/frontend/home/src/AdminTiles.tsx`, add `"source_app"` to the `FIELDS` array:

```ts
const FIELDS: (keyof LauncherTile)[] = [
  "name",
  "app_name",
  "title",
  "route",
  "icon",
  "tile_order",
  "enabled",
  "is_admin",
  "gate",
  "source_app",
];
```

Add a helper just below `const tiles = useMemo(...)` inside `AdminTiles`:

```ts
  const isManaged = (t: LauncherTile) => !!t.source_app;
```

- [ ] **Step 3: Default the New-tile gate to `roles`**

In the `New tile` button's `setEditing({...})` call, change `gate: "hr_or_employee"` to `gate: "roles"`:

```tsx
            onClick={() =>
              setEditing({
                gate: "roles",
                enabled: 1,
                is_admin: 0,
                tile_order: (tiles.at(-1)?.tile_order ?? 0) + 10,
              })
            }
```

- [ ] **Step 4: Render managed tiles with a badge and restricted actions**

Replace the row `<Card>` block (the `tiles.map((t, i) => ( ... ))` body) with this version, which shows a "Managed by …" badge and hides Edit/Delete for managed tiles:

```tsx
          {tiles.map((t, i) => (
            <Card key={t.name} className="flex items-center gap-3 p-3">
              <img
                src={t.icon || ""}
                alt=""
                className="size-8 rounded"
                onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {t.title}
                  {isManaged(t) && (
                    <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Managed by {t.source_app}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.route} · {t.gate}
                  {t.is_admin ? " · admin" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={i === 0}
                  onClick={() => move(t, -1)}
                  aria-label="Move up"
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={i === tiles.length - 1}
                  onClick={() => move(t, 1)}
                  aria-label="Move down"
                >
                  ↓
                </Button>
                <Switch
                  checked={!!t.enabled}
                  onCheckedChange={() => toggle(t)}
                  aria-label="Enabled"
                />
                {!isManaged(t) && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(t)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/home && npx tsc --noEmit`
Expected: no errors. (If `tsc` reports an unused `GATE_OPTIONS` import elsewhere, it is still used by `AdminTiles.tsx`'s `TileDialog`; do not remove it.)

- [ ] **Step 6: Build the bundle**

Run: `cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/home && npm run build`
Expected: Vite build succeeds; writes `dewey_time/public/home/assets/index.{js,css}` and `copy-html-entry.mjs` rewrites `dewey_time/www/home.html` with a fresh `?v=` cache-bust. Do **not** run `npm install`.

- [ ] **Step 7: Commit (source + rebuilt bundle)**

```bash
git add dewey_time/frontend/home/src/tileTypes.ts dewey_time/frontend/home/src/AdminTiles.tsx dewey_time/public/home dewey_time/www/home.html
git commit -m "feat(home): guard app-managed tiles in the admin tiles UI"
```

---

## Post-Implementation (user-run, needs a bench — NOT a subagent step)

These verify the wiring end-to-end on a real site and are listed for the final summary, not for TDD subagents:

- `bench --site <site> migrate` — runs the DocType sync (gate→Data, source_app), then `after_migrate` reconcile: retitles the `dewey_time` row to "Dewey Time", rewrites `dewey_time`/`adms` gates to dotted paths, stamps `source_app`, leaves `enabled`/`tile_order` intact.
- `bench --site <site> run-tests --app dewey_time` — CI-parity run of the suite.
- Smoke `/home` (tiles render, correct gating per persona) and `/home/admin` (managed badge; Edit/Delete hidden on the 3 managed tiles; a hand-made tile still fully editable).

---

## Self-Review

**Spec coverage:**
- Hook schema → Task 4 (`dewey_launcher_tiles`). ✓
- Gate model (built-ins + dotted path + skip; fail-open/closed) → Task 2. ✓
- Gates owned by declaring app → Task 1. ✓
- Reconcile sync (upsert code-owned, keep admin-owned, prune managed-only, key-collision, swallow) → Task 3. ✓
- DocType changes (gate Data, source_app) → Task 3. ✓
- Title "Dewey Time" → Task 4 hook + asserted in Task 4 test + Task 2 fixture. ✓
- Admin UI guardrails → Task 5. ✓
- Remove seed patch → Task 4. ✓
- Testing matrix (resolver, sync, gates, wiring) → Tasks 1–4. ✓
- Out-of-scope items untouched (no app extraction, no route renames, `add_to_apps_screen` left alone). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content. ✓

**Type/identity consistency:** Gate dotted paths identical across Task 1 (defn), Task 2 (fixture), Task 4 (hook + resolution test). Tile key ↔ `app_name` consistent in sync (Task 3) and resolver (Task 2). `source_app` field added in Task 3, consumed in Task 5. `sync_launcher_tiles` name identical in Task 3 defn and Task 4 wiring/test. ✓
