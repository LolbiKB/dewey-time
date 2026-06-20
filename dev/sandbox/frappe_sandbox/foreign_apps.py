"""Pure helpers for seeding a prod backup whose installed-apps set / versions
differ from the sandbox bench. No external deps — the DB I/O that uses these
lives in scripts/prune_foreign_apps.py (which runs in-container with pymysql).

A restored prod backup records, in the site DB, every app it had installed. If
the sandbox bench lacks one of those apps, `bench migrate`/init crashes trying
to import that app's hooks (ModuleNotFoundError). These helpers decide which
apps to prune and surface major-version drift between backup and bench.
"""
from __future__ import annotations


def parse_major(version) -> int | None:
    """Major version int from a version string ('16.23.0' -> 16); None if unparseable."""
    if not version:
        return None
    head = str(version).strip().split(".", 1)[0]
    return int(head) if head.isdigit() else None


def foreign_apps(db_apps, present_apps) -> list[str]:
    """Apps the restored DB lists as installed but that are absent from the bench.

    Order-preserving and de-duplicated, so callers can log/act deterministically.
    """
    present = set(present_apps)
    seen: set[str] = set()
    out: list[str] = []
    for app in db_apps:
        if app and app not in present and app not in seen:
            seen.add(app)
            out.append(app)
    return out


def filtered_installed_apps(installed, present_apps) -> list[str]:
    """The installed_apps list keeping only apps present in the bench (order preserved)."""
    present = set(present_apps)
    out: list[str] = []
    for app in installed:
        if app in present and app not in out:
            out.append(app)
    return out


def version_warnings(db_versions: dict, bench_versions: dict) -> list[str]:
    """One warning per app whose MAJOR version differs between backup and bench.

    Major-version drift is the meaningful signal: `bench migrate` and engine
    replay are only reliable when the code matches the data's schema generation.
    """
    warnings: list[str] = []
    for app in sorted(db_versions):
        db_ver = db_versions[app]
        bench_ver = bench_versions.get(app)
        if not bench_ver:
            continue
        db_major, bench_major = parse_major(db_ver), parse_major(bench_ver)
        if db_major is not None and bench_major is not None and db_major != bench_major:
            warnings.append(
                f"version mismatch: {app} backup={db_ver} (v{db_major}) vs "
                f"bench={bench_ver} (v{bench_major}) — migrate and engine-replay "
                f"may be unreliable across major versions"
            )
    return warnings
