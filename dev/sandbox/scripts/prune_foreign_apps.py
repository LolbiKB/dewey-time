#!/usr/bin/env python3
"""Prune apps the restored backup lists as installed but that are NOT present in
this bench, so `bench migrate`/init won't crash importing their hooks. Also emits
major-version-mismatch warnings (backup vs bench).

Runs INSIDE the sandbox container via the bench env python (pymysql is available
there) and connects to MariaDB directly — deliberately WITHOUT frappe.init, which
is the very thing that crashes on the missing apps. Idempotent.

Usage (cwd = the bench dir, e.g. /home/frappe/frappe-bench):
    env/bin/python /workspace/repo/dev/sandbox/scripts/prune_foreign_apps.py <site>

Env: DB_HOST (default mariadb), DB_ROOT_USER (default root), DB_ROOT_PASSWORD (default root)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# The pure decision logic lives in the frappe_sandbox package (unit-tested on the
# host). The repo is bind-mounted at /workspace/repo inside the container.
sys.path.insert(0, "/workspace/repo/dev/sandbox")
from frappe_sandbox.foreign_apps import (  # noqa: E402
    filtered_installed_apps,
    foreign_apps,
    version_warnings,
)

import pymysql  # noqa: E402

VERSION_APPS = ("frappe", "erpnext", "hrms")


def _bench_versions(apps_dir: str = "apps") -> dict:
    """Map app -> __version__ string for apps present on disk in this bench."""
    out: dict[str, str] = {}
    for app in sorted(os.listdir(apps_dir)):
        init = Path(apps_dir, app, app, "__init__.py")
        if not init.is_file():
            continue
        for line in init.read_text().splitlines():
            if line.strip().startswith("__version__"):
                out[app] = line.split("=", 1)[1].strip().strip("\"'")
                break
    return out


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit("usage: prune_foreign_apps.py <site>")
    site = sys.argv[1]
    db_name = json.loads(Path("sites", site, "site_config.json").read_text())["db_name"]
    present = set(os.listdir("apps"))

    conn = pymysql.connect(
        host=os.environ.get("DB_HOST", "mariadb"),
        user=os.environ.get("DB_ROOT_USER", "root"),
        password=os.environ.get("DB_ROOT_PASSWORD", "root"),
        database=db_name,
        autocommit=False,
    )
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT app_name, app_version FROM `tabInstalled Application`")
            rows = cur.fetchall()
            db_apps = [r[0] for r in rows]
            db_versions = {r[0]: r[1] for r in rows if r[0] in VERSION_APPS}

            foreign = foreign_apps(db_apps, present)
            if foreign:
                print(f"prune: foreign apps (in backup, not in bench): {foreign}")
                placeholders = ",".join(["%s"] * len(foreign))
                cur.execute(
                    f"DELETE FROM `tabInstalled Application` WHERE app_name IN ({placeholders})",
                    foreign,
                )
                # The cached installed_apps list (tabDefaultValue / __global) must match.
                cur.execute("SELECT defvalue FROM tabDefaultValue WHERE defkey='installed_apps'")
                row = cur.fetchone()
                if row and row[0]:
                    kept = filtered_installed_apps(json.loads(row[0]), present)
                    cur.execute(
                        "UPDATE tabDefaultValue SET defvalue=%s WHERE defkey='installed_apps'",
                        (json.dumps(kept),),
                    )
                    print(f"prune: installed_apps global now {kept}")
            else:
                print("prune: no foreign apps")

            for warning in version_warnings(db_versions, _bench_versions()):
                print(f"WARN: {warning}")
        conn.commit()
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
