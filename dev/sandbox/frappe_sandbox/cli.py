from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

from . import commands as c
from .config import ConfigError, load_config
from .runner import run_all

DEFAULT_CONFIG = str(Path(__file__).resolve().parents[1] / "frappe-sandbox.json")

_ANON_STUB = '''"""Anonymization for the sandbox site. Non-skippable; refuses on prod.
Run via: bench --site sandbox execute {app}.utils.anonymize.run

Column-tolerant: only scrubs columns that exist on the restored schema.
"""
from __future__ import annotations

import frappe

_PROD_MARKERS = ("prod", "frappehr.com")


def is_prod_site(site_name: str) -> bool:
    name = (site_name or "").lower()
    return any(m in name for m in _PROD_MARKERS)


def _scrub_specs() -> list[tuple[str, dict, str]]:
    # TODO: (doctype, {column: sql_value_expr}, where_clause). Use \'\' / 0 to blank
    # (respect NOT NULL); keep engine-relevant fields OUT of the column keys.
    return []


def run() -> str:
    site = frappe.local.site
    if is_prod_site(site):
        raise RuntimeError(f"refusing to anonymize a prod-looking site: {site}")
    for doctype, set_map, where in _scrub_specs():
        try:
            existing = set(frappe.db.get_table_columns(doctype))
        except Exception:
            continue
        cols = {col: expr for col, expr in set_map.items() if col in existing}
        if not cols:
            continue
        set_clause = ", ".join(f"`{col}` = {expr}" for col, expr in cols.items())
        frappe.db.sql(f"UPDATE `tab{doctype}` SET {set_clause} {where}".strip())
    frappe.db.commit()
    return f"ANONYMIZE_OK site={site}"
'''

_BOOTSTRAP_STUB = '''"""Sandbox bootstrap: set up this app\'s custom fields / masters / config so a
fresh bench (or a schema-light restore) has the schema the app expects. Idempotent.
Run via: bench --site <site> execute {app}.utils.sandbox_bootstrap.run
"""
from __future__ import annotations

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

# TODO: declare this app\'s custom fields by doctype, e.g.
# _CUSTOM_FIELDS = {"Some Doctype": [{"fieldname": "custom_x", "label": "X", "fieldtype": "Data"}]}
_CUSTOM_FIELDS = {}


def run() -> str:
    if _CUSTOM_FIELDS:
        create_custom_fields(_CUSTOM_FIELDS, ignore_validate=True)
    frappe.db.commit()
    return "BOOTSTRAP_OK"
'''

_VERIFY_STUB = '''"""Sandbox verify stub (seam for the oracle layer).
Run via: bench --site sandbox execute {app}.utils.sandbox_verify.run
"""
from __future__ import annotations

import json


def run() -> str:
    # TODO: add invariants over this app\'s generated data.
    findings = {"oracle": "stub", "scanned": 0, "violations": []}
    print(json.dumps(findings))
    return "VERIFY_OK violations=0"
'''


def _init(config_path, *, app, app_src, frontend_dir) -> int:
    cfg_path = Path(config_path)
    base = cfg_path.parent
    utils_dir = (base / app_src / app / "utils").resolve()
    targets = [cfg_path, utils_dir / "anonymize.py", utils_dir / "sandbox_verify.py",
               utils_dir / "sandbox_bootstrap.py"]
    existing = [t for t in targets if t.exists()]
    if existing:
        print(f"init: refusing to overwrite existing files: "
              f"{', '.join(str(t) for t in existing)}", file=sys.stderr)
        return 1
    scaffold = {
        "_TODO": "Fill required_apps, exercise.method/args, and the anonymize/sandbox_verify/sandbox_bootstrap stubs.",
        "app": app,
        "app_src": app_src,
        "required_apps": ["frappe"],
        "branch": "version-15",
        "frontend_dir": frontend_dir,
        "bootstrap_method": f"{app}.utils.sandbox_bootstrap.run",
        "exercise": {"method": "CHANGEME.module.function", "args": []},
    }
    cfg_path.write_text(json.dumps(scaffold, indent=2) + "\n")
    utils_dir.mkdir(parents=True, exist_ok=True)
    (utils_dir / "__init__.py").touch()
    (utils_dir / "anonymize.py").write_text(_ANON_STUB.replace("{app}", app))
    (utils_dir / "sandbox_verify.py").write_text(_VERIFY_STUB.replace("{app}", app))
    (utils_dir / "sandbox_bootstrap.py").write_text(_BOOTSTRAP_STUB.replace("{app}", app))
    print(f"init: scaffolded {cfg_path} + {utils_dir}/{{anonymize,sandbox_verify,sandbox_bootstrap}}.py")
    return 0


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
    if args.cmd == "bootstrap":
        site = cfg.test_site if args.test_site else cfg.sandbox_site
        return c.build_bootstrap(cfg, site=site)
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
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--config", default=DEFAULT_CONFIG)
    pre.add_argument("--dry-run", action="store_true")
    known, remaining = pre.parse_known_args(argv)

    # init runs before config exists — dispatch it immediately.
    if remaining and remaining[0] == "init":
        init_p = argparse.ArgumentParser(prog="frappe-sandbox init")
        init_p.add_argument("--config", default=known.config)
        init_p.add_argument("--app", required=True)
        init_p.add_argument("--app-src", default="../..")
        init_p.add_argument("--frontend-dir", default="../..")
        init_args = init_p.parse_args(remaining[1:])
        return _init(known.config, app=init_args.app, app_src=init_args.app_src,
                     frontend_dir=init_args.frontend_dir)

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
    b = sub.add_parser("bootstrap")
    b.add_argument("--test-site", action="store_true",
                   help="run bootstrap on test_site instead of the sandbox site")
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


if __name__ == "__main__":
    raise SystemExit(main())
