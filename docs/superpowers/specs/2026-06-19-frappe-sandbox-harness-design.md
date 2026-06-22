# Frappe Dev-Automation Harness — Design (Phase 1 detailed + roadmap)

- **Date:** 2026-06-19
- **Status:** Approved (Phase 1 design); roadmap captures the north star
- **Owner:** LolbiKB
- **Scope:** Phase 1 is the build target. Later phases are design intent so Phase 1 leaves the right seams.

## 1. Context & Goal

We want to maximize **dev automation** for Frappe custom-app work and make it
**autonomous-loop-friendly** (`/loop` + the goal skill). Concretely: give a Claude Code
agent (and humans/CI) a fast, disposable, safe environment to run tests, iterate TDD
unattended, and — the **north star** — **exercise the real system against real
(anonymized) production data and surface real bugs with zero human input**, then loop on it.

This starts on `dewey_time` but is **structured to generalize** to other Frappe custom
apps / Frappe Cloud projects.

### Why a local harness and not "an MCP into Frappe Cloud"

For a **local** sandbox driven in loops, **Bash-over-Docker beats an MCP**: faster,
deterministic, no network flakiness, no auth-token expiry mid-loop. An MCP earns its keep
only for typed access to a *remote* instance or for *other* agents/tools — deferred to the
generalization phase.

## 2. Where this sits — three delivery layers & relationship to `setup-ci`

The single biggest source of confusion is calling this "CI." It is not. A healthy delivery
lifecycle has **three distinct layers**, and this harness is layer ①:

```
① INNER LOOP (local, you/agent)   ② CI (cloud, on push/PR)        ③ CD (promote to prod)
   edit → test → fix, fast            clean ephemeral gate            build once → deploy
   ★ THIS HARNESS                     setup-ci + tests.yml           (today: manual
     • warm local bench                • backend run-tests             bench migrate;
     • real-data triage                • frontend E2E (authored)       no automation)
     • autonomous verify loop          • backend-STUBBED, hermetic
```

- **The harness = layer ①** — a *developer/agent environment*, not a pipeline. It runs
  **before** code reaches CI, and it is where open-ended, real-data exploration happens.
- **`setup-ci` = layer ② authoring.** It is a one-time recipe that writes the cloud gate
  (lint / E2E / integration jobs) and is **backend-stubbed by design** (`page.route`, mock
  mode). It almost certainly produced this repo's `ci+frontend-e2e-and-unit` worktree.
- **CD = layer ③** — largely absent today (manual `build` + `bench migrate`).

**Division of labour (do not duplicate):**
- `setup-ci` **owns** CI authoring and the frontend E2E gate. The harness **consumes** that
  output — it does not re-derive Playwright configs or CI YAML.
- The harness **owns** the local, real-data, loopable inner loop and the autonomous
  verification that CI fundamentally cannot do (CI only checks what a human pre-wrote;
  the harness *discovers*).
- **Key complement:** the harness's parity lane (`test --backend`) is the local gate that
  makes "push straight to main" safe — run it before pushing, since CI currently runs
  *after* push.

### 2.1 Distribution & reuse — a skill, not a repo

The harness reuses across your other Frappe Cloud apps as **three artifacts**, each in its
right home:

- **A Claude skill `frappe-sandbox`** (portable; any agent installs it) — bundles the
  *generic engine* (docker-compose + CLI) and the recipes (warm loop, autonomous-verify,
  safety guardrail). This is the "add it to their tooling" unit — a sibling to `setup-ci`.
- **A per-app profile** in each app's repo (the coupled ~20%): `frappe-sandbox.yml` +
  `sandbox_profile.py` (scrub spec + exercise commands + invariants).
- **An onboarding procedure** in the skill that *generates* a starter profile for a new app
  (inspect `hooks.py` + doctypes + rules docs → propose yml + scrub + invariant skeleton;
  the human fills the domain truth).

The coupled part **can't be a shared skill** (it's app data) — but the skill is what *mints*
it. Another agent's flow: install skill → onboard the app → fill invariants → loop.

**Sequencing — prove, then package:**
- **1a** build the engine + dewey_time profile in-repo under `dev/sandbox/` and hit the
  acceptance bars (one app, demonstrably working).
- **1b** lift the *proven* engine into the `frappe-sandbox` skill + onboarding generator,
  leaving dewey_time's profile as the reference example. Extract a skill from working usage —
  never abstract first.

## 3. Roadmap

| Phase | What | Status |
|---|---|---|
| **1 — Substrate** | local bench + dual seeding (clean + prod-restore) + warm loop + backend & frontend test lanes. **1a** prove in-repo (acceptance bars); **1b** package the proven engine as the `frappe-sandbox` skill (§2.1) | **this spec** |
| **2 — Autonomous Verification Loop** (the north star) | error capture + the **oracle layer** (crash / invariant / idempotency / regression) + `/loop` & goal-skill driver + remediation-as-PR guardrail. Subsumes "coverage growth" and "flag triage" — both become *outcomes* of this loop. | design intent (§11) |
| 3 — CD | grow deploy-rehearsal into automated deploy to Frappe Cloud on merge, after gates | later |
| 4 — Onboard other apps + optional MCP | onboard your other Frappe Cloud apps via the skill (§2.1); optional remote read-only MCP; `--raw` seeding variant | later |
| **Hygiene track** (parallel, not a phase — do anytime) | merge `frontend.yml`; `.gitignore` + de-commit `node_modules`/built assets; one lockfile + pin deps; make CI a required check | §13 |

## 4. Confirmed Decisions

- **Sandbox host:** local Docker bench. (Docker + capable machine available; FC plan tier unknown, so no SSH/private-bench dependency.)
- **Seeding source:** a backup **downloaded from the Frappe Cloud dashboard** (every tier) — no SSH; real data never leaves the machine.
- **No MCP in Phase 1.** Revisited in Phase 4.
- **Deliverable:** a config-driven CLI/scripts engine + a thin Claude skill with loop recipes. CLI first.
- **Harness location & distribution:** in-repo first under `dev/sandbox/` (1a), then lift the proven engine into a portable Claude skill `frappe-sandbox` (1b); per-app profiles live in each app's repo. See §2.1.
- **PII:** restore real data then **anonymize by default, non-skippable** (deterministic, id-preserving). Local-only regardless.
- **Phase 1 scope:** backend **and** frontend.
- **Substrate:** official `frappe/bench` image as base; all value in our CLI.

## 5. Architecture — one substrate, two decoupled lanes

```
frappe-sandbox (CLI, reads dev/sandbox/frappe-sandbox.yml)
│
├─ BACKEND lane → Docker: frappe/bench + mariadb:10.6(utf8mb4) + redis-cache + redis-queue
│   ├─ test_site   (clean; bench run-tests --app dewey_time)   ← CI parity
│   └─ sandbox     (prod backup, restored + anonymized)        ← real-data triage / autonomous verify
│
└─ FRONTEND lane → node 20 + npm (NO bench, NO DB, NO live site)
    ├─ test:web   (tsx + node:test, the 6 src/lib/*.test.ts)
    └─ test:e2e   (Playwright/chromium vs vite dev-server :8080, backend fully stubbed)
```

**The frontend lane needs no backend.** Playwright's `e2e/fixtures.ts` intercepts every
`/api/method/**` and seeds the auth cookie; `FRAPPE_PROXY` points at a dead address on
purpose. So it needs only node + chromium + the npm token — fully decoupled from Docker.

## 6. Backend Lane

### 6.1 Stack (mirror `.github/workflows/tests.yml`)

- `mariadb:10.6` (root pw `root`), **server charset utf8mb4**, TCP / `--no-mariadb-socket`.
- `redis:6.2-alpine` ×2 (cache + queue).
- `frappe/bench:latest` container, `command: sleep infinity`, **named volume** for `frappe-bench/` (apps + sites persist), repo **bind-mounted** at `/workspace/dewey_time-src`.

### 6.2 Required apps (install order = dependency order)

`frappe` → `erpnext` → `hrms` → `dewey_time`, all `version-15`. `erpnext` is required because
**hrms depends on it**; `hrms` provides `Employee Checkin`, `Shift Assignment`, `Shift Type`,
`Shift Schedule`, `Shift Schedule Assignment`, `Holiday List`, `Leave Application`,
`Attendance` (used throughout `attendance_engine/`). `dewey_time` owns only `Attendance Flag`,
`Device Closeout Alert`, `Device Sync Status`.

### 6.3 One-time provisioning (cold path, runs once on the named volume)

```bash
export FRAPPE_BRANCH=version-15 ERPNEXT_BRANCH=version-15 HRMS_BRANCH=version-15
bench init --skip-redis-config-generation --skip-assets \
  --frappe-branch "$FRAPPE_BRANCH" --python "$(which python)" frappe-bench
cd frappe-bench
bench set-config -g db_host mariadb
bench set-config -g redis_cache    "redis://redis-cache:6379"
bench set-config -g redis_queue    "redis://redis-queue:6379"
bench set-config -g redis_socketio "redis://redis-queue:6379"
bench get-app erpnext --branch "$ERPNEXT_BRANCH" --skip-assets
bench get-app hrms    --branch "$HRMS_BRANCH"    --skip-assets
bench get-app dewey_time /workspace/dewey_time-src --skip-assets

# apps.txt trailing-newline guard (nested dewey_time/ layout can skip
# auto-registration AND concatenate into 'hrmsdewey_time' without a trailing newline):
[ -s sites/apps.txt ] && [ -n "$(tail -c1 sites/apps.txt)" ] && echo >> sites/apps.txt
grep -qxF dewey_time sites/apps.txt 2>/dev/null || echo dewey_time >> sites/apps.txt

bench new-site test_site --no-mariadb-socket --db-host mariadb \
  --mariadb-root-password root --admin-password admin
bench --site test_site install-app erpnext hrms dewey_time
bench --site test_site set-config allow_tests true   # MANDATORY — run-tests refuses without it
```

### 6.4 Two test speeds (all 14 backend test files are pure unit tests)

Every backend test installs a MagicMock `frappe` (`_install_frappe_mock` in
`tests/test_closeout.py`) and never reads the DB. Therefore:

- **Fast lane** — `python -m unittest` in a venv (app on `PYTHONPATH`). Sub-second, **no Docker** → the inner `/loop` TDD cycle. (148 methods / 14 files; 3 files need no frappe at all.)
- **Parity lane** — dockerized `bench --site test_site run-tests --app dewey_time` → the gate matching what protects `main`. Accepts `--module …` / `--test …` to scope.

`run-tests` is canonical (CLAUDE.md's old `pytest` reference was wrong and is fixed).

### 6.5 Two sites, never crossed

`test_site` (clean; target of `run-tests`) and `sandbox` (prod-restored + anonymized; triage
and autonomous verify). **Never** run `run-tests` against `sandbox` — it can leave fixtures
and is slow/destructive-ish on real data.

## 7. Frontend Lane (reuse `setup-ci` output)

The `ci+frontend-e2e-and-unit` worktree (branch tip `ac92da92`), produced by `setup-ci`,
already built this; Phase 1 **merges it to main** and wraps it in `frappe-sandbox test
--frontend` — it does **not** re-derive it.

- **Unit:** `test:web` = `tsx --test src/lib/*.test.ts` (`node:test`); devDep `tsx`. **No vitest.**
- **E2E:** `test:e2e` = `playwright test`; `@playwright/test`. Config owns the server
  (`webServer.command: npm run dev`, vite **:8080**), desktop + mobile (both chromium); `e2e/fixtures.ts` stubs all network.
- **Build prereq:** `npm install` requires `NODE_AUTH_TOKEN` (GitHub PAT, `read:packages`) for the private `@lolbikb/dewey-ui`. Use `npm install` (not `npm ci`).
- **Base image:** `mcr.microsoft.com/playwright`; install **chromium only**. **Node 20.**

## 8. Seeding & Anonymization

### 8.1 Backup shape

`<ts>-<site>-database.sql.gz`, `<ts>-<site>-files.tar` (public),
`<ts>-<site>-private-files.tar` (private, may be absent). **Do not** restore the prod
`site_config.json` (carries `encryption_key`/secrets).

### 8.2 Restore (`seed --prod <dir>`)

```bash
bench new-site sandbox --no-mariadb-socket --db-host mariadb \
  --mariadb-root-password root --admin-password admin \
  --install-app erpnext --install-app hrms
bench --site sandbox --force restore <db>.sql.gz \
  --with-public-files <files>.tar \
  --with-private-files <private-files>.tar \   # omit if absent
  --mariadb-root-password root
bench --site sandbox install-app dewey_time   # if not already in the restored DB
bench --site sandbox migrate
# then the non-skippable anonymize pass (8.3)
```

### 8.3 Anonymization (`dewey_time/utils/anonymize.py`, ON by default)

Post-restore, **non-skippable** tail of `seed --prod`. **Deterministic + id-preserving:**
`Employee.employee_name → "Employee {id}"`; mask `first/last_name`, emails, `cell_number`,
`bank_ac_no`, `passport_number`, `date_of_birth`; scrub `Employee Checkin.employee_name`,
`device_id`, `custom_device_serial_number`, geo; also `User`, `Contact`, `Address`.
**Engine-relevant fields untouched:** `time`, `log_type`, `shift`, `custom_supabase_log_id`,
and the `employee` **link** — so engine behavior is identical and triage still correlates a
bug to a real person **by id**. Hard guard refuses to run unless the site is clearly non-prod.

## 9. CLI Surface, Config, Generalization

Config-driven CLI at `dev/sandbox/` reading `dev/sandbox/frappe-sandbox.yml`:

```yaml
app: dewey_time
app_src: .
required_apps: [erpnext, hrms]   # install order = dependency order
branch: version-15
frontend_dir: dewey_time/frontend/hr_attendance
register_app_in_apps_txt: true   # nested-layout newline fix
```

Generalizing to another Frappe app = a new config file.

| Verb | Does |
|---|---|
| `up` / `down` | start/stop the stack; `down --purge` drops volumes |
| `install-app` | get-app erpnext/hrms + get-app from the mount + apps.txt fix + install |
| `seed --clean` \| `--prod <dir>` | build `test_site`; or restore+anonymize `sandbox` |
| `test --backend [--fast] [--module X]` \| `--frontend [--unit\|--e2e]` | run either lane |
| `engine-run --employee … --from … --to …` | run the engine on `sandbox`, dump flags |
| `verify [--oracle crash,invariant,idempotency,regression]` | the autonomous oracle pass (§11) |
| `shell [--console]` | exec into bench / `bench console` |
| `migrate` | re-run patches + DocType sync |
| `doctor` | preflight: Docker up? token set? backup present? volume initialized? |

## 10. The Warm Loop (`/loop`-friendly)

Container stays warm (`sleep infinity`, named volume persists bench + both sites); the app is
**bind-mounted editable** → a host edit is live on the next run with no reinstall. Inner loop =
fast-lane `python -m unittest` (sub-second); before "done", run the parity lane once. Every
step is a single non-interactive `docker compose exec`. The slow cold path (init + get-app
erpnext/hrms + new-site) runs **once**.

## 11. Autonomous Verification Loop (the north star — Phase 2 design intent)

Phase 1 is the substrate; **this** is the point. It lets an agent surface real bugs against
real data with zero input. Four parts:

1. **Run** the real system on the `sandbox` site: `migrate`, the engine (intraday/closeout),
   scheduler jobs, the API, optionally the SPA.
2. **Capture** failures: Python tracebacks + Frappe **Error Log** rows, harvested into a
   machine-readable findings file the agent reads unattended.
3. **Oracle** (the hard part — without it, "find bugs" = "find crashes only"):

   | Oracle | Catches | Notes |
   |---|---|---|
   | **Crash** | exceptions, failed migrate, import errors, hook misconfig | free, unambiguous |
   | **Invariant** | *wrong* output that doesn't crash | encode the rules below |
   | **Idempotency** | non-determinism | run intraday/closeout twice → identical flags |
   | **Regression** | unintended change | snapshot flags for the dataset; diff after a code change |

   Concrete flag-engine invariants (source of truth: `FRAPPE_ATTENDANCE_RULES.md` + the
   flag-type docs — make them executable):
   - no duplicate flags (same employee + date + `flag_code` + `day_closed`);
   - mutually-exclusive flags don't co-occur (e.g. `UNNOTIFIED_ABSENCE` [0 punches] vs `OFF_SHIFT_PUNCH` [punches present]);
   - on-shift + 0 checkins ⇒ exactly `UNNOTIFIED_ABSENCE`; 1 checkin ⇒ `ATTENDANCE_ISSUE` (`single_checkin`);
   - after closeout, no leftover provisional (`day_closed=0`) flag for a closed day;
   - every flag references an existing employee/shift.

   **Encoding these invariants is the highest-leverage, partly domain-specific work in the
   whole program** — and the rules are already written down, so it is "make the spec
   executable," not "invent."

4. **Drive** with `/loop` + goal skill: goal = e.g. *"zero invariant violations on the latest
   snapshot"* or *"PR-fix the top N anomalies"*; loop = `refresh sandbox → verify → log →
   (optional) fix on a branch → re-run gate → append findings`, terminating on goal-met or
   token/time budget.

**Safety guardrail (best practice):**
- **Discover** (read-only on the disposable, anonymized, local sandbox) → **fully
  autonomous, zero input**; blast radius is zero by construction.
- **Fix** (writes code) → autonomous **on a branch**, must pass the parity gate **+
  invariants**, and emits a **PR/diff for human merge**. **Never** an unattended push to `main`.
  This fits the push-to-main workflow: the agent does everything up to the merge; you merge.

Phase 1 must leave the seams for this: structured engine-run output, a place for the
invariant/oracle module, and the `verify` CLI verb stub.

## 12. Error Handling & Reproducibility (Phase 1)

`doctor` preflight; missing `NODE_AUTH_TOKEN` → frontend lane **skips with a warning**
(non-fatal); missing `--with-private-files` tolerated; `allow_tests` always set before
`run-tests`; `apps.txt` newline guard always applied. **Reproducibility risk:** `version-15`
branches track tips → Phase 1 pins the branch like CI; SHA-pinning / a prebuilt base image is
a hardening knob.

## 13. CI/CD Hygiene Gaps (parallel track — not Phase 1, but tracked)

Verified against the repo; high-leverage, independent of the harness:

- ❌ **`node_modules` committed** — 22,329 files tracked; `.gitignore` has no `node_modules`/`dist`. → add `.gitignore`, `git rm -r --cached`.
- ❌ **Built SPA assets committed** — CI uses `--skip-assets` to cope. → build in CI, stop committing output.
- ❌ **Non-reproducible deps** — 12 deps pinned to `"latest"`; **both** `bun.lock` and `package-lock.json` present. → pick one lockfile, pin versions.
- ⚠️ **Frontend CI not on main** — `frontend.yml` lives only in the worktree; main isn't gated on it. → merge it.
- ⚠️ **No real-integration tests** — all 148 backend tests mock frappe; zero real-DB coverage. → the harness's real bench is the place to add a thin integration layer.
- ⚠️ **No CD / gate-before-main** — manual `build` + `bench migrate`; CI runs after push. → Phase 3 + run the parity lane locally before pushing.

## 14. Acceptance Criteria (Phase 1)

1. **One-command green suite:** `up && seed --clean && test --backend` → full backend suite green, repeatable.
2. **Unattended TDD loop:** a scripted red→green demo runs fully unattended (fast lane each iteration) → proves the `/loop` substrate.
3. **Real-data engine run:** `seed --prod <backup> && engine-run --employee …` → prints real (anonymized) flags → proves triage.

Plus: `up`/`down`/`up` idempotent; `test --frontend` runs unit + e2e when the token is present, skips cleanly when not.

## 15. Out of Scope (Phase 1)

The full autonomous-verification build (§11 is design intent only — Phase 1 ships the seams,
not the oracle suite), CD automation, cross-project repo extraction, the optional remote MCP,
and `--raw` seeding. The hygiene track (§13) is parallel, not Phase 1.

## 16. Open Questions / Risks (carry into implementation)

1. Does `bench get-app /workspace/dewey_time-src` on `frappe/bench` symlink (edits live) or copy? If copy → bind-mount directly onto `frappe-bench/apps/dewey_time`. **Verify in the image.**
2. Confirm pip-editable install resolves the **nested** package correctly inside the container.
3. Confirm the exact FC backup variant (separate `site_config.json`? private-files always present?).
4. Anonymization completeness: enumerate every DocType with real PII actually present (Contact, Address, custom doctypes), not a fixed list.
5. Confirm `frappe/bench` plays cleanly pointed at sibling compose services vs its built-in supervisor.
6. Frontend warm loop on host vs in a node container (no root `package.json`).
7. **Oracle authoring effort (Phase 2):** how many invariants to encode initially, and whether the rules docs are precise enough to translate without ambiguity.

## 17. Deliverable Summary (Phase 1)

**1a — prove (in-repo):**
- `dev/sandbox/` — `docker-compose.yml`, the `frappe-sandbox` CLI/scripts, `frappe-sandbox.yml`, a `verify` stub + structured engine-run output (seams for §11).
- `dev/sandbox/sandbox_profile.py` (+ `dewey_time/utils/anonymize.py`) — dewey_time's scrub spec + exercise commands + (later) invariants.
- Frontend: merge the `setup-ci`-produced worktree to main.

**1b — package (skill):**
- A portable `frappe-sandbox` Claude skill bundling the proven engine + loop recipes + an onboarding generator; dewey_time's profile stays in-repo as the reference example. Built via the **writing-skills** skill, from working 1a usage.
