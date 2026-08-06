"""HR flag triage queue — the batched cross-employee read behind /hr-flags.

This is the only endpoint that reads flags for the whole roster at once, so the query
budget is the defining constraint: a FIXED number of queries per request, regardless of
how many employees have flags. Everything that looks per-employee — branch resolution,
decision matching, device-outage detection — is done in Python over batched result sets
and then handed to flag_grouping.build_queue, which is pure. Never loop
get_employee_calendar (hr_calendar.py:603-646) or reuse get_my_week's per-day shape
(api.py:78-82,109-112); ×500 employees is thousands of queries for one week.

Bounding follows coverage_api.get_schedule_coverage, the established shape for an
HR-only whole-roster read: a hard row cap, a short Redis cache, doc-event invalidation
wired in hooks.py, and a `truncated` flag instead of a cursor (there is no cursor
pattern in this repo to copy, and `truncated` is honest about what was dropped).
"""

from __future__ import annotations

import frappe
from frappe.utils import getdate

from dewey_time.attendance_engine.flag_grouping import build_queue
from dewey_time.attendance_engine.flag_identity import date_key, flag_identity, parse_evidence
from dewey_time.attendance_engine.flag_triage import TIER_ACT, TIER_REVIEW, TIER_ROUTINE
from dewey_time.attendance_engine.hr_calendar import _require_hr_role

# Row cap on the one unfiltered Attendance Flag scan. Sized defensively: 500 employees ×
# a month of flags is unmeasured (spec Open risk 3), so `truncated` reports when it bites.
QUEUE_FLAG_LIMIT = 5000

# A month at a time. The scan is unfiltered by employee, so the date range is the only
# thing bounding it.
QUEUE_MAX_RANGE_DAYS = 31

# Ceiling on entries returned in one response; also the `limit` default in the signature
# below (kept as a literal there so the whitelisted signature reads as documented).
_MAX_ENTRIES = 2000

_TIERS = frozenset({TIER_ACT, TIER_REVIEW, TIER_ROUTINE})

_QUEUE_CACHE_PREFIX = "flag_queue:v1"

# 60s, deliberately half of coverage_api's 120s (coverage_api.py:26). The invalidator
# below is best-effort only: the engine deletes flags with raw frappe.db.delete()
# (closeout.py:712, reached from intraday.py:78,214 and closeout.py:295,473,476), which
# fires NO document hooks at all, so a regeneration cycle can leave this cache stale
# without ever calling the invalidator. The short TTL, not the hook, is what actually
# bounds staleness — that is why it is 60s and not longer.
_QUEUE_CACHE_TTL_SECONDS = 60


def _date_key(value) -> str:
    """A date column as "YYYY-MM-DD", whatever shape the driver handed back.

    Thin alias for flag_identity.date_key, which flag_grouping._date_str also delegates
    to — one implementation, because three separate things have to agree on the same
    string or the feature fails silently: the identity handed to flag_identity() (whose
    _format_date str()s a string as given, so a datetime-shaped one would stop matching
    what flag_decision_api stores), the outage (branch, date) tuples (flag_grouping.py:191
    tests raw tuple membership), and the decision code keys _orphans compares.
    """
    return date_key(value)


def _queue_cache_key(
    start_date: str, end_date: str, tier: str | None, include_decided: bool = False
) -> str:
    """The two views are separate entries — sharing one key would serve a request
    that asked for settled people the page that omits them, silently.

    The include_decided component is a SUFFIX rather than a fourth slot so the
    default view's key is byte-identical to what it has always been; the prefix
    scan in invalidate_flag_queue_cache reaches both either way.
    """
    key = f"{_QUEUE_CACHE_PREFIX}:{start_date}:{end_date}:{tier or 'all'}"
    return f"{key}:decided" if include_decided else key


def invalidate_flag_queue_cache(doc=None, method=None):
    """Drop every cached queue page. Wired in hooks.py to Attendance Flag Decision
    doc events only (after_insert / on_update / on_trash), mirroring
    coverage_api.invalidate_coverage_cache.

    Deliberately NOT wired to Attendance Flag: this is a delete_keys() prefix scan,
    i.e. a blocking Redis KEYS over the whole keyspace, and the engine rewrites
    flags on every checkin and every closeout — it would run that scan all day for
    freshness the 60s TTL already provides, on sites with nobody on the page. It
    could not have made the cache correct either, since the engine's deletes go
    through raw frappe.db.delete() and fire no document hooks at all.
    test_engine_flag_writes_are_deliberately_not_hooked pins the absence.

    delete_keys (not delete_value) because the key carries the range and tier, so one
    request writes one of many pages. Best-effort — see _QUEUE_CACHE_TTL_SECONDS above
    for why the TTL is what really bounds staleness.
    """
    frappe.cache().delete_keys(_QUEUE_CACHE_PREFIX)


def _parse_include_decided(value) -> bool:
    """Same coercion as flag_decision_api._parse_confirm (and dev_tools before it):
    Frappe hands whitelisted arguments over as strings, so the SPA's `1` arrives as
    "1" and a bare False must not read as truthy."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def _coerce_limit(limit) -> int:
    try:
        value = int(limit)
    except (TypeError, ValueError):
        return _MAX_ENTRIES
    return max(1, min(value, _MAX_ENTRIES))


def _apply_entry_limit(payload: dict, limit: int) -> dict:
    """Slice the cached payload down to `limit` entries. Applied AFTER the cache read on
    purpose: the contract's cache key has no `limit` component, so the cache stores the
    full page for a (range, tier) and each caller trims it."""
    entries = payload.get("entries") or []
    if len(entries) <= limit:
        return payload
    return {**payload, "entries": entries[:limit], "truncated": True}


def _flag_rows(start, end) -> tuple[list[dict], bool]:
    """The single unfiltered Attendance Flag scan for the range. Returns (flags, hit_cap).

    source == "AUTO" only: flag_identity is prefixed "AUTO-" by construction, so an
    HR-created flag for the same employee/date/code would collide with the engine's row
    under one identity. Manual flags are HR's own and were never at risk from the
    delete-and-rebuild cycle this queue exists for.
    """
    rows = (
        frappe.get_all(
            "Attendance Flag",
            filters={"attendance_date": ["between", [start, end]], "source": "AUTO"},
            fields=["employee", "attendance_date", "flag_code", "severity", "day_closed", "evidence"],
            # Deterministic so truncation at the cap always drops the same tail.
            order_by="attendance_date asc, employee asc, creation asc",
            limit_page_length=QUEUE_FLAG_LIMIT,
        )
        or []
    )

    # flag_identity deliberately excludes day_closed (that is the whole point of the
    # scheme), so inside the closeout window a provisional and its final replacement can
    # both be live and share one identity. Collapse to one row, final preferred.
    by_identity: dict[str, dict] = {}
    for row in rows:
        attendance_date = _date_key(row.get("attendance_date"))
        # `evidence` is Long Text — a JSON string off the wire. Parse once, here: every
        # downstream consumer (triage_rank's minutes bands, evidence_fingerprint,
        # flag_identity's suffix builders) silently degrades on a raw string rather than
        # raising.
        evidence = parse_evidence(row.get("evidence"))
        identity = flag_identity(
            employee=row.get("employee"),
            # Normalised first so the identity cannot depend on whether the driver
            # handed back a date object or a string (see _date_key).
            attendance_date=attendance_date,
            flag_code=row.get("flag_code"),
            evidence=evidence,
        )
        flag = {
            "flag_identity": identity,
            "employee": row.get("employee"),
            "attendance_date": attendance_date,
            "flag_code": row.get("flag_code"),
            "severity": row.get("severity"),
            "day_closed": row.get("day_closed"),
            "evidence": evidence,
        }
        previous = by_identity.get(identity)
        if previous is None or (flag.get("day_closed") or 0) >= (previous.get("day_closed") or 0):
            by_identity[identity] = flag

    return list(by_identity.values()), len(rows) >= QUEUE_FLAG_LIMIT


def _decisions_by_identity(start, end) -> tuple[dict[str, dict], bool]:
    """Live (superseded=0) decisions for the range, keyed by flag_identity."""
    rows = (
        frappe.get_all(
            "Attendance Flag Decision",
            filters={"attendance_date": ["between", [start, end]], "superseded": 0},
            fields=[
                "name",
                "flag_identity",
                "employee",
                "attendance_date",
                "flag_code",
                "outcome",
                "reason",
                "note",
                "evidence_fingerprint",
                "group_key",
                "decided_by",
                "decided_at",
            ],
            order_by="decided_at asc",
            limit_page_length=QUEUE_FLAG_LIMIT,
        )
        or []
    )

    by_identity: dict[str, dict] = {}
    for row in rows:
        if row.get("decided_at"):
            row["decided_at"] = str(row["decided_at"])
        # employee/attendance_date/flag_code are carried so flag_grouping._orphans
        # (flag_grouping.py:266-273) can tell "the flag was corrected and its evidence
        # suffix moved" from "the flag is gone entirely"; without them every orphan
        # classifies as orphaned_flag_gone.
        row["attendance_date"] = _date_key(row.get("attendance_date"))
        # Supersession should already guarantee one live row per identity; ordering by
        # decided_at asc means the newest wins if a write ever raced and left two.
        by_identity[row.get("flag_identity")] = row

    return by_identity, len(rows) >= QUEUE_FLAG_LIMIT


def _employees_by_id(employee_ids: set[str]) -> dict[str, dict]:
    """One Employee query for every flagged employee — never one per employee. The IN
    list is bounded by QUEUE_FLAG_LIMIT distinct employees."""
    if not employee_ids:
        return {}
    rows = (
        frappe.get_all(
            "Employee",
            filters={"name": ["in", sorted(employee_ids)]},
            fields=["name", "employee_name", "branch"],
        )
        or []
    )
    # Keyed "branch", not "employee_branch": flag_grouping._person reads meta["branch"]
    # (flag_grouping.py:157), and a mismatch silently drops every branch group.
    return {
        row["name"]: {"employee_name": row.get("employee_name"), "branch": row.get("branch")}
        for row in rows
    }


def _open_alert_rows(start, end) -> list[dict]:
    """Unresolved Device Closeout Alert rows for the range — the flagless cause list.

    Deliberately NOT filtered by the branches that have flags: when a device reports
    deferred_offline or closure_failed the company-fallback path skips those employees
    entirely and generates no flags at all, which is exactly the silence HR cannot see
    today. Same branch+date+resolved_at shape as hr_calendar.py:487-500, minus the
    per-employee branch filter.

    device_sn is deliberately not selected, and the card is rebuilt field by field rather
    than passed through, so a column added to the doctype later cannot leak into an
    HR-facing payload: no device↔branch registry exists, so nothing HR-facing may name a
    serial (spec "Must not do" 6). Two devices failing at one branch is one fact for HR,
    so rows collapse to one card per (branch, date).
    """
    if not frappe.db.table_exists("Device Closeout Alert"):
        return []

    rows = (
        frappe.get_all(
            "Device Closeout Alert",
            filters={"local_date": ["between", [start, end]], "resolved_at": ["is", "not set"]},
            fields=["branch", "local_date", "status", "last_error"],
            order_by="local_date asc, branch asc",
        )
        or []
    )

    deduped: dict[tuple[str, str], dict] = {}
    for row in rows:
        branch = row.get("branch")
        if not branch:
            # branch comes from the webhook payload and can be absent. Without it there
            # is nothing sayable to HR that does not name a serial, so drop the card
            # rather than render "unknown device".
            continue
        card = {
            "branch": branch,
            "local_date": _date_key(row.get("local_date")),
            "status": row.get("status"),
            "last_error": row.get("last_error"),
        }
        deduped.setdefault((branch, card["local_date"]), card)
    return list(deduped.values())


def _device_sync_pairs(branches: set[str], start, end) -> set[tuple[str, str]]:
    """(branch, date) pairs that reported ANY sync row. Existence is all we need, so this
    skips dedupe_device_sync_for_calendar (hr_calendar.py:531) entirely."""
    if not branches or not frappe.db.table_exists("Device Sync Status"):
        return set()
    rows = (
        frappe.get_all(
            "Device Sync Status",
            filters={"branch": ["in", sorted(branches)], "local_date": ["between", [start, end]]},
            fields=["branch", "local_date"],
        )
        or []
    )
    return {(row.get("branch"), _date_key(row.get("local_date"))) for row in rows}


def _outage_branch_dates(*, flags, employees_by_id, alert_rows, sync_pairs) -> set[tuple[str, str]]:
    """(branch, date) pairs with either an unresolved closeout alert or no sync row at all.

    Detecting "no row at all" needs a candidate set to test against, and there is no
    device registry to enumerate — so the candidates are the (branch, date) pairs of
    employees who actually have flags in the range. Branch granularity is by design, not
    an approximation of something finer: nothing in this app maps a device to a branch.

    Dates are "YYYY-MM-DD" strings throughout (_date_key): flag_grouping normalises the
    flag side but tests membership of this set with a raw tuple (flag_grouping.py:191),
    so a set keyed by datetime.date yields zero groups and no error.
    """
    candidates = set()
    for flag in flags:
        branch = (employees_by_id.get(flag["employee"]) or {}).get("branch")
        if branch:
            candidates.add((branch, flag["attendance_date"]))

    outage = {pair for pair in candidates if pair not in sync_pairs}
    for row in alert_rows:
        outage.add((row["branch"], row["local_date"]))
    return outage


def _build_queue_payload(*, start, end, tier: str | None, include_decided: bool = False) -> dict:
    """Five queries, always: flags, decisions, employees, alerts, sync rows. Adding a
    sixth that varies with employee or day count is a spec violation, not a slow path.

    include_decided changes only which people build_queue keeps in `entries`; the
    reads underneath are identical, because the decided flags were always read
    (that is where `counts["decided"]` comes from)."""
    flags, flags_capped = _flag_rows(start, end)
    decisions_by_identity, decisions_capped = _decisions_by_identity(start, end)
    employees_by_id = _employees_by_id({flag["employee"] for flag in flags if flag.get("employee")})
    alert_rows = _open_alert_rows(start, end)
    branches = {info.get("branch") for info in employees_by_id.values() if info.get("branch")}
    sync_pairs = _device_sync_pairs(branches, start, end)

    queue = build_queue(
        flags=flags,
        decisions_by_identity=decisions_by_identity,
        employees_by_id=employees_by_id,
        outage_branch_dates=_outage_branch_dates(
            flags=flags,
            employees_by_id=employees_by_id,
            alert_rows=alert_rows,
            sync_pairs=sync_pairs,
        ),
        include_decided=include_decided,
    )

    entries = queue.get("entries") or []
    if tier:
        entries = [entry for entry in entries if entry.get("tier") == tier]

    return {
        "entries": entries,
        # counts/orphans stay whole-range: they are the toolbar totals, not a page count.
        "counts": queue.get("counts") or {},
        "orphans": queue.get("orphans") or {},
        "alerts": alert_rows,
        "truncated": bool(flags_capped or decisions_capped),
        "start_date": str(start),
        "end_date": str(end),
    }


@frappe.whitelist()
def get_flag_queue(
    start_date: str,
    end_date: str,
    tier: str | None = None,
    limit: int = 2000,
    include_decided=0,
) -> dict:
    """HR-only: every AUTO flag in the range, ranked, person-deduped and cause-grouped,
    plus the unresolved device alerts that produced no flags at all.

    include_decided=1 additionally returns people whose flags are all settled, so HR
    can reach an applied decision and replace it (deciding the same identity again
    supersedes it). Default 0: the queue's default answer is "who still owes me
    something", and the response for the default is unchanged, cache key included.

    _require_hr_role() raises frappe.ValidationError (417), not PermissionError (403) —
    inconsistent with its neighbours and deliberately kept that way for drop-in
    consistency with schedule_api and coverage_api (hr_calendar.py:50-53).
    """
    _require_hr_role()

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be >= start_date")
    if (end - start).days + 1 > QUEUE_MAX_RANGE_DAYS:
        frappe.throw(f"Date range must be {QUEUE_MAX_RANGE_DAYS} days or fewer")

    tier = (tier or "").strip() or None
    if tier and tier not in _TIERS:
        # Silently returning nothing for a typo'd tier looks like an empty queue.
        frappe.throw("Unknown tier")

    include_decided = _parse_include_decided(include_decided)

    # Normalised dates in the key so "2026-8-1" and "2026-08-01" are one cache entry.
    cache_key = _queue_cache_key(str(start), str(end), tier, include_decided)
    payload = frappe.cache().get_value(cache_key)
    if not payload:
        payload = _build_queue_payload(
            start=start, end=end, tier=tier, include_decided=include_decided
        )
        frappe.cache().set_value(cache_key, payload, expires_in_sec=_QUEUE_CACHE_TTL_SECONDS)

    return _apply_entry_limit(payload, _coerce_limit(limit))
