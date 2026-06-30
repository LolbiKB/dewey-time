# Schedule-edit guardrails + change audit — design

**Date:** 2026-06-30
**Status:** Approved (build)
**Suggested branch:** `feat/schedule-edit-guardrails-audit`
**Builds on:** the merged "decisive schedule edit" feature (PR #38).

## Problem

Editing a set schedule is now easy and non-destructive — which makes an *accidental* edit easy too. There's no strong "you're about to change an existing schedule" signal, and the confirm step is a single click. Separately, once an edit is applied the change leaves no digestible record: the raw history survives (trimmed `end_date`s, `Inactive` rows, the SSA back-link) but there is no "who changed whose schedule, when, from what to what" trail.

## Goal

Two layers on top of the existing edit flow:
1. **Guardrails** — make it obvious an edit changes an *existing* schedule, and require a typed confirmation (the employee's name) before applying a change that **retires existing future shifts**.
2. **Audit capture** — record each confirmed schedule change as a `Schedule Change Log` row, built from the reconcile output already computed. Capture only; the in-app browsing UI is a deliberate later increment.

## Non-goals (YAGNI)

- In-app change-history browser (per-employee list / Coverage drawer). Captured now, viewed later. The new DocType is Desk-listable, which covers viewing for now.
- Rollback / restore a previous schedule.
- Visual before→after diffing, multi-version compare.
- Server-side enforcement of the typed phrase. The typed gate is a **client-side misclick guard** layered on the existing `needs_confirm` round-trip; the backend contract is unchanged.

## Decisions (from brainstorming)

- Typed confirmation is required **only when the edit retires existing future shifts** (reconcile has `disable_ssas` or `affected_assignments`). Purely-additive edits and fresh creates do not require typing.
- The phrase to type is the **employee's name**, matched case-insensitively and trimmed.

---

## Part A — Guardrails (frontend only)

### A1. Pure logic — extend `src/lib/scheduleEdit.ts`

```ts
export function reconcileRetiresShifts(reconcile: ReconcilePreview | null | undefined): boolean {
  return Boolean(
    (reconcile?.disable_ssas?.length ?? 0) > 0 ||
    (reconcile?.affected_assignments?.length ?? 0) > 0
  );
}

export function confirmNameMatches(typed: string, employeeName: string | null | undefined): boolean {
  const a = (typed ?? "").trim().toLowerCase();
  const b = (employeeName ?? "").trim().toLowerCase();
  return a.length > 0 && a === b;
}
```

Both pure, under the `test:web` glob.

### A2. "You're editing" signal — `WeeklySchedulePage.tsx`

- When `isEditing` (`enabled_ssa_count > 0`), render an **amber banner** in the header:
  *"Editing **{employeeLabel}**'s schedule — changes take effect {effectiveFrom}. Existing future shifts will be replaced."* (`brand-accent`/amber styling, like the existing preview/ineligible cards.)
- The Save button already reads **"Review changes"** for edits (kept).

### A3. Typed-confirm gate — the confirm dialog in `WeeklySchedulePage.tsx`

- **Retitle** the confirm dialog when editing: *"Change {employeeLabel}'s schedule?"* (vs the current "Create shared shift records?"). The existing "What changes on {E}" reconcile section stays, shown first.
- Add `confirmText` state; **reset to `""`** when the dialog opens (in the `needs_confirm` branch of `handleSave`) and on close.
- Compute `requiresTyped = reconcileRetiresShifts(pendingReconcile)` and
  `typedOk = !requiresTyped || confirmNameMatches(confirmText, employeeLabel)`.
- When `requiresTyped`, render a typed-confirm block mirroring `ClearAllSchedulesDialog` (`Label` + `Input`, destructive border + "Name doesn't match" when non-empty and not matching):
  *"Type **{employeeLabel}** to confirm this change."*
- The confirm button label becomes **"Save changes"** when editing (else "Create and save"); it is `disabled` when `applying || !typedOk`.
- Purely-additive edits (`requiresTyped === false`) and fresh creates keep one-click confirm.

### A4. Tests (Part A)

- `src/lib/scheduleEdit.test.ts`: `reconcileRetiresShifts` (true on disable_ssas; true on affected_assignments; false on add-only / empty / null), `confirmNameMatches` (exact, case-insensitive, trimmed, empty→false, mismatch→false).
- Playwright `e2e/schedule-edit.spec.ts` (extend): assert the amber "Editing … schedule" banner renders; in the confirm dialog (the existing fixture's reconcile retires shifts) the save button is **disabled** initially, **stays disabled** after typing a wrong name, and **enables** after typing the employee's name (`Jane Doe`), then save proceeds.

---

## Part B — Audit capture (backend)

### B1. DocType `Schedule Change Log`

`dewey_time/dewey_time/doctype/schedule_change_log/` — `schedule_change_log.json` + `__init__.py` + `schedule_change_log.py` (empty `Document` subclass). Module **Dewey Time**. Not submittable; `track_changes: 0`; `autoname: "hash"`.

Fields:
| fieldname | type | notes |
|---|---|---|
| `employee` | Link → Employee | reqd, in_list_view |
| `employee_name` | Data | fetch_from `employee.employee_name`, read_only, in_list_view |
| `changed_by` | Link → User | read_only, in_list_view |
| `change_datetime` | Datetime | read_only, in_list_view |
| `effective_from` | Date | in_list_view |
| `summary` | Small Text | in_list_view |
| `inactivated_count` | Int | |
| `trimmed_count` | Int | |
| `detail` | Code (JSON) | leaving/adding labels + created records |

Permissions: read/report for `HR User`, `HR Manager`, `System Manager` (rows are written with `ignore_permissions`). Desk-listable → free interim viewing.

### B2. `attendance_engine/schedule_change_log.py`

```python
from __future__ import annotations
import json
import frappe
from frappe.utils import now_datetime


def _summarize(leaving, adding):
    parts = []
    if leaving:
        parts.append("Retired " + " · ".join(leaving))
    if adding:
        parts.append("Added " + " · ".join(adding))
    return "; ".join(parts) if parts else "Schedule updated"


def record_schedule_change(*, employee, effective_from, reconcile, created, ssas):
    """Best-effort audit row for a confirmed apply. NEVER raises — an audit-write
    failure must not break the schedule change itself."""
    try:
        if not frappe.db.table_exists("Schedule Change Log"):
            return None
        reconcile = reconcile or {}
        leaving = list(reconcile.get("leaving_labels") or [])
        adding = list(reconcile.get("add_labels") or [])
        affected = reconcile.get("affected_assignments") or []
        inactivated = sum(1 for a in affected if a.get("action") == "inactivate")
        trimmed = sum(1 for a in affected if a.get("action") == "end_before")
        created = created or {}
        created_types = list(created.get("shift_types") or [])
        created_scheds = list(created.get("shift_schedules") or [])
        if not (leaving or adding or affected or created_types or created_scheds or ssas):
            return None  # nothing changed
        doc = frappe.new_doc("Schedule Change Log")
        doc.employee = employee
        doc.changed_by = getattr(frappe.session, "user", None) or "Administrator"
        doc.change_datetime = now_datetime()
        doc.effective_from = effective_from
        doc.summary = _summarize(leaving, adding)
        doc.inactivated_count = inactivated
        doc.trimmed_count = trimmed
        doc.detail = json.dumps(
            {
                "leaving": leaving,
                "adding": adding,
                "created_shift_types": created_types,
                "created_shift_schedules": created_scheds,
            },
            separators=(",", ":"),
        )
        doc.insert(ignore_permissions=True)
        return doc.name
    except Exception:
        frappe.log_error(title="schedule change log: write failed")
        return None
```

`_summarize` is pure and unit-testable without frappe.

### B3. Wire into `apply_weekly_schedule`

Inside the existing `try`, after the group loop and **before** `frappe.db.commit()` (atomic with the change):

```python
        record_schedule_change(
            employee=employee,
            effective_from=effective,
            reconcile=reconcile,
            created={"shift_types": created_shift_types, "shift_schedules": created_shift_schedules},
            ssas=ssas_out,
        )
        frappe.db.commit()
```

Import `record_schedule_change` from `attendance_engine.schedule_change_log`. Logs fresh creates too (the first "set" is the first change); skips no-ops via the helper's guard.

### B4. Tests (Part B) — and the bench-isolation lesson

- `dewey_time/tests/test_schedule_change_log.py`:
  - `_summarize`: leaving-only, adding-only, both, neither→"Schedule updated".
  - `record_schedule_change`: returns `None` and inserts nothing on a pure no-op (empty reconcile/created/ssas); on a real change, constructs a doc with the right `employee`/`effective_from`/`summary`/counts and calls `insert` (mock `frappe.new_doc`); never raises when `insert` throws (returns `None`, logs).
- **`test_apply_weekly_schedule.py`**: add `patch.object(schedule_api, "record_schedule_change")` to the `_apply` helper's patch stack, so the apply tests stay isolated from the audit write (the same isolation discipline that fixed the last CI `tests` failure). The helper is defensive, so unpatched existing `TestScheduleApi` tests remain bench-safe regardless.

---

## Data flow / contract

No API contract change. `apply_weekly_schedule` still returns `{needs_confirm, plan, reconcile}` / `{ok, …, reconciled, …}`. The audit row is a side effect of a confirmed apply. The typed gate is entirely client-side.

## Risks / edge cases

- **Audit write must never break the edit** — `record_schedule_change` is wrapped in try/except + `log_error`; called before commit so a success is atomic, a failure is swallowed.
- **Bench vs mock** — anything new in `apply` runs under real `bench run-tests`. The helper is defensive (no-throw) and is additionally patched in the apply unit tests. A JSON-validity check on the DocType is part of its task.
- **Typed-name source** — match against `employeeLabel` (the name shown in the banner/header), so what HR types matches what they see. Case-insensitive + trimmed avoids trivial-casing friction.
- **Name with no match data** — if `employeeLabel` is empty/unknown, `confirmNameMatches` returns false → the gate would block. In practice the wizard always has a resolved label before the confirm dialog opens; acceptable.
- **New DocType deploy** — `bench migrate` creates `Schedule Change Log`; no patch, no hook.

## Deploy

`npm run build` (Part A bundle) then `bench migrate` (creates the DocType, picks up the updated `apply_weekly_schedule` + new module). No patch, no new hook, no new scheduler.
