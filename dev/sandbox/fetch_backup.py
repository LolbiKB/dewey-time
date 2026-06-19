#!/usr/bin/env python3
"""Download the latest offsite backup of a Frappe Cloud site via the Press API.

No dashboard needed. Writes the 3 files into <dest> with names that
`frappe-sandbox seed --prod <dest>` understands:
    <name>-database.sql.gz, <name>-files.tar, <name>-private-files.tar

Credentials (env) — generate once at frappecloud.com -> account User -> Settings
-> API Access -> Generate Keys (the secret is shown only once):
    FC_API_KEY, FC_API_SECRET, FC_TEAM (your team email/slug), FC_SITE (e.g. dewey.frappehr.com)

Usage:
    FC_API_KEY=... FC_API_SECRET=... FC_TEAM=you@example.com FC_SITE=dewey.frappehr.com \\
      python3 dev/sandbox/fetch_backup.py dev/sandbox/_backup

Caveats (the API contract is read from frappe/press source, so verify on first run):
  * Offsite backups are a PAID feature — only offsite rows yield downloadable S3 links.
  * Presigned links are short-lived; this script mints each one immediately before download.
  * If the site encrypts backups, the DB dump is GPG-encrypted and `bench restore` needs the
    encryption key (not exposed by the Press API) — you'll see a restore error if so.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://frappecloud.com/api/method"


def _env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        sys.exit(f"fetch_backup: missing env var {key}")
    return val


def _api(method: str, params: dict, *, key: str, secret: str, team: str, timeout: int = 60):
    url = f"{BASE}/{method}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"token {key}:{secret}",
        "X-Press-Team": team,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read()).get("message")
    except urllib.error.HTTPError as e:
        sys.exit(f"fetch_backup: {method} -> HTTP {e.code} {e.reason}\n{e.read().decode(errors='replace')[:500]}")


def _download(link: str, out: Path) -> None:
    # presigned S3 URL — NO auth headers; stream to disk (backups can be multi-GB).
    with urllib.request.urlopen(link, timeout=300) as resp, open(out, "wb") as fh:
        shutil.copyfileobj(resp, fh, length=1024 * 1024)


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit("usage: fetch_backup.py <dest_dir>")
    dest = Path(sys.argv[1])
    dest.mkdir(parents=True, exist_ok=True)
    key, secret, team, site = (_env("FC_API_KEY"), _env("FC_API_SECRET"),
                               _env("FC_TEAM"), _env("FC_SITE"))

    me = _api("press.api.account.me", {}, key=key, secret=secret, team=team)
    print(f"fetch_backup: auth ok (team={team}, site={site})")

    backups = _api("press.api.site.backups", {"name": site}, key=key, secret=secret, team=team) or []
    pick = next((b for b in backups
                 if b.get("offsite") and b.get("with_files")
                 and b.get("files_availability") == "Available"), None)
    if not pick:
        sys.exit("fetch_backup: no offsite backup with files available for this site.\n"
                 "  Offsite backups are a paid Frappe Cloud feature; enable it (and take a\n"
                 "  backup with files) or download manually from the dashboard.")
    name = pick["name"]
    print(f"fetch_backup: latest offsite backup = {name}")

    slots = {
        "database": f"{name}-database.sql.gz",
        "public": f"{name}-files.tar",
        "private": f"{name}-private-files.tar",
    }
    for slot, fname in slots.items():
        link = _api("press.api.site.get_backup_link",
                    {"name": site, "backup": name, "file": slot},
                    key=key, secret=secret, team=team)
        if not link:
            sys.exit(f"fetch_backup: no download link for slot '{slot}'")
        out = dest / fname
        print(f"  downloading {slot} -> {out.name}")
        _download(link, out)
    print(f"fetch_backup: DONE — backup in {dest}\n"
          f"  next: ./frappe-sandbox seed --prod {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
