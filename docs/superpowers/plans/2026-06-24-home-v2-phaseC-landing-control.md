# Home v2 Phase C — Landing control (role-based, reversible)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** A System-Manager-only "Landing" panel in `/home/admin` that makes `/home` the post-login landing **per role** (instantly reversible), correctly handling the `default_workspace` footgun via snapshot-and-restore. This is the in-app answer to "how do we direct users to `/home` after auth", replacing manual Desk edits.

**Architecture:** A whitelisted backend module reads/sets `Role.home_page` (the value `"home"`, no leading slash — verified against frappe v16 `get_home_page`, which `.strip('/')`s). Enabling a role also snapshots+nulls the `default_workspace` of that role's System Users (it outranks everything); disabling restores it. All writes call `frappe.website.utils.clear_cache()` so changes take effect with **no deploy** (the kill-switch). The `/home/admin/landing` SPA page lists roles with a toggle + diagnostics for settings that could mask the toggle.

**Tech Stack:** Frappe v16 (Python), React 19 + `@lolbikb/dewey-ui` + `frappe-react-sdk`. Tests: mock-based `unittest` (`python3.13 -m unittest`).

## Global Constraints
- **Verified value:** store `"home"` (NOT `/home`) in `Role.home_page`. `get_home_page()` strips slashes; the Website-User login path prepends `/`.
- **Cache:** after ANY landing write, call `frappe.website.utils.clear_cache()` (no path arg) — `frappe.db.set_value` does NOT clear the per-user `home_page` Redis hash. (Note in UI: landing is computed at login; active sessions keep their old landing until next login.)
- **default_workspace footgun (verified):** a System User's `default_workspace` returns unconditionally from `get_home_page()`, outranking `Role.home_page`. Enabling landing for a role MUST null `default_workspace` for that role's System Users; disabling MUST restore the snapshot.
- **Snapshot model:** persist a JSON dict `{user_email: original_default_workspace}` in **Dewey Time Settings**. On enable, record a user only if not already recorded. On disable, restore + remove a user ONLY if they hold no other landing-on role (handles users in multiple landing roles).
- **Gating:** every landing API guards with `frappe.only_for("System Manager")` — the real boundary (the SPA route guard is cosmetic). No green surface tint; light-only; reuse `@lolbikb/dewey-ui`.
- `NODE_AUTH_TOKEN` is in the build env — **never print it.** Build with `cd dewey_time/frontend/home && npm run build`; commit rebuilt `public/home`.
- **⛔ GIT HYGIENE (a prior subagent caused an incident):** stay on the current branch; NEVER checkout/switch/branch/pull/fetch/merge/rebase/stash or make worktrees; NEVER `git add -A`/`.`/`-a`; stage ONLY the paths a task names.

---

## Task C1: Backend — landing config APIs + snapshot field + tests

**Files:**
- Create: `dewey_time/attendance_engine/landing.py`
- Modify: `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json` (add a hidden snapshot field)
- Test: `dewey_time/tests/test_landing.py`

**Interfaces (Produces):**
- `get_landing_state() -> {"roles": [{"role": str, "enabled": bool, "user_count": int}], "masks": {"portal_home": str|None, "home_page_hook": bool, "default_app": str|None}, "note": str}` — whitelisted, System Manager only.
- `set_role_landing(role: str, enabled: bool|int|str) -> {"role": str, "enabled": bool}` — whitelisted, System Manager only; performs the Role.home_page write + default_workspace snapshot/restore + cache clear.

**Helpers (internal):** `_assignable_roles()`, `_system_users_with_role(role)`, `_load_snapshot()/_save_snapshot(dict)`, `_user_has_other_landing_role(user, excluding_role)`.

- [ ] **Step 1: Add the snapshot field to Dewey Time Settings.** Read `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json` first to match its exact field syntax. Add to `field_order` and `fields` a hidden Long Text:

```json
{
  "fieldname": "landing_workspace_snapshot",
  "fieldtype": "Long Text",
  "label": "Landing Workspace Snapshot",
  "hidden": 1,
  "description": "JSON {user: original default_workspace} saved when role-based landing is enabled; used to restore on disable. Managed by attendance_engine.landing."
}
```
Validate: `python3.13 -c "import json; json.load(open('dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json')); print('json ok')"`.

- [ ] **Step 2: Write the failing tests** `dewey_time/tests/test_landing.py` (mock-based; mirror `test_launcher.py` idioms — `_install_frappe_mock`, `_patched_throw`):

```python
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import landing as mod  # noqa: E402

mod.frappe.PermissionError = PermissionError


class SetRoleLandingTests(unittest.TestCase):
    def _common(self, *, roles_of_user=None):
        # Patch the helpers + frappe writes; capture set_value calls.
        self.sets = []
        def _set_value(dt, name, field, value=None):
            self.sets.append((dt, name, field, value))
        return _set_value

    def test_non_system_manager_rejected(self):
        with patch.object(mod.frappe, "only_for", side_effect=PermissionError("nope")):
            with self.assertRaises(PermissionError):
                mod.set_role_landing("HR User", True)

    def test_enable_sets_role_home_page_and_nulls_workspace_and_clears_cache(self):
        sv = self._common()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe.db, "set_value", side_effect=sv), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod.frappe.db, "get_value", return_value="Welcome Workspace"), \
             patch.object(mod, "_load_snapshot", return_value={}), \
             patch.object(mod, "_save_snapshot") as save_snap, \
             patch.object(mod, "_clear_cache") as clear:
            out = mod.set_role_landing("HR User", True)
        self.assertEqual(out, {"role": "HR User", "enabled": True})
        self.assertIn(("Role", "HR User", "home_page", "home"), self.sets)
        self.assertIn(("User", "a@x.com", "default_workspace", None), self.sets)
        save_snap.assert_called_once()
        self.assertEqual(save_snap.call_args[0][0], {"a@x.com": "Welcome Workspace"})
        clear.assert_called_once()

    def test_enable_does_not_overwrite_existing_snapshot_entry(self):
        sv = self._common()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe.db, "set_value", side_effect=sv), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod.frappe.db, "get_value", return_value="NEW"), \
             patch.object(mod, "_load_snapshot", return_value={"a@x.com": "ORIGINAL"}), \
             patch.object(mod, "_save_snapshot") as save_snap, \
             patch.object(mod, "_clear_cache"):
            mod.set_role_landing("HR User", True)
        # existing snapshot kept; default_workspace NOT re-nulled-from-NEW into snapshot
        self.assertEqual(save_snap.call_args[0][0], {"a@x.com": "ORIGINAL"})

    def test_disable_clears_role_and_restores_when_no_other_landing_role(self):
        sv = self._common()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe.db, "set_value", side_effect=sv), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod, "_load_snapshot", return_value={"a@x.com": "ORIGINAL"}), \
             patch.object(mod, "_user_has_other_landing_role", return_value=False), \
             patch.object(mod, "_save_snapshot") as save_snap, \
             patch.object(mod, "_clear_cache"):
            out = mod.set_role_landing("HR User", False)
        self.assertEqual(out, {"role": "HR User", "enabled": False})
        self.assertIn(("Role", "HR User", "home_page", ""), self.sets)
        self.assertIn(("User", "a@x.com", "default_workspace", "ORIGINAL"), self.sets)
        self.assertEqual(save_snap.call_args[0][0], {})  # entry removed

    def test_disable_keeps_workspace_nulled_if_user_in_another_landing_role(self):
        sv = self._common()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe.db, "set_value", side_effect=sv), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod, "_load_snapshot", return_value={"a@x.com": "ORIGINAL"}), \
             patch.object(mod, "_user_has_other_landing_role", return_value=True), \
             patch.object(mod, "_save_snapshot") as save_snap, \
             patch.object(mod, "_clear_cache"):
            mod.set_role_landing("HR User", False)
        # not restored; snapshot entry retained
        self.assertNotIn(("User", "a@x.com", "default_workspace", "ORIGINAL"), self.sets)
        self.assertEqual(save_snap.call_args[0][0], {"a@x.com": "ORIGINAL"})


class GetLandingStateTests(unittest.TestCase):
    def test_reports_enabled_roles_and_masks(self):
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod, "_assignable_roles", return_value=["HR User", "ADMS Admin"]), \
             patch.object(mod.frappe.db, "get_value", side_effect=lambda dt, n, f: "home" if n == "HR User" else ""), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod.frappe.db, "get_single_value", return_value=None), \
             patch.object(mod.frappe, "get_hooks", return_value=[]):
            out = mod.get_landing_state()
        roles = {r["role"]: r["enabled"] for r in out["roles"]}
        self.assertTrue(roles["HR User"])
        self.assertFalse(roles["ADMS Admin"])
        self.assertIn("masks", out)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: RED** — `python3.13 -m unittest dewey_time.tests.test_landing -v` (module missing).

- [ ] **Step 4: Implement** `dewey_time/attendance_engine/landing.py`:

```python
"""Role-based post-login landing control for the /home launcher.

Sets Role.home_page = "home" (verified v16 value; get_home_page strips slashes)
so holders of a role land on /home after login. Because a per-user
default_workspace outranks Role.home_page in get_home_page(), enabling a role
also snapshots + nulls default_workspace for that role's System Users, and
disabling restores it. All writes clear the website cache so changes take
effect with no deploy (the kill-switch). Landing is applied at login, so
changes affect users' NEXT login, not active sessions.
"""

import json

import frappe
from frappe import _

_LANDING_VALUE = "home"
_SETTINGS = "Dewey Time Settings"
_SNAPSHOT_FIELD = "landing_workspace_snapshot"


def _clear_cache():
    # Deletes the per-user "home_page" Redis hash so the new landing is read.
    from frappe.website.utils import clear_cache
    clear_cache()


def _assignable_roles():
    return frappe.get_all(
        "Role",
        filters={"disabled": 0, "is_custom": 0},  # see note below; adjust filter to taste
        pluck="name",
    )


def _system_users_with_role(role):
    users = frappe.get_all("Has Role", filters={"role": role}, pluck="parent")
    if not users:
        return []
    return frappe.get_all(
        "User",
        filters={"name": ["in", users], "user_type": "System User", "enabled": 1},
        pluck="name",
    )


def _load_snapshot():
    raw = frappe.db.get_single_value(_SETTINGS, _SNAPSHOT_FIELD)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}


def _save_snapshot(snapshot):
    frappe.db.set_value(_SETTINGS, _SETTINGS, _SNAPSHOT_FIELD, json.dumps(snapshot))


def _user_has_other_landing_role(user, excluding_role):
    roles = frappe.get_all("Has Role", filters={"parent": user}, pluck="role")
    for r in roles:
        if r == excluding_role:
            continue
        if (frappe.db.get_value("Role", r, "home_page") or "").strip("/") == _LANDING_VALUE:
            return True
    return False


@frappe.whitelist()
def set_role_landing(role, enabled):
    frappe.only_for("System Manager")
    enabled = enabled in (True, 1, "1", "true", "True")
    if not frappe.db.exists("Role", role):
        frappe.throw(_("Unknown role"), frappe.DoesNotExistError)

    snapshot = _load_snapshot()
    users = _system_users_with_role(role)

    if enabled:
        for u in users:
            if u not in snapshot:
                snapshot[u] = frappe.db.get_value("User", u, "default_workspace") or ""
            frappe.db.set_value("User", u, "default_workspace", None)
        frappe.db.set_value("Role", role, "home_page", _LANDING_VALUE)
    else:
        frappe.db.set_value("Role", role, "home_page", "")
        for u in users:
            if _user_has_other_landing_role(u, role):
                continue
            if u in snapshot:
                frappe.db.set_value("User", u, "default_workspace", snapshot.pop(u) or None)

    _save_snapshot(snapshot)
    _clear_cache()
    return {"role": role, "enabled": enabled}


@frappe.whitelist()
def get_landing_state():
    frappe.only_for("System Manager")
    roles = []
    for role in _assignable_roles():
        on = (frappe.db.get_value("Role", role, "home_page") or "").strip("/") == _LANDING_VALUE
        roles.append({
            "role": role,
            "enabled": on,
            "user_count": len(_system_users_with_role(role)),
        })
    masks = {
        "portal_home": frappe.db.get_single_value("Portal Settings", "default_portal_home") or None,
        "home_page_hook": bool(frappe.get_hooks("home_page")),
        "default_app": frappe.db.get_single_value("System Settings", "default_app") or None,
    }
    return {
        "roles": roles,
        "masks": masks,
        "note": "Landing applies at next login; active sessions are unaffected.",
    }
```

> **Note on `_assignable_roles` filter:** read the `Role` doctype on a real bench if unsure; `is_custom`/`disabled` filters may need adjustment. If `frappe.only_for` raises a different class under the mock, the test patches it — fine. Confirm `frappe.DoesNotExistError` exists (it does in v16); if the mock lacks it, set `mod.frappe.DoesNotExistError = Exception` in the test.

- [ ] **Step 5: GREEN** — `python3.13 -m unittest dewey_time.tests.test_landing -v`. All pass.

- [ ] **Step 6: Commit** (stage ONLY these paths):
```bash
git add dewey_time/attendance_engine/landing.py dewey_time/tests/test_landing.py dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json
git commit -m "feat(home): role-based landing control APIs (Role.home_page + workspace snapshot)"
```

---

## Task C2: Frontend — Landing control admin page

**Files:**
- Create: `dewey_time/frontend/home/src/LandingControl.tsx`
- Modify: `dewey_time/frontend/home/src/main.tsx` (add `/home/admin/landing` route, guarded like `/home/admin`)
- Modify: `dewey_time/frontend/home/src/AdminTiles.tsx` (add a nav link to Landing)

**Interfaces (Consumes):** `get_landing_state` / `set_role_landing` via `frappe-react-sdk` `useFrappeGetCall` / `useFrappePostCall` (the call-hook pattern the HR app uses — NOT DocType hooks). `set_role_landing` args: `{ role, enabled }`.

- [ ] **Step 1: Implement `LandingControl.tsx`** — lists roles with a toggle, shows mask warnings + the "applies at next login" note, confirms before enabling, surfaces errors:

```tsx
import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Card, Switch, Skeleton, EmptyState, Button } from "@lolbikb/dewey-ui";
import { Compass } from "lucide-react";

const GET = "dewey_time.attendance_engine.landing.get_landing_state";
const SET = "dewey_time.attendance_engine.landing.set_role_landing";

interface RoleRow { role: string; enabled: boolean; user_count: number; }
interface LandingState {
  roles: RoleRow[];
  masks: { portal_home: string | null; home_page_hook: boolean; default_app: string | null };
  note: string;
}

export function LandingControl() {
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: LandingState }>(GET, undefined, GET);
  const { call } = useFrappePostCall<{ message: { role: string; enabled: boolean } }>(SET);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const state = data?.message;

  async function toggle(row: RoleRow) {
    setError(null);
    if (!row.enabled && !confirm(`Make /home the landing page for everyone with the "${row.role}" role? They'll see it at their next login.`)) return;
    setBusy(row.role);
    try {
      await call({ role: row.role, enabled: !row.enabled });
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const masks = state?.masks;
  const maskWarnings = [
    masks?.portal_home && `Portal Settings home is "${masks.portal_home}"`,
    masks?.home_page_hook && "an app sets a home_page hook",
    masks?.default_app && `System default app is "${masks.default_app}"`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Landing control</h1>
          <p className="text-sm text-muted-foreground">Choose which roles land on /home after login.</p>
        </div>
        <a href="/home/admin" className="rounded-md border border-border px-3 py-1.5 text-sm">App tiles</a>
      </div>

      {error && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      {state?.note && <p className="mb-3 text-xs text-muted-foreground">{state.note}</p>}
      {maskWarnings.length > 0 && (
        <div className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Heads up — these settings can override the landing page for some users: {maskWarnings.join("; ")}.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !state?.roles.length ? (
        <EmptyState icon={Compass} title="No roles found" description="No assignable roles to configure." />
      ) : (
        <div className="space-y-2">
          {state.roles.map((r) => (
            <Card key={r.role} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.role}</p>
                <p className="text-xs text-muted-foreground">{r.user_count} desk user{r.user_count === 1 ? "" : "s"}{r.enabled ? " · lands on /home" : ""}</p>
              </div>
              <Switch checked={r.enabled} disabled={busy === r.role} onCheckedChange={() => toggle(r)} aria-label={`Land ${r.role} on /home`} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

> Confirm the dewey-ui exports used (`Card`, `Switch`, `Skeleton`, `EmptyState`, `Button`) against `node_modules/@lolbikb/dewey-ui/dist/index.d.ts`; adjust if a name differs. `Button` may be unused — drop the import if so (no unused-import errors).

- [ ] **Step 2: Add the route** in `main.tsx` — mirror the existing `/home/admin` `AdminGuard`. Refactor the guard so it can wrap either page, e.g.:

```tsx
import { LandingControl } from "./LandingControl";
// ...
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useFrappeGetCall<{ message: LauncherData }>(METHOD, undefined, METHOD);
  if (isLoading) return (/* existing skeleton shell */);
  if (!data?.message?.user?.can_manage_tiles) return <Navigate to="/home" replace />;
  return <>{children}</>;
}
// routes:
// <Route path="/home/admin" element={<AdminGuard><AdminTiles /></AdminGuard>} />
// <Route path="/home/admin/landing" element={<AdminGuard><LandingControl /></AdminGuard>} />
```
(Keep the existing loading-skeleton markup from B3; just parameterize the guarded child.)

- [ ] **Step 3: Add a nav link** in `AdminTiles.tsx` header — next to "New tile", add `<a href="/home/admin/landing" className="rounded-md border border-border px-3 py-1.5 text-sm">Landing</a>`.

- [ ] **Step 4: Build** — `cd dewey_time/frontend/home && npm run build`. Clean; assets + `www/home.html` regenerated. Fix any TS errors.

- [ ] **Step 5: Commit** (stage ONLY these paths):
```bash
git add dewey_time/frontend/home/src dewey_time/public/home dewey_time/www/home.html
git commit -m "feat(home): landing control admin page (/home/admin/landing)"
```

---

## Self-Review
- **Spec coverage:** role-based landing (C1 `set_role_landing` writes `Role.home_page="home"`) · snapshot&clear default_workspace (C1, with multi-role-aware restore) · instant kill-switch (toggle off = clear + restore + cache clear, no deploy) · state + mask diagnostics (C1 `get_landing_state`) · System-Manager gate (`frappe.only_for`) · admin UI with confirm + errors + "next login" note (C2). The two locked decisions (role-based model; snapshot & clear) are both realized.
- **Placeholder scan:** no TBD/TODO; all steps carry real code. The `_assignable_roles` filter + `DoesNotExistError`/`only_for` mock details are flagged as verify-on-bench, not placeholders.
- **Type/contract consistency:** `get_landing_state`/`set_role_landing` shapes in C1 match `LandingState`/the `call({role, enabled})` in C2. Value `"home"` (slashless) used consistently. Cache cleared after every write.
- **Verify-on-bench (flagged):** `_assignable_roles` filter correctness; `frappe.only_for` raising `frappe.PermissionError`; whether any installed app sets a `home_page` hook / Portal home (surfaced as masks). Full effect requires `bench migrate` (adds the settings field) + a clean login QA for both a System and a Website user.
