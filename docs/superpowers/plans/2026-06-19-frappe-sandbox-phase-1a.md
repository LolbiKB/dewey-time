# Frappe Sandbox Harness — Phase 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-repo `frappe-sandbox` harness that stands up a local Frappe bench, runs the backend test suite (fast + CI-parity) and frontend tests, seeds a disposable anonymized prod-data sandbox, and runs the flag engine over it — hitting the three Phase 1 acceptance bars.

**Architecture:** A stdlib-only Python CLI (host side) drives `docker compose` + `bench`. Pure command-builder functions map `(verb, args, config)` → argv lists (unit-tested); a thin runner executes them. The cold-path bench provisioning lives in one shell script mirroring `.github/workflows/tests.yml`. Anonymization is a Frappe module run inside the bench. The frontend lane reuses the `setup-ci`-produced `ci+frontend-e2e-and-unit` worktree.

**Tech Stack:** Python 3.9+ (stdlib: `argparse`, `subprocess`, `json`, `dataclasses`, `pathlib`, `unittest`), Docker Compose, `frappe/bench` image, MariaDB 10.6, Redis 6.2, Frappe/ERPNext/HRMS `version-15`, Node 20 + Playwright (frontend lane).

## Global Constraints

- **App stack (install order = dep order):** `frappe` → `erpnext` → `hrms` → `zkteco_hr`, **all branch `version-15`**.
- **Parity test command:** `bench --site test_site run-tests --app zkteco_hr`, and `bench --site test_site set-config allow_tests true` is **mandatory** first.
- **Fast lane (proven on Py 3.9.6, 148 tests / 0.056s):** `PYTHONPATH=<repo>/zkteco_hr python3 -m unittest discover -s <repo>/zkteco_hr/zkteco_hr/tests -t <repo>/zkteco_hr -p 'test_*.py'`.
- **Test import root:** the package `zkteco_hr` lives at `<repo>/zkteco_hr/zkteco_hr/`; the outer `<repo>/zkteco_hr/` has no `__init__.py`, so `PYTHONPATH=<repo>/zkteco_hr`.
- **Services:** MariaDB **10.6** with **utf8mb4** server charset; **two** Redis 6.2-alpine (cache + queue); TCP / `--no-mariadb-socket`.
- **apps.txt newline guard (verbatim):** `[ -s sites/apps.txt ] && [ -n "$(tail -c1 sites/apps.txt)" ] && echo >> sites/apps.txt` then append `zkteco_hr` if absent (nested layout can skip auto-registration and concatenate into `hrmszkteco_hr`).
- **Two sites, never crossed:** `test_site` (clean; `run-tests` only), `sandbox` (prod-restored + anonymized; triage only). **Never** `run-tests` against `sandbox`.
- **Anonymization:** deterministic + id-preserving; **preserve** `Employee Checkin.time`, `log_type`, `shift`, `employee` link, `custom_supabase_log_id`; **non-skippable** in `seed --prod`; **hard-guard** against running on a prod-looking site.
- **Host CLI:** Python **3.9+**, **stdlib only**, every module starts with `from __future__ import annotations` (so `X | Y` / `tuple[str, ...]` annotations work on 3.9). Config is **JSON** (`tomllib` needs 3.11+).
- **Harness self-tests** run via `python3 -m unittest` from `dev/sandbox/`.
- **Frontend lane:** Node **20**, **chromium only**, `NODE_AUTH_TOKEN` required for `@lolbikb/dewey-ui` (missing → **skip with warning**, non-fatal), `npm install` not `npm ci`.
- **Commits:** conventional-commit messages; commit at the end of every task.

---

## File Structure

```
dev/sandbox/
  README.md                      # loop recipes + usage
  docker-compose.yml             # bench + mariadb(utf8mb4) + redis-cache + redis-queue
  frappe-sandbox.json            # zkteco_hr profile (app, required_apps, branch, frontend_dir, app_src)
  frappe-sandbox                 # executable shim → python3 -m frappe_sandbox.cli
  frappe_sandbox/
    __init__.py
    config.py                    # load_config() → Config dataclass (+ ConfigError)
    commands.py                  # pure build_*() → list[list[str]]
    runner.py                    # run_all(commands, cwd, dry_run) → int
    cli.py                       # argparse dispatch + doctor
  scripts/
    provision.sh                 # cold-path: init/get-app/apps.txt fix/new-site/install/allow_tests
    seed_prod.sh                 # restore backup + run anonymize
  tests/
    __init__.py
    test_config.py
    test_commands.py
zkteco_hr/zkteco_hr/utils/anonymize.py            # anonymization Frappe module
zkteco_hr/zkteco_hr/utils/sandbox_verify.py       # verify-stub oracle (crash + no-dup invariant)
zkteco_hr/zkteco_hr/tests/test_anonymize.py        # TDD for anonymize
zkteco_hr/zkteco_hr/tests/test_sandbox_verify.py   # TDD for the invariant
```

Frontend lane files (Task 9) are merged from the existing worktree, not authored here.

---

## Task 1: Scaffold + JSON config loader

**Files:**
- Create: `dev/sandbox/frappe_sandbox/__init__.py` (empty)
- Create: `dev/sandbox/frappe_sandbox/config.py`
- Create: `dev/sandbox/frappe-sandbox.json`
- Test: `dev/sandbox/tests/__init__.py` (empty), `dev/sandbox/tests/test_config.py`

**Interfaces:**
- Produces: `Config` (frozen dataclass) with fields `app: str`, `app_src: str` (resolved absolute), `required_apps: tuple[str, ...]`, `branch: str`, `frontend_dir: str` (resolved absolute), `register_app_in_apps_txt: bool`, `test_site: str`, `sandbox_site: str`, `bench_dir: str`, `compose_file: str` (resolved absolute). `load_config(path) -> Config`; raises `ConfigError`.

- [ ] **Step 1: Write the failing test**

`dev/sandbox/tests/test_config.py`:
```python
from __future__ import annotations
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from frappe_sandbox.config import load_config, Config, ConfigError


class TestLoadConfig(unittest.TestCase):
    def _write(self, d: str, data: dict) -> Path:
        p = Path(d) / "frappe-sandbox.json"
        p.write_text(json.dumps(data))
        return p

    def test_loads_and_resolves_paths(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {
                "app": "zkteco_hr",
                "app_src": "../..",
                "required_apps": ["erpnext", "hrms"],
                "branch": "version-15",
                "frontend_dir": "../../frontend",
            })
            cfg = load_config(p)
            self.assertIsInstance(cfg, Config)
            self.assertEqual(cfg.app, "zkteco_hr")
            self.assertEqual(cfg.required_apps, ("erpnext", "hrms"))
            self.assertEqual(cfg.branch, "version-15")
            self.assertTrue(Path(cfg.app_src).is_absolute())
            self.assertTrue(cfg.register_app_in_apps_txt)  # defaults True
            self.assertEqual(cfg.test_site, "test_site")
            self.assertEqual(cfg.sandbox_site, "sandbox")

    def test_missing_key_raises(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {"app": "x"})
            with self.assertRaises(ConfigError):
                load_config(p)

    def test_empty_required_apps_raises(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {
                "app": "x", "app_src": ".", "required_apps": [],
                "branch": "version-15", "frontend_dir": ".",
            })
            with self.assertRaises(ConfigError):
                load_config(p)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev/sandbox && python3 -m unittest discover -s tests -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'frappe_sandbox.config'`

- [ ] **Step 3: Write minimal implementation**

`dev/sandbox/frappe_sandbox/__init__.py`: empty file.
`dev/sandbox/tests/__init__.py`: empty file.
`dev/sandbox/frappe_sandbox/config.py`:
```python
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    app: str
    app_src: str               # absolute host path to the app repo (get-app source)
    required_apps: tuple[str, ...]
    branch: str
    frontend_dir: str          # absolute host path to the frontend dir
    register_app_in_apps_txt: bool = True
    test_site: str = "test_site"
    sandbox_site: str = "sandbox"
    bench_dir: str = "frappe-bench"
    compose_file: str = "docker-compose.yml"  # absolute after load


_REQUIRED = ("app", "app_src", "required_apps", "branch", "frontend_dir")


def load_config(path) -> Config:
    p = Path(path)
    if not p.is_file():
        raise ConfigError(f"config not found: {p}")
    try:
        data = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        raise ConfigError(f"invalid JSON in {p}: {e}") from e

    missing = [k for k in _REQUIRED if k not in data]
    if missing:
        raise ConfigError(f"missing keys: {', '.join(missing)}")
    if not isinstance(data["required_apps"], list) or not data["required_apps"]:
        raise ConfigError("required_apps must be a non-empty list")

    base = p.parent
    resolve = lambda rel: str((base / rel).resolve())
    return Config(
        app=data["app"],
        app_src=resolve(data["app_src"]),
        required_apps=tuple(data["required_apps"]),
        branch=data["branch"],
        frontend_dir=resolve(data["frontend_dir"]),
        register_app_in_apps_txt=bool(data.get("register_app_in_apps_txt", True)),
        test_site=data.get("test_site", "test_site"),
        sandbox_site=data.get("sandbox_site", "sandbox"),
        bench_dir=data.get("bench_dir", "frappe-bench"),
        compose_file=resolve(data.get("compose_file", "docker-compose.yml")),
    )
```

`dev/sandbox/frappe-sandbox.json`:
```json
{
  "app": "zkteco_hr",
  "app_src": "../..",
  "required_apps": ["erpnext", "hrms"],
  "branch": "version-15",
  "frontend_dir": "../../zkteco_hr/zkteco_hr/frontend/hr_attendance",
  "register_app_in_apps_txt": true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dev/sandbox && python3 -m unittest discover -s tests -v`
Expected: PASS (3 tests OK)

- [ ] **Step 5: Commit**

```bash
git add dev/sandbox/frappe_sandbox dev/sandbox/tests dev/sandbox/frappe-sandbox.json
git commit -m "feat(sandbox): config loader + zkteco_hr profile"
```

---

## Task 2: Pure command builders

**Files:**
- Create: `dev/sandbox/frappe_sandbox/commands.py`
- Test: `dev/sandbox/tests/test_commands.py`

**Interfaces:**
- Consumes: `Config` from Task 1.
- Produces: `docker_exec(cfg, bash_cmd, *, service="bench", env=None) -> list[str]`; and builders each returning `list[list[str]]`: `build_up(cfg)`, `build_down(cfg, *, purge=False)`, `build_provision(cfg)`, `build_run_tests(cfg, *, module=None, fast=False)`, `build_seed_prod(cfg, backup_dir)`, `build_engine_run(cfg, *, employee, start, end, mode="both")`, `build_verify(cfg)`, `build_frontend(cfg, *, mode)` (mode ∈ {"unit","e2e","all"}).

- [ ] **Step 1: Write the failing test**

`dev/sandbox/tests/test_commands.py`:
```python
from __future__ import annotations
import unittest

from frappe_sandbox.config import Config
from frappe_sandbox import commands as c


def _cfg() -> Config:
    return Config(
        app="zkteco_hr", app_src="/repo", required_apps=("erpnext", "hrms"),
        branch="version-15", frontend_dir="/repo/fe",
        compose_file="/repo/dev/sandbox/docker-compose.yml",
    )


class TestCommands(unittest.TestCase):
    def test_up(self):
        self.assertEqual(
            c.build_up(_cfg()),
            [["docker", "compose", "-f", "/repo/dev/sandbox/docker-compose.yml", "up", "-d"]],
        )

    def test_down_purge(self):
        cmd = c.build_down(_cfg(), purge=True)[0]
        self.assertEqual(cmd[-2:], ["down", "-v"])

    def test_run_tests_parity(self):
        cmd = c.build_run_tests(_cfg())[0]
        joined = " ".join(cmd)
        self.assertIn("exec", joined)
        self.assertIn("bench --site test_site run-tests --app zkteco_hr", joined)

    def test_run_tests_parity_module(self):
        joined = " ".join(c.build_run_tests(_cfg(), module="test_closeout")[0])
        self.assertIn("--module zkteco_hr.tests.test_closeout", joined)

    def test_run_tests_fast_is_host_unittest(self):
        cmd = c.build_run_tests(_cfg(), fast=True)[0]
        joined = " ".join(cmd)
        self.assertNotIn("docker", joined)
        self.assertIn("PYTHONPATH=/repo/zkteco_hr", joined)
        self.assertIn("python3 -m unittest discover", joined)
        self.assertIn("/repo/zkteco_hr/zkteco_hr/tests", joined)

    def test_provision_passes_env(self):
        cmd = c.build_provision(_cfg())[0]
        joined = " ".join(cmd)
        self.assertIn("-e", joined)
        self.assertIn("REQUIRED_APPS=erpnext hrms", joined)
        self.assertIn("BRANCH=version-15", joined)
        self.assertIn("provision.sh", joined)

    def test_seed_prod_restore_then_anonymize(self):
        cmds = c.build_seed_prod(_cfg(), "/backups/x")
        joined = " ".join(" ".join(x) for x in cmds)
        self.assertIn("seed_prod.sh", joined)
        self.assertIn("BACKUP_DIR=/backups/x", joined)

    def test_engine_run(self):
        joined = " ".join(c.build_engine_run(_cfg(), employee="HR-EMP-1",
                                             start="2026-06-01", end="2026-06-07")[0])
        self.assertIn("--site sandbox execute", joined)
        self.assertIn("run_engine_for_employee", joined)
        self.assertIn("HR-EMP-1", joined)

    def test_frontend_unit(self):
        joined = " ".join(c.build_frontend(_cfg(), mode="unit")[0])
        self.assertIn("npm run test:web", joined)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev/sandbox && python3 -m unittest tests.test_commands -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'frappe_sandbox.commands'`

- [ ] **Step 3: Write minimal implementation**

`dev/sandbox/frappe_sandbox/commands.py`:
```python
from __future__ import annotations

import json
import shlex

from .config import Config


def _compose(cfg: Config) -> list[str]:
    return ["docker", "compose", "-f", cfg.compose_file]


def docker_exec(cfg: Config, bash_cmd: str, *, service: str = "bench",
                env: dict | None = None) -> list[str]:
    cmd = _compose(cfg) + ["exec", "-T"]
    for k, v in (env or {}).items():
        cmd += ["-e", f"{k}={v}"]
    cmd += [service, "bash", "-lc", bash_cmd]
    return cmd


def _bench(cfg: Config, args: str, *, site: str | None = None) -> str:
    site_part = f"--site {site} " if site else ""
    return f"cd {cfg.bench_dir} && bench {site_part}{args}"


def build_up(cfg: Config) -> list[list[str]]:
    return [_compose(cfg) + ["up", "-d"]]


def build_down(cfg: Config, *, purge: bool = False) -> list[list[str]]:
    return [_compose(cfg) + ["down"] + (["-v"] if purge else [])]


def build_provision(cfg: Config) -> list[list[str]]:
    env = {
        "APP": cfg.app,
        "APP_SRC": "/workspace/repo",
        "REQUIRED_APPS": " ".join(cfg.required_apps),
        "BRANCH": cfg.branch,
        "TEST_SITE": cfg.test_site,
        "REGISTER_APPS_TXT": "1" if cfg.register_app_in_apps_txt else "0",
        "BENCH_DIR": cfg.bench_dir,
    }
    return [docker_exec(cfg, "bash /workspace/repo/dev/sandbox/scripts/provision.sh", env=env)]


def build_run_tests(cfg: Config, *, module: str | None = None,
                    fast: bool = False) -> list[list[str]]:
    if fast:
        p" "  # placeholder removed below
        py_root = f"{cfg.app_src}/{cfg.app}"
        if module:
            inner = (f"PYTHONPATH={py_root} python3 -m unittest "
                     f"{cfg.app}.tests.{module} -v")
        else:
            inner = (f"PYTHONPATH={py_root} python3 -m unittest discover "
                     f"-s {py_root}/{cfg.app}/tests -t {py_root} -p 'test_*.py'")
        return [["bash", "-lc", inner]]
    args = f"run-tests --app {cfg.app}"
    if module:
        args += f" --module {cfg.app}.tests.{module}"
    return [docker_exec(cfg, _bench(cfg, args, site=cfg.test_site))]


def build_seed_prod(cfg: Config, backup_dir: str) -> list[list[str]]:
    env = {
        "APP": cfg.app,
        "SANDBOX_SITE": cfg.sandbox_site,
        "BACKUP_DIR": backup_dir,
        "BENCH_DIR": cfg.bench_dir,
    }
    return [docker_exec(cfg, "bash /workspace/repo/dev/sandbox/scripts/seed_prod.sh", env=env)]


def build_engine_run(cfg: Config, *, employee: str, start: str, end: str,
                     mode: str = "both") -> list[list[str]]:
    kwargs = json.dumps({"employee": employee, "start_date": start,
                         "end_date": end, "mode": mode})
    args = (f"execute {cfg.app}.attendance_engine.dev_tools.run_engine_for_employee "
            f"--kwargs {shlex.quote(kwargs)}")
    return [docker_exec(cfg, _bench(cfg, args, site=cfg.sandbox_site))]


def build_verify(cfg: Config) -> list[list[str]]:
    args = f"execute {cfg.app}.utils.sandbox_verify.run"
    return [docker_exec(cfg, _bench(cfg, args, site=cfg.sandbox_site))]


def build_frontend(cfg: Config, *, mode: str) -> list[list[str]]:
    script = {"unit": "test:web", "e2e": "test:e2e"}.get(mode)
    if mode == "all":
        return [["bash", "-lc", f"cd {cfg.frontend_dir} && npm run test:web && npm run test:e2e"]]
    return [["bash", "-lc", f"cd {cfg.frontend_dir} && npm run {script}"]]
```

Note: delete the stray `p" "  # placeholder removed below` line — it is shown only to mark where the `fast` branch begins; the real first line of the branch is `py_root = ...`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dev/sandbox && python3 -m unittest tests.test_commands -v`
Expected: PASS (9 tests OK)

- [ ] **Step 5: Commit**

```bash
git add dev/sandbox/frappe_sandbox/commands.py dev/sandbox/tests/test_commands.py
git commit -m "feat(sandbox): pure command builders for the CLI verbs"
```

---

## Task 3: Runner + argparse CLI + `--dry-run`

**Files:**
- Create: `dev/sandbox/frappe_sandbox/runner.py`
- Create: `dev/sandbox/frappe_sandbox/cli.py`
- Create: `dev/sandbox/frappe-sandbox` (executable shim)
- Test: extend `dev/sandbox/tests/test_commands.py` with a CLI dry-run test (or new `test_cli.py`)

**Interfaces:**
- Consumes: `Config`, builders from Task 2.
- Produces: `run_all(commands, *, cwd=None, dry_run=False) -> int`; `main(argv=None) -> int` (argparse). Verbs: `up`, `down`, `install-app`, `seed`, `test`, `engine-run`, `verify`, `frontend`, `doctor`. Global flags: `--config <path>`, `--dry-run`.

- [ ] **Step 1: Write the failing test**

Create `dev/sandbox/tests/test_cli.py`:
```python
from __future__ import annotations
import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from frappe_sandbox.cli import main

CONFIG = str(Path(__file__).resolve().parents[1] / "frappe-sandbox.json")


class TestCliDryRun(unittest.TestCase):
    def _run(self, *args) -> str:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = main(["--config", CONFIG, "--dry-run", *args])
        self.assertEqual(rc, 0)
        return buf.getvalue()

    def test_test_backend_dry_run(self):
        out = self._run("test", "--backend")
        self.assertIn("run-tests --app zkteco_hr", out)

    def test_test_fast_dry_run(self):
        out = self._run("test", "--backend", "--fast")
        self.assertIn("python3 -m unittest discover", out)
        self.assertNotIn("docker", out)

    def test_up_dry_run(self):
        out = self._run("up")
        self.assertIn("docker compose", out)
        self.assertIn("up -d", out)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dev/sandbox && python3 -m unittest tests.test_cli -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'frappe_sandbox.cli'`

- [ ] **Step 3: Write minimal implementation**

`dev/sandbox/frappe_sandbox/runner.py`:
```python
from __future__ import annotations

import subprocess


def run_all(commands: list[list[str]], *, cwd: str | None = None,
            dry_run: bool = False) -> int:
    for cmd in commands:
        line = " ".join(cmd)
        if dry_run:
            print(line)
            continue
        print(f"$ {line}")
        result = subprocess.run(cmd, cwd=cwd)
        if result.returncode != 0:
            return result.returncode
    return 0
```

`dev/sandbox/frappe_sandbox/cli.py`:
```python
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

from . import commands as c
from .config import ConfigError, load_config
from .runner import run_all

DEFAULT_CONFIG = str(Path(__file__).resolve().parents[1] / "frappe-sandbox.json")


def _build(args) -> list[list[str]]:
    cfg = load_config(args.config)
    if args.cmd == "up":
        return c.build_up(cfg)
    if args.cmd == "down":
        return c.build_down(cfg, purge=args.purge)
    if args.cmd == "install-app":
        return c.build_provision(cfg)
    if args.cmd == "seed":
        if args.clean:
            return c.build_provision(cfg)            # clean test_site == provision
        return c.build_seed_prod(cfg, args.prod)
    if args.cmd == "test":
        if args.frontend:
            mode = "e2e" if args.e2e else "unit" if args.unit else "all"
            return c.build_frontend(cfg, mode=mode)
        return c.build_run_tests(cfg, module=args.module, fast=args.fast)
    if args.cmd == "engine-run":
        return c.build_engine_run(cfg, employee=args.employee,
                                  start=args.start, end=args.end, mode=args.mode)
    if args.cmd == "verify":
        return c.build_verify(cfg)
    raise SystemExit(f"unknown command: {args.cmd}")


def _doctor(args) -> int:
    cfg = load_config(args.config)
    checks = []
    checks.append(("docker present", shutil.which("docker") is not None))
    checks.append(("compose file exists", Path(cfg.compose_file).is_file()))
    checks.append(("python >= 3.9", sys.version_info >= (3, 9)))
    checks.append(("NODE_AUTH_TOKEN set (frontend)", bool(os.environ.get("NODE_AUTH_TOKEN"))))
    ok = True
    for name, passed in checks:
        mark = "PASS" if passed else ("WARN" if "NODE_AUTH" in name else "FAIL")
        if mark == "FAIL":
            ok = False
        print(f"[{mark}] {name}")
    return 0 if ok else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="frappe-sandbox")
    p.add_argument("--config", default=DEFAULT_CONFIG)
    p.add_argument("--dry-run", action="store_true")
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
    e = sub.add_parser("engine-run")
    e.add_argument("--employee", required=True)
    e.add_argument("--start", required=True)
    e.add_argument("--end", required=True)
    e.add_argument("--mode", default="both")
    sub.add_parser("verify")
    sub.add_parser("doctor")

    args = p.parse_args(argv)
    cwd = str(Path(args.config).resolve().parent)
    try:
        if args.cmd == "doctor":
            return _doctor(args)
        return run_all(_build(args), cwd=cwd, dry_run=args.dry_run)
    except ConfigError as ex:
        print(f"config error: {ex}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
```

`dev/sandbox/frappe-sandbox` (executable shim):
```bash
#!/usr/bin/env bash
# Thin shim so `dev/sandbox/frappe-sandbox <verb>` works from anywhere.
here="$(cd "$(dirname "$0")" && pwd)"
exec python3 -m frappe_sandbox.cli "$@"
```
Then: `chmod +x dev/sandbox/frappe-sandbox`. The shim relies on `PYTHONPATH` including `dev/sandbox`; document in README that the shim is run as `cd dev/sandbox && ./frappe-sandbox …` or via `PYTHONPATH=dev/sandbox python3 -m frappe_sandbox.cli`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dev/sandbox && python3 -m unittest tests.test_cli -v`
Expected: PASS (3 tests OK)

- [ ] **Step 5: Run the full harness test suite**

Run: `cd dev/sandbox && python3 -m unittest discover -s tests -v`
Expected: PASS (all config + commands + cli tests OK)

- [ ] **Step 6: Commit**

```bash
git add dev/sandbox/frappe_sandbox/runner.py dev/sandbox/frappe_sandbox/cli.py dev/sandbox/frappe-sandbox dev/sandbox/tests/test_cli.py
git commit -m "feat(sandbox): runner + argparse CLI with --dry-run and doctor"
```

---

## Task 4: docker-compose + provision.sh → a bench with `test_site`

**Files:**
- Create: `dev/sandbox/docker-compose.yml`
- Create: `dev/sandbox/scripts/provision.sh`
- Create: `dev/sandbox/.gitignore` (ignore any local artifacts)

**Interfaces:**
- Consumes: `build_up`, `build_provision` (Task 2).
- Produces: a running bench container with `frappe`+`erpnext`+`hrms`+`zkteco_hr` installed on `test_site`, `allow_tests=true`.

- [ ] **Step 1: Write `docker-compose.yml`**

`dev/sandbox/docker-compose.yml`:
```yaml
services:
  mariadb:
    image: mariadb:10.6
    environment:
      MARIADB_ROOT_PASSWORD: root
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --skip-character-set-client-handshake
    volumes:
      - mariadb-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      retries: 20

  redis-cache:
    image: redis:6.2-alpine

  redis-queue:
    image: redis:6.2-alpine

  bench:
    image: frappe/bench:latest
    tty: true
    command: sleep infinity
    working_dir: /home/frappe
    environment:
      SHELL: /bin/bash
    volumes:
      - bench-data:/home/frappe
      - ../../:/workspace/repo
    depends_on:
      mariadb:
        condition: service_healthy
      redis-cache:
        condition: service_started
      redis-queue:
        condition: service_started

volumes:
  mariadb-data:
  bench-data:
```

- [ ] **Step 2: Write `provision.sh`** (mirrors `tests.yml`, idempotent)

`dev/sandbox/scripts/provision.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

# Env (passed by the CLI): APP, APP_SRC, REQUIRED_APPS, BRANCH, TEST_SITE,
# REGISTER_APPS_TXT, BENCH_DIR
: "${APP:?}" "${APP_SRC:?}" "${REQUIRED_APPS:?}" "${BRANCH:?}" "${TEST_SITE:?}" "${BENCH_DIR:?}"

cd /home/frappe

if [ ! -d "$BENCH_DIR" ]; then
  bench init --skip-redis-config-generation --skip-assets \
    --frappe-branch "$BRANCH" --python "$(which python)" "$BENCH_DIR"
fi
cd "$BENCH_DIR"

bench set-config -g db_host mariadb
bench set-config -g redis_cache    "redis://redis-cache:6379"
bench set-config -g redis_queue    "redis://redis-queue:6379"
bench set-config -g redis_socketio "redis://redis-queue:6379"

for app in $REQUIRED_APPS; do
  [ -d "apps/$app" ] || bench get-app "$app" --branch "$BRANCH" --skip-assets
done
[ -d "apps/$APP" ] || bench get-app "$APP" "$APP_SRC" --skip-assets

if [ "${REGISTER_APPS_TXT:-1}" = "1" ]; then
  [ -s sites/apps.txt ] && [ -n "$(tail -c1 sites/apps.txt)" ] && echo >> sites/apps.txt
  grep -qxF "$APP" sites/apps.txt 2>/dev/null || echo "$APP" >> sites/apps.txt
fi

if [ ! -d "sites/$TEST_SITE" ]; then
  bench new-site "$TEST_SITE" --no-mariadb-socket --db-host mariadb \
    --mariadb-root-password root --admin-password admin
  bench --site "$TEST_SITE" install-app $REQUIRED_APPS "$APP"
fi
bench --site "$TEST_SITE" set-config allow_tests true
echo "PROVISION_OK site=$TEST_SITE apps=$REQUIRED_APPS $APP"
```
Then: `chmod +x dev/sandbox/scripts/provision.sh`.

- [ ] **Step 3: Bring the stack up**

Run: `cd dev/sandbox && ./frappe-sandbox up`
Expected: `docker compose ... up -d` creates `mariadb`, `redis-cache`, `redis-queue`, `bench`; `docker compose -f dev/sandbox/docker-compose.yml ps` shows all running and mariadb healthy.

- [ ] **Step 4: Verify `get-app` editability (open question #1)**

Run: `cd dev/sandbox && docker compose exec -T bench bash -lc 'ls -la /home/frappe/frappe-bench/apps 2>/dev/null || echo no-bench-yet'`
Then after provisioning (Step 5), run: `docker compose exec -T bench bash -lc 'readlink -f frappe-bench/apps/zkteco_hr; head -1 frappe-bench/apps/zkteco_hr/pyproject.toml'`
Expected: if `apps/zkteco_hr` is a symlink into `/workspace/repo`, warm edits are live. **If it is a real copy** (not a symlink), add a bind mount `../../:/workspace/repo` is already present — add a second mount in `docker-compose.yml` under `bench.volumes`: `- ../../:/home/frappe/frappe-bench/apps/zkteco_hr` is NOT correct (that mounts the repo root, not the package). Instead bind the app package dir: add `- ../../zkteco_hr:/home/frappe/frappe-bench/apps/zkteco_hr` only if the package import still resolves; otherwise keep the copy and re-run `get-app` on change. Record the finding in `dev/sandbox/README.md`.

- [ ] **Step 5: Provision the bench (slow: installs erpnext+hrms, minutes)**

Run: `cd dev/sandbox && ./frappe-sandbox install-app`
Expected (tail): `PROVISION_OK site=test_site apps=erpnext hrms zkteco_hr`. Re-running is idempotent (skips existing apps/site).

- [ ] **Step 6: Commit**

```bash
git add dev/sandbox/docker-compose.yml dev/sandbox/scripts/provision.sh dev/sandbox/.gitignore
git commit -m "feat(sandbox): docker-compose stack + idempotent bench provisioning"
```

---

## Task 5: Backend lanes green (acceptance bars #1 and #2)

**Files:**
- Modify: `dev/sandbox/README.md` (record the two-lane recipe) — created in Task 9; for now record in commit message.

**Interfaces:**
- Consumes: `build_run_tests` (Task 2), provisioned bench (Task 4).

- [ ] **Step 1: Run the fast lane (host, no Docker)**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast`
Expected: `Ran 148 tests in 0.0XXs` / `OK` (proven: 0.056s on Py 3.9.6). **This is acceptance bar #2's substrate.**

- [ ] **Step 2: Run the parity lane (dockerized bench)**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend`
Expected: `docker compose ... exec ... bench --site test_site run-tests --app zkteco_hr` → the same 148 tests, `OK`. **This is acceptance bar #1.**

- [ ] **Step 3: Scope to one module both ways (sanity)**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_closeout`
Then: `cd dev/sandbox && ./frappe-sandbox test --backend --module test_closeout`
Expected: both run only `test_closeout`'s methods, `OK`.

- [ ] **Step 4: Prove the unattended TDD loop (acceptance bar #2)**

Create a throwaway proof script `dev/sandbox/scripts/_tdd_demo.sh` (delete after) that: (a) appends a deliberately failing test method to a temp copy under `tests/`, (b) runs `--fast` and asserts non-zero, (c) removes it, (d) runs `--fast` and asserts zero. Run it:
Run: `cd dev/sandbox && bash scripts/_tdd_demo.sh && echo TDD_LOOP_OK`
Expected: `TDD_LOOP_OK`. Then `rm dev/sandbox/scripts/_tdd_demo.sh`.

- [ ] **Step 5: Commit**

```bash
git add -A dev/sandbox
git commit -m "test(sandbox): backend fast + parity lanes green; TDD loop verified"
```

---

## Task 6: Anonymization module (in-app, TDD)

**Files:**
- Create: `zkteco_hr/zkteco_hr/utils/anonymize.py`
- Test: `zkteco_hr/zkteco_hr/tests/test_anonymize.py`

**Interfaces:**
- Produces: `run()` (the non-skippable scrub; raises `RuntimeError` if site looks like prod), `_scrub_statements() -> list[tuple[str, dict]]` (pure: returns `(sql, params)` pairs, unit-testable without a DB), `is_prod_site(site_name: str) -> bool`.

- [ ] **Step 1: Write the failing test**

`zkteco_hr/zkteco_hr/tests/test_anonymize.py`:
```python
import unittest

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from zkteco_hr.utils import anonymize  # noqa: E402


class TestAnonymizeStatements(unittest.TestCase):
    def test_scrub_targets_pii_and_preserves_engine_fields(self):
        stmts = anonymize._scrub_statements()
        blob = " ".join(sql.lower() for sql, _ in stmts)
        # PII columns scrubbed
        self.assertIn("update `tabemployee`", blob)
        self.assertIn("employee_name", blob)
        self.assertIn("personal_email", blob)
        self.assertIn("update `tabemployee checkin`", blob)
        # engine-relevant fields NEVER appear in a SET clause
        for protected in (" time =", " log_type =", " shift =", " employee =",
                          "custom_supabase_log_id ="):
            self.assertNotIn(protected, blob)

    def test_is_prod_site_guard(self):
        self.assertTrue(anonymize.is_prod_site("dewey.frappehr.com"))
        self.assertFalse(anonymize.is_prod_site("sandbox"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="$PWD/zkteco_hr" python3 -m unittest zkteco_hr.tests.test_anonymize -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'zkteco_hr.utils.anonymize'`

- [ ] **Step 3: Write minimal implementation**

`zkteco_hr/zkteco_hr/utils/anonymize.py`:
```python
"""Deterministic, id-preserving PII scrub for the sandbox site. Non-skippable.

Run via: bench --site sandbox execute zkteco_hr.utils.anonymize.run
Refuses to run on a site whose name looks like production.
"""
from __future__ import annotations

import frappe

_PROD_MARKERS = ("dewey", "frappehr.com", "prod")


def is_prod_site(site_name: str) -> bool:
    name = (site_name or "").lower()
    return any(m in name for m in _PROD_MARKERS)


def _scrub_statements() -> list[tuple[str, dict]]:
    """(sql, params) pairs. Deterministic: derive fakes from the row's own name/id.
    Engine-relevant fields (time, log_type, shift, employee, custom_supabase_log_id)
    are intentionally NOT in any SET clause."""
    return [
        ("UPDATE `tabEmployee` SET "
         "employee_name = CONCAT('Employee ', name), "
         "first_name = CONCAT('Employee ', name), last_name = '', "
         "personal_email = CONCAT(name, '@example.test'), "
         "company_email = CONCAT(name, '@example.test'), "
         "cell_number = '000', bank_ac_no = NULL, passport_number = NULL, "
         "date_of_birth = NULL", {}),
        ("UPDATE `tabEmployee Checkin` SET "
         "employee_name = CONCAT('Employee ', employee), "
         "device_id = NULL, custom_device_serial_number = NULL, "
         "latitude = NULL, longitude = NULL", {}),
        ("UPDATE `tabAttendance Flag` SET "
         "employee_name = CONCAT('Employee ', employee)", {}),
        ("UPDATE `tabUser` SET "
         "full_name = CONCAT('User ', name), first_name = CONCAT('User ', name), "
         "last_name = '' WHERE name NOT IN ('Administrator', 'Guest')", {}),
        ("UPDATE `tabContact` SET first_name = CONCAT('Contact ', name), "
         "last_name = '', email_id = CONCAT(name, '@example.test')", {}),
        ("UPDATE `tabAddress` SET address_line1 = 'redacted', "
         "address_line2 = NULL, phone = NULL", {}),
    ]


def run() -> str:
    site = frappe.local.site
    if is_prod_site(site):
        raise RuntimeError(f"refusing to anonymize a prod-looking site: {site}")
    for sql, params in _scrub_statements():
        frappe.db.sql(sql, params)
    frappe.db.commit()
    return f"ANONYMIZE_OK site={site}"
```

Also create `zkteco_hr/zkteco_hr/utils/__init__.py` if missing (check first; `utils/` already exists with modules, so `__init__.py` likely present — verify with `ls zkteco_hr/zkteco_hr/utils/__init__.py`).

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="$PWD/zkteco_hr" python3 -m unittest zkteco_hr.tests.test_anonymize -v`
Expected: PASS (2 tests OK)

- [ ] **Step 5: Confirm the full backend suite still green**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast`
Expected: `Ran 150 tests ... OK` (148 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add zkteco_hr/zkteco_hr/utils/anonymize.py zkteco_hr/zkteco_hr/tests/test_anonymize.py
git commit -m "feat(sandbox): deterministic id-preserving anonymization module"
```

---

## Task 7: `seed --prod` (restore + anonymize) via a synthetic backup

**Files:**
- Create: `dev/sandbox/scripts/seed_prod.sh`

**Interfaces:**
- Consumes: `build_seed_prod` (Task 2), `anonymize.run` (Task 6).
- Produces: a `sandbox` site restored from a backup dir and anonymized.

This task validates the whole pipeline **without real prod data**: take a backup of `test_site` (after inserting two fake employees + checkins), then restore+anonymize into `sandbox`.

- [ ] **Step 1: Write `seed_prod.sh`**

`dev/sandbox/scripts/seed_prod.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${APP:?}" "${SANDBOX_SITE:?}" "${BACKUP_DIR:?}" "${BENCH_DIR:?}"
cd "/home/frappe/$BENCH_DIR"

DB_GZ="$(ls "$BACKUP_DIR"/*-database.sql.gz | head -1)"
PUB="$(ls "$BACKUP_DIR"/*-files.tar 2>/dev/null | head -1 || true)"
PRIV="$(ls "$BACKUP_DIR"/*-private-files.tar 2>/dev/null | head -1 || true)"

if [ ! -d "sites/$SANDBOX_SITE" ]; then
  bench new-site "$SANDBOX_SITE" --no-mariadb-socket --db-host mariadb \
    --mariadb-root-password root --admin-password admin
fi

RESTORE=(--force restore "$DB_GZ" --mariadb-root-password root)
[ -n "$PUB" ]  && RESTORE+=(--with-public-files "$PUB")
[ -n "$PRIV" ] && RESTORE+=(--with-private-files "$PRIV")
bench --site "$SANDBOX_SITE" "${RESTORE[@]}"

bench --site "$SANDBOX_SITE" list-apps | grep -qx "$APP" || \
  bench --site "$SANDBOX_SITE" install-app "$APP"
bench --site "$SANDBOX_SITE" migrate

# Non-skippable anonymization
bench --site "$SANDBOX_SITE" execute "$APP.utils.anonymize.run"
echo "SEED_PROD_OK site=$SANDBOX_SITE"
```
Then: `chmod +x dev/sandbox/scripts/seed_prod.sh`.

- [ ] **Step 2: Create a synthetic backup from `test_site`**

Run (inside the bench) — insert two fake employees + checkins, then back up:
```bash
cd dev/sandbox && docker compose exec -T bench bash -lc '
cd frappe-bench &&
bench --site test_site execute frappe.client.insert --kwargs "{\"doc\":{\"doctype\":\"Employee\",\"employee_name\":\"Jane Real\",\"first_name\":\"Jane\",\"personal_email\":\"jane@real.example\"}}" || true &&
bench --site test_site backup --with-files &&
ls -1 sites/test_site/private/backups | tail -4'
```
Expected: a fresh `*-database.sql.gz` (+ files tars) under `sites/test_site/private/backups`. Note the timestamp prefix dir.

- [ ] **Step 3: Seed the sandbox from that backup**

Copy the backup files into a dir reachable as `$BACKUP_DIR` inside the container (e.g. `/home/frappe/frappe-bench/sites/test_site/private/backups`), then:
Run: `cd dev/sandbox && ./frappe-sandbox seed --prod /home/frappe/frappe-bench/sites/test_site/private/backups`
Expected (tail): `SEED_PROD_OK site=sandbox`.

(Note: `build_seed_prod` passes `BACKUP_DIR` as an absolute path **inside the container**. Document this in README: backups downloaded from Frappe Cloud must be placed under the repo (mounted at `/workspace/repo`) or copied into the bench volume first.)

- [ ] **Step 4: Verify anonymization actually ran**

Run:
```bash
cd dev/sandbox && docker compose exec -T bench bash -lc '
cd frappe-bench &&
bench --site sandbox execute frappe.client.get_list --kwargs "{\"doctype\":\"Employee\",\"fields\":[\"employee_name\"],\"limit_page_length\":3}"'
```
Expected: `employee_name` values like `Employee HR-EMP-00001` (the scrub ran), **not** `Jane Real`.

- [ ] **Step 5: Commit**

```bash
git add dev/sandbox/scripts/seed_prod.sh
git commit -m "feat(sandbox): seed --prod restore + non-skippable anonymize pipeline"
```

---

## Task 8: `engine-run` + `verify` stub (acceptance bar #3 + §11 seam)

**Files:**
- Create: `zkteco_hr/zkteco_hr/utils/sandbox_verify.py`
- Test: `zkteco_hr/zkteco_hr/tests/test_sandbox_verify.py`

**Interfaces:**
- Consumes: `build_engine_run`, `build_verify` (Task 2); `dev_tools.run_engine_for_employee(employee, start_date, end_date, mode="both")`.
- Produces: `sandbox_verify.run() -> str` (prints findings JSON), `no_duplicate_flags(rows: list[dict]) -> list[dict]` (pure invariant: returns violating groups).

- [ ] **Step 1: Write the failing test (pure invariant)**

`zkteco_hr/zkteco_hr/tests/test_sandbox_verify.py`:
```python
import unittest

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from zkteco_hr.utils import sandbox_verify as sv  # noqa: E402


class TestNoDuplicateFlags(unittest.TestCase):
    def test_detects_duplicate(self):
        rows = [
            {"employee": "E1", "attendance_date": "2026-06-01", "flag_code": "LATE_START", "day_closed": 1},
            {"employee": "E1", "attendance_date": "2026-06-01", "flag_code": "LATE_START", "day_closed": 1},
            {"employee": "E1", "attendance_date": "2026-06-02", "flag_code": "LATE_START", "day_closed": 1},
        ]
        violations = sv.no_duplicate_flags(rows)
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["count"], 2)

    def test_clean_set_has_no_violations(self):
        rows = [
            {"employee": "E1", "attendance_date": "2026-06-01", "flag_code": "LATE_START", "day_closed": 1},
            {"employee": "E1", "attendance_date": "2026-06-01", "flag_code": "LEFT_EARLY", "day_closed": 1},
        ]
        self.assertEqual(sv.no_duplicate_flags(rows), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="$PWD/zkteco_hr" python3 -m unittest zkteco_hr.tests.test_sandbox_verify -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'zkteco_hr.utils.sandbox_verify'`

- [ ] **Step 3: Write minimal implementation**

`zkteco_hr/zkteco_hr/utils/sandbox_verify.py`:
```python
"""Phase-1 verify STUB: the seam for the Phase-2 oracle layer.

Implements the crash oracle (this runs the engine output query; any exception
surfaces) and ONE invariant (no duplicate flags). Emits findings as JSON.
Run via: bench --site sandbox execute zkteco_hr.utils.sandbox_verify.run
"""
from __future__ import annotations

import json
from collections import Counter

import frappe


def no_duplicate_flags(rows: list[dict]) -> list[dict]:
    keys = Counter(
        (r["employee"], r["attendance_date"], r["flag_code"], r["day_closed"])
        for r in rows
    )
    return [
        {"employee": e, "attendance_date": d, "flag_code": f, "day_closed": c, "count": n}
        for (e, d, f, c), n in keys.items() if n > 1
    ]


def run() -> str:
    rows = frappe.get_all(
        "Attendance Flag",
        filters={"source": "AUTO"},
        fields=["employee", "attendance_date", "flag_code", "day_closed"],
        limit_page_length=0,
    )
    findings = {
        "oracle": "invariant:no_duplicate_flags",
        "scanned": len(rows),
        "violations": no_duplicate_flags(rows),
    }
    print(json.dumps(findings, default=str))
    return f"VERIFY_OK violations={len(findings['violations'])}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="$PWD/zkteco_hr" python3 -m unittest zkteco_hr.tests.test_sandbox_verify -v`
Expected: PASS (2 tests OK)

- [ ] **Step 5: Real-data engine run (acceptance bar #3)**

Pick a real employee id from the sandbox:
```bash
cd dev/sandbox && docker compose exec -T bench bash -lc '
cd frappe-bench && bench --site sandbox execute frappe.client.get_list --kwargs "{\"doctype\":\"Employee\",\"fields\":[\"name\"],\"limit_page_length\":1}"'
```
Then run the engine over a date range:
Run: `cd dev/sandbox && ./frappe-sandbox engine-run --employee <EMP-ID> --start 2026-06-01 --end 2026-06-07`
Expected: command completes; recompute runs without error. **If `_require_hr_role` blocks Administrator**, grant the role once: `docker compose exec -T bench bash -lc 'cd frappe-bench && bench --site sandbox add-system-manager Administrator || bench --site sandbox execute frappe.client.insert --kwargs "{\"doc\":{\"doctype\":\"Has Role\",\"parent\":\"Administrator\",\"parenttype\":\"User\",\"parentfield\":\"roles\",\"role\":\"HR Manager\"}}"'` — then re-run. Record the resolved role in README. **This is acceptance bar #3.**

- [ ] **Step 6: Run the verify stub over real data**

Run: `cd dev/sandbox && ./frappe-sandbox verify`
Expected: a JSON line `{"oracle": "invariant:no_duplicate_flags", "scanned": N, "violations": [...]}` then `VERIFY_OK violations=K`.

- [ ] **Step 7: Confirm full backend suite still green**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast`
Expected: `Ran 152 tests ... OK`.

- [ ] **Step 8: Commit**

```bash
git add zkteco_hr/zkteco_hr/utils/sandbox_verify.py zkteco_hr/zkteco_hr/tests/test_sandbox_verify.py
git commit -m "feat(sandbox): engine-run + verify stub (crash + no-duplicate-flags invariant)"
```

---

## Task 9: Frontend lane merge + `test --frontend` + doctor + README (wrap 1a)

**Files:**
- Merge from worktree `ci+frontend-e2e-and-unit` into the live tree:
  - Modify: `zkteco_hr/zkteco_hr/frontend/hr_attendance/package.json` (add `test:web`, `test:e2e` scripts; devDeps `@playwright/test@^1.61.0`, `tsx@^4.22.4`)
  - Create: `zkteco_hr/zkteco_hr/frontend/hr_attendance/playwright.config.ts`
  - Create: `zkteco_hr/zkteco_hr/frontend/hr_attendance/e2e/fixtures.ts`, `e2e/attendance.spec.ts`, `e2e/schedule.spec.ts`
  - Create: `.github/workflows/frontend.yml`
- Create: `dev/sandbox/README.md`

**Interfaces:**
- Consumes: `build_frontend` (Task 2).

- [ ] **Step 1: Port the worktree's frontend test wiring**

Run (copy the proven files from the worktree into the live tree):
```bash
WT=.claude/worktrees/ci+frontend-e2e-and-unit
FE=zkteco_hr/zkteco_hr/frontend/hr_attendance
cp "$WT/$FE/playwright.config.ts" "$FE/playwright.config.ts"
mkdir -p "$FE/e2e" && cp "$WT/$FE/e2e/"*.ts "$FE/e2e/"
cp "$WT/.github/workflows/frontend.yml" .github/workflows/frontend.yml
```
Then hand-merge `package.json`: add to `scripts` — `"test:web": "tsx --test src/lib/*.test.ts"`, `"test:e2e": "playwright test"`; add to `devDependencies` — `"@playwright/test": "^1.61.0"`, `"tsx": "^4.22.4"`. (Match the worktree's `package.json` exactly.)

- [ ] **Step 2: Install + run unit web tests (token-gated)**

Run:
```bash
cd zkteco_hr/zkteco_hr/frontend/hr_attendance
NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN:?set a GitHub PAT with read:packages}" npm install --no-audit --no-fund
npm run test:web
```
Expected: `tsx --test` runs the 6 `src/lib/*.test.ts` → all pass. (If `NODE_AUTH_TOKEN` unset, `doctor` warns and this step is skipped per the non-fatal rule.)

- [ ] **Step 3: Run E2E (chromium)**

Run:
```bash
cd zkteco_hr/zkteco_hr/frontend/hr_attendance
npx playwright install --with-deps chromium
npm run test:e2e
```
Expected: Playwright starts the vite dev server on :8080, runs `attendance.spec.ts` + `schedule.spec.ts` (desktop + mobile, both chromium) → all pass; no backend needed (fixtures stub it).

- [ ] **Step 4: Wire + verify the CLI frontend verb**

Run: `cd dev/sandbox && ./frappe-sandbox test --frontend --unit`
Expected: runs `npm run test:web` in the frontend dir → pass.
Run: `cd dev/sandbox && ./frappe-sandbox doctor`
Expected: `[PASS] docker present`, `[PASS] compose file exists`, `[PASS] python >= 3.9`, and `[PASS]`/`[WARN] NODE_AUTH_TOKEN set (frontend)` depending on env.

- [ ] **Step 5: Write `dev/sandbox/README.md`**

`dev/sandbox/README.md` — document: prerequisites (Docker, Python 3.9+, `NODE_AUTH_TOKEN` for frontend), the verbs, the two backend lanes, where to drop a Frappe Cloud backup for `seed --prod`, the `get-app` symlink-vs-copy finding from Task 4, the resolved HR-role step from Task 8, and the loop recipes:
```
# inner TDD loop (sub-second, no Docker)
./frappe-sandbox test --backend --fast --module test_closeout
# CI-parity gate before pushing
./frappe-sandbox test --backend
# real-data triage
./frappe-sandbox seed --prod <backup-dir> && ./frappe-sandbox engine-run --employee <id> --start <d> --end <d> && ./frappe-sandbox verify
```

- [ ] **Step 6: Full green sweep (all three acceptance bars)**

Run, in order:
```bash
cd dev/sandbox
./frappe-sandbox doctor
./frappe-sandbox test --backend            # bar #1
./frappe-sandbox test --backend --fast     # bar #2 substrate
./frappe-sandbox verify                    # bar #3 (after a prior seed --prod + engine-run)
```
Expected: doctor PASS; both backend lanes `OK`; verify emits findings JSON.

- [ ] **Step 7: Commit**

```bash
git add dev/sandbox/README.md zkteco_hr/zkteco_hr/frontend/hr_attendance/package.json zkteco_hr/zkteco_hr/frontend/hr_attendance/playwright.config.ts zkteco_hr/zkteco_hr/frontend/hr_attendance/e2e .github/workflows/frontend.yml
git commit -m "feat(sandbox): frontend lane (merge setup-ci worktree) + README + doctor; Phase 1a complete"
```

---

## Self-Review

**Spec coverage:**
- §5/§6 backend lane (two sites, two speeds) → Tasks 4, 5. ✓
- §7 frontend lane (reuse worktree) → Task 9. ✓
- §8 seeding + anonymization → Tasks 6, 7. ✓
- §9 CLI surface (up/down/install-app/seed/test/engine-run/verify/migrate/doctor) → Tasks 2, 3. **Gap:** `migrate` and `down` verbs are built (`build_down`) but `migrate` has no dedicated builder/subparser. *Resolution:* `migrate` is low-risk and not on any acceptance bar; deferred to the first follow-up (note in README). `down` is exercised via `build_down` (tested) though without a subparser entry — add a `down` subparser line in Task 3 cli.py: `dn = sub.add_parser("down"); dn.add_argument("--purge", action="store_true")` (already present). ✓
- §10 warm loop → Tasks 5 (fast lane) + README recipes. ✓
- §11 autonomous-verify SEAM (structured engine-run output + `verify` stub) → Task 8. ✓ (full oracle suite correctly out of Phase 1a)
- §14 acceptance bars #1/#2/#3 → Tasks 5, 5, 8 + final sweep in Task 9. ✓
- §2.1 distribution/skill (1b) → correctly NOT in this plan (1a only). ✓

**Placeholder scan:** one intentional marker called out and instructed-to-delete in Task 2 Step 3 (the `p" "` line). No TBD/TODO/"handle edge cases". ✓

**Type consistency:** `Config` fields used identically across config.py/commands.py/cli.py; builders all return `list[list[str]]`; `run_all` consumes `list[list[str]]`; `no_duplicate_flags`/`_scrub_statements` signatures match their tests. ✓

**Open-question handling:** get-app symlink-vs-copy (Task 4 Step 4), HR-role gate (Task 8 Step 5), FC backup variant (Task 7 tolerant flags) are resolved *empirically inside the relevant task* rather than assumed. ✓
