import frappe

from dewey_time.setup.shift_type_naming import ensure_shift_type_prompt_naming


def execute():
    """Restore Shift Type to prompt naming on sites that drifted off it.

    A naming override on Shift Type (a Customize-Form Property Setter on
    ``autoname``/``naming_rule``, or a Document Naming Rule) makes Frappe
    regenerate the name and ignore the one the schedule resolver assigns. Every
    same-time Shift Type variant then collapses onto one record and the schedule
    importer fails with "Shift Type naming collapsed onto …" — which is exactly
    what the prod import hit while stock/sandbox benches (real prompt naming)
    could not reproduce.

    This removes those overrides so the resolver can once again mint variant
    names (FT_x, FT_x_2, …). Idempotent — the same reset also runs on every
    migrate via `after_migrate` so the naming can't quietly drift back.
    """
    removed = ensure_shift_type_prompt_naming()
    if removed["property_setters"] or removed["document_naming_rules"]:
        frappe.logger().info(
            "reset_shift_type_naming_to_prompt: removed "
            f"property_setters={removed['property_setters']} "
            f"document_naming_rules={removed['document_naming_rules']}"
        )
