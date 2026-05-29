import frappe
from frappe.model.document import Document


FLAG_SEVERITY = {
    "UNNOTIFIED_ABSENCE": "CRITICAL",
    "MISSING_IN_OR_OUT": "CRITICAL",
    "UNKNOWN_DEVICE_BRANCH": "CRITICAL",
    "OFF_SHIFT_PUNCH": "WARNING",
    "NON_PRIMARY_SITE_PUNCH": "WARNING",
    "LATE_START": "WARNING",
    "NO_CHECKIN_YET": "WARNING",
    "MISSING_LUNCH": "INFO",
    "LATE_FROM_LUNCH": "WARNING",
    "DELIVERY_FAILED": "WARNING",
    "LATE_CHECKIN_AFTER_CLOSE": "INFO",
}


class AttendanceFlag(Document):
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

            key = "AUTO-{0}-{1}-{2}".format(
                frappe.scrub(self.employee),
                str(self.attendance_date),
                suffix,
            )
            # Frappe name length constraints vary by backend; keep it reasonable.
            self.name = key[:140]

            # Fill Company when possible (matches your DocType spec).
            if not self.company:
                self.company = frappe.db.get_value("Employee", self.employee, "company")

    def _delivery_failed_key(self):
        evidence = self.evidence
        if isinstance(evidence, str) and evidence:
            try:
                import json

                evidence = json.loads(evidence)
            except Exception:
                evidence = None
        if isinstance(evidence, dict):
            for key in ("pin", "user_id", "supabase_log_id", "custom_supabase_log_id"):
                value = evidence.get(key)
                if value:
                    return frappe.scrub(str(value))
        return None

