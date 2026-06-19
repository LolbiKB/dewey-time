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
