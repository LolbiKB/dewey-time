import frappe

from dewey_time.attendance_engine.flag_identity import evidence_fingerprint, flag_identity

# Legacy Attendance Flag.status values that map onto an Attendance Flag
# Decision outcome. See docs/superpowers/specs/2026-08-05-hr-flag-management-design.md,
# "Retiring the Desk decision path".
_STATUS_TO_OUTCOME = {
    "APPROVED": "EXCUSED",
    "REJECTED": "UPHELD",
}

# CLOSED predates this feature entirely (it was a terminal Desk state with no
# EXCUSED/UPHELD meaning) and EXPLAINED belongs to Spec 2's employee-note flow,
# which does not exist yet -- neither has an Attendance Flag Decision
# equivalent. Inventing one would fabricate an HR judgment nobody made.
_NO_DECISION_EQUIVALENT = {"CLOSED", "EXPLAINED"}

# One fixed group_key for every row this patch ever writes, across every run
# on every site. Two things depend on it being constant rather than
# per-row/per-run:
#   1. reverse_decision_group() (flag_decision_api.py) undoes a whole
#      group_key at once -- a fixed key means an operator can bulk-undo the
#      entire legacy migration through the same API a normal bulk decision
#      uses, rather than months-old Desk state having no supported rollback
#      at all.
#   2. It is also the idempotency tag a re-run checks for (see the exists()
#      check in execute() below): a row carrying this group_key, *even if
#      superseded*, means this identity was already handled by this
#      migration -- including the case where an operator deliberately
#      reversed it. Without checking for the tag regardless of superseded,
#      a second run would silently recreate the very decision the operator
#      just undid.
_MIGRATION_GROUP_KEY = "AFD-LEGACY-MIGRATION"


def _note_for(row: dict, status: str) -> str:
    """A note that satisfies the doctype's own required-note validation.

    hr_note was never a required field on the Desk form (attendance_flag.json),
    so a real slice of legacy APPROVED/REJECTED rows carry a blank one --
    likely the majority, not an edge case. This migration always writes
    reason="OTHER", which Attendance Flag Decision.validate() requires a note
    for. Rather than lose the HR judgment itself for want of a sentence
    nobody was ever forced to type, a blank hr_note is replaced with a
    synthesised placeholder that says plainly it is synthesised, so nobody
    downstream mistakes it for the reviewer's own words.
    """
    note = (row.get("hr_note") or "").strip()
    if note:
        return note
    return "Migrated from legacy Desk decision (status={0}); no HR note recorded.".format(status)


def execute():
    """Best-effort migration of legacy in-place Desk decisions into Attendance
    Flag Decision rows, so this page (not Desk) becomes the single place a
    decision can be read from.

    Why "best-effort" is not hedging, but the honest description of what is
    possible: AUTO Attendance Flag rows are hard-deleted and rebuilt on every
    checkin and every closeout, via raw frappe.db.delete() calls that bypass
    every document hook --
        intraday.py:78    (day_closed=0 rows, scoped to INTRADAY_FLAG_CODES)
        intraday.py:214   (ALL AUTO rows for that employee/date, on any
                            checkin insert or edit)
        closeout.py:295,473,476,696
        schedule_resolver.py:1240,1299-1348 (schedule wizard, not the engine)
    Any status/hr_note/hr_user/hr_decided_at an HR reviewer wrote onto an AUTO
    row before this patch runs is destroyed the moment the engine next
    regenerates that employee's date, with no trace and nothing left for this
    patch to find. The rows below are only the ones that happened to still be
    sitting in the table on the day this patch ran: whatever the deletion
    cycle had not yet reached.

    Scoped to source == "AUTO" only, deliberately -- not a gap. flag_identity()
    is hard-prefixed "AUTO-" (flag_identity.py:181), and both native readers of
    a decision filter to source == "AUTO" for exactly that reason
    (flag_queue_api.py:102-105, flag_decision_api.py:153): an HR-created flag
    for the same employee/date/code would collide with the engine's row under
    one identity. Migrating a non-AUTO row here would write a decision at an
    identity that actually belongs to the engine's AUTO flag, not the
    HR-created one it was really about -- silently attaching to the wrong
    flag, or pre-deciding whatever the engine later creates at that identity.
    Rescuing HR/EMPLOYEE-sourced rows would need a distinct, non-AUTO identity
    scheme; this migration does not attempt that.

    A low migrated count on a given site is therefore not evidence this patch
    is broken -- it is evidence of (a) how much the deletion cycle had already
    destroyed before the patch got a chance to run, and (b) the source ==
    "AUTO" scope above deliberately excluding every HR/EMPLOYEE-created row.
    Do not read the tally below as a completeness signal; read it as a
    snapshot of what survived and was in scope.

    Idempotent: an identity that already has either (a) a live (superseded=0)
    decision -- from a prior run of this same patch, or from a fresh decision
    made through decide_flags() in the meantime -- or (b) any row this same
    patch previously wrote (tagged with _MIGRATION_GROUP_KEY, live or not) is
    skipped, so re-running never creates a duplicate and never resurrects a
    migrated decision an operator has since reversed.
    """
    rows = frappe.get_all(
        "Attendance Flag",
        filters={"status": ["!=", "OPEN"], "source": "AUTO"},
        fields=[
            "name",
            "employee",
            "attendance_date",
            "flag_code",
            "evidence",
            "status",
            "hr_note",
            "hr_user",
            "hr_decided_at",
        ],
    )

    migrated = 0
    skipped = 0
    failed = 0

    for row in rows:
        name = row.get("name")
        status = row.get("status")

        if status in _NO_DECISION_EQUIVALENT:
            skipped += 1
            frappe.log_error(
                title="migrate_legacy_flag_decisions: no decision equivalent",
                message=(
                    "Attendance Flag {0} has status {1}, which has no Attendance Flag "
                    "Decision outcome. Left as a legacy in-place record; not migrated."
                ).format(name, status),
            )
            continue

        outcome = _STATUS_TO_OUTCOME.get(status)
        if not outcome:
            # Defensive only: Attendance Flag.status has exactly five options
            # (attendance_flag.json:104-108) and every one is handled above.
            # This guards against a future status value being added to the
            # doctype without this patch being updated to match.
            failed += 1
            frappe.log_error(
                title="migrate_legacy_flag_decisions: unmapped status",
                message="Attendance Flag {0} has unrecognised status {1!r}.".format(name, status),
            )
            continue

        try:
            identity = flag_identity(
                employee=row.get("employee"),
                attendance_date=row.get("attendance_date"),
                flag_code=row.get("flag_code"),
                evidence=row.get("evidence"),
            )
        except Exception:
            failed += 1
            frappe.log_error(
                title="migrate_legacy_flag_decisions: flag_identity failed",
                message="Attendance Flag {0}: could not compute flag_identity.\n{1}".format(
                    name, frappe.get_traceback()
                ),
            )
            continue

        if frappe.db.exists(
            "Attendance Flag Decision", {"flag_identity": identity, "superseded": 0}
        ) or frappe.db.exists(
            "Attendance Flag Decision",
            {"flag_identity": identity, "group_key": _MIGRATION_GROUP_KEY},
        ):
            skipped += 1
            continue

        try:
            # employee_branch is denormalised at write time (same reason the
            # doctype carries it at all: cause grouping in get_flag_queue
            # reads it without a join). A per-row lookup here is fine -- this
            # runs once, not on the read hot path the O(1) query budget binds.
            branch = frappe.db.get_value("Employee", row.get("employee"), "branch")

            # decided_by/decided_at are read_only in the Desk form
            # (attendance_flag_decision.json) but that only blocks the form
            # UI -- decide_flags() (flag_decision_api.py) sets these two
            # fields explicitly from frappe.session.user/now_datetime() for
            # every *new* decision, and this migration does the analogous
            # thing for a *historical* one: it uses the original reviewer's
            # identity and timestamp (hr_user/hr_decided_at) rather than
            # whoever happens to run `bench migrate`.
            doc = frappe.get_doc(
                {
                    "doctype": "Attendance Flag Decision",
                    "flag_identity": identity,
                    "employee": row.get("employee"),
                    "attendance_date": row.get("attendance_date"),
                    "flag_code": row.get("flag_code"),
                    "employee_branch": branch,
                    "outcome": outcome,
                    "reason": "OTHER",
                    "note": _note_for(row, status),
                    "evidence_fingerprint": evidence_fingerprint(row.get("evidence")),
                    "group_key": _MIGRATION_GROUP_KEY,
                    "decided_by": row.get("hr_user"),
                    "decided_at": row.get("hr_decided_at"),
                }
            )
            doc.insert(ignore_permissions=True)
        except Exception:
            # _note_for() means a blank hr_note no longer reaches this point
            # empty-handed, but the doctype's own required-note validation
            # (or any other insert()-time failure -- a bad Employee link, a
            # db-level error, etc.) can still land here. That is a real
            # problem with the Desk-era record or the write, not a bug in
            # this patch -- count it as failed and keep going.
            failed += 1
            frappe.log_error(
                title="migrate_legacy_flag_decisions: write failed",
                message="Attendance Flag {0} (identity {1}): could not write Attendance Flag "
                "Decision.\n{2}".format(name, identity, frappe.get_traceback()),
            )
            continue

        migrated += 1

    frappe.log_error(
        title="migrate_legacy_flag_decisions: summary",
        message="migrated={0} skipped={1} failed={2} total={3}".format(
            migrated, skipped, failed, len(rows)
        ),
    )
