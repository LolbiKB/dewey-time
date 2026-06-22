import frappe
from frappe.model.document import Document

from dewey_time.webpush import subscription_name


class DeweyTimePushSubscription(Document):
    def autoname(self):
        if not self.endpoint:
            frappe.throw(frappe._("Endpoint is required"))
        # Deterministic name = one row per browser endpoint, so re-subscribing
        # the same browser updates in place instead of duplicating.
        self.name = subscription_name(self.endpoint)
