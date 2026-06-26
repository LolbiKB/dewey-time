# dewey_portal Cutover Runbook

Phase 2 split the company portal (`/login` + `/home` launcher + `Launcher Tile`
registry + resolver) out of `dewey_time` into a new app, **`dewey_portal`**. The
code is done and unit-tested; this runbook is the **bench / Frappe Cloud** half,
which cannot run in CI. Do it as one coordinated deploy.

## What changed (so you know what to expect)

- New app `dewey_portal` owns `/login` (brand reskin), `/home` (the launcher SPA),
  the `Launcher Tile` + `Launcher Tile Role` DocTypes (now module **"Dewey
  Portal"**), and the resolver/reconcile/landing/access APIs. Its assets live
  under `/assets/dewey_portal/...`; its API methods are `dewey_portal.portal.*`.
- `dewey_time` keeps the HR product + the ADMS bundle, and still **registers its
  tiles** via the `dewey_launcher_tiles` hook plus a new `dewey_portal_access_roles`
  hook. It no longer serves `/home` or `/login`.
- The `Launcher Tile` **records are unchanged** — they live in the DB table, not
  in the owning app. The move only re-homes the DocType *definition*; the
  reconcile (now in the portal) keeps managing the rows, preserving admin
  `enabled`/`tile_order` overrides and any hand-made tiles.

## Steps (single coordinated deploy)

1. **Get the app onto the bench.** From the bench dir:
   `bench get-app /path/to/dewey-portal` (or the GitHub URL once pushed), then
   `bench --site <site> install-app dewey_portal`.
2. **Frappe Cloud:** add `dewey_portal` to the bench group. Deploy **`dewey_portal`
   and the slimmed `dewey_time` together in the same release** (so `/home`+`/login`
   never fall between two apps).
3. **Migrate once:** `bench --site <site> migrate`.
   - The portal's DocType import re-homes `Launcher Tile`/`Launcher Tile Role` to
     module "Dewey Portal" (their `modified` is bumped to force the reimport).
   - `after_migrate` runs `dewey_portal.utils.sync_home_assets.sync_home_assets`
     (publishes the `/home` bundle to `sites/assets/dewey_portal/home`) and
     `dewey_portal.portal.launcher_sync.sync_launcher_tiles` (reconciles tiles
     from every installed app's `dewey_launcher_tiles` hook).
4. **Clear cache:** `bench --site <site> clear-cache`.

## Smoke checks

- `/login` renders the brand reskin (full-bleed aurora, big DI logo, green
  "Continue with Google").
- `/home` renders the launcher; tiles appear per persona (HR/employee sees Dewey
  Time; ADMS-role sees ADMS; System User sees Desk).
- `/home/admin` shows the managed badge on the 3 tiles; **Landing** and **Access**
  sub-pages load (Access groups now come from the `dewey_portal_access_roles` hook).
- **Data preserved:** `SELECT COUNT(*) FROM \`tabLauncher Tile\`;` is unchanged
  from before the deploy, and any previously toggled-off / reordered tile is still
  as the admin left it.

## Rollback

The `Launcher Tile` table is untouched by a rollback. To revert, re-deploy the
previous release (pre-slim `dewey_time`, without `dewey_portal`); `/home`+`/login`
return to being served by `dewey_time`. (Optionally `bench --site <site>
uninstall-app dewey_portal --no-backup` if you also want the app gone — the table
and rows remain.)

## Notes / known follow-ups

- The portal avatar uses the **User image only** (the employee-photo precedence
  was dropped to keep the portal product-agnostic). Re-add later via a hook if
  wanted.
- Shared brand tokens are vendored in both apps for now; hoisting them into
  `@lolbikb/dewey-ui` is a clean future follow-up.
- `dewey_time` still ships `images/DI-logo.svg` + the Geist fonts (used by its own
  favicon/tile icons); removing the now-unused copies is optional cleanup.
