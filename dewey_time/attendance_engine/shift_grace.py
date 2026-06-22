from __future__ import annotations


def _int_grace(value) -> int:
    if value is None:
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def grace_fields_from_shift_doc(doc) -> dict:
    """Read custom + HRMS grace columns from a Shift Type document."""
    import frappe

    custom = _int_grace(getattr(doc, "custom_grace_minutes", None))
    late_entry = 0
    early_exit = 0
    if frappe.db.has_column("Shift Type", "late_entry_grace_period"):
        late_entry = _int_grace(getattr(doc, "late_entry_grace_period", None))
    if frappe.db.has_column("Shift Type", "early_exit_grace_period"):
        early_exit = _int_grace(getattr(doc, "early_exit_grace_period", None))
    return {
        "custom_grace_minutes": custom,
        "late_entry_grace_period": late_entry,
        "early_exit_grace_period": early_exit,
    }


def enrich_shift_meta(meta: dict) -> dict:
    """Add normalized grace sources and effective values to shift_meta."""
    custom = _int_grace(meta.get("custom_grace_minutes"))
    late_entry = _int_grace(meta.get("late_entry_grace_period"))
    early_exit = _int_grace(meta.get("early_exit_grace_period"))
    start = max(custom, late_entry)
    end = max(custom, early_exit)
    out = dict(meta)
    out.update(
        {
            "custom_grace_minutes": custom,
            "late_entry_grace_period": late_entry,
            "early_exit_grace_period": early_exit,
            "effective_start_grace_minutes": start,
            "effective_end_grace_minutes": end,
            "effective_lunch_return_grace_minutes": start,
        }
    )
    return out


def effective_start_grace(meta: dict | None) -> int:
    if not meta:
        return 0
    cached = meta.get("effective_start_grace_minutes")
    if cached is not None:
        return _int_grace(cached)
    return max(
        _int_grace(meta.get("custom_grace_minutes")),
        _int_grace(meta.get("late_entry_grace_period")),
    )


def effective_end_grace(meta: dict | None) -> int:
    if not meta:
        return 0
    cached = meta.get("effective_end_grace_minutes")
    if cached is not None:
        return _int_grace(cached)
    return max(
        _int_grace(meta.get("custom_grace_minutes")),
        _int_grace(meta.get("early_exit_grace_period")),
    )


def effective_lunch_return_grace(meta: dict | None) -> int:
    return effective_start_grace(meta)


def grace_evidence(meta: dict | None, *, for_end: bool = False) -> dict:
    """JSON evidence fields for schedule lateness flags."""
    if not meta:
        return {"grace_minutes": 0}
    start = effective_start_grace(meta)
    end = effective_end_grace(meta)
    effective = end if for_end else start
    return {
        "custom_grace_minutes": _int_grace(meta.get("custom_grace_minutes")),
        "late_entry_grace_period": _int_grace(meta.get("late_entry_grace_period")),
        "early_exit_grace_period": _int_grace(meta.get("early_exit_grace_period")),
        "grace_minutes": effective,
        "effective_start_grace_minutes": start,
        "effective_end_grace_minutes": end,
        "effective_lunch_return_grace_minutes": effective_lunch_return_grace(meta),
    }
