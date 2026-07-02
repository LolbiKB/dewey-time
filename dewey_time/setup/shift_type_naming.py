"""Keep the schedule doctypes on app-owned naming so the importer can mint variants.

The dewey_time schedule resolver names Shift Types and Shift Schedules itself
(`proposed_shift_type_name` → ``FT_<start>_<end>[_L<lunch>][_G<grace>]``,
`proposed_pat_name` → ``PAT_<days>_<shift_type>[_L<lunch>]``) and relies on prompt
naming plus the unique index over ``name`` to arbitrate variants: two shifts that
share start/end but differ on lunch or grace MUST be able to coexist as ``FT_x``,
``FT_x_2``, … For that the name the resolver assigns has to be the name that gets
stored.

Stock HRMS ships both doctypes with prompt naming. A live site can drift off it
three ways — and any of them regenerates the name and ignores ours, collapsing
every variant onto one record ("naming collapsed onto …"):

  * **Customize Form** → a Property Setter on ``autoname``/``naming_rule``.
  * **Document Naming Settings** → a ``Document Naming Rule`` for the doctype.
  * **A DocType-Event Server Script** that reassigns ``doc.name`` — this was the
    actual prod culprit: a "Shift Type - Auto name FT_*" script doing
    ``doc.name = "FT_" + start + "_" + end`` (start/end only, so it stripped the
    lunch/grace suffix the resolver had chosen), plus a sibling PAT script.

This removes the Property Setters / Document Naming Rules and DISABLES the naming
Server Scripts, restoring app-owned naming. Idempotent; safe to run every migrate.
"""
from __future__ import annotations

import re

import frappe

# Property Setter `property` values that change how a doctype is named.
_NAMING_PROPERTIES = ("autoname", "naming_rule", "naming_series")
# Doctypes whose names the resolver owns.
_SCHEDULE_DOCTYPES = ("Shift Type", "Shift Schedule")
_ACCEPTABLE_AUTONAME = ("", "prompt")
# A DocType-Event Server Script that *assigns* doc.name (not just reads/compares it).
_NAME_ASSIGN_RE = re.compile(r"doc\.name\s*=(?!=)")


def ensure_schedule_naming() -> dict:
    """Strip every naming override off the schedule doctypes and restore app naming.

    Returns a summary of what was removed/disabled (for patch/after-migrate logging).
    """
    removed: dict = {
        "property_setters": [],
        "document_naming_rules": [],
        "server_scripts": [],
    }

    for doctype in _SCHEDULE_DOCTYPES:
        if not frappe.db.exists("DocType", doctype):
            continue
        _remove_naming_property_setters(doctype, removed)
        _remove_document_naming_rules(doctype, removed)

    _disable_naming_server_scripts(removed)

    frappe.clear_cache()

    _warn_if_naming_still_forced(removed)

    return removed


# Backward-compatible alias — the already-shipped reset_shift_type_naming_to_prompt
# patch imports this name. Fresh installs run that patch, so it must keep resolving.
def ensure_shift_type_prompt_naming() -> dict:
    return ensure_schedule_naming()


def _remove_naming_property_setters(doctype: str, removed: dict) -> None:
    for name in frappe.get_all(
        "Property Setter",
        filters={"doc_type": doctype, "property": ["in", list(_NAMING_PROPERTIES)]},
        pluck="name",
    ):
        if _safe_delete("Property Setter", name):
            removed["property_setters"].append(name)


def _remove_document_naming_rules(doctype: str, removed: dict) -> None:
    if not frappe.db.exists("DocType", "Document Naming Rule"):
        return
    try:
        rules = frappe.get_all(
            "Document Naming Rule", filters={"document_type": doctype}, pluck="name"
        )
    except Exception:
        rules = []
    for name in rules:
        if _safe_delete("Document Naming Rule", name):
            removed["document_naming_rules"].append(name)


def _disable_naming_server_scripts(removed: dict) -> None:
    """Disable DocType-Event Server Scripts on the schedule doctypes that reassign
    doc.name. Disable (not delete) so the record survives for audit and the change
    is reversible — but the app requires prompt naming, so it stays disabled."""
    if not frappe.db.exists("DocType", "Server Script"):
        return
    try:
        scripts = frappe.get_all(
            "Server Script",
            filters={
                "reference_doctype": ["in", list(_SCHEDULE_DOCTYPES)],
                "script_type": "DocType Event",
            },
            fields=["name", "script", "disabled"],
        )
    except Exception:
        return

    disabled_any = False
    for row in scripts:
        if row.get("disabled"):
            continue
        if not _NAME_ASSIGN_RE.search(row.get("script") or ""):
            continue
        try:
            frappe.db.set_value("Server Script", row["name"], "disabled", 1)
            removed["server_scripts"].append(row["name"])
            disabled_any = True
        except Exception:
            frappe.log_error(title="ensure_schedule_naming", message=frappe.get_traceback())

    if disabled_any:
        # Server scripts are cached compiled; drop the map so the disable takes effect.
        try:
            frappe.cache().delete_value("server_script_map")
        except Exception:
            pass


def _warn_if_naming_still_forced(removed: dict) -> None:
    for doctype in _SCHEDULE_DOCTYPES:
        if not frappe.db.exists("DocType", doctype):
            continue
        autoname = (frappe.get_meta(doctype).autoname or "").strip().lower()
        if autoname not in _ACCEPTABLE_AUTONAME:
            frappe.log_error(
                title="ensure_schedule_naming",
                message=(
                    f"{doctype} autoname is still {autoname!r} after removing naming "
                    "Property Setters, Document Naming Rules and Server Scripts. Another "
                    "override (a custom app's autoname hook, or a direct core DocType "
                    "edit) is forcing it — the schedule importer cannot mint variant "
                    "names until that is removed."
                ),
            )


def _safe_delete(doctype: str, name: str) -> bool:
    try:
        frappe.delete_doc(doctype, name, force=1, ignore_permissions=True, ignore_missing=True)
        return True
    except Exception:
        frappe.log_error(title="ensure_schedule_naming", message=frappe.get_traceback())
        return False
