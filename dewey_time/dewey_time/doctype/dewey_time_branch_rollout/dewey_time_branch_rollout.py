from frappe.model.document import Document


class DeweyTimeBranchRollout(Document):
    """Empty by design. Cross-row rules (duplicates, ordering) need the whole table
    at once, so they live on the parent's validate()."""

    pass
