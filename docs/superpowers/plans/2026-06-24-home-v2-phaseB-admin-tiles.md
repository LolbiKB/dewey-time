# Home v2 Phase B — Admin tile registry (DocType + admin page)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Move the launcher's app-tile registry from `hooks.py` into an admin-editable `Launcher Tile` DocType, have `get_launcher` read it (hybrid gate model), and add a `/home/admin` page where admins manage tiles (add/reorder/enable/edit/role-visibility) — no deploy needed to change the lineup.

**Architecture:** New `Launcher Tile` DocType (+ child `Launcher Tile Role`) seeded with today's 3 tiles via an idempotent patch. `get_launcher` reads enabled tiles ordered by `tile_order`, applies a gate predicate chosen by the tile's `gate` Select, and keeps the v1 fail-open-broad / fail-closed-admin policy (driven by the tile's `is_admin`). The home SPA gains react-router (it already depends on it) with `/home` (launcher) + `/home/admin` (gated config). Admin CRUD uses `frappe-react-sdk` DocType hooks; the **DocType permission (System Manager) is the real boundary** — the SPA guard is cosmetic.

**Tech Stack:** Frappe v16 (Python), React 19 + Vite + `@lolbikb/dewey-ui` 1.13.1 + `frappe-react-sdk` 1.16.0 + `react-router-dom` 7. Tests: mock-based `unittest` (`python3.13 -m unittest`).

## Global Constraints
- Gating is **cosmetic**; each app route + the DocType permission are the real boundaries. `get_launcher` must **never 500** (wrap reads in try/except → safe payload).
- Fail policy on gate error: `is_admin` tiles **fail-closed**, others **fail-open**. Log via `frappe.log_error`.
- Hybrid gate model: `gate` Select ∈ {`hr_or_employee`, `adms`, `desk`, `roles`}. Built-ins map to existing code predicates; `roles` uses the tile's `visible_to_roles`.
- Brand: green `#066031` = signal only; light-only; reuse `@lolbikb/dewey-ui`.
- `NODE_AUTH_TOKEN` is in the build env — **never print it**. Verify frontend with `cd dewey_time/frontend/home && npm run build`; commit the rebuilt `public/home` output.
- New `patches/*.py` file **must** be appended to `dewey_time/patches.txt`.
- Don't modify `sync_hr_attendance_assets.py` or the existing `add_to_apps_screen` hook (Frappe's own desktop screen still uses it; it's a separate concern).

---

## Task B1: `Launcher Tile` DocType (+ child) + seed patch

**Files:**
- Create: `dewey_time/dewey_time/doctype/launcher_tile/launcher_tile.json`
- Create: `dewey_time/dewey_time/doctype/launcher_tile/launcher_tile.py`
- Create: `dewey_time/dewey_time/doctype/launcher_tile/__init__.py` (empty)
- Create: `dewey_time/dewey_time/doctype/launcher_tile_role/launcher_tile_role.json`
- Create: `dewey_time/dewey_time/doctype/launcher_tile_role/launcher_tile_role.py`
- Create: `dewey_time/dewey_time/doctype/launcher_tile_role/__init__.py` (empty)
- Create: `dewey_time/patches/seed_launcher_tiles.py`
- Modify: `dewey_time/patches.txt` (append one line)

**Interfaces:**
- Produces the `Launcher Tile` DocType with fields: `app_name` (Data, unique, reqd), `title` (Data, reqd), `route` (Data, reqd), `icon` (Data), `tile_order` (Int, default 0), `enabled` (Check, default 1), `is_admin` (Check, default 0), `gate` (Select, reqd), `visible_to_roles` (Table MultiSelect → `Launcher Tile Role`).
- Consumes: `dewey_time.utils.sync_hr_attendance_assets` logo constants for the seed (`SITE_FAVICON_LOGO`, `HR_APP_LOGO`/`ATTENDANCE_APP_LOGO`, `ADMS_APP_LOGO`).

- [ ] **Step 1: Create child doctype** `launcher_tile_role/launcher_tile_role.json` (mirrors the `device_sync_status` json shape; `istable: 1`):

```json
{
  "actions": [],
  "creation": "2026-06-24 00:00:00.000000",
  "custom": 1,
  "doctype": "DocType",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": ["role"],
  "fields": [
    {
      "fieldname": "role",
      "fieldtype": "Link",
      "in_list_view": 1,
      "label": "Role",
      "options": "Role",
      "reqd": 1
    }
  ],
  "index_web_pages_for_search": 0,
  "istable": 1,
  "links": [],
  "modified": "2026-06-24 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "Dewey Time",
  "name": "Launcher Tile Role",
  "owner": "Administrator",
  "permissions": [],
  "sort_field": "modified",
  "sort_order": "DESC",
  "states": []
}
```

- [ ] **Step 2: Create child controller** `launcher_tile_role/launcher_tile_role.py`:

```python
from frappe.model.document import Document


class LauncherTileRole(Document):
    pass
```

And empty `launcher_tile_role/__init__.py`.

- [ ] **Step 3: Create parent doctype** `launcher_tile/launcher_tile.json` (autoname by `app_name` so the record name IS the app id):

```json
{
  "actions": [],
  "allow_rename": 1,
  "autoname": "field:app_name",
  "creation": "2026-06-24 00:00:00.000000",
  "custom": 1,
  "doctype": "DocType",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": [
    "app_name", "title", "route", "icon", "column_break_1",
    "tile_order", "enabled", "is_admin", "gate", "visible_to_roles"
  ],
  "fields": [
    {"fieldname": "app_name", "fieldtype": "Data", "label": "App Name", "reqd": 1, "unique": 1, "in_list_view": 1, "description": "Stable identifier, e.g. dewey_time, adms, desk"},
    {"fieldname": "title", "fieldtype": "Data", "label": "Title", "reqd": 1, "in_list_view": 1},
    {"fieldname": "route", "fieldtype": "Data", "label": "Route", "reqd": 1, "in_list_view": 1, "description": "e.g. /hr-attendance"},
    {"fieldname": "icon", "fieldtype": "Data", "label": "Icon URL", "description": "Asset path, e.g. /assets/dewey_time/images/dewey-time.svg"},
    {"fieldname": "column_break_1", "fieldtype": "Column Break"},
    {"fieldname": "tile_order", "fieldtype": "Int", "label": "Order", "default": "0", "in_list_view": 1},
    {"fieldname": "enabled", "fieldtype": "Check", "label": "Enabled", "default": "1", "in_list_view": 1},
    {"fieldname": "is_admin", "fieldtype": "Check", "label": "Admin only", "default": "0", "description": "Shows the Admins chip; fails closed on gate error"},
    {"fieldname": "gate", "fieldtype": "Select", "label": "Visibility Gate", "reqd": 1, "default": "roles", "options": "hr_or_employee\nadms\ndesk\nroles", "description": "Built-ins use code predicates; 'roles' uses Visible To Roles"},
    {"fieldname": "visible_to_roles", "fieldtype": "Table MultiSelect", "label": "Visible To Roles", "options": "Launcher Tile Role", "depends_on": "eval:doc.gate=='roles'"}
  ],
  "index_web_pages_for_search": 0,
  "links": [],
  "modified": "2026-06-24 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "Dewey Time",
  "name": "Launcher Tile",
  "naming_rule": "By fieldname",
  "owner": "Administrator",
  "permissions": [
    {"create": 1, "delete": 1, "email": 1, "export": 1, "print": 1, "read": 1, "report": 1, "role": "System Manager", "share": 1, "write": 1}
  ],
  "sort_field": "tile_order",
  "sort_order": "ASC",
  "states": [],
  "track_changes": 1
}
```

- [ ] **Step 4: Create parent controller** `launcher_tile/launcher_tile.py`:

```python
from frappe.model.document import Document


class LauncherTile(Document):
    pass
```

And empty `launcher_tile/__init__.py`.

- [ ] **Step 5: Validate the JSON is well-formed**

Run from repo root:
```bash
python3.13 -c "import json; [json.load(open(p)) for p in ['dewey_time/dewey_time/doctype/launcher_tile/launcher_tile.json','dewey_time/dewey_time/doctype/launcher_tile_role/launcher_tile_role.json']]; print('json ok')"
```
Expected: `json ok`.

- [ ] **Step 6: Create the idempotent seed patch** `dewey_time/patches/seed_launcher_tiles.py` (mirrors `add_adms_admin_role.py`'s shape):

```python
import frappe

from dewey_time.utils.sync_hr_attendance_assets import (
    ADMS_APP_LOGO,
    ATTENDANCE_APP_LOGO,
    SITE_FAVICON_LOGO,
)

# Seeded launcher tiles = the v1 curated registry, now data. Idempotent: only
# inserts tiles that don't already exist, so admins' later edits are preserved.
_TILES = [
    {"app_name": "dewey_time", "title": "HR Attendance", "route": "/hr-attendance", "icon": ATTENDANCE_APP_LOGO, "tile_order": 10, "is_admin": 0, "gate": "hr_or_employee"},
    {"app_name": "adms", "title": "ADMS Bridge", "route": "/adms", "icon": ADMS_APP_LOGO, "tile_order": 20, "is_admin": 1, "gate": "adms"},
    {"app_name": "desk", "title": "Frappe Desk", "route": "/desk", "icon": SITE_FAVICON_LOGO, "tile_order": 30, "is_admin": 1, "gate": "desk"},
]


def execute():
    for tile in _TILES:
        if frappe.db.exists("Launcher Tile", tile["app_name"]):
            continue
        doc = {"doctype": "Launcher Tile", "enabled": 1, **tile}
        frappe.get_doc(doc).insert(ignore_permissions=True)
    frappe.clear_cache()
```

- [ ] **Step 7: Syntax-check the patch**

```bash
python3.13 -m py_compile dewey_time/patches/seed_launcher_tiles.py
```
Expected: no output.

- [ ] **Step 8: Register the patch** — append to `dewey_time/patches.txt` (last line):

```
dewey_time.patches.seed_launcher_tiles
```

- [ ] **Step 9: Commit**

```bash
git add dewey_time/dewey_time/doctype/launcher_tile dewey_time/dewey_time/doctype/launcher_tile_role dewey_time/patches/seed_launcher_tiles.py dewey_time/patches.txt
git commit -m "feat(home): add Launcher Tile DocType + seed patch (registry as data)"
```

> **Note:** DocType json auto-syncs on `bench migrate` (standard Frappe); the seed patch runs in the same migrate. No bench here, so live verification (tiles exist after migrate) is the user's step.

---

## Task B2: `get_launcher` reads the DocType (hybrid gate) + `can_manage_tiles`

**Files:**
- Modify: `dewey_time/attendance_engine/launcher.py`
- Modify: `dewey_time/tests/test_launcher.py`

**Interfaces:**
- Consumes: the `Launcher Tile` DocType (B1). Existing predicates `_can_see_hr`, `_can_see_adms`, `_has_desk_access`, `_visible`, `_initials`, `_user_image` stay.
- Produces (additive): `get_launcher()` now returns `{"user": {"full_name", "initials", "image_url", "can_manage_tiles": bool}, "apps": [{"name","title","route","logo","admin"}, ...]}`, with `apps` sourced from enabled `Launcher Tile` rows ordered by `tile_order`.

- [ ] **Step 1: Write the failing tests** — replace the registry-dependent tests in `test_launcher.py`. The personas now mock `frappe.get_all`. Add a `_run` that returns tiles for `"Launcher Tile"` and roles for `"Launcher Tile Role"`:

```python
_TILES = [
    {"name": "dewey_time", "app_name": "dewey_time", "title": "HR Attendance", "route": "/hr-attendance", "icon": "/x/d.svg", "is_admin": 0, "gate": "hr_or_employee"},
    {"name": "adms", "app_name": "adms", "title": "ADMS Bridge", "route": "/adms", "icon": "/x/a.svg", "is_admin": 1, "gate": "adms"},
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


def _run(*, user="u@x.com", roles=None, hr=False, employee=None, desk=False, tiles=None, tile_roles=None):
    roles = roles or []
    with patch.object(mod.frappe, "session", SimpleNamespace(user=user)), \
         patch.object(mod.frappe, "get_roles", return_value=roles), \
         patch.object(mod.frappe, "get_all", side_effect=_get_all(tiles, tile_roles)), \
         patch.object(mod, "_is_hr_staff", return_value=hr), \
         patch.object(mod, "_employee_linked_to_user", return_value=employee), \
         patch.object(mod, "_has_desk_access", return_value=desk), \
         patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
        return mod.get_launcher()
```

Then the assertions (mirror the existing v1 test names/intent, updated for DocType source):

```python
class GetLauncherTests(unittest.TestCase):
    def test_guest_is_rejected(self):
        with _patched_throw(), patch.object(mod.frappe, "session", SimpleNamespace(user="Guest")):
            with self.assertRaises(mod.frappe.AuthenticationError):
                mod.get_launcher()

    def test_linked_employee_sees_only_hr(self):
        self.assertEqual(_names(_run(employee="EMP-001")), ["dewey_time"])

    def test_adms_admin_sees_only_adms(self):
        self.assertEqual(_names(_run(roles=["ADMS Admin"])), ["adms"])

    def test_hr_user_sees_hr_and_desk(self):
        self.assertEqual(_names(_run(hr=True, desk=True)), ["dewey_time", "desk"])

    def test_disabled_tiles_excluded_via_filter(self):
        # get_launcher must pass filters={"enabled": 1}; assert the call.
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
             patch.object(mod, "_is_hr_staff", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod, "_has_desk_access", return_value=False), \
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
        with patch.object(mod, "_is_hr_staff", side_effect=RuntimeError("boom")), \
             patch.object(mod, "_employee_linked_to_user", side_effect=RuntimeError("boom")):
            self.assertIn("dewey_time", _names(_run()))

    def test_admin_gate_error_fails_closed(self):
        with patch.object(mod, "_has_desk_access", side_effect=RuntimeError("boom")):
            self.assertNotIn("desk", _names(_run(hr=True)))
```

> Keep the existing `_install_frappe_mock()` import, the `_names` helper, and the `_patched_throw` helper (copy it from `test_dashboard_auth.py` if not already present in `test_launcher.py`). Keep the existing `_user_image` precedence test from Phase A.

- [ ] **Step 2: RED** — `python3.13 -m unittest dewey_time.tests.test_launcher -v`. Expect failures (get_launcher still reads hooks; no `can_manage_tiles`).

- [ ] **Step 3: Rewrite the registry section** of `dewey_time/attendance_engine/launcher.py`. Remove the `_APP_GATES` dict and the `frappe.get_hooks(...)` loop + synthesized-desk block. Add the gate map + roles predicate, and read the DocType:

```python
# Built-in gate predicates, keyed by the Launcher Tile `gate` Select value.
_GATE_FUNCS = {
    "hr_or_employee": _can_see_hr,
    "adms": _can_see_adms,
    "desk": _has_desk_access,
}


def _can_see_by_roles(tile_name: str) -> bool:
    wanted = {
        r["role"]
        for r in frappe.get_all(
            "Launcher Tile Role", filters={"parent": tile_name}, fields=["role"]
        )
    }
    return bool(wanted & set(frappe.get_roles()))
```

Then the new `apps` assembly inside `get_launcher` (replacing the old try block):

```python
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
            gate = t.get("gate")
            if gate == "roles":
                predicate = (lambda name: lambda: _can_see_by_roles(name))(t["name"])
            else:
                predicate = _GATE_FUNCS.get(gate)
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
```

And extend the `user` dict with `can_manage_tiles`:

```python
    user = {
        "full_name": full_name,
        "initials": _initials(full_name),
        "image_url": _user_image(),
        "can_manage_tiles": "System Manager" in set(frappe.get_roles()),
    }
```

Remove the now-unused `SITE_FAVICON_LOGO` import only if nothing else uses it (the desk tile's logo now comes from the seeded DocType row). Verify with grep before removing.

- [ ] **Step 4: GREEN** — `python3.13 -m unittest dewey_time.tests.test_launcher -v`. All pass, output pristine.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/launcher.py dewey_time/tests/test_launcher.py
git commit -m "feat(home): get_launcher reads Launcher Tile DocType (hybrid gate) + can_manage_tiles"
```

---

## Task B3: Home SPA routing + admin route guard

**Files:**
- Modify: `dewey_time/frontend/home/src/main.tsx`
- Modify: `dewey_time/frontend/home/src/types.ts`
- Create: `dewey_time/frontend/home/src/AdminTiles.tsx` (placeholder this task; filled in B4)

**Interfaces:**
- Consumes: `react-router-dom` (already a dep). `get_launcher` `user.can_manage_tiles` (B2).
- Produces: `/home` renders `<Launcher/>`; `/home/admin` renders `<AdminTiles/>` only when `can_manage_tiles`, else redirects to `/home`. (BrowserRouter with **no basename** — Frappe rewrites `/home/<path>`; mirrors the HR app.)

- [ ] **Step 1: Extend the type** in `types.ts`:

```ts
export interface LauncherData {
  user: { full_name: string; initials: string; image_url?: string | null; can_manage_tiles: boolean };
  apps: LauncherApp[];
}
```

- [ ] **Step 2: Create a placeholder** `AdminTiles.tsx` (replaced in B4) so routing compiles:

```tsx
export function AdminTiles() {
  return <div className="mx-auto max-w-3xl px-5 py-7 text-sm text-muted-foreground">Tile admin — coming up.</div>;
}
```

- [ ] **Step 3: Add routing** in `main.tsx` (mirror the HR app's BrowserRouter + Routes; the admin route is guarded by `can_manage_tiles`):

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FrappeProvider, useFrappeGetCall } from "frappe-react-sdk";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Launcher } from "./Launcher";
import { AdminTiles } from "./AdminTiles";
import type { LauncherData } from "./types";
import "./index.css";

const METHOD = "dewey_time.attendance_engine.launcher.get_launcher";

function AdminGuard() {
  const { data, isLoading } = useFrappeGetCall<{ message: LauncherData }>(METHOD, undefined, METHOD);
  if (isLoading) return null;
  if (!data?.message?.user?.can_manage_tiles) return <Navigate to="/home" replace />;
  return <AdminTiles />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FrappeProvider enableSocket={false}>
      <BrowserRouter>
        <Routes>
          <Route path="/home" element={<Launcher />} />
          <Route path="/home/admin" element={<AdminGuard />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter>
    </FrappeProvider>
  </StrictMode>
);
```

> `useFrappeGetCall` shares the SWR key `METHOD` with `Launcher.tsx`, so the guard reuses the cached launcher payload (no second network call).

- [ ] **Step 4: Add an admin entry point** — in `Launcher.tsx`, when `launcher.user.can_manage_tiles`, add a "Manage tiles" `DropdownMenuItem` to the existing user menu that navigates to `/home/admin` (use `window.location.href = "/home/admin"` to keep it simple, consistent with the Profile item). Gate the menu item on the flag.

- [ ] **Step 5: Build**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/home && npm run build
```
Expected: clean build; `public/home/assets/index.js` + `index.css` + `www/home.html` regenerated.

- [ ] **Step 6: Commit** (include rebuilt `public/home`)

```bash
git add dewey_time/frontend/home/src dewey_time/public/home dewey_time/www/home.html
git commit -m "feat(home): client routing + admin route guard (/home/admin)"
```

---

## Task B4: Admin Tiles management UI

**Files:**
- Modify: `dewey_time/frontend/home/src/AdminTiles.tsx` (full implementation)
- Create: `dewey_time/frontend/home/src/tileTypes.ts`

**Interfaces:**
- Consumes: `frappe-react-sdk` DocType hooks — `useFrappeGetDocList`, `useFrappeCreateDoc`, `useFrappeUpdateDoc`, `useFrappeDeleteDoc` (signatures verified: `createDoc(doctype, doc)`, `updateDoc(doctype, name, partial)`, `deleteDoc(doctype, name)`); dewey-ui `Card`, `Button`, `Input`, `Switch`, `Select*`, `Dialog*`, `Label`, `EmptyState`, `Skeleton`.
- Produces: an admin page listing `Launcher Tile` rows (ordered) with: enable/disable toggle, move up/down (edits `tile_order`), edit (Dialog form: title, route, icon, gate, is_admin), create, delete. The DocType permission (System Manager write) is the enforcement boundary.

- [ ] **Step 1: Create `tileTypes.ts`**

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
  gate: "hr_or_employee" | "adms" | "desk" | "roles";
}

export const GATE_OPTIONS: LauncherTile["gate"][] = ["hr_or_employee", "adms", "desk", "roles"];
```

- [ ] **Step 2: Implement `AdminTiles.tsx`** — list + reorder + toggle + edit/create/delete. Full component:

```tsx
import { useMemo, useState } from "react";
import {
  useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc,
} from "frappe-react-sdk";
import {
  Card, Button, Input, Switch, Label, EmptyState, Skeleton,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@lolbikb/dewey-ui";
import { LayoutGrid } from "lucide-react";
import type { LauncherTile } from "./tileTypes";
import { GATE_OPTIONS } from "./tileTypes";

const DT = "Launcher Tile";
const FIELDS: (keyof LauncherTile)[] = ["name", "app_name", "title", "route", "icon", "tile_order", "enabled", "is_admin", "gate"];

export function AdminTiles() {
  const { data, isLoading, mutate } = useFrappeGetDocList<LauncherTile>(DT, {
    fields: FIELDS as string[], orderBy: { field: "tile_order", order: "asc" }, limit: 0,
  });
  const { updateDoc } = useFrappeUpdateDoc<LauncherTile>();
  const { deleteDoc } = useFrappeDeleteDoc();
  const [editing, setEditing] = useState<Partial<LauncherTile> | null>(null);

  const tiles = useMemo(() => data ?? [], [data]);

  async function toggle(t: LauncherTile) {
    await updateDoc(DT, t.name, { enabled: t.enabled ? 0 : 1 });
    mutate();
  }
  async function move(t: LauncherTile, dir: -1 | 1) {
    const idx = tiles.findIndex((x) => x.name === t.name);
    const swap = tiles[idx + dir];
    if (!swap) return;
    await updateDoc(DT, t.name, { tile_order: swap.tile_order });
    await updateDoc(DT, swap.name, { tile_order: t.tile_order });
    mutate();
  }
  async function remove(t: LauncherTile) {
    if (!confirm(`Delete tile "${t.title}"?`)) return;
    await deleteDoc(DT, t.name);
    mutate();
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Manage app tiles</h1>
          <p className="text-sm text-muted-foreground">Control which apps appear on the home launcher.</p>
        </div>
        <div className="flex gap-2">
          <a href="/home" className="rounded-md border border-border px-3 py-1.5 text-sm">Back</a>
          <Button onClick={() => setEditing({ gate: "roles", enabled: 1, is_admin: 0, tile_order: (tiles.at(-1)?.tile_order ?? 0) + 10 })}>New tile</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : tiles.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="No tiles yet" description="Add a tile to show it on the launcher." />
      ) : (
        <div className="space-y-2">
          {tiles.map((t, i) => (
            <Card key={t.name} className="flex items-center gap-3 p-3">
              <img src={t.icon || ""} alt="" className="size-8 rounded" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                <p className="truncate text-xs text-muted-foreground">{t.route} · {t.gate}{t.is_admin ? " · admin" : ""}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(t, -1)} aria-label="Move up">↑</Button>
                <Button variant="ghost" size="sm" disabled={i === tiles.length - 1} onClick={() => move(t, 1)} aria-label="Move down">↓</Button>
                <Switch checked={!!t.enabled} onCheckedChange={() => toggle(t)} aria-label="Enabled" />
                <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => remove(t)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && <TileDialog tile={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); mutate(); }} />}
    </div>
  );
}

function TileDialog({ tile, onClose, onSaved }: { tile: Partial<LauncherTile>; onClose: () => void; onSaved: () => void }) {
  const isNew = !tile.name;
  const { createDoc } = useFrappeCreateDoc<Partial<LauncherTile>>();
  const { updateDoc } = useFrappeUpdateDoc<LauncherTile>();
  const [form, setForm] = useState<Partial<LauncherTile>>(tile);
  const set = (k: keyof LauncherTile, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (isNew) {
      await createDoc(DT, form);
    } else {
      const { app_name: _ignore, ...rest } = form; // app_name is the id; don't rename here
      await updateDoc(DT, tile.name!, rest);
    }
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isNew ? "New tile" : "Edit tile"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {isNew && <Field label="App name (id)"><Input value={form.app_name ?? ""} onChange={(e) => set("app_name", e.target.value)} /></Field>}
          <Field label="Title"><Input value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Route"><Input value={form.route ?? ""} onChange={(e) => set("route", e.target.value)} placeholder="/my-app" /></Field>
          <Field label="Icon URL"><Input value={form.icon ?? ""} onChange={(e) => set("icon", e.target.value)} placeholder="/assets/dewey_time/images/...svg" /></Field>
          <Field label="Visibility gate">
            <Select value={form.gate} onValueChange={(v) => set("gate", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{GATE_OPTIONS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><Switch checked={!!form.is_admin} onCheckedChange={(v) => set("is_admin", v ? 1 : 0)} /> Admin only</label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!form.title || !form.route || (isNew && !form.app_name)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}
```

> **Note on `roles` gate:** this UI sets the gate but not the `visible_to_roles` child rows (Table MultiSelect editing is deferred — there are zero `roles`-gated tiles today; the seeded three use built-in gates). Editing role lists for custom apps is a follow-up; flag it in the report, do not silently imply it's supported. If `useFrappeGetDocList`'s arg shape differs from `{fields, orderBy, limit}`, consult the installed `frappe-react-sdk` types and adjust (the verified signature is `useFrappeGetDocList(doctype, args?, swrKey?)` with `GetDocListArgs`).

- [ ] **Step 3: Build**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/home && npm run build
```
Expected: clean; assets regenerated. Fix any TS errors (verify dewey-ui export names + SDK arg shapes against `node_modules` types).

- [ ] **Step 4: Commit** (include rebuilt `public/home`)

```bash
git add dewey_time/frontend/home/src dewey_time/public/home dewey_time/www/home.html
git commit -m "feat(home): admin tiles management UI (list/reorder/toggle/edit/create/delete)"
```

---

## Self-Review

- **Spec coverage:** Registry-as-DocType (B1) · `get_launcher` reads it with hybrid gate + fail policy + can_manage_tiles (B2) · routing + cosmetic admin guard (B3) · admin CRUD UI, real boundary = DocType perm (B4). The chosen **hybrid gate** is realized: `gate` Select + `visible_to_roles` child (built-ins in code, `roles` per-tile).
- **Placeholder scan:** no TBD/TODO; all steps carry real code. `roles`-list editing in the UI is an explicit, stated deferral (not a silent gap). `<site>`/token are user-supplied, not code placeholders.
- **Type consistency:** `LauncherTile` fields (B4) match the DocType json (B1) and the `fields` list read in `get_launcher` (B2). `user.can_manage_tiles` defined in B2, typed in B3, consumed in B3/B4. SDK hook calls use the verified signatures (`updateDoc(dt, name, partial)`, `deleteDoc(dt, name)`, `createDoc(dt, doc)`).
- **Verify-on-bench points (flagged, not placeholders):** DocType json sync + seed patch run on `bench migrate` (user); `useFrappeGetDocList` arg shape confirm against installed types (B4 Step 2 note); removal of unused `SITE_FAVICON_LOGO` import contingent on grep (B2 Step 3).
