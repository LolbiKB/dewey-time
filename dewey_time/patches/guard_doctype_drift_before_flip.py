import frappe

from dewey_time.utils.doctype_drift_audit import audit_schema_drift


def execute():
    """Abort this migrate if flipping the seven to standard would lose a field.

    Runs as a pre_model_sync patch, so it executes BEFORE
    frappe.model.sync.sync_all() reimports the DocType JSONs.
    Migrate.run_schema_updates is @atomic, so throwing here rolls back and
    leaves the schema exactly as it was.

    The failure this exists to prevent: making a DocType standard makes the
    app's JSON authoritative, so a field added to one of these in Desk on
    production is de-registered by the reimport. The column survives in
    MariaDB; Frappe stops knowing about it, and every read of that data
    silently returns nothing.

    Custom Fields are exempt, and audit_schema_drift already excludes them --
    they live in their own table and are the supported way to extend a
    standard DocType.

    Idempotent and self-retiring: once the flip has happened with no drift,
    every later run finds nothing and returns.
    """
    blocked = {
        entry["doctype"]: entry["would_be_deregistered"]
        for entry in audit_schema_drift()
        # .get(), not [...]: a DocType absent from the site (a first migrate on
        # a fresh bench) yields a status entry with no such key.
        if entry.get("would_be_deregistered")
    }
    if not blocked:
        return

    detail = "; ".join(
        f"{doctype}: {', '.join(fields)}" for doctype, fields in sorted(blocked.items())
    )
    frappe.throw(
        "Migrate aborted: making these DocTypes standard would de-register fields "
        f"that exist in this site's database but not in the app's JSON -- {detail}. "
        "The data stays in MariaDB but becomes invisible to Frappe. Add the fields "
        "to the app JSON, or convert them to Custom Fields, then migrate again. "
        "Full report: bench --site <site> execute "
        "dewey_time.utils.doctype_drift_audit.run"
    )
