# frappe-sandbox

A local development harness for the `zkteco_hr` Frappe custom app. Provides a CLI
(`dev/sandbox/frappe-sandbox`) that orchestrates Docker-based backend tests and
Docker-free frontend tests.

## Prerequisites

| Requirement | Notes |
|---|---|
| Docker + Compose v2 | Required for `up`, `install-app`, `seed`, `test --backend`, `exercise`, `verify`, `down` |
| Python 3.9+ | Required for the CLI itself; run from the host |
| Node.js 20+ | Required for `test --frontend` |
| `NODE_AUTH_TOKEN` env var | GitHub PAT with `read:packages` — required to install `@lolbikb/dewey-ui` from GitHub Packages. Without it, frontend install degrades gracefully with a warning (both locally and in CI). |

Check your environment with:

```bash
cd dev/sandbox && ./frappe-sandbox doctor
```

Expected output (Docker + token present):
```
[PASS] docker present
[PASS] compose file exists
[PASS] python >= 3.9
[PASS] NODE_AUTH_TOKEN set (frontend)
```

## CLI verbs

Run all commands from the repo root or the `dev/sandbox/` directory.
`--config` defaults to `dev/sandbox/frappe-sandbox.json`.

```
./frappe-sandbox up                            # start the Docker compose stack
./frappe-sandbox down [--purge]                # stop (--purge removes volumes)
./frappe-sandbox install-app                   # provision a clean test_site + install zkteco_hr
./frappe-sandbox seed --clean                  # alias for install-app (fresh provision)
./frappe-sandbox seed --prod <BACKUP_DIR>      # restore a Frappe Cloud backup into sandbox site
./frappe-sandbox test --backend [--fast] [--module <name>]   # run Python test suite
./frappe-sandbox test --frontend [--unit|--e2e]              # run React unit / E2E tests
./frappe-sandbox exercise --employee <id> --start <date> --end <date> [--mode both|intraday|closeout]
./frappe-sandbox verify                        # run sandbox_verify oracle (emits findings JSON)
./frappe-sandbox doctor                        # environment pre-flight check
./frappe-sandbox --dry-run <verb> ...          # print commands without running them
```

## Backend lanes

Two backend test modes exist:

**Full lane** (`test --backend`) — runs inside Docker via `bench run-tests`. Requires the
stack to be up (`up` + `install-app`). Matches CI exactly.

**Fast lane** (`test --backend --fast`) — runs Python `unittest` directly on the host,
no Docker, no Frappe site. Requires the Python path to be clean. Useful for sub-second
TDD iterations on pure-Python modules (e.g. `intraday.py`, `closeout.py`, `schedule_resolver.py`).

## Frontend lane

`test --frontend` runs inside the frontend directory
(`zkteco_hr/zkteco_hr/frontend/hr_attendance`) — no Docker needed.

- `--unit` → `npm run test:web` (tsx + node:test, runs 6 `src/lib/*.test.ts` files; ~1 s)
- `--e2e` → `npm run test:e2e` (Playwright + Chromium; stubs the Frappe network layer)
- default (no flag) → unit then E2E in sequence

**First-time E2E setup** — install the Chromium browser once:
```bash
cd zkteco_hr/zkteco_hr/frontend/hr_attendance
npx playwright install chromium
```

## Loop recipes

```bash
# --- inner TDD loop (sub-second, no Docker) ---
./frappe-sandbox test --backend --fast --module test_closeout

# --- CI-parity gate before pushing ---
./frappe-sandbox test --backend

# --- frontend unit loop (also Docker-free) ---
./frappe-sandbox test --frontend --unit

# --- real-data triage ---
./frappe-sandbox seed --prod <backup-dir>
./frappe-sandbox exercise --employee <id> --start <date> --end <date>
./frappe-sandbox verify
```

## Seeding from a Frappe Cloud backup (`seed --prod`)

1. Download the backup from Frappe Cloud (site backup → download `.sql.gz` + files tar).
2. Place all three files (`.sql.gz`, `files.tar`, `private-files.tar`) in one local
   directory, e.g. `~/backups/prod-2026-06-01/`.
3. Run:
   ```bash
   ./frappe-sandbox seed --prod ~/backups/prod-2026-06-01
   ```
   The `seed_prod.sh` script restores into the `sandbox` site, anonymises PII
   (employee names → `ANON-<id>`, phone/email → synthetic values), and runs `bench migrate`.
4. The script tolerates `.sql.gz` files produced by both the legacy and the 2024+
   Frappe Cloud backup formats (detected by file-name prefix).

## Implementation notes

**`get-app` copies, not symlinks** (resolved empirically during Docker-runtime
verification): `bench get-app <path>` COPIES the app into `apps/<app>`, so host edits
would not reach the bench. `provision.sh` therefore replaces the copy with a **symlink**
to the bind-mounted source (`apps/<app> -> /workspace/repo`) and re-installs it editable,
so host edits to the app's Python are immediately live.

**HR-role gate** — not an issue: `bench execute` runs as `Administrator`, which passes
`run_engine_for_employee`'s `_require_hr_role()` check; no role grant is needed for
`exercise`.

**Python compatibility** — `frappe/bench:latest` may default to a Python too new for the
pinned Frappe branch (e.g. 3.14 vs v15). `provision.sh` resolves a compatible **pyenv
3.12/3.11** interpreter (which ship dev headers, unlike the bare system python3.11);
override with `PYTHON_BIN`.

**Custom fields / app setup (`bootstrap`)** — apps often need custom fields or seed
masters that `install-app` doesn't create. Declare `bootstrap_method` in
`frappe-sandbox.json` (e.g. `zkteco_hr.utils.sandbox_bootstrap.run`); the harness runs it
after provisioning (`test_site`) and after `seed --prod` (`sandbox`). `zkteco_hr` uses it
to create its `custom_device_branch` / `custom_lunch_*` / `custom_grace_minutes` fields,
which the app does not ship as fixtures. Run manually with `./frappe-sandbox bootstrap
[--test-site]`.

**`migrate` verb** — a `migrate` subparser exists in the CLI but there is no dedicated
`build_migrate` builder yet (no acceptance bar in Phase 1a). Run migrate directly:
```bash
docker compose -f dev/sandbox/docker-compose.yml exec bench bash -lc \
  "cd frappe-bench && bench --site test_site migrate"
```
A dedicated `./frappe-sandbox migrate` verb is planned for Phase 1b.

## Deferred: Docker not required for frontend

All frontend commands (`test --frontend`, `doctor` NODE_AUTH_TOKEN check) are
Docker-free and run on the host. If Docker is unavailable, `doctor` will report
`[FAIL] compose file exists` and `[FAIL]`/`[PASS] docker present` — this is expected
in CI environments that only run the frontend job. The frontend GitHub Actions workflow
(`.github/workflows/frontend.yml`) runs without Docker.

## Reusing this for other Frappe apps
The generic engine is packaged as the `frappe-sandbox` Claude skill at
`~/.claude/skills/frappe-sandbox/`. To onboard another app: copy its `engine/` into that
app's `dev/sandbox/`, run `./frappe-sandbox init --app <name>`, and fill the scaffolded
config + `anonymize`/`sandbox_verify` stubs. See the skill's `SKILL.md`.
