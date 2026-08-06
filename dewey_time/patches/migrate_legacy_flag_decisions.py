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
    cycle had not yet reached, plus any HR/EMPLOYEE-sourced rows the engine
    never touches at all.

    A low migrated count on a given site is therefore not evidence this patch
    is broken -- it is evidence of how much the deletion cycle had already
    destroyed before the patch got a chance to run. Do not read the tally
    below as a completeness signal; read it as a snapshot of what survived.

    Idempotent: an identity that already has a live (superseded=0) decision
    -- from a prior run of this same patch, or from a fresh decision made
    through decide_flags() in the meantime -- is skipped, so re-running never
    creates a duplicate.
    """
    rows = frappe.get_all(
        "Attendance Flag",
        filters={"status": ["!=", "OPEN"]},
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

        if frappe.db.exists("Attendance Flag Decision", {"flag_identity": identity, "superseded": 0}):
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
                    "note": row.get("hr_note"),
                    "evidence_fingerprint": evidence_fingerprint(row.get("evidence")),
                    "decided_by": row.get("hr_user"),
                    "decided_at": row.get("hr_decided_at"),
                }
            )
            doc.insert(ignore_permissions=True)
        except Exception:
            # Covers, among other things, the doctype's own required-note
            # validation (note is required when reason=OTHER, and this patch
            # always sets reason=OTHER) rejecting a legacy row that was
            # approved/rejected in Desk without an hr_note. That is a real
            # or missing detail from the Desk-era record, not a bug in this
            # patch -- count it as failed and keep going.
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
