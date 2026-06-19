from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class ExerciseArg:
    flag: str
    kwarg: str
    required: bool = False
    default: str | None = None
    choices: tuple[str, ...] | None = None


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
    exercise_method: str | None = None
    exercise_args: tuple[ExerciseArg, ...] = ()
    anonymize_method: str = ""
    verify_method: str = ""


_REQUIRED = ("app", "app_src", "required_apps", "branch", "frontend_dir")


def load_config(path: str | Path) -> Config:
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
    if not isinstance(data["required_apps"], list) or not data["required_apps"] or not all(isinstance(x, str) for x in data["required_apps"]):
        raise ConfigError("required_apps must be a non-empty list of strings")

    exercise = data.get("exercise")
    exercise_method: str | None = None
    exercise_args: tuple[ExerciseArg, ...] = ()
    if exercise is not None:
        if not isinstance(exercise, dict) or "method" not in exercise:
            raise ConfigError("exercise must be an object with a 'method'")
        exercise_method = exercise["method"]
        if not isinstance(exercise_method, str) or not exercise_method.strip():
            raise ConfigError("exercise.method must be a non-empty string")
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

    base = p.parent

    def resolve(rel: str) -> str:
        return str((base / rel).resolve())

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
        exercise_method=exercise_method,
        exercise_args=exercise_args,
        anonymize_method=data.get("anonymize_method", f"{data['app']}.utils.anonymize.run"),
        verify_method=data.get("verify_method", f"{data['app']}.utils.sandbox_verify.run"),
    )
