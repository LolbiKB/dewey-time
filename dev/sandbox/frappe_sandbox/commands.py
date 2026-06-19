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
    return f"cd {shlex.quote(cfg.bench_dir)} && bench {site_part}{args}"


def build_up(cfg: Config) -> list[list[str]]:
    return [_compose(cfg) + ["up", "-d"]]


def build_ready(cfg: Config) -> list[list[str]]:
    """One-shot cold start: bring the stack up, then provision (idempotent)."""
    return build_up(cfg) + build_provision(cfg)


def build_down(cfg: Config, *, purge: bool = False) -> list[list[str]]:
    return [_compose(cfg) + ["down"] + (["-v"] if purge else [])]


def build_provision(cfg: Config) -> list[list[str]]:
    env = {
        "APP": cfg.app,
        "APP_SRC": "/workspace/repo",  # in-container mount of the repo (docker-compose.yml), NOT cfg.app_src (a host path)
        "REQUIRED_APPS": " ".join(cfg.required_apps),
        "BRANCH": cfg.branch,
        "TEST_SITE": cfg.test_site,
        "REGISTER_APPS_TXT": "1" if cfg.register_app_in_apps_txt else "0",
        "BENCH_DIR": cfg.bench_dir,
        "BOOTSTRAP_METHOD": cfg.bootstrap_method,
    }
    return [docker_exec(cfg, "bash /workspace/repo/dev/sandbox/scripts/provision.sh", env=env)]


def build_run_tests(cfg: Config, *, module: str | None = None,
                    fast: bool = False) -> list[list[str]]:
    if fast:
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
        "ANONYMIZE_METHOD": cfg.anonymize_method,
        "BOOTSTRAP_METHOD": cfg.bootstrap_method,
    }
    return [docker_exec(cfg, "bash /workspace/repo/dev/sandbox/scripts/seed_prod.sh", env=env)]


def build_exercise(cfg: Config, kwargs: dict) -> list[list[str]]:
    if not cfg.exercise_method:
        raise ValueError("no exercise configured (add an 'exercise' block or run init)")
    payload = json.dumps(kwargs, sort_keys=True)
    args = f"execute {cfg.exercise_method} --kwargs {shlex.quote(payload)}"
    return [docker_exec(cfg, _bench(cfg, args, site=cfg.sandbox_site))]


def build_verify(cfg: Config) -> list[list[str]]:
    args = f"execute {cfg.verify_method}"
    return [docker_exec(cfg, _bench(cfg, args, site=cfg.sandbox_site))]


def build_bootstrap(cfg: Config, *, site: str | None = None) -> list[list[str]]:
    """App-provided post-provision setup (custom fields, masters, config).
    No-op (empty command list) when the app declares no bootstrap_method."""
    if not cfg.bootstrap_method:
        return []
    args = f"execute {cfg.bootstrap_method}"
    return [docker_exec(cfg, _bench(cfg, args, site=site or cfg.sandbox_site))]


def build_frontend(cfg: Config, *, mode: str) -> list[list[str]]:
    fe = shlex.quote(cfg.frontend_dir)
    if mode == "all":
        return [["bash", "-lc", f"cd {fe} && npm run test:web && npm run test:e2e"]]
    script = {"unit": "test:web", "e2e": "test:e2e"}.get(mode)
    if script is None:
        raise ValueError(f"Unknown frontend mode: {mode!r}")
    return [["bash", "-lc", f"cd {fe} && npm run {script}"]]
