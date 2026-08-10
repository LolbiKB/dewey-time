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

        # Redundant for engine writes -- closeout._insert_flag supplies severity,
        # company and every required field itself -- but it is the only guard a
        # Desk-side insert gets, and Desk is where an incomplete AUTO row would
        # come from.
        #
        # This block used to also assign a deterministic name. Deleted with the
        # custom:1 fix (T3-11): AUTO flags are hard-deleted and rebuilt on every
        # punch, so idempotency comes from that cycle, and stable identity comes
        # from flag_identity, which computes it from CONTENT precisely because
        # the name cannot be relied on. Two key schemes for one job is one too
        # many -- and the version that lived here carried an uncapped
        # _delivery_failed_key where flag_identity caps the same suffix at [:80].
        if (self.source or "").upper() == "AUTO":
            if not (self.employee and self.attendance_date and self.flag_code):
                frappe.throw("AUTO flags require employee, attendance_date, and flag_code")

            if not self.company:
                self.company = frappe.db.get_value("Employee", self.employee, "company")
