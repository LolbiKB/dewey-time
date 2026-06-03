import frappe
from frappe.model.document import Document
from frappe.utils import getdate


class DeviceSyncStatus(Document):
    def autoname(self):
        device_sn = frappe.scrub(self.device_sn or "device")
        local_date = str(getdate(self.local_date)) if self.local_date else "date"
        self.name = f"DSS-{device_sn}-{local_date}"[:140]
