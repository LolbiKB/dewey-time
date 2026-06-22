# Frappe Sandbox Harness — Phase 1b Design (generalize + package as a skill)

- **Date:** 2026-06-19
- **Status:** Approved (design)
- **Owner:** LolbiKB
- **Builds on:** Phase 1a (`docs/superpowers/specs/2026-06-19-frappe-sandbox-harness-design.md` §2.1, and `docs/superpowers/plans/2026-06-19-frappe-sandbox-phase-1a.md`). The Phase 1a harness is merged on `main`.

## 1. Goal

Make the harness's app-specific seams **config-driven**, then package the proven engine
as a portable **`frappe-sandbox` Claude skill** with an **onboarding generator**, so any
Frappe custom app adopts it via *install → init → fill → loop*. dewey_time stays the first
instance and reference profile.

## 2. Confirmed decisions

- **Exercise verb:** config-declared entrypoint **+ typed args** (keeps `--employee`-style UX, fully generic). Replaces the zkteco-hardcoded `engine-run`.
- **Skill location:** a personal skill at `~/.claude/skills/frappe-sandbox/` (promotable to a plugin later).
- **Onboarding:** an `init` command (scaffolding) **+** a `SKILL.md` guide (judgment parts).
- **Two stages:** A = config-driven seams (in-repo, Docker-free, TDD); B = skill packaging + onboarding (assembly + verify).

## 3. Current coupling (what Phase 1b removes)

From the shipped code:
- `commands.build_engine_run` hardcodes `{app}.attendance_engine.dev_tools.run_engine_for_employee` + zkteco kwargs (`employee/start_date/end_date/mode`). **The only true coupling.**
- `commands.build_verify` uses `{app}.utils.sandbox_verify.run` and `seed_prod.sh` uses `$APP.utils.anonymize.run` — already conventions; Phase 1b makes them config-overridable with those conventions as defaults.

## 4. Stage A — Config-driven seams (in-repo, Docker-free, TDD)

### 4.1 Config additions (`frappe-sandbox.json` + `Config`)

```json
{
  "exercise": {
    "method": "dewey_time.attendance_engine.dev_tools.run_engine_for_employee",
    "args": [
      {"flag": "employee", "kwarg": "employee", "required": true},
      {"flag": "start",    "kwarg": "start_date", "required": true},
      {"flag": "end",      "kwarg": "end_date",   "required": true},
      {"flag": "mode",     "kwarg": "mode", "default": "both", "choices": ["intraday","closeout","both"]}
    ]
  },
  "anonymize_method": "dewey_time.utils.anonymize.run",
  "verify_method": "dewey_time.utils.sandbox_verify.run"
}
```

`Config` gains:
- `exercise_method: str | None` and `exercise_args: tuple[ExerciseArg, ...]` where `ExerciseArg` is a frozen dataclass `(flag: str, kwarg: str, required: bool = False, default: str | None = None, choices: tuple[str, ...] | None = None)`.
- `anonymize_method: str` — defaults to `f"{app}.utils.anonymize.run"` when absent.
- `verify_method: str` — defaults to `f"{app}.utils.sandbox_verify.run"` when absent.

`load_config` parses these (validating each `exercise.args` entry has `flag` + `kwarg`); raises `ConfigError` on malformed exercise args.

### 4.2 `commands.py`

- **`build_exercise(cfg, kwargs: dict) -> list[list[str]]`** (replaces `build_engine_run`): emits `bench --site <sandbox> execute <cfg.exercise_method> --kwargs <json.dumps(kwargs, sorted)>`. Raises `ValueError` if `cfg.exercise_method` is None ("no exercise configured — run `init` or add an `exercise` block").
- **`build_verify(cfg)`** uses `cfg.verify_method` (not the hardcoded path).
- **`build_seed_prod(cfg, backup_dir)`** passes `ANONYMIZE_METHOD={cfg.anonymize_method}` in the env to `seed_prod.sh`.

### 4.3 `cli.py` — config-driven `exercise` subcommand (replaces `engine-run`)

argparse needs the config before it can register the `exercise` flags, so use a **two-phase parse**: (1) `parse_known_args` to capture `--config`/`--dry-run`; (2) load config; (3) build the full parser, dynamically adding the `exercise` subcommand's args from `cfg.exercise_args` (each → `--<flag>` with `required`/`default`/`choices`); (4) `parse_args`. Dispatch collects the exercise flags into a `kwargs` dict keyed by each arg's `kwarg`, omitting unset optionals, and calls `build_exercise(cfg, kwargs)`. `engine-run` is removed (zkteco is the only consumer; README + tests updated).

### 4.4 `seed_prod.sh`

Read `ANONYMIZE_METHOD` env (default `"$APP.utils.anonymize.run"`); call `bench --site "$SANDBOX_SITE" execute "$ANONYMIZE_METHOD"`.

### 4.5 `init` command

`frappe-sandbox init --app <name> [--app-src <rel>] [--frontend-dir <rel>]` scaffolds, into the **current `dev/sandbox/` dir** (assumes the engine is already present there — Stage B's onboarding documents getting the engine):
- `frappe-sandbox.json` — `app` set, `app_src`/`frontend_dir` from flags (defaults `../..` and omitted), `required_apps: []` with a `"_TODO"` marker, `branch: "version-15"`, an `exercise` block with `"method": "TODO"`, `"args": []`, and `anonymize_method`/`verify_method` defaulted to the convention.
- Stub `<app-src>/<app>/utils/anonymize.py` — working skeleton: the prod-guard `is_prod_site` + `run()` + `_scrub_statements()` returning `[]` with a `# TODO: enumerate PII columns` comment.
- Stub `<app-src>/<app>/utils/sandbox_verify.py` — `run()` that prints `{"oracle": "stub", "scanned": 0, "violations": []}` + a `# TODO: add invariants` comment.
- Refuses to overwrite existing files (prints a notice, leaves them).

Testable: given a temp app dir, `init` writes a `frappe-sandbox.json` that `load_config` accepts, and the two stub files exist and import cleanly under the test mock.

## 5. Stage B — Package as the `frappe-sandbox` skill (assembly + verify)

Create `~/.claude/skills/frappe-sandbox/` (authored following the **writing-skills** conventions):

```
~/.claude/skills/frappe-sandbox/
  SKILL.md                       # frontmatter (name + description); when-to-use; verbs;
                                 # loop recipes; the discover-vs-fix safety guardrail; onboarding steps
  engine/                        # the GENERIC engine (no zkteco config/profile)
    docker-compose.yml
    frappe_sandbox/              # the CLI package (config, commands, runner, cli)
    scripts/{provision.sh, seed_prod.sh}
    frappe-sandbox               # the shim
    frappe-sandbox.example.json  # an annotated template config
```

- The skill bundles a **copy** of the proven engine, **excluding** zkteco's `frappe-sandbox.json` and its `utils/anonymize.py`/`sandbox_verify.py` (those are per-app).
- **Onboarding (in `SKILL.md`):** *install the skill → copy `engine/` into your app's `dev/sandbox/` (a documented `cp -r`) → `./frappe-sandbox init --app <name>` → fill the scaffolded `exercise` method/args + the `anonymize`/`sandbox_verify` stubs → run the loop.* The `init` command does the mechanical scaffold; `SKILL.md` guides the judgment (which PII fields, which invariants, the exercise entrypoint).
- **zkteco's existing `dev/sandbox/`** stays as the first instance + reference profile.

### Honest drift note
The engine then lives in two places — the skill's `engine/` (canonical, generic) and zkteco's `dev/sandbox/` (its instance). A later follow-up can have zkteco consume the skill's engine to dedupe; not worth coupling now.

## 6. Acceptance criteria

**Stage A** (all Docker-free, TDD):
1. `exercise`/`verify`/`anonymize` are config-driven; with zkteco's config, `frappe-sandbox --dry-run exercise --employee E1 --start 2026-06-01 --end 2026-06-07` emits the *same* `execute …run_engine_for_employee --kwargs {...}` command the old `engine-run` did.
2. `build_verify` and `build_seed_prod` use the config methods (asserted via `--dry-run`/unit tests).
3. `init` scaffolds a `frappe-sandbox.json` that `load_config` accepts + the two importable stubs, in a fixture dir.
4. New unit tests green; the full harness suite + the app fast-lane suite stay green.

**Stage B** (assembly + verify):
5. `~/.claude/skills/frappe-sandbox/` exists with `SKILL.md` + `engine/` (compose, CLI, scripts, shim, example config), excluding zkteco's profile.
6. The bundled CLI runs from the skill: `cd ~/.claude/skills/frappe-sandbox/engine && ./frappe-sandbox --config frappe-sandbox.example.json --dry-run up` prints the compose command (proves the engine is self-contained in the skill).

## 7. Out of scope

- Deduping zkteco's in-repo copy vs the skill's engine.
- Running onboarding end-to-end against a real *second* app (we only have zkteco to prove generalization).
- A remote MCP; `--raw` seeding; Docker-runtime verification (still pending Docker, from Phase 1a).

## 8. Risks / open questions

1. **Two-phase argparse** for config-driven `exercise` flags adds CLI complexity — keep it contained in one helper; unit-test the dynamic registration.
2. **`init` path assumptions** — a generic Frappe app may not have zkteco's nested `app/app/app/` layout; `init` writes stubs at `<app-src>/<app>/utils/` and the user adjusts if their layout differs. Document this.
3. **Skill engine copy** can drift from zkteco's in-repo copy (noted in §5).
4. **`exercise.method` for a new app** is genuinely app-specific (no auto-detection) — `init` writes `"TODO"`; SKILL.md guides choosing it.

## 9. Deliverables

- Stage A: updated `config.py`, `commands.py` (`build_exercise`, config-driven `build_verify`/`build_seed_prod`), `cli.py` (`exercise` + `init`, two-phase parse), `seed_prod.sh`, zkteco's `frappe-sandbox.json` (gains the `exercise` block), updated `README.md`, new unit tests.
- Stage B: `~/.claude/skills/frappe-sandbox/` (SKILL.md + engine bundle + example config).
