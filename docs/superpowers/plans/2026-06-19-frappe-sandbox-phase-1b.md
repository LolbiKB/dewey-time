# Frappe Sandbox Harness — Phase 1b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the harness's app-specific seams to be config-driven (exercise/verify/anonymize), add an `init` scaffolder, and package the proven engine as a portable `~/.claude/skills/frappe-sandbox` skill — so any Frappe app adopts it.

**Architecture:** Stage A (Tasks 1–4, in-repo, Docker-free, TDD) extends the existing stdlib-only Python CLI: config gains an `exercise` block + `anonymize_method`/`verify_method`; `build_engine_run` becomes config-driven `build_exercise`; the CLI uses a two-phase argparse to register the `exercise` flags from config; an `init` command scaffolds a new app's config + profile stubs. Stage B (Task 5) copies the generic engine into a personal skill with a `SKILL.md` and verifies the bundled CLI runs.

**Tech Stack:** Python 3.9+ (stdlib: argparse, json, dataclasses, pathlib, shutil, unittest), bash, the existing `dev/sandbox/` harness.

## Global Constraints

- **Python 3.9+, stdlib only**, every module starts with `from __future__ import annotations`.
- **Config is JSON** (`frappe-sandbox.json`).
- Harness self-tests run via `cd dev/sandbox && python3 -m unittest discover -s tests`.
- `anonymize_method` defaults to `f"{app}.utils.anonymize.run"`; `verify_method` defaults to `f"{app}.utils.sandbox_verify.run"`.
- The exercise kwargs payload is `json.dumps(kwargs, sort_keys=True)` (deterministic).
- `engine-run` is REMOVED and replaced by config-driven `exercise` (zkteco is the only consumer).
- Two-phase argparse: parse `--config` first, load config, then build the full parser (so `exercise` flags come from config). Keep it contained in `main()`.
- `init` assumes the standard Frappe layout (`<app-src>/<app>/` is the package dir); document that nonstandard nesting (like zkteco's doubled `app/app/app/`) needs manual path adjustment.
- The skill lives at `~/.claude/skills/frappe-sandbox/` and bundles the GENERIC engine only (NOT zkteco's `frappe-sandbox.json` or its `utils/anonymize.py`/`sandbox_verify.py`).
- Commit at the end of each Stage-A task (conventional messages). Stage B writes outside the repo (the skill) plus one repo README-pointer commit.
- Do NOT stage `node_modules`.

---

## Task 1: Config — `exercise` block + `anonymize_method`/`verify_method`

**Files:**
- Modify: `dev/sandbox/frappe_sandbox/config.py`
- Modify: `dev/sandbox/frappe-sandbox.json` (add the `exercise` block)
- Test: `dev/sandbox/tests/test_config.py`

**Interfaces:**
- Produces: `ExerciseArg(flag, kwarg, required=False, default=None, choices=None)` (frozen dataclass); `Config` gains `exercise_method: str | None`, `exercise_args: tuple[ExerciseArg, ...]`, `anonymize_method: str`, `verify_method: str`.

- [ ] **Step 1: Write the failing tests**

Add to `dev/sandbox/tests/test_config.py`:
```python
    def test_exercise_block_parsed(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {
                "app": "dewey_time", "app_src": "../..", "required_apps": ["hrms"],
                "branch": "version-15", "frontend_dir": "../..",
                "exercise": {
                    "method": "dewey_time.attendance_engine.dev_tools.run_engine_for_employee",
                    "args": [
                        {"flag": "employee", "kwarg": "employee", "required": True},
                        {"flag": "mode", "kwarg": "mode", "default": "both", "choices": ["both", "intraday"]},
                    ],
                },
            })
            cfg = load_config(p)
            self.assertEqual(cfg.exercise_method,
                             "dewey_time.attendance_engine.dev_tools.run_engine_for_employee")
            self.assertEqual(len(cfg.exercise_args), 2)
            self.assertEqual(cfg.exercise_args[0].flag, "employee")
            self.assertTrue(cfg.exercise_args[0].required)
            self.assertEqual(cfg.exercise_args[1].default, "both")
            self.assertEqual(cfg.exercise_args[1].choices, ("both", "intraday"))

    def test_method_defaults(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {
                "app": "myapp", "app_src": ".", "required_apps": ["frappe"],
                "branch": "version-15", "frontend_dir": ".",
            })
            cfg = load_config(p)
            self.assertEqual(cfg.anonymize_method, "myapp.utils.anonymize.run")
            self.assertEqual(cfg.verify_method, "myapp.utils.sandbox_verify.run")
            self.assertIsNone(cfg.exercise_method)
            self.assertEqual(cfg.exercise_args, ())

    def test_malformed_exercise_arg_raises(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {
                "app": "x", "app_src": ".", "required_apps": ["frappe"],
                "branch": "version-15", "frontend_dir": ".",
                "exercise": {"method": "x.y.z", "args": [{"flag": "only_flag"}]},
            })
            with self.assertRaises(ConfigError):
                load_config(p)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dev/sandbox && python3 -m unittest tests.test_config -v`
Expected: FAIL (`AttributeError: 'Config' object has no attribute 'exercise_method'`).

- [ ] **Step 3: Implement**

In `dev/sandbox/frappe_sandbox/config.py`, add the `ExerciseArg` dataclass after the imports (and before `Config`):
```python
@dataclass(frozen=True)
class ExerciseArg:
    flag: str
    kwarg: str
    required: bool = False
    default: str | None = None
    choices: tuple[str, ...] | None = None
```
Extend `Config` (append these fields AFTER `compose_file` so existing positional defaults stay valid):
```python
    exercise_method: str | None = None
    exercise_args: tuple[ExerciseArg, ...] = ()
    anonymize_method: str = ""
    verify_method: str = ""
```
In `load_config`, after the `required_apps` validation and before `base = p.parent`, add:
```python
    exercise = data.get("exercise")
    exercise_method: str | None = None
    exercise_args: tuple[ExerciseArg, ...] = ()
    if exercise is not None:
        if not isinstance(exercise, dict) or "method" not in exercise:
            raise ConfigError("exercise must be an object with a 'method'")
        exercise_method = exercise["method"]
        parsed = []
        for a in exercise.get("args", []):
            if not isinstance(a, dict) or "flag" not in a or "kwarg" not in a:
                raise ConfigError("each exercise arg needs 'flag' and 'kwarg'")
            parsed.append(ExerciseArg(
                flag=a["flag"], kwarg=a["kwarg"],
                required=bool(a.get("required", False)),
                default=a.get("default"),
                choices=tuple(a["choices"]) if a.get("choices") else None,
            ))
        exercise_args = tuple(parsed)
```
Then extend the returned `Config(...)` with (keep all existing fields):
```python
        exercise_method=exercise_method,
        exercise_args=exercise_args,
        anonymize_method=data.get("anonymize_method", f"{data['app']}.utils.anonymize.run"),
        verify_method=data.get("verify_method", f"{data['app']}.utils.sandbox_verify.run"),
```

Update `dev/sandbox/frappe-sandbox.json` to add (after `"register_app_in_apps_txt": true`):
```json
  "exercise": {
    "method": "dewey_time.attendance_engine.dev_tools.run_engine_for_employee",
    "args": [
      {"flag": "employee", "kwarg": "employee", "required": true},
      {"flag": "start", "kwarg": "start_date", "required": true},
      {"flag": "end", "kwarg": "end_date", "required": true},
      {"flag": "mode", "kwarg": "mode", "default": "both", "choices": ["intraday", "closeout", "both"]}
    ]
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd dev/sandbox && python3 -m unittest discover -s tests -v`
Expected: PASS (all config tests incl. the 3 new ones).

- [ ] **Step 5: Commit**
```bash
git add dev/sandbox/frappe_sandbox/config.py dev/sandbox/frappe-sandbox.json dev/sandbox/tests/test_config.py
git commit -m "feat(sandbox): config-driven exercise block + anonymize/verify method fields"
```

---

## Task 2: Commands — `build_exercise` + config-driven `build_verify`/`build_seed_prod` + `seed_prod.sh`

**Files:**
- Modify: `dev/sandbox/frappe_sandbox/commands.py`
- Modify: `dev/sandbox/scripts/seed_prod.sh`
- Test: `dev/sandbox/tests/test_commands.py`

**Interfaces:**
- Consumes: `Config.exercise_method`, `Config.verify_method`, `Config.anonymize_method` (Task 1).
- Produces: `build_exercise(cfg, kwargs: dict) -> list[list[str]]`. `build_engine_run` is removed.

- [ ] **Step 1: Write/replace the failing tests**

In `dev/sandbox/tests/test_commands.py`: replace the existing `test_engine_run` method with these, and update `_cfg()` to include exercise config + methods:
```python
    def test_build_exercise(self):
        cfg = _cfg()
        cmd = c.build_exercise(cfg, {"employee": "HR-EMP-1", "start_date": "2026-06-01"})[0]
        joined = " ".join(cmd)
        self.assertIn("--site sandbox execute", joined)
        self.assertIn("dewey_time.attendance_engine.dev_tools.run_engine_for_employee", joined)
        self.assertIn("HR-EMP-1", joined)

    def test_build_exercise_no_method_raises(self):
        cfg = _cfg(exercise_method=None)
        with self.assertRaises(ValueError):
            c.build_exercise(cfg, {})

    def test_verify_uses_config_method(self):
        joined = " ".join(c.build_verify(_cfg(verify_method="myapp.v.run"))[0])
        self.assertIn("execute myapp.v.run", joined)

    def test_seed_prod_passes_anonymize_method(self):
        joined = " ".join(" ".join(x) for x in c.build_seed_prod(_cfg(anonymize_method="myapp.a.run"), "/b"))
        self.assertIn("ANONYMIZE_METHOD=myapp.a.run", joined)
```
Update the `_cfg()` helper to build a `Config` with the new fields (add params with defaults):
```python
from frappe_sandbox.config import Config, ExerciseArg

def _cfg(*, exercise_method="dewey_time.attendance_engine.dev_tools.run_engine_for_employee",
         verify_method="dewey_time.utils.sandbox_verify.run",
         anonymize_method="dewey_time.utils.anonymize.run") -> Config:
    return Config(
        app="dewey_time", app_src="/repo", required_apps=("erpnext", "hrms"),
        branch="version-15", frontend_dir="/repo/fe",
        compose_file="/repo/dev/sandbox/docker-compose.yml",
        exercise_method=exercise_method,
        exercise_args=(ExerciseArg("employee", "employee", required=True),),
        anonymize_method=anonymize_method, verify_method=verify_method,
    )
```
(Keep all the pre-existing command tests; they call `_cfg()` with no args, which still works.)

- [ ] **Step 2: Run to verify failure**

Run: `cd dev/sandbox && python3 -m unittest tests.test_commands -v`
Expected: FAIL (`module 'commands' has no attribute 'build_exercise'`).

- [ ] **Step 3: Implement**

In `dev/sandbox/frappe_sandbox/commands.py`, replace the `build_engine_run` function (lines defining `def build_engine_run...`) with:
```python
def build_exercise(cfg: Config, kwargs: dict) -> list[list[str]]:
    if not cfg.exercise_method:
        raise ValueError("no exercise configured (add an 'exercise' block or run init)")
    payload = json.dumps(kwargs, sort_keys=True)
    args = f"execute {cfg.exercise_method} --kwargs {shlex.quote(payload)}"
    return [docker_exec(cfg, _bench(cfg, args, site=cfg.sandbox_site))]
```
Replace `build_verify` body's `args` line with:
```python
    args = f"execute {cfg.verify_method}"
```
In `build_seed_prod`, add to the `env` dict:
```python
        "ANONYMIZE_METHOD": cfg.anonymize_method,
```

In `dev/sandbox/scripts/seed_prod.sh`: after the `: "${APP:?}" ...` line, add:
```bash
ANONYMIZE_METHOD="${ANONYMIZE_METHOD:-$APP.utils.anonymize.run}"
```
and change the final anonymize line from `execute "$APP.utils.anonymize.run"` to:
```bash
bench --site "$SANDBOX_SITE" execute "$ANONYMIZE_METHOD"
```

- [ ] **Step 4: Run to verify pass + shell syntax**

Run: `cd dev/sandbox && python3 -m unittest discover -s tests -v`
Expected: PASS (all command tests).
Run: `bash -n dev/sandbox/scripts/seed_prod.sh`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**
```bash
git add dev/sandbox/frappe_sandbox/commands.py dev/sandbox/scripts/seed_prod.sh dev/sandbox/tests/test_commands.py
git commit -m "feat(sandbox): config-driven build_exercise/verify/anonymize; drop build_engine_run"
```

---

## Task 3: CLI — config-driven `exercise` (two-phase parse), remove `engine-run`, README

**Files:**
- Modify: `dev/sandbox/frappe_sandbox/cli.py`
- Modify: `dev/sandbox/README.md`
- Test: `dev/sandbox/tests/test_cli.py`

**Interfaces:**
- Consumes: `build_exercise` (Task 2), `Config.exercise_args` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `dev/sandbox/tests/test_cli.py`, add:
```python
    def test_exercise_dry_run(self):
        out = self._run("exercise", "--employee", "E1", "--start", "2026-06-01", "--end", "2026-06-07")
        self.assertIn("run_engine_for_employee", out)
        self.assertIn("E1", out)

    def test_engine_run_removed(self):
        import io
        from contextlib import redirect_stderr
        with self.assertRaises(SystemExit):
            with redirect_stderr(io.StringIO()):
                main(["--config", CONFIG, "--dry-run", "engine-run", "--employee", "E1"])
```
(`_run` already exists from Phase 1a and asserts rc==0.)

- [ ] **Step 2: Run to verify failure**

Run: `cd dev/sandbox && python3 -m unittest tests.test_cli -v`
Expected: FAIL (`exercise` unrecognized; `engine-run` still accepted).

- [ ] **Step 3: Implement — rewrite `main()` and `_build()`**

Replace the whole `_build` function and `main` function in `dev/sandbox/frappe_sandbox/cli.py` with:
```python
def _build(args, cfg) -> list[list[str]]:
    if args.cmd == "up":
        return c.build_up(cfg)
    if args.cmd == "down":
        return c.build_down(cfg, purge=args.purge)
    if args.cmd == "install-app":
        return c.build_provision(cfg)
    if args.cmd == "seed":
        if args.clean:
            return c.build_provision(cfg)
        return c.build_seed_prod(cfg, args.prod)
    if args.cmd == "test":
        if args.frontend:
            mode = "e2e" if args.e2e else "unit" if args.unit else "all"
            return c.build_frontend(cfg, mode=mode)
        return c.build_run_tests(cfg, module=args.module, fast=args.fast)
    if args.cmd == "exercise":
        kwargs = {}
        for a in cfg.exercise_args:
            val = getattr(args, a.flag.replace("-", "_"), None)
            if val is not None:
                kwargs[a.kwarg] = val
        return c.build_exercise(cfg, kwargs)
    if args.cmd == "verify":
        return c.build_verify(cfg)
    raise SystemExit(f"unknown command: {args.cmd}")


def main(argv=None) -> int:
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--config", default=DEFAULT_CONFIG)
    pre.add_argument("--dry-run", action="store_true")
    known, _ = pre.parse_known_args(argv)

    try:
        cfg = load_config(known.config)
    except ConfigError as ex:
        print(f"config error: {ex}", file=sys.stderr)
        return 2

    p = argparse.ArgumentParser(prog="frappe-sandbox", parents=[pre])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("up")
    d = sub.add_parser("down"); d.add_argument("--purge", action="store_true")
    sub.add_parser("install-app")
    s = sub.add_parser("seed")
    s.add_argument("--clean", action="store_true")
    s.add_argument("--prod", metavar="BACKUP_DIR")
    t = sub.add_parser("test")
    t.add_argument("--backend", action="store_true")
    t.add_argument("--frontend", action="store_true")
    t.add_argument("--fast", action="store_true")
    t.add_argument("--unit", action="store_true")
    t.add_argument("--e2e", action="store_true")
    t.add_argument("--module")
    ex = sub.add_parser("exercise")
    for a in cfg.exercise_args:
        kw = {"required": a.required}
        if a.default is not None:
            kw["default"] = a.default
        if a.choices:
            kw["choices"] = list(a.choices)
        ex.add_argument(f"--{a.flag}", **kw)
    sub.add_parser("verify")
    sub.add_parser("doctor")

    args = p.parse_args(argv)
    if args.cmd == "seed" and not args.clean and not args.prod:
        print("seed requires --clean or --prod <BACKUP_DIR>", file=sys.stderr)
        return 2
    if args.cmd == "test" and not args.backend and not args.frontend:
        print("test requires --backend or --frontend", file=sys.stderr)
        return 2
    cwd = str(Path(args.config).resolve().parent)
    try:
        if args.cmd == "doctor":
            return _doctor(args)
        return run_all(_build(args, cfg), cwd=cwd, dry_run=args.dry_run)
    except ConfigError as ex:
        print(f"config error: {ex}", file=sys.stderr)
        return 2
```
(`_doctor` is unchanged; it still calls `load_config(args.config)` itself — leave it as-is.)

In `dev/sandbox/README.md`, replace the `engine-run` usage line with the `exercise` form:
```
./frappe-sandbox exercise --employee <id> --start <date> --end <date> [--mode both|intraday|closeout]
```
and update the "real-data triage" loop recipe similarly (`engine-run` → `exercise`).

- [ ] **Step 4: Run to verify pass**

Run: `cd dev/sandbox && python3 -m unittest discover -s tests -v`
Expected: PASS (incl. the 2 new CLI tests; `engine-run` now rejected).

- [ ] **Step 5: Commit**
```bash
git add dev/sandbox/frappe_sandbox/cli.py dev/sandbox/README.md dev/sandbox/tests/test_cli.py
git commit -m "feat(sandbox): config-driven exercise CLI (two-phase parse); remove engine-run"
```

---

## Task 4: `init` command — scaffold a new app's config + profile stubs

**Files:**
- Modify: `dev/sandbox/frappe_sandbox/cli.py` (add `_init` + the `init` subparser)
- Test: `dev/sandbox/tests/test_init.py`

**Interfaces:**
- Produces: `_init(config_path, *, app, app_src, frontend_dir) -> int` (writes files; returns 0, or 1 if it refused to overwrite).

- [ ] **Step 1: Write the failing test**

Create `dev/sandbox/tests/test_init.py`:
```python
from __future__ import annotations
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from frappe_sandbox.cli import _init
from frappe_sandbox.config import load_config


class TestInit(unittest.TestCase):
    def test_scaffolds_valid_config_and_stubs(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            sandbox = root / "dev" / "sandbox"
            sandbox.mkdir(parents=True)
            (root / "myapp").mkdir()  # standard layout: <app-src>/<app>/
            cfg_path = sandbox / "frappe-sandbox.json"
            rc = _init(str(cfg_path), app="myapp", app_src="../..", frontend_dir="../..")
            self.assertEqual(rc, 0)
            cfg = load_config(cfg_path)              # scaffold must be load_config-valid
            self.assertEqual(cfg.app, "myapp")
            self.assertTrue((root / "myapp" / "utils" / "anonymize.py").is_file())
            self.assertTrue((root / "myapp" / "utils" / "sandbox_verify.py").is_file())

    def test_refuses_to_overwrite(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            sandbox = root / "dev" / "sandbox"; sandbox.mkdir(parents=True)
            (root / "myapp").mkdir()
            cfg_path = sandbox / "frappe-sandbox.json"
            cfg_path.write_text("{}")
            rc = _init(str(cfg_path), app="myapp", app_src="../..", frontend_dir="../..")
            self.assertEqual(rc, 1)
            self.assertEqual(cfg_path.read_text(), "{}")  # untouched


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dev/sandbox && python3 -m unittest tests.test_init -v`
Expected: FAIL (`cannot import name '_init'`).

- [ ] **Step 3: Implement**

In `dev/sandbox/frappe_sandbox/cli.py`, add `import json` and `from pathlib import Path` (Path already imported). Add the `_init` function:
```python
_ANON_STUB = '''"""Anonymization for the sandbox site. Non-skippable; refuses on prod.
Run via: bench --site sandbox execute {app}.utils.anonymize.run
"""
from __future__ import annotations

import frappe

_PROD_MARKERS = ("prod", "frappehr.com")


def is_prod_site(site_name: str) -> bool:
    name = (site_name or "").lower()
    return any(m in name for m in _PROD_MARKERS)


def _scrub_statements() -> list[tuple[str, dict]]:
    # TODO: enumerate this app's PII columns as (sql, params) UPDATE pairs.
    # Keep engine-relevant fields OUT of any SET clause.
    return []


def run() -> str:
    site = frappe.local.site
    if is_prod_site(site):
        raise RuntimeError(f"refusing to anonymize a prod-looking site: {{site}}")
    for sql, params in _scrub_statements():
        frappe.db.sql(sql, params)
    frappe.db.commit()
    return f"ANONYMIZE_OK site={{site}}"
'''

_VERIFY_STUB = '''"""Sandbox verify stub (seam for the oracle layer).
Run via: bench --site sandbox execute {app}.utils.sandbox_verify.run
"""
from __future__ import annotations

import json


def run() -> str:
    # TODO: add invariants over this app's generated data.
    findings = {{"oracle": "stub", "scanned": 0, "violations": []}}
    print(json.dumps(findings))
    return "VERIFY_OK violations=0"
'''


def _init(config_path, *, app, app_src, frontend_dir) -> int:
    cfg_path = Path(config_path)
    base = cfg_path.parent
    utils_dir = (base / app_src / app / "utils").resolve()
    targets = [cfg_path, utils_dir / "anonymize.py", utils_dir / "sandbox_verify.py"]
    existing = [t for t in targets if t.exists()]
    if existing:
        print(f"init: refusing to overwrite existing files: "
              f"{', '.join(str(t) for t in existing)}", file=sys.stderr)
        return 1
    scaffold = {
        "_TODO": "Fill required_apps, exercise.method/args, and the anonymize/sandbox_verify stubs.",
        "app": app,
        "app_src": app_src,
        "required_apps": ["frappe"],
        "branch": "version-15",
        "frontend_dir": frontend_dir,
        "exercise": {"method": "CHANGEME.module.function", "args": []},
    }
    cfg_path.write_text(json.dumps(scaffold, indent=2) + "\n")
    utils_dir.mkdir(parents=True, exist_ok=True)
    (utils_dir / "__init__.py").touch()
    (utils_dir / "anonymize.py").write_text(_ANON_STUB.replace("{app}", app))
    (utils_dir / "sandbox_verify.py").write_text(_VERIFY_STUB.replace("{app}", app))
    print(f"init: scaffolded {cfg_path} + {utils_dir}/{{anonymize,sandbox_verify}}.py")
    return 0
```
Note: the stub bodies use `{{ }}` for literal braces because the surrounding string is a normal (non-f) string; `.replace("{app}", app)` substitutes the app name. Verify the generated files contain real single braces.

Wire the subparser + dispatch in `main()`: add after the `doctor` parser:
```python
    i = sub.add_parser("init")
    i.add_argument("--app", required=True)
    i.add_argument("--app-src", default="../..")
    i.add_argument("--frontend-dir", default="../..")
```
and in `main()`, handle it before the `run_all` dispatch (alongside the `doctor` branch):
```python
        if args.cmd == "init":
            return _init(args.config, app=args.app, app_src=args.app_src,
                         frontend_dir=args.frontend_dir)
```
(Place this inside the existing `try:` block, right before `if args.cmd == "doctor":`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd dev/sandbox && python3 -m unittest discover -s tests -v`
Expected: PASS (init tests + all prior).

- [ ] **Step 5: Commit**
```bash
git add dev/sandbox/frappe_sandbox/cli.py dev/sandbox/tests/test_init.py
git commit -m "feat(sandbox): init command scaffolds config + anonymize/verify stubs"
```

---

## Task 5: Stage B — package the `frappe-sandbox` skill (assembly + verify)

**Files:**
- Create (OUTSIDE the repo): `~/.claude/skills/frappe-sandbox/SKILL.md`, `~/.claude/skills/frappe-sandbox/engine/` (copied engine), `~/.claude/skills/frappe-sandbox/engine/frappe-sandbox.example.json`
- Modify (repo): `dev/sandbox/README.md` (add a pointer to the skill)

**Interfaces:** none (assembly task).

- [ ] **Step 1: Copy the generic engine into the skill**
```bash
SKILL=~/.claude/skills/frappe-sandbox
mkdir -p "$SKILL/engine/scripts" "$SKILL/engine/frappe_sandbox"
cp dev/sandbox/docker-compose.yml "$SKILL/engine/"
cp dev/sandbox/frappe-sandbox "$SKILL/engine/"
cp dev/sandbox/frappe_sandbox/*.py "$SKILL/engine/frappe_sandbox/"
cp dev/sandbox/scripts/provision.sh dev/sandbox/scripts/seed_prod.sh "$SKILL/engine/scripts/"
chmod +x "$SKILL/engine/frappe-sandbox" "$SKILL/engine/scripts/"*.sh
```
Do NOT copy `dev/sandbox/frappe-sandbox.json`, the `tests/` dir, or zkteco's `utils/`.

- [ ] **Step 2: Write the example config**

`~/.claude/skills/frappe-sandbox/engine/frappe-sandbox.example.json`:
```json
{
  "_TODO": "Copy to frappe-sandbox.json and fill in for your app.",
  "app": "your_app",
  "app_src": "../..",
  "required_apps": ["frappe"],
  "branch": "version-15",
  "frontend_dir": "../..",
  "anonymize_method": "your_app.utils.anonymize.run",
  "verify_method": "your_app.utils.sandbox_verify.run",
  "exercise": {
    "method": "your_app.module.entrypoint",
    "args": [
      {"flag": "employee", "kwarg": "employee", "required": true}
    ]
  }
}
```

- [ ] **Step 3: Write `SKILL.md`**

`~/.claude/skills/frappe-sandbox/SKILL.md` with YAML frontmatter and these sections:
```markdown
---
name: frappe-sandbox
description: Use when you need a local, disposable Frappe bench to run a custom app's tests (fast + CI-parity), iterate TDD unattended, or triage the flag/engine against anonymized prod data. Works for any Frappe custom app via a per-app config + profile.
---

# frappe-sandbox

A reusable local dev-automation harness for Frappe custom apps. The generic engine
(`engine/`) drives a Dockerized bench; each app supplies a `frappe-sandbox.json` config
plus `utils/anonymize.py` and `utils/sandbox_verify.py`.

## Onboarding a new app
1. Copy `engine/` into the app repo at `dev/sandbox/` (`cp -r <skill>/engine/* <app>/dev/sandbox/`).
2. From the app's `dev/sandbox/`, run `./frappe-sandbox init --app <name>` — scaffolds
   `frappe-sandbox.json` + stub `utils/anonymize.py` / `utils/sandbox_verify.py`.
3. Fill in: `required_apps` (the app's Frappe deps), `branch`, the `exercise` method/args,
   the anonymize scrub columns (keep engine-relevant fields out), and at least one invariant.
4. Run the loop (below).

## Verbs
up / down [--purge] / install-app / seed --clean|--prod <dir> /
test --backend [--fast] [--module X] | --frontend [--unit|--e2e] /
exercise <config-driven flags> / verify / doctor / init --app <name>

## Loop recipes
- Inner TDD (sub-second, no Docker): `./frappe-sandbox test --backend --fast --module <m>`
- CI-parity gate before pushing: `./frappe-sandbox test --backend`
- Real-data triage: `./frappe-sandbox seed --prod <dir> && ./frappe-sandbox exercise ... && ./frappe-sandbox verify`

## Autonomous use (discover vs fix — the safety line)
- DISCOVER (read-only on the disposable, anonymized, local sandbox): fully autonomous.
- FIX (writes code): on a branch, must pass the parity gate + invariants, emit a PR/diff
  for human merge. Never an unattended push to main.
```

- [ ] **Step 4: Verify the bundled engine is self-contained**

Run:
```bash
cd ~/.claude/skills/frappe-sandbox/engine && \
  PYTHONPATH="$PWD" python3 -m frappe_sandbox.cli --config frappe-sandbox.example.json --dry-run up
```
Expected: prints `docker compose -f .../docker-compose.yml up -d` (the engine runs from the skill with only the example config — proves it's self-contained and app-agnostic).
Also run a config-driven exercise dry-run to prove generalization:
```bash
cd ~/.claude/skills/frappe-sandbox/engine && \
  PYTHONPATH="$PWD" python3 -m frappe_sandbox.cli --config frappe-sandbox.example.json --dry-run exercise --employee E1
```
Expected: prints `... execute your_app.module.entrypoint --kwargs ...` containing `E1`.

- [ ] **Step 5: Add a repo pointer + commit**

In `dev/sandbox/README.md`, add a short section:
```markdown
## Reusing this for other Frappe apps
The generic engine is packaged as the `frappe-sandbox` Claude skill at
`~/.claude/skills/frappe-sandbox/`. To onboard another app: copy its `engine/` into that
app's `dev/sandbox/`, run `./frappe-sandbox init --app <name>`, and fill the scaffolded
config + `anonymize`/`sandbox_verify` stubs. See the skill's `SKILL.md`.
```
```bash
git add dev/sandbox/README.md
git commit -m "docs(sandbox): point README at the frappe-sandbox skill for other apps"
```

---

## Self-Review

**Spec coverage:**
- §4.1 config (exercise + methods) → Task 1. ✓
- §4.2 commands (build_exercise, config-driven verify/seed) → Task 2. ✓
- §4.3 cli two-phase exercise, remove engine-run → Task 3. ✓
- §4.4 seed_prod.sh ANONYMIZE_METHOD → Task 2. ✓
- §4.5 init → Task 4. ✓
- §5 skill packaging + onboarding → Task 5. ✓
- §6 acceptance: A1 (exercise dry-run parity) → Task 3 test; A2 (verify/seed config) → Task 2 tests; A3 (init scaffold valid) → Task 4 test; A4 (suites green) → each task Step 4; B5/B6 (skill exists + bundled CLI runs) → Task 5 Steps 1–4. ✓

**Placeholder scan:** the `_TODO`/`CHANGEME`/`# TODO` strings are INTENTIONAL scaffold content (not plan gaps) — they are the literal output `init` and the example config produce. No plan-step placeholders.

**Type consistency:** `ExerciseArg(flag, kwarg, required, default, choices)` used identically in config.py, the cli `exercise` registration, and `_cfg()` test helper. `build_exercise(cfg, kwargs)` signature matches its test and the cli dispatch. `_init(config_path, *, app, app_src, frontend_dir)` matches its test. `anonymize_method`/`verify_method` consumed in commands match config defaults.
