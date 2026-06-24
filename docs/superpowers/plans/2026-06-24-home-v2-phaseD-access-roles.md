# Home v2 Phase D — Access & roles view + tile role-picker

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Two final admin pieces. (1) **Role-picker:** re-enable the `roles` tile gate by letting admins choose which roles see a tile (completes the hybrid gate deferred in Phase B). (2) **Access & roles view:** a read-only `/home/admin/access` screen showing who holds the Dewey roles (HR / ADMS / desk) and who lands on `/home`.

**Architecture:** A new System-Manager-gated backend module `attendance_engine/access.py` provides: `get_assignable_roles`, `get_tile_roles`, `set_tile_roles` (writes the `Launcher Tile`'s `visible_to_roles` child rows **server-side** — avoids SDK child-table wrangling, atomic + permission-checked), and `get_access_overview` (read-only roster). The home SPA gains a role-picker in the existing tile dialog and a new `/home/admin/access` page; a small shared `AdminNav` cross-links the three admin pages.

**Tech Stack:** Frappe v16 (Python) + React 19 + `@lolbikb/dewey-ui` + `frappe-react-sdk`. Tests: mock-based `unittest` (`python3.13 -m unittest`).

## Global Constraints
- **Access view is read-only (view-first).** No role assignment from the UI — changes happen in Desk. Don't add write/grant paths.
- Every backend API guards with `frappe.only_for("System Manager")` — the real boundary; the SPA `AdminGuard` is cosmetic.
- `roles`-gated tile visibility already works in `get_launcher` (`_can_see_by_roles` reads `Launcher Tile Role` child rows). This phase only adds the *editor* + re-enables the dropdown option.
- Landing value is `"home"` (no slash); a role "lands on /home" if its `Role.home_page.strip("/") == "home"`.
- Brand: green/orange/red are **signal only**; light-only; reuse `@lolbikb/dewey-ui`. `NODE_AUTH_TOKEN` is in the build env — **never print it.** Commit rebuilt `public/home`.
- **⛔ GIT HYGIENE (a prior subagent caused an incident):** stay on the current branch; NEVER checkout/switch/branch/pull/fetch/merge/rebase/stash or worktrees; NEVER `git add -A`/`.`/`-a`; stage ONLY the paths a task names.

---

## Task D1: Backend — access/roles APIs + tests

**Files:**
- Create: `dewey_time/attendance_engine/access.py`
- Test: `dewey_time/tests/test_access.py`

**Interfaces (Produces, all whitelisted + System-Manager-gated):**
- `get_assignable_roles() -> list[str]` — enabled, non-pseudo roles (for the picker).
- `get_tile_roles(tile: str) -> list[str]` — the role names in a tile's `visible_to_roles`.
- `set_tile_roles(tile: str, roles: list[str]|str) -> {"tile": str, "roles": list[str]}` — replaces the tile's `visible_to_roles` child rows.
- `get_access_overview() -> {"users": [{"user","full_name","hr","adms","desk","lands_on_home","roles"}]}`.

- [ ] **Step 1: Write the failing tests** `dewey_time/tests/test_access.py` (mock-based; mirror `test_landing.py`):

```python
import json
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import access as mod  # noqa: E402

mod.frappe.PermissionError = PermissionError


class GuardTests(unittest.TestCase):
    def test_apis_require_system_manager(self):
        for fn in (lambda: mod.get_assignable_roles(),
                   lambda: mod.get_tile_roles("t"),
                   lambda: mod.set_tile_roles("t", []),
                   lambda: mod.get_access_overview()):
            with patch.object(mod.frappe, "only_for", side_effect=PermissionError("no")):
                with self.assertRaises(PermissionError):
                    fn()


class RolePickerTests(unittest.TestCase):
    def test_get_assignable_roles_excludes_pseudo(self):
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_all", return_value=["System Manager", "HR User", "Guest", "All", "Administrator"]):
            self.assertEqual(mod.get_assignable_roles(), ["System Manager", "HR User"])

    def test_get_tile_roles(self):
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_all", return_value=["Sales User", "Support"]):
            self.assertEqual(mod.get_tile_roles("crm"), ["Sales User", "Support"])

    def test_set_tile_roles_writes_child_rows(self):
        captured = {}
        class _Doc:
            def set(self, field, value): captured["field"] = field; captured["value"] = value
            def save(self, **kw): captured["saved"] = True
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_doc", return_value=_Doc()):
            out = mod.set_tile_roles("crm", ["Sales User", "Support"])
        self.assertEqual(captured["field"], "visible_to_roles")
        self.assertEqual(captured["value"], [{"role": "Sales User"}, {"role": "Support"}])
        self.assertTrue(captured["saved"])
        self.assertEqual(out, {"tile": "crm", "roles": ["Sales User", "Support"]})

    def test_set_tile_roles_accepts_json_string(self):
        class _Doc:
            def set(self, field, value): self.value = value
            def save(self, **kw): pass
        d = _Doc()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_doc", return_value=d):
            mod.set_tile_roles("crm", json.dumps(["A", "B"]))
        self.assertEqual(d.value, [{"role": "A"}, {"role": "B"}])


class AccessOverviewTests(unittest.TestCase):
    def test_overview_computes_flags(self):
        # Has Role rows, landing roles, user info — driven by the doctype arg.
        def _get_all(doctype, **kw):
            if doctype == "Role":  # landing roles query
                return ["HR User"]
            if doctype == "Has Role":
                return [
                    {"parent": "maria@x.com", "role": "HR User"},
                    {"parent": "dev@x.com", "role": "ADMS Admin"},
                ]
            if doctype == "User":
                return [
                    {"name": "maria@x.com", "full_name": "Maria", "user_type": "System User"},
                    {"name": "dev@x.com", "full_name": "Dev", "user_type": "Website User"},
                ]
            return []
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_all", side_effect=_get_all):
            out = mod.get_access_overview()
        rows = {r["user"]: r for r in out["users"]}
        self.assertTrue(rows["maria@x.com"]["hr"])
        self.assertTrue(rows["maria@x.com"]["desk"])
        self.assertTrue(rows["maria@x.com"]["lands_on_home"])
        self.assertTrue(rows["dev@x.com"]["adms"])
        self.assertFalse(rows["dev@x.com"]["desk"])
        self.assertFalse(rows["dev@x.com"]["lands_on_home"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: RED** — `python3.13 -m unittest dewey_time.tests.test_access -v` (module missing).

- [ ] **Step 3: Implement** `dewey_time/attendance_engine/access.py`:

```python
"""Access & roles overview + tile role-picker APIs (System-Manager-gated).

Read-only roster of who holds the Dewey roles and who lands on /home, plus the
server-side writer for a Launcher Tile's visible_to_roles (the 'roles' gate).
"""

import json
from collections import defaultdict

import frappe

from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES as ADMS_ROLES
from dewey_time.attendance_engine.hr_calendar import HR_STAFF_ROLES

_PSEUDO_ROLES = {"Administrator", "Guest", "All"}
_LANDING_VALUE = "home"


@frappe.whitelist()
def get_assignable_roles():
    frappe.only_for("System Manager")
    roles = frappe.get_all("Role", filters={"disabled": 0}, pluck="name")
    return [r for r in roles if r not in _PSEUDO_ROLES]


@frappe.whitelist()
def get_tile_roles(tile):
    frappe.only_for("System Manager")
    return frappe.get_all("Launcher Tile Role", filters={"parent": tile}, pluck="role")


@frappe.whitelist()
def set_tile_roles(tile, roles):
    frappe.only_for("System Manager")
    if isinstance(roles, str):
        roles = json.loads(roles or "[]")
    doc = frappe.get_doc("Launcher Tile", tile)
    doc.set("visible_to_roles", [{"role": r} for r in roles])
    doc.save(ignore_permissions=True)
    return {"tile": tile, "roles": list(roles)}


@frappe.whitelist()
def get_access_overview():
    frappe.only_for("System Manager")
    hr_roles = set(HR_STAFF_ROLES)
    adms_roles = set(ADMS_ROLES)
    landing_roles = set(
        frappe.get_all("Role", filters={"home_page": ["in", [_LANDING_VALUE, "/" + _LANDING_VALUE]]}, pluck="name")
    )
    interesting = hr_roles | adms_roles | landing_roles

    by_user = defaultdict(set)
    for row in frappe.get_all("Has Role", filters={"role": ["in", list(interesting)]}, fields=["parent", "role"]):
        by_user[row["parent"]].add(row["role"])

    if not by_user:
        return {"users": []}

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
            continue  # disabled user
        users.append({
            "user": user,
            "full_name": u.get("full_name") or user,
            "hr": bool(uroles & hr_roles),
            "adms": bool(uroles & adms_roles),
            "desk": u.get("user_type") == "System User",
            "lands_on_home": bool(uroles & landing_roles),
            "roles": sorted(uroles & interesting),
        })
    users.sort(key=lambda r: r["full_name"].lower())
    return {"users": users}
```

> Note: `HR_STAFF_ROLES` is a frozenset in `hr_calendar.py`; `ADMS_ROLES` (`ALLOWED_ROLES`) is a set in `dashboard_auth.py`. Confirm both import names before relying on them.

- [ ] **Step 4: GREEN** — `python3.13 -m unittest dewey_time.tests.test_access -v`. All pass.

- [ ] **Step 5: Commit** (stage only these):
```bash
git add dewey_time/attendance_engine/access.py dewey_time/tests/test_access.py
git commit -m "feat(home): access overview + tile role-picker APIs (system-manager gated)"
```

---

## Task D2: Frontend — tile role-picker + re-enable `roles` gate

**Files:**
- Modify: `dewey_time/frontend/home/src/tileTypes.ts` (re-add `"roles"` to `GATE_OPTIONS`)
- Modify: `dewey_time/frontend/home/src/AdminTiles.tsx` (role-picker in `TileDialog`)

**Interfaces (Consumes):** `get_assignable_roles`, `get_tile_roles`, `set_tile_roles` (D1) via `frappe-react-sdk` `useFrappeGetCall`/`useFrappePostCall`.

- [ ] **Step 1: Re-enable `roles`** in `tileTypes.ts` — restore it to `GATE_OPTIONS` and update the comment:

```ts
// All four gates are now selectable; "roles" uses the Visible-to-roles picker.
export const GATE_OPTIONS: LauncherTile["gate"][] = ["hr_or_employee", "adms", "desk", "roles"];
```

- [ ] **Step 2: Add the role-picker to `TileDialog`** in `AdminTiles.tsx`. Add imports (`useFrappeGetCall`, `useFrappePostCall` from `frappe-react-sdk`; `Checkbox` from `@lolbikb/dewey-ui` — confirm the export exists). Inside `TileDialog`, before `return`:

```tsx
  const ASSIGNABLE = "dewey_time.attendance_engine.access.get_assignable_roles";
  const GET_ROLES = "dewey_time.attendance_engine.access.get_tile_roles";
  const SET_ROLES = "dewey_time.attendance_engine.access.set_tile_roles";

  const { data: rolesData } = useFrappeGetCall<{ message: string[] }>(ASSIGNABLE, undefined, ASSIGNABLE);
  const allRoles = rolesData?.message ?? [];
  const { data: tileRolesData } = useFrappeGetCall<{ message: string[] }>(
    GET_ROLES, isNew ? undefined : { tile: tile.name }, isNew ? null : `${GET_ROLES}:${tile.name}`
  );
  const { call: callSetRoles } = useFrappePostCall<{ message: unknown }>(SET_ROLES);
  const [selectedRoles, setSelectedRoles] = useState<string[] | null>(null);
  // Initialize the selection once the existing rows load (edit) or to [] (new).
  const roles = selectedRoles ?? (isNew ? [] : tileRolesData?.message ?? []);
  const toggleRole = (r: string) =>
    setSelectedRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);
```

In `save()`, after the tile create/update succeeds and before `onSaved()`, persist roles when the gate is `roles` (the new tile's name === its `app_name` because of `autoname: field:app_name`):

```tsx
      const tileName = isNew ? form.app_name! : tile.name!;
      if (form.gate === "roles") {
        await callSetRoles({ tile: tileName, roles });
      }
      onSaved();
```

Render the picker in the dialog body, only when `form.gate === "roles"` (place it right after the Visibility gate `Field`):

```tsx
          {form.gate === "roles" && (
            <Field label="Visible to roles">
              <div className="max-h-40 space-y-1.5 overflow-auto rounded-md border border-border p-2.5">
                {allRoles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Loading roles…</p>
                ) : (
                  allRoles.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={roles.includes(r)} onCheckedChange={() => toggleRole(r)} />
                      {r}
                    </label>
                  ))
                )}
              </div>
            </Field>
          )}
```

> Confirm `Checkbox` is exported by `@lolbikb/dewey-ui` (the package's `index.d.ts` lists it). If `useFrappeGetCall` with `null` swrKey to skip the fetch isn't honored by the installed SDK, gate the call another way (e.g. always fetch but ignore for new tiles). Keep the existing tile create/update + `dialogError` try/catch intact — wrap the `callSetRoles` in the same try so a roles-write failure surfaces and does NOT call `onSaved()`.

- [ ] **Step 3: Build** — `cd dewey_time/frontend/home && npm run build`. Clean; assets + `www/home.html` regenerated. Fix any TS errors.

- [ ] **Step 4: Commit** (stage only these):
```bash
git add dewey_time/frontend/home/src/tileTypes.ts dewey_time/frontend/home/src/AdminTiles.tsx dewey_time/public/home dewey_time/www/home.html
git commit -m "feat(home): tile role-picker + re-enable roles gate"
```

---

## Task D3: Frontend — Access & roles view + shared admin nav

**Files:**
- Create: `dewey_time/frontend/home/src/AccessOverview.tsx`
- Create: `dewey_time/frontend/home/src/AdminNav.tsx`
- Modify: `dewey_time/frontend/home/src/main.tsx` (add `/home/admin/access` route)
- Modify: `dewey_time/frontend/home/src/AdminTiles.tsx` and `LandingControl.tsx` (use the shared nav)

**Interfaces (Consumes):** `get_access_overview` (D1).

- [ ] **Step 1: Create `AdminNav.tsx`** — a small cross-link bar for the three admin pages:

```tsx
const LINKS = [
  { href: "/home/admin", label: "App tiles" },
  { href: "/home/admin/landing", label: "Landing" },
  { href: "/home/admin/access", label: "Access" },
];

export function AdminNav({ active }: { active: string }) {
  return (
    <nav className="mb-5 flex gap-1.5">
      {LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className={
            "rounded-md px-3 py-1.5 text-sm " +
            (l.href === active
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
          }
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Create `AccessOverview.tsx`** (read-only roster):

```tsx
import { useFrappeGetCall } from "frappe-react-sdk";
import { Card, Skeleton, EmptyState, Badge } from "@lolbikb/dewey-ui";
import { Users } from "lucide-react";
import { AdminNav } from "./AdminNav";

const GET = "dewey_time.attendance_engine.access.get_access_overview";

interface Row {
  user: string; full_name: string;
  hr: boolean; adms: boolean; desk: boolean; lands_on_home: boolean;
  roles: string[];
}

export function AccessOverview() {
  const { data, isLoading } = useFrappeGetCall<{ message: { users: Row[] } }>(GET, undefined, GET);
  const users = data?.message?.users ?? [];

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <AdminNav active="/home/admin/access" />
      <div className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight">Access &amp; roles</h1>
        <p className="text-sm text-muted-foreground">Who holds the Dewey roles and who lands on /home. Read-only — change roles in Desk.</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="No users" description="No one holds a Dewey-relevant role yet." />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.user} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">{u.user}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {u.hr && <Badge variant="secondary">HR</Badge>}
                {u.adms && <Badge variant="secondary">ADMS</Badge>}
                {u.desk && <Badge variant="secondary">Desk</Badge>}
                {u.lands_on_home && <Badge>/home</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

> Confirm `Badge` is exported and its `variant` prop values (`"secondary"` / default) against `@lolbikb/dewey-ui` `index.d.ts`; adjust if names differ. Don't tint with green — `Badge` defaults are neutral; the `/home` badge may use the default (primary) which is the brand green as a *signal* (acceptable — it marks a state, not a surface).

- [ ] **Step 3: Add the route** in `main.tsx` (guarded like the others):

```tsx
import { AccessOverview } from "./AccessOverview";
// ...
<Route path="/home/admin/access" element={<AdminGuard><AccessOverview /></AdminGuard>} />
```

- [ ] **Step 4: Use the shared nav** in the other two admin pages. In `AdminTiles.tsx` and `LandingControl.tsx`, replace their ad-hoc header links with `<AdminNav active="/home/admin" />` (tiles) and `<AdminNav active="/home/admin/landing" />` (landing) at the top of the returned container. Keep the page's own action buttons (e.g. "New tile") where they are. Import `AdminNav`.

- [ ] **Step 5: Build** — `cd dewey_time/frontend/home && npm run build`. Clean; assets + `www/home.html` regenerated. Fix any TS errors.

- [ ] **Step 6: Commit** (stage only these):
```bash
git add dewey_time/frontend/home/src dewey_time/public/home dewey_time/www/home.html
git commit -m "feat(home): access & roles view + shared admin nav"
```

---

## Self-Review
- **Spec coverage:** role-picker (D2 editor + D1 `set_tile_roles`/`get_tile_roles`/`get_assignable_roles` + re-enabled `GATE_OPTIONS`) realizes the deferred `roles` gate end-to-end (get_launcher already reads the child rows). Access & roles **view-first** (D1 `get_access_overview` read-only + D3 read-only page; no assignment path). System-Manager guard on every API. Shared nav cross-links the 3 admin pages.
- **Placeholder scan:** no TBD/TODO; all steps carry real code. SDK `null`-swrKey skip + dewey-ui `Checkbox`/`Badge` export names are flagged as verify-against-node_modules, not placeholders.
- **Type/contract consistency:** `get_access_overview` row shape matches `Row` in D3; `set_tile_roles({tile, roles})` matches the D2 call; `get_tile_roles`/`get_assignable_roles` return `string[]` consumed as such. `roles`-gate value flows: dialog → `set_tile_roles` → child rows → `get_launcher._can_see_by_roles` (already on main).
- **Verify-on-bench (flagged):** `bench migrate` not required (no schema change — `visible_to_roles`/`Launcher Tile Role` already exist from Phase B); a deploy + the role-picker round-trip + the access roster should be eyeballed on the live site. Confirm `HR_STAFF_ROLES`/`ALLOWED_ROLES` import names.
