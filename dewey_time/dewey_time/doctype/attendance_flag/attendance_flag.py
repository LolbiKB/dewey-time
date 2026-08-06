import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


FLAG_SEVERITY = {
    "UNNOTIFIED_ABSENCE": "CRITICAL",
    "MISSING_TIME": "CRITICAL",
    "ATTENDANCE_ISSUE": "CRITICAL",
    "MISSING_IN_OR_OUT": "CRITICAL",
    "UNKNOWN_DEVICE_BRANCH": "CRITICAL",
    "OFF_SHIFT_PUNCH": "WARNING",
    "NON_PRIMARY_SITE_PUNCH": "INFO",
    "LATE_START": "WARNING",
    "NO_CHECKIN_YET": "WARNING",
    "MISSING_LUNCH": "INFO",
    "LATE_FROM_LUNCH": "WARNING",
    "LEFT_EARLY": "WARNING",
    "DELIVERY_FAILED": "WARNING",
}


class AttendanceFlag(Document):
    def before_save(self):
        if self.has_value_changed("status"):
            self.status_changed_by = frappe.session.user
            self.status_changed_at = now_datetime()

    def before_insert(self):
        if not self.severity and self.flag_code:
            self.severity = FLAG_SEVERITY.get(self.flag_code, "WARNING")

        # For AUTO flags we use a deterministic name so reruns are idempotent.
        # Other sources (HR/EMPLOYEE) can use Frappe's default naming.
        if (self.source or "").upper() == "AUTO":
            if not (self.employee and self.attendance_date and self.flag_code):
                frappe.throw("AUTO flags require employee, attendance_date, and flag_code")

            suffix = frappe.scrub(self.flag_code)
            if self.flag_code == "DELIVERY_FAILED":
                delivery_key = self._delivery_failed_key()
                if delivery_key:
                    suffix = f"delivery-failed-{delivery_key}"
            elif self.flag_code == "MISSING_TIME":
                interval_key = self._missing_time_key()
                if interval_key:
                    suffix = f"missing-time-{interval_key}"
            elif self.flag_code == "ATTENDANCE_ISSUE":
                issue_key = self._attendance_issue_key()
                if issue_key:
                    suffix = f"attendance-issue-{issue_key}"

            # day_closed is part of the identity. Without it a provisional
            # (day_closed=0) and a final (day_closed=1) row for the same
            # employee/date/code share a name: intraday deletes only its own
            # provisional rows, so refreshing a past date that closeout had
            # already finalized collided with the existing final instead of
            # writing a flag.
            #
            # Only provisionals take the marker, so finalized names are
            # byte-identical to what already exists in the database and no
            # historical row is orphaned by this change.
            state = "" if int(self.day_closed or 0) else "-prov"
            key = "AUTO-{0}-{1}-{2}{3}".format(
                frappe.scrub(self.employee),
                str(self.attendance_date),
                suffix,
                state,
            )
            # Frappe name length constraints vary by backend; keep it reasonable.
            self.name = key[:140]

            # Fill Company when possible (matches your DocType spec).
            if not self.company:
                self.company = frappe.db.get_value("Employee", self.employee, "company")

    def _parsed_evidence(self):
        evidence = self.evidence
        if isinstance(evidence, str) and evidence:
            try:
                import json

                return json.loads(evidence)
            except Exception:
                return None
        if isinstance(evidence, dict):
            return evidence
        return None

    def _delivery_failed_key(self):
        evidence = self._parsed_evidence()
        if isinstance(evidence, dict):
            undelivered = evidence.get("undelivered")
            if isinstance(undelivered, dict):
                for key in ("pin", "user_id", "supabase_log_id", "custom_supabase_log_id"):
                    value = undelivered.get(key)
                    if value:
                        return frappe.scrub(str(value))
            for key in ("pin", "user_id", "supabase_log_id", "custom_supabase_log_id"):
                value = evidence.get(key)
                if value:
                    return frappe.scrub(str(value))
        return None

    def _missing_time_key(self):
        evidence = self._parsed_evidence()
        if isinstance(evidence, dict):
            start = evidence.get("interval_start")
            if start:
                return frappe.scrub(str(start))[:80]
        return None

    def _attendance_issue_key(self):
        evidence = self._parsed_evidence()
        if isinstance(evidence, dict):
            reason = evidence.get("reason") or "issue"
            # `delivery_failed` writes no punch_time (record_issue_flags.py:72-81
            # carries only reason + undelivered), so before this fallback every
            # undelivered item in one closeout produced the SAME docname and the
            # second insert raised DuplicateEntryError. closeout.py's flag loop
            # has no per-flag isolation, so that raise aborted every remaining
            # flag for the employee-day. Falling back to the item's own
            # identifier keeps the names distinct.
            #
            # `punch or delivery_key` in that order: a reason that does carry
            # punch_time is unaffected, so no existing flag is renamed except
            # the delivery-failure ones this fixes.
            punch = evidence.get("punch_time") or self._delivery_failed_key() or ""
            return frappe.scrub(f"{reason}-{punch}")[:80]
        return None

