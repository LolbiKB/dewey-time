# Launcher Registration Contract — Design (Phase 1)

**Status:** approved design (brainstormed + locked). Phase 1 of a two-phase effort.

## Goal

Make the `/home` launcher **pluggable**: any installed Dewey Frappe app can contribute one or more tiles — and own the visibility logic for each — by publishing a `dewey_launcher_tiles` hook. No app needs to know launcher internals, and the launcher needs to know no product internals.

Phase 1 builds this **registration contract entirely inside `dewey_time`** — no new app, no moved files. `dewey_time` becomes "just another registering app" by declaring its own tiles (Dewey Time, ADMS, Desk) through the hook. This is the *seam*; Phase 2 (separate effort) physically relocates the launcher into a new `dewey_portal` app, at which point the gates travel with their apps and the resolver/registry travel to the portal — a mechanical move because everything already flows through the seam.

## Identity model (recap)

- `/home` is the **company portal** (Dewey International), not a product.
- **"Dewey Time" is the brand of the attendance product** — the tile reads "Dewey Time", never "HR Attendance". Internal names (`/hr-attendance` route, `dewey_time` package, `hr_attendance` frontend dir) are unchanged; the rule is about what users *see*.
- **ADMS** is a vendored bundle hosted by `dewey_time` (its backend — device sync, closeout, bridge, `dashboard_auth` — lives in `dewey_time`). It is **not** its own app. `dewey_time` publishes it as a *second tile*. The contract is per-tile and host-agnostic, so a www-served bundle and a real SPA register identically.

## The contract: `dewey_launcher_tiles` hook

Each app declares a list of tile dicts in its `hooks.py`. `dewey_time`'s declaration:

```python
dewey_launcher_tiles = [
    {
        "key": "dewey_time",                 # stable, globally-unique tile id
        "title": "Dewey Time",
        "route": "/hr-attendance",
        "icon": ATTENDANCE_APP_LOGO,
        "order": 10,                          # default order (seed only — see sync)
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
        "gate": "desk",                       # built-in
    },
]
```

**Field semantics**
- `key` — stable unique id. Maps to the existing `Launcher Tile.app_name` field (already `unique`, already the autoname). Today's prod rows are named `dewey_time`/`adms`/`desk`, which already equal their keys, so no identity migration is needed. (We keep the field name `app_name` on disk; it functions as the tile key.)
- `title`, `route`, `icon`, `is_admin` — **code-owned** (refreshed from the hook on every sync).
- `order` — **seed-only**: written to `tile_order` on first insert, never clobbered afterward (admins reorder freely).
- `gate` — a **built-in name** or a **dotted path** (see Gate model).

## Gate model

A gate decides per-user tile visibility. Gating is cosmetic — every route enforces real auth — so policy is **fail-open for broad tiles (`is_admin=False`), fail-closed for admin tiles (`is_admin=True`)**, preserved exactly from today via `_visible(predicate, policy)`.

**Resolution order** for a `gate` string:
1. If it's a **built-in** (`desk`, `roles`) → use the built-in predicate.
2. Else if it **contains `.`** → treat as a dotted path; resolve with `frappe.get_attr(gate)` and call it `() -> bool`.
3. Else → **unknown gate → skip the tile** (curated safety; preserves today's behavior).

**Built-in gates** (generic, no product knowledge — live in the resolver, will travel to `dewey_portal`):
- `desk` — true if any of the user's roles has `desk_access=1` (today's `_has_desk_access`).
- `roles` — true if the user holds any role in the tile's `visible_to_roles` child table (today's `_can_see_by_roles`). This is the **admin-managed** gate for hand-made tiles; `access.py`'s role-picker APIs stay as-is.

**Dotted-path gates** (owned by the declaring app). `dewey_time` moves its two predicates out of the resolver into a new module it owns:
- `dewey_time/attendance_engine/launcher_gates.py`
  - `can_see_attendance()` — today's `_can_see_hr` (HR staff or linked employee).
  - `can_see_adms()` — today's `_can_see_adms` (holds an ADMS role).

After this, **the resolver's gate dispatch imports no product code** — `dashboard_auth`/ADMS coupling is gone entirely, and the only remaining `hr_calendar` import is the `_employee_linked_to_user` lookup used by the avatar (`_user_image`), cleaned up in Phase 2 when the resolver relocates.

## The reconcile sync

`sync_launcher_tiles()` (new, `dewey_time/attendance_engine/launcher_sync.py`) runs on `after_migrate` and **replaces** the `seed_launcher_tiles` patch. It reconciles hook declarations into `Launcher Tile` rows. It is **reconcile, not replace** — admin choices survive:

1. Aggregate `frappe.get_hooks("dewey_launcher_tiles")` across all installed apps → list of tile dicts. Build `declared_keys = {t["key"]}`.
2. **Key-collision guard:** if two apps declare the same `key`, first-seen wins; log the rest via `frappe.log_error`. Never crash migrate.
3. **Upsert** each declared tile by `key` (= `app_name`):
   - On **insert**: set code-owned fields (`title`, `route`, `icon`, `is_admin`, `gate`), set `source_app` = declaring app, set `tile_order` = `order`, set `enabled` = 1.
   - On **update**: refresh code-owned fields + `source_app` only. **Never touch** `tile_order` or `enabled` (admin-owned after creation).
4. **Prune:** delete any `Launcher Tile` where `source_app` is non-empty **and** its key ∉ `declared_keys` (its app was uninstalled or dropped the tile). Rows with empty `source_app` (admin hand-made) are **never** pruned.
5. Never raise out of `after_migrate`; wrap in try/except + `frappe.log_error`.

**Field ownership summary**

| Field | Owner | Sync behavior |
|---|---|---|
| `title`, `route`, `icon`, `is_admin`, `gate` | code (hook) | overwrite every sync |
| `source_app` | code (sync) | set every sync (provenance) |
| `tile_order` | admin (seeded from `order`) | set on insert only |
| `enabled` | admin | set to 1 on insert only |
| hand-made tile (empty `source_app`) | admin | never touched, never pruned |

## DocType changes (`Launcher Tile`)

- `gate`: **Select → Data** (must allow dotted paths). Description updated to "Built-in name (`desk`, `roles`) or dotted path to a `() -> bool` callable."
- Add `source_app`: **Data, read-only**, label "Source App", description "App that registered this tile (blank = added manually)."
- `app_name` stays the unique identity / tile key (unchanged).
- `field_order` updated to include `source_app`.

Field-type change (Select→Data) and a new nullable field are non-destructive; existing data is preserved and corrected by the first post-migrate sync.

## Admin UI changes (`/home/admin` → `AdminTiles.tsx`)

The reconcile makes managed tiles partly code-owned, so the UI must stop offering edits that silently revert:

- **Managed tiles** (`source_app` non-empty): show a "Managed by `{source_app}`" badge; allow **enable toggle + reorder** only; **hide Edit and Delete** (route/title/gate are code-owned; a delete would be recreated next migrate).
- **Hand-made tiles** (`source_app` empty): full CRUD as today.
- `tileTypes.ts`: add `source_app?: string`; `gate` stays `string`. `GATE_OPTIONS` for the new-tile picker becomes built-ins admins can use without code: `["roles", "desk"]` (default `"roles"`). Custom gates are code-only by design.
- Rebuild the home bundle (`frontend/home` → `public/home`) + asset sync (existing `sync_home_assets`).

## Data flow

```
hooks.py (each app)  ──dewey_launcher_tiles──┐
                                             ▼
  after_migrate ──► sync_launcher_tiles()  reconcile→ Launcher Tile rows
                                             │   (upsert code-owned, keep admin-owned, prune stale)
  admin UI (/home/admin) ──enable/order/hand-made──┘
                                             ▼
  GET /home ──► get_launcher() ──► read enabled rows (order) ──► per-tile gate dispatch
                                       (built-in | dotted-path | skip; fail-open/closed)
                                             ▼
                                   { user, apps:[{name,title,route,logo,admin}] }
```

## Migration / back-compat

- Prod already has 3 `Launcher Tile` rows (`dewey_time`, `adms`, `desk`) from the seed patch. The first post-deploy `after_migrate` sync upserts them: retitles `dewey_time` → "Dewey Time", rewrites the `dewey_time`/`adms` gates to dotted paths, sets `source_app="dewey_time"`, leaves their `enabled`/`tile_order` intact.
- **Remove** `seed_launcher_tiles.py` and its `patches.txt` line — the after_migrate sync seeds fresh installs and reconciles existing ones, making the patch redundant.
- `add_to_apps_screen` (the Frappe-native v16 desktop apps list) is a **separate** feature and is out of scope.

## Testing

Unit tests (mock-based, no bench — follow `test_launcher.py`'s existing `_install_frappe_mock` pattern):

- **Resolver gate dispatch** (`test_launcher.py`, updated):
  - built-in `desk`/`roles` still gate correctly; dotted-path gate resolved via patched `frappe.get_attr`; unknown gate (no `.`, not built-in) skipped; dotted path that raises → fail-open (broad) / fail-closed (admin); `enabled` filter + `tile_order` order preserved; `admin` passthrough; guest rejected.
- **Reconcile sync** (`test_launcher_sync.py`, new):
  - insert sets code fields + `source_app` + `tile_order` + `enabled=1`; re-sync overwrites code fields but **preserves** changed `tile_order`/`enabled`; prune deletes managed rows whose key left the hook set; **never** prunes/edits hand-made (empty `source_app`) rows; duplicate-key collision logs and first-wins; exception path is swallowed.
- **Gate module** (`test_launcher_gates.py`, new): `can_see_attendance` / `can_see_adms` return the right booleans for HR/employee/ADMS-role personas.

## Out of scope (Phase 2 / later)

- Physical `dewey_portal` app extraction (home SPA, login skin, `Launcher Tile` DocType, resolver) + prod data-migration patch to re-home the DocType + asset-path rewrites. Separate spec.
- Renaming routes/packages/dirs.
- De-duplicating `add_to_apps_screen` against the launcher registry.
- Letting hooks supply `roles` defaults for the `roles` gate (admins assign roles in the UI for now).
```
