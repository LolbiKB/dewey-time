import frappe
from frappe.model.document import Document
from frappe.utils import getdate


def _throw_if_reversed(*, scope, testing_start, go_live):
    if testing_start and go_live and getdate(testing_start) > getdate(go_live):
        frappe.throw(f"Testing start cannot be after go-live ({scope}).")


class DeweyTimeSettings(Document):
    def validate(self):
        self._validate_rollout_dates()

    def _validate_rollout_dates(self):
        """Reject the three ways a rollout config can be incoherent.

        A pilot that ends without starting is the interesting one: `testing_start`
        is the cutoff, so a `go_live` without it would end a period that never
        began and leave no cutoff at all. A branch that should skip the pilot sets
        the two dates equal instead.
        """
        if self.rollout_go_live and not self.rollout_testing_start:
            frappe.throw("Set a testing start date before setting a go-live date.")

        _throw_if_reversed(
            scope="global",
            testing_start=self.rollout_testing_start,
            go_live=self.rollout_go_live,
        )

        seen = set()
        for row in self.branch_rollout or []:
            if not row.branch:
                continue
            if row.branch in seen:
                frappe.throw(f"Branch {row.branch} appears twice in the rollout table.")
            seen.add(row.branch)
            _throw_if_reversed(
                scope=row.branch,
                testing_start=row.testing_start,
                go_live=row.go_live,
            )
