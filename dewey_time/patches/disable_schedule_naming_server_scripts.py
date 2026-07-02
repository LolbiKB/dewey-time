import frappe

from dewey_time.setup.shift_type_naming import ensure_schedule_naming


def execute():
    """Disable the DocType-Event Server Scripts that auto-name Shift Type / Shift
    Schedule and collapse every variant.

    reset_shift_type_naming_to_prompt (the previous patch) only cleared Property
    Setters and Document Naming Rules — the real prod override was a Server Script
    ("Shift Type - Auto name FT_*") doing ``doc.name = "FT_" + start + "_" + end``,
    which strips the lunch/grace suffix the resolver assigned so same-time variants
    can never coexist. This runs the broadened `ensure_schedule_naming`, which also
    disables those naming Server Scripts. Idempotent; the same reset runs on every
    migrate via `after_migrate`.
    """
    removed = ensure_schedule_naming()
    if any(removed.values()):
        frappe.logger().info(
            "disable_schedule_naming_server_scripts: "
            f"property_setters={removed['property_setters']} "
            f"document_naming_rules={removed['document_naming_rules']} "
            f"server_scripts={removed['server_scripts']}"
        )
