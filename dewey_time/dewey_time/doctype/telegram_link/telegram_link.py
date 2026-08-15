import frappe
from frappe.model.document import Document


class TelegramLink(Document):
    def validate(self):
        # Defence in depth behind the primary key. The docname already stops one
        # Telegram account binding to two employees; this stops the mirror case,
        # one employee bound to two Telegram accounts, which would make "which
        # chat do we notify" ambiguous and answer it arbitrarily.
        if not self.enabled:
            return

        existing = frappe.db.get_value(
            "Telegram Link",
            {
                "employee": self.employee,
                "enabled": 1,
                "name": ["!=", self.name or ""],
            },
            "name",
        )
        if existing:
            frappe.throw(
                f"{self.employee} is already linked to Telegram account {existing}. "
                "Disable that link first."
            )
