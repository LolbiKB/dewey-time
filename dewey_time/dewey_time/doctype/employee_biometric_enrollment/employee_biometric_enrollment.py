from frappe.model.document import Document


class EmployeeBiometricEnrollment(Document):
    """One row per employee, named by employee id.

    Deliberately has no controller hooks. The register is written only by the
    bridge snapshot ingest, which owns all of its validation; a hook here would
    fire once per row on a 237-row snapshot for no benefit.
    """

    pass
