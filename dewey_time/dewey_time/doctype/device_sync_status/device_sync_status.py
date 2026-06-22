import frappe
from frappe.model.document import Document
from frappe.utils import getdate

from dewey_time.attendance_engine.device_sync import device_sync_doc_name


class DeviceSyncStatus(Document):
    def autoname(self):
        self.name = device_sync_doc_name(self.device_sn, self.local_date)

    def validate(self):
        if not self.device_sn or not self.local_date:
            return
        canonical = device_sync_doc_name(self.device_sn, self.local_date)
        if self.name != canonical and not self.is_new():
            return
        others = frappe.get_all(
            "Device Sync Status",
            filters={
                "device_sn": self.device_sn,
                "local_date": getdate(self.local_date),
                "name": ["!=", self.name or ""],
            },
            pluck="name",
        )
        if others:
            frappe.throw(
                f"Device Sync Status already exists for {self.device_sn} on {self.local_date}: {others[0]}"
            )
