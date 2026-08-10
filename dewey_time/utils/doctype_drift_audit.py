"""Read-only audit: what would break if dewey_time's DocTypes became standard?

Run via: bench --site <site> execute dewey_time.utils.doctype_drift_audit.run

Answers the two questions T3-11's spec says must be settled against real data
before flipping `"custom": 1` -> `0`
(docs/superpowers/specs/2026-08-10-doctype-controllers-design.md):

1. **Schema drift** — the destructive one. Making a DocType standard makes the
   app's JSON authoritative. A field added in Desk on production exists in
   `tabDocField` but not in the JSON, and the reimport de-registers it: the
   column survives, the data becomes invisible to Frappe. This reports every
   such field BEFORE anyone migrates.
2. **Legacy rows the newly-live validators would reject.** Each of these throws
   on the row's *next save*, not at migrate time, so without this audit the
   failure surfaces days later and somewhere else.

Writes nothing. Safe against a production restore; pointless against a site
built from the JSON (drift is zero there by construction).
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import frappe

# The seven carrying `"custom": 1`. `Schedule Change Log` is deliberately absent:
# it is already standard, and is the control case the spec leans on.
DOCTYPES = (
    "Attendance Flag",
    "Attendance Flag Decision",
    "Device Sync Status",
    "Device Closeout Alert",
    "Dewey Time Push Subscription",
    "Dewey Time Settings",
    "Dewey Time Branch Rollout",
)


def _json_path(doctype: str) -> Path:
    """Locate a DocType's JSON inside the installed app.

    Anchored on this file, not the CWD: `bench execute` runs from the bench
    directory, so a repo-relative path resolves locally and raises in CI --
    the trap recorded in test_non_primary_severity_patch.py.
    """
    scrubbed = frappe.scrub(doctype)
    return (
        Path(__file__).resolve().parents[1]
        / "dewey_time"
        / "doctype"
        / scrubbed
        / f"{scrubbed}.json"
    )


def _json_fieldnames(doctype: str) -> tuple[set[str], str | None]:
    path = _json_path(doctype)
    if not path.exists():
        return set(), f"no JSON at {path}"
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return set(), f"unreadable JSON: {exc}"
    names = {
        f.get("fieldname")
        for f in data.get("fields", [])
        if f.get("fieldname")
    }
    return names, None


def _db_fieldnames(doctype: str) -> set[str]:
    return set(
        frappe.get_all(
            "DocField",
            filters={"parent": doctype, "parenttype": "DocType"},
            pluck="fieldname",
        )
    )


def audit_schema_drift() -> list[dict]:
    """Per DocType: the current custom flag, and fields present in one side only."""
    report = []
    for doctype in DOCTYPES:
        if not frappe.db.exists("DocType", doctype):
            report.append({"doctype": doctype, "status": "absent from this site"})
            continue

        json_fields, json_error = _json_fieldnames(doctype)
        db_fields = _db_fieldnames(doctype)

        # Custom Fields are a separate table and survive the flip untouched --
        # they are the SUPPORTED way to extend a standard DocType, so they are
        # counted but never reported as drift.
        custom_fields = set(
            frappe.get_all("Custom Field", filters={"dt": doctype}, pluck="fieldname")
        )

        report.append(
            {
                "doctype": doctype,
                "custom": frappe.db.get_value("DocType", doctype, "custom"),
                "json_error": json_error,
                # THE DESTRUCTIVE CASE: in the database, absent from the JSON.
                "would_be_deregistered": sorted(db_fields - json_fields - custom_fields),
                # Harmless: the reimport adds these.
                "would_be_added": sorted(json_fields - db_fields),
                "custom_fields_unaffected": sorted(custom_fields),
            }
        )
    return report


def _duplicate_keys(doctype: str, fields: list[str]) -> list[dict]:
    """Rows sharing a key that a newly-live autoname/validate would make unique."""
    if not frappe.db.exists("DocType", doctype):
        return []
    counts = Counter()
    for row in frappe.get_all(doctype, fields=fields, limit_page_length=0):
        counts[tuple(str(row.get(f) or "") for f in fields)] += 1
    return [
        {"key": dict(zip(fields, key)), "rows": n}
        for key, n in sorted(counts.items(), key=lambda kv: -kv[1])
        if n > 1
    ]


def audit_legacy_rows() -> dict:
    """Rows that the hooks this fix wakes up would reject or duplicate."""
    findings = {
        # DeviceSyncStatus.validate throws when a second row shares the key.
        "device_sync_duplicates": _duplicate_keys(
            "Device Sync Status", ["device_sn", "local_date"]
        ),
        # DeviceCloseoutAlert.autoname would make these one row; nothing throws,
        # but the duplicates are evidence the dead hook was doing nothing.
        "closeout_alert_duplicates": _duplicate_keys(
            "Device Closeout Alert", ["device_sn", "local_date"]
        ),
        # A legacy hash-named row and a new canonical row for one endpoint means
        # the browser is pushed to twice.
        "push_subscription_duplicates": _duplicate_keys(
            "Dewey Time Push Subscription", ["endpoint"]
        ),
    }
    findings["settings"] = _audit_settings()
    return findings


def _audit_settings() -> dict | str:
    """Would DeweyTimeSettings.validate reject the config already saved?"""
    if not frappe.db.exists("DocType", "Dewey Time Settings"):
        return "doctype absent"
    from frappe.utils import getdate

    doc = frappe.get_single("Dewey Time Settings")
    problems = []

    global_start = doc.get("rollout_testing_start")
    global_live = doc.get("rollout_go_live")
    if global_live and not global_start:
        problems.append("go-live set with no testing start (global)")
    if global_start and global_live and getdate(global_start) > getdate(global_live):
        problems.append("testing start after go-live (global)")

    seen = set()
    for row in doc.get("branch_rollout") or []:
        branch = row.get("branch")
        if not branch:
            continue
        if branch in seen:
            problems.append(f"branch appears twice: {branch}")
        seen.add(branch)
        start, live = row.get("testing_start"), row.get("go_live")
        if start and live and getdate(start) > getdate(live):
            problems.append(f"testing start after go-live: {branch}")

    return {"problems": problems, "branch_rows": len(doc.get("branch_rollout") or [])}


def _row_counts() -> dict:
    """How much data the audit actually looked at.

    Load-bearing, not decoration. On a site built from these JSONs drift is zero
    BY CONSTRUCTION, so a CLEAR verdict there is not evidence of anything -- and
    it reads identically to a CLEAR verdict earned against production. The counts
    are what let a reader tell the two apart, so `run()` refuses to say CLEAR
    without them.
    """
    counts = {}
    for doctype in DOCTYPES:
        if not frappe.db.exists("DocType", doctype):
            continue
        if frappe.get_meta(doctype).issingle:
            continue  # a Single has no rows to count
        counts[doctype] = frappe.db.count(doctype)
    return counts


def verdict(schema_drift: list[dict], row_counts: dict) -> str:
    """The audit's one-line answer. Pure, so the VACUOUS branch is reachable in a
    unit test -- it is the branch that matters most and the hardest to stage on a
    real bench, since it needs every audited table to be empty at once."""
    blocking = [
        entry["doctype"] for entry in schema_drift if entry.get("would_be_deregistered")
    ]
    if blocking:
        return f"DRIFT_AUDIT_BLOCKED fields would be de-registered on: {', '.join(blocking)}"

    total = sum(row_counts.values())
    if total == 0:
        return (
            "DRIFT_AUDIT_VACUOUS every audited table is empty -- this is not a "
            "production restore, and a clear result here proves nothing"
        )
    return f"DRIFT_AUDIT_CLEAR no field would be de-registered by the flip ({total} rows audited)"


def run() -> str:
    counts = _row_counts()
    drift = audit_schema_drift()
    report = {
        "schema_drift": drift,
        "legacy_rows": audit_legacy_rows(),
        "row_counts": counts,
    }
    print(json.dumps(report, indent=2, default=str))
    return verdict(drift, counts)
