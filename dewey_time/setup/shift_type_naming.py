"""Keep Shift Type on prompt naming so the schedule importer can mint variants.

The dewey_time schedule resolver names Shift Types itself
(`proposed_shift_type_name` → ``FT_<start>_<end>[_L<lunch>][_G<grace>]``) and relies
on the unique index over ``name`` to arbitrate variants: two shifts that share
start/end but differ on lunch or grace MUST be able to coexist as ``FT_x``,
``FT_x_2``, … For that to work the Shift Type doctype MUST use *prompt* naming, so
the name the resolver assigns is the name that actually gets stored.

Stock HRMS ships Shift Type as ``autoname='prompt'`` / ``naming_rule='Set by user'``.
But a live site can silently drift off prompt:

  * **Customize Form** → writes a Property Setter on ``autoname`` (and/or
    ``naming_rule`` / ``naming_series``).
  * **Document Naming Settings** → creates a ``Document Naming Rule`` for the doctype.

Either override makes Frappe *regenerate* the name and ignore the one the resolver
picked, so every same-time variant collapses onto a single record and the importer
fails with "Shift Type naming collapsed onto …". This module removes those overrides
and restores prompt naming. It is idempotent and safe to run on every migrate.
"""
from __future__ import annotations

import frappe

# Property Setter `property` values that change how a doctype is named. Removing
# these reverts Shift Type to its shipped naming (prompt / Set by user).
_NAMING_PROPERTIES = ("autoname", "naming_rule", "naming_series")

_ACCEPTABLE_AUTONAME = ("", "prompt")


def ensure_shift_type_prompt_naming() -> dict:
    """Strip naming overrides off Shift Type and restore prompt naming.

    Returns a summary of what was removed (for patch/after-migrate logging).
    """
    removed: dict = {"property_setters": [], "document_naming_rules": []}

    if not frappe.db.exists("DocType", "Shift Type"):
        return removed

    # 1. Customize-Form / manual naming Property Setters.
    for name in frappe.get_all(
        "Property Setter",
        filters={"doc_type": "Shift Type", "property": ["in", list(_NAMING_PROPERTIES)]},
        pluck="name",
    ):
        if _safe_delete("Property Setter", name):
            removed["property_setters"].append(name)

    # 2. Document Naming Rule records (from the Document Naming Settings UI).
    if frappe.db.exists("DocType", "Document Naming Rule"):
        try:
            rules = frappe.get_all(
                "Document Naming Rule", filters={"document_type": "Shift Type"}, pluck="name"
            )
        except Exception:
            rules = []
        for name in rules:
            if _safe_delete("Document Naming Rule", name):
                removed["document_naming_rules"].append(name)

    frappe.clear_cache(doctype="Shift Type")

    # 3. Verify. If naming is STILL forced, the cause is something this function
    #    deliberately does not touch — a Server Script (autoname/before_naming event)
    #    or a direct edit of the core DocType. Surface it loudly rather than silently
    #    leaving the importer broken.
    autoname = (frappe.get_meta("Shift Type").autoname or "").strip().lower()
    if autoname not in _ACCEPTABLE_AUTONAME:
        frappe.log_error(
            title="ensure_shift_type_prompt_naming",
            message=(
                f"Shift Type autoname is still {autoname!r} after removing naming "
                "Property Setters and Document Naming Rules. A Server Script "
                "(autoname/before_naming) or a direct core DocType edit is forcing it. "
                "The schedule importer cannot mint variant names (FT_x_2, …) until that "
                "override is removed."
            ),
        )

    return removed


def _safe_delete(doctype: str, name: str) -> bool:
    try:
        frappe.delete_doc(doctype, name, force=1, ignore_permissions=True, ignore_missing=True)
        return True
    except Exception:
        frappe.log_error(title="ensure_shift_type_prompt_naming", message=frappe.get_traceback())
        return False
