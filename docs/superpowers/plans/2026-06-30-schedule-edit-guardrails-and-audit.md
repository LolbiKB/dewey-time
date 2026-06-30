# Schedule-Edit Guardrails + Change Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clear "you're editing an existing schedule" signal + a typed-confirmation (employee name) gate before applying a change that retires future shifts, and capture each confirmed change as a `Schedule Change Log` row.

**Architecture:** Frontend guardrails are pure-logic + wizard wiring (no API change — a client-side misclick guard on the existing `needs_confirm` round-trip). Backend audit is a new lean DocType plus a defensive `record_schedule_change` helper called from `apply_weekly_schedule`.

**Tech Stack:** React 19 + TS + Vite + Tailwind + shadcn/ui, Playwright; Frappe (Python, `unittest`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-30-schedule-edit-guardrails-and-audit-design.md` — read it first.
- Typed gate is required **only when the edit retires existing future shifts** (`reconcile.disable_ssas` or `reconcile.affected_assignments` non-empty). Purely-additive edits and fresh creates do NOT require typing.
- Typed phrase = the **employee's name**, matched **trimmed + case-insensitive**.
- The typed gate is **client-side only**; no API/contract change.
- `record_schedule_change` MUST be **defensive** (try/except + `frappe.log_error`) — an audit-write failure must never break the schedule apply. It is also **patched** in the apply unit tests so they stay isolated under real `bench run-tests` (the lesson from PR #38's CI catch: anything new in `apply` runs under real frappe in CI).
- Python tests run from repo root: `python3 -m unittest dewey_time.tests.<module>`. `_install_frappe_mock()` (from `dewey_time.tests.test_closeout`) provides the frappe mock + working `frappe.utils`.
- Frontend tests: `npm run test:web` (node:test). All npm/playwright commands run from `dewey_time/frontend/hr_attendance/`. Pure logic lives under `src/lib/`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Stage explicitly by path; never `git add -A`. Branch: `feat/schedule-edit-guardrails-audit` (off `main`). Untracked stray PNGs (`di-*.png`, `mine-final*.png`, `home-di-shot*.png`, `render-*.png`) are NOT ours — never stage them.
- Deploy is user-side: `npm run build` then `bench migrate` (creates the DocType).

---

### Task 1: Frontend guard logic

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.test.ts`

**Interfaces:**
- Produces: `reconcileRetiresShifts(reconcile: ReconcilePreview | null | undefined): boolean`; `confirmNameMatches(typed: string, employeeName: string | null | undefined): boolean`. Both consumed by Task 2.

- [ ] **Step 1: Write the failing test** — append to `scheduleEdit.test.ts`:

```ts
import { reconcileRetiresShifts, confirmNameMatches } from "@/lib/scheduleEdit";

test("reconcileRetiresShifts: true when SSAs are disabled", () => {
  assert.equal(reconcileRetiresShifts({ ...EMPTY, disable_ssas: [{ name: "S", shift_schedule: "P" }] }), true);
});
test("reconcileRetiresShifts: true when assignments are affected", () => {
  assert.equal(
    reconcileRetiresShifts({ ...EMPTY, affected_assignments: [{ name: "A", start_date: "2026-07-05", action: "inactivate" }] }),
    true,
  );
});
test("reconcileRetiresShifts: false for add-only / empty / null", () => {
  assert.equal(reconcileRetiresShifts({ ...EMPTY, add_identities: ["k"], add_labels: ["X"] }), false);
  assert.equal(reconcileRetiresShifts(EMPTY), false);
  assert.equal(reconcileRetiresShifts(null), false);
});
test("confirmNameMatches: exact, case-insensitive, trimmed", () => {
  assert.equal(confirmNameMatches("Jane Doe", "Jane Doe"), true);
  assert.equal(confirmNameMatches("  jane doe ", "Jane Doe"), true);
  assert.equal(confirmNameMatches("JANE DOE", "Jane Doe"), true);
});
test("confirmNameMatches: empty and mismatch are false", () => {
  assert.equal(confirmNameMatches("", "Jane Doe"), false);
  assert.equal(confirmNameMatches("Jane", "Jane Doe"), false);
  assert.equal(confirmNameMatches("Jane Doe", null), false);
});
```

> `EMPTY` is the existing const in `scheduleEdit.test.ts` (a full `ReconcilePreview` with all arrays empty). The file already imports `node:test`/`assert` and the `ReconcilePreview` type.

- [ ] **Step 2: Run test to verify it fails**

Run (from `dewey_time/frontend/hr_attendance/`): `npm run test:web`
Expected: FAIL — `reconcileRetiresShifts`/`confirmNameMatches` not exported.

- [ ] **Step 3: Write minimal implementation** — append to `src/lib/scheduleEdit.ts`:

```ts
export function reconcileRetiresShifts(
  reconcile: ReconcilePreview | null | undefined,
): boolean {
  return Boolean(
    (reconcile?.disable_ssas?.length ?? 0) > 0 ||
      (reconcile?.affected_assignments?.length ?? 0) > 0,
  );
}

export function confirmNameMatches(
  typed: string,
  employeeName: string | null | undefined,
): boolean {
  const a = (typed ?? "").trim().toLowerCase();
  const b = (employeeName ?? "").trim().toLowerCase();
  return a.length > 0 && a === b;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.ts dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.test.ts
git commit -m "feat(schedule): guard logic — retires-shifts + name-match helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wizard guardrails (banner + typed-confirm gate) + e2e

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeeklySchedulePage.tsx`
- Modify: `dewey_time/frontend/hr_attendance/e2e/schedule-edit.spec.ts`

**Interfaces:**
- Consumes: `reconcileRetiresShifts`, `confirmNameMatches` (Task 1).

- [ ] **Step 1: Write the failing test** — replace the body of `e2e/schedule-edit.spec.ts` with:

```ts
import { test, expect } from "@playwright/test";

import { stubFrappe } from "./fixtures";

test.describe("schedule edit", () => {
  test("editing shows the banner and reconcile review", async ({ page }) => {
    await stubFrappe(page);
    await page.goto("/hr-schedule?employee=EMP-001");

    await expect(page.getByText(/Editing Jane Doe.s schedule/)).toBeVisible();

    const save = page.getByRole("button", { name: /Review changes|Save schedule/ });
    await expect(save).toBeVisible();
    await save.click();

    await expect(page.getByText(/Retiring MON-FRI 09–17/)).toBeVisible();
    await expect(page.getByText(/Adding MON-SAT 09–17 from 2026-07-01/)).toBeVisible();
    await expect(page.getByText(/1 future shift inactivated/)).toBeVisible();
    await expect(page.getByText(/1 shift trimmed to end 2026-06-30/)).toBeVisible();
  });

  test("typed name gates the save when shifts are retired", async ({ page }) => {
    await stubFrappe(page);
    await page.goto("/hr-schedule?employee=EMP-001");
    await page.getByRole("button", { name: /Review changes|Save schedule/ }).click();

    const confirm = page.getByRole("button", { name: "Save changes" });
    await expect(confirm).toBeDisabled();

    const input = page.locator("#schedule-change-confirm");
    await input.fill("wrong name");
    await expect(confirm).toBeDisabled();

    await input.fill("Jane Doe");
    await expect(confirm).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test schedule-edit --project=desktop`
Expected: FAIL — no banner; the dialog button reads "Create and save" (not "Save changes") and has no typed gate / `#schedule-change-confirm` input.

- [ ] **Step 3: Write minimal implementation** — apply these edits to `WeeklySchedulePage.tsx`:

(a) Extend the scheduleEdit import (line 53 `import { summarizeReconcile } from "@/lib/scheduleEdit";`):

```ts
import { summarizeReconcile, reconcileRetiresShifts, confirmNameMatches } from "@/lib/scheduleEdit";
```

(b) Add the `Input` import (after the `Label` import near line 23):

```ts
import { Input } from "@/components/ui/input";
```

(c) Add `confirmText` state (after the `lastReconciled` state, line 95):

```ts
  const [confirmText, setConfirmText] = useState("");
```

(d) Reset `confirmText` when opening the confirm dialog — in `handleSave`, between `setPendingReconcile(...)` (line 236) and `setConfirmOpen(true)` (line 237):

```ts
      setConfirmText("");
```

(e) Add the edit banner — after the `ineligibleMessage` card block (line 380, before the `saveSuccessUrl` card):

```tsx
            {isEditing && scheduleEmployeeId && !ineligibleMessage ? (
              <Card className="border-brand-accent/40 bg-brand-accent/10">
                <CardContent className="py-2.5 text-sm text-foreground">
                  <span className="font-medium">
                    Editing {employeeLabel ?? "this employee"}'s schedule.
                  </span>{" "}
                  Changes take effect {effectiveFrom || "the effective date"}. Existing future
                  shifts will be replaced.
                </CardContent>
              </Card>
            ) : null}
```

(f) Retitle the confirm dialog — replace its `<DialogTitle>` and `<DialogDescription>` (lines 576-579):

```tsx
            <DialogTitle>
              {isEditing
                ? `Change ${employeeLabel ?? "this employee"}'s schedule?`
                : "Create shared shift records?"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Review what changes and confirm to apply."
                : "Confirm to create shared Shift Type and Shift Schedule records on save."}
            </DialogDescription>
```

(g) Make the dialog reset `confirmText` on close — change the `<Dialog>` open handler (line 573):

```tsx
      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o) setConfirmText("");
        }}
      >
```

(h) Add the typed-confirm block and update the save button — replace the `<DialogFooter>…</DialogFooter>` (lines 606-620) with:

```tsx
          {reconcileRetiresShifts(pendingReconcile) ? (
            <div className="mt-2 space-y-1.5">
              <Label htmlFor="schedule-change-confirm" className="text-xs text-muted-foreground">
                Type{" "}
                <span className="font-medium text-foreground">
                  {employeeLabel ?? "the employee's name"}
                </span>{" "}
                to confirm this change
              </Label>
              <Input
                id="schedule-change-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={employeeLabel ?? "Employee name"}
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  "h-9 text-sm",
                  confirmText.length > 0 &&
                    !confirmNameMatches(confirmText, employeeLabel) &&
                    "border-destructive/50 focus-visible:ring-destructive/30",
                )}
              />
              {confirmText.length > 0 && !confirmNameMatches(confirmText, employeeLabel) ? (
                <p className="text-xs text-destructive">Name doesn't match.</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                void handleSave(true);
              }}
              disabled={
                applying ||
                (reconcileRetiresShifts(pendingReconcile) &&
                  !confirmNameMatches(confirmText, employeeLabel))
              }
            >
              {isEditing ? "Save changes" : "Create and save"}
            </Button>
          </DialogFooter>
```

> `cn` (`@/lib/utils`) and `Label` are already imported. `employeeLabel` (string | null) and `effectiveFrom` (string) already exist in the component.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test schedule-edit --project=desktop` → PASS. Then `npm run test:web` (unchanged-green) and `npx playwright test --project=desktop` (full e2e green).

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add dewey_time/frontend/hr_attendance/src/ui/WeeklySchedulePage.tsx dewey_time/frontend/hr_attendance/e2e/schedule-edit.spec.ts dewey_time/public/hr_attendance dewey_time/www/hr-schedule.html dewey_time/www/hr-attendance.html
git commit -m "feat(schedule): edit banner + typed-name confirm gate on retiring edits

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Schedule Change Log DocType

**Files:**
- Create: `dewey_time/dewey_time/doctype/schedule_change_log/__init__.py` (empty)
- Create: `dewey_time/dewey_time/doctype/schedule_change_log/schedule_change_log.json`
- Create: `dewey_time/dewey_time/doctype/schedule_change_log/schedule_change_log.py`

**Interfaces:**
- Produces: the `Schedule Change Log` DocType that Task 4's `record_schedule_change` writes to.

- [ ] **Step 1: Create the DocType JSON** — `schedule_change_log.json`:

```json
{
 "actions": [],
 "allow_rename": 0,
 "autoname": "hash",
 "creation": "2026-06-30 00:00:00",
 "doctype": "DocType",
 "editable_grid": 1,
 "engine": "InnoDB",
 "field_order": [
  "employee",
  "employee_name",
  "changed_by",
  "change_datetime",
  "effective_from",
  "summary",
  "inactivated_count",
  "trimmed_count",
  "detail"
 ],
 "fields": [
  {"fieldname": "employee", "fieldtype": "Link", "label": "Employee", "options": "Employee", "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
  {"fieldname": "employee_name", "fieldtype": "Data", "label": "Employee Name", "fetch_from": "employee.employee_name", "read_only": 1, "in_list_view": 1},
  {"fieldname": "changed_by", "fieldtype": "Link", "label": "Changed By", "options": "User", "read_only": 1, "in_list_view": 1},
  {"fieldname": "change_datetime", "fieldtype": "Datetime", "label": "Change Datetime", "read_only": 1, "in_list_view": 1},
  {"fieldname": "effective_from", "fieldtype": "Date", "label": "Effective From", "in_list_view": 1},
  {"fieldname": "summary", "fieldtype": "Small Text", "label": "Summary", "in_list_view": 1},
  {"fieldname": "inactivated_count", "fieldtype": "Int", "label": "Inactivated Count"},
  {"fieldname": "trimmed_count", "fieldtype": "Int", "label": "Trimmed Count"},
  {"fieldname": "detail", "fieldtype": "Code", "label": "Detail (JSON)", "options": "JSON"}
 ],
 "index_web_pages_for_search": 1,
 "links": [],
 "modified": "2026-06-30 00:00:00",
 "modified_by": "Administrator",
 "module": "Dewey Time",
 "naming_rule": "Random",
 "owner": "Administrator",
 "permissions": [
  {"role": "System Manager", "read": 1, "report": 1, "export": 1},
  {"role": "HR Manager", "read": 1, "report": 1, "export": 1},
  {"role": "HR User", "read": 1, "report": 1}
 ],
 "sort_field": "modified",
 "sort_order": "DESC",
 "states": [],
 "track_changes": 0
}
```

- [ ] **Step 2: Create the controller** — `schedule_change_log.py`:

```python
# Copyright (c) 2026, Dewey Time and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class ScheduleChangeLog(Document):
    pass
```

And an empty `__init__.py`.

- [ ] **Step 3: Validate**

Run from repo root:
```bash
python3 -c "import json; json.load(open('dewey_time/dewey_time/doctype/schedule_change_log/schedule_change_log.json')); print('json ok')"
python3 -m py_compile dewey_time/dewey_time/doctype/schedule_change_log/schedule_change_log.py && echo "py_compile ok"
```
Expected: `json ok` and `py_compile ok`.

- [ ] **Step 4: Commit**

```bash
git add dewey_time/dewey_time/doctype/schedule_change_log/__init__.py dewey_time/dewey_time/doctype/schedule_change_log/schedule_change_log.json dewey_time/dewey_time/doctype/schedule_change_log/schedule_change_log.py
git commit -m "feat(schedule): Schedule Change Log DocType (audit capture)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `record_schedule_change` helper

**Files:**
- Create: `dewey_time/attendance_engine/schedule_change_log.py`
- Test: `dewey_time/tests/test_schedule_change_log.py`

**Interfaces:**
- Produces: `record_schedule_change(*, employee, effective_from, reconcile, created, ssas) -> str | None`; `_summarize(leaving, adding) -> str`. Consumed by Task 5.

- [ ] **Step 1: Write the failing test** — create `dewey_time/tests/test_schedule_change_log.py`:

```python
import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


class TestSummarize(unittest.TestCase):
    def test_leaving_only(self):
        from dewey_time.attendance_engine.schedule_change_log import _summarize

        self.assertEqual(_summarize(["MON-FRI 09-17"], []), "Retired MON-FRI 09-17")

    def test_adding_only(self):
        from dewey_time.attendance_engine.schedule_change_log import _summarize

        self.assertEqual(_summarize([], ["SAT 08-12"]), "Added SAT 08-12")

    def test_both(self):
        from dewey_time.attendance_engine.schedule_change_log import _summarize

        self.assertEqual(_summarize(["A"], ["B"]), "Retired A; Added B")

    def test_neither(self):
        from dewey_time.attendance_engine.schedule_change_log import _summarize

        self.assertEqual(_summarize([], []), "Schedule updated")


class TestRecordScheduleChange(unittest.TestCase):
    def test_noop_writes_nothing(self):
        import frappe
        from dewey_time.attendance_engine import schedule_change_log

        frappe.db.table_exists.return_value = True
        with patch.object(schedule_change_log.frappe, "new_doc") as new_doc:
            out = schedule_change_log.record_schedule_change(
                employee="EMP-1",
                effective_from="2026-07-01",
                reconcile={"leaving_labels": [], "add_labels": [], "affected_assignments": []},
                created={"shift_types": [], "shift_schedules": []},
                ssas=[],
            )
        self.assertIsNone(out)
        new_doc.assert_not_called()

    def test_writes_row_for_real_change(self):
        import frappe
        from dewey_time.attendance_engine import schedule_change_log

        frappe.db.table_exists.return_value = True
        frappe.session = type("S", (), {"user": "hr@example.com"})()
        doc = MagicMock()
        doc.name = "SCL-xyz"
        with patch.object(schedule_change_log.frappe, "new_doc", return_value=doc):
            out = schedule_change_log.record_schedule_change(
                employee="EMP-1",
                effective_from="2026-07-01",
                reconcile={
                    "leaving_labels": ["MON-FRI 09-17"],
                    "add_labels": ["MON-SAT 09-17"],
                    "affected_assignments": [{"action": "inactivate"}, {"action": "end_before"}],
                },
                created={"shift_types": [], "shift_schedules": []},
                ssas=[{"name": "SSA-1"}],
            )
        self.assertEqual(out, "SCL-xyz")
        self.assertEqual(doc.employee, "EMP-1")
        self.assertEqual(doc.changed_by, "hr@example.com")
        self.assertEqual(doc.inactivated_count, 1)
        self.assertEqual(doc.trimmed_count, 1)
        self.assertEqual(doc.summary, "Retired MON-FRI 09-17; Added MON-SAT 09-17")
        doc.insert.assert_called_once()

    def test_never_raises_on_failure(self):
        import frappe
        from dewey_time.attendance_engine import schedule_change_log

        frappe.db.table_exists.return_value = True

        def boom(*a, **k):
            raise RuntimeError("db down")

        with patch.object(schedule_change_log.frappe, "new_doc", side_effect=boom):
            out = schedule_change_log.record_schedule_change(
                employee="EMP-1",
                effective_from="2026-07-01",
                reconcile={"leaving_labels": ["X"], "add_labels": [], "affected_assignments": []},
                created={},
                ssas=[],
            )
        self.assertIsNone(out)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest dewey_time.tests.test_schedule_change_log -v`
Expected: FAIL — module `schedule_change_log` doesn't exist.

- [ ] **Step 3: Write the implementation** — create `dewey_time/attendance_engine/schedule_change_log.py`:

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
    """Best-effort audit row for a confirmed schedule apply. NEVER raises — an audit-write
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
            return None
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

> Note: `_summarize` joins labels with `·` but the tests use single labels, so the asserted strings have no separator. The two-label `both` test asserts `"Retired A; Added B"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_schedule_change_log -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/schedule_change_log.py dewey_time/tests/test_schedule_change_log.py
git commit -m "feat(schedule): record_schedule_change audit helper (defensive)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire audit into `apply_weekly_schedule`

**Files:**
- Modify: `dewey_time/attendance_engine/schedule_api.py` (import + one call before commit)
- Modify: `dewey_time/tests/test_apply_weekly_schedule.py` (patch `record_schedule_change` in `_apply`)

**Interfaces:**
- Consumes: `record_schedule_change` (Task 4).

- [ ] **Step 1: Write the failing test** — in `test_apply_weekly_schedule.py`, add a test asserting the audit helper is invoked on a confirmed apply. Append to `TestApplyEditPath` (before the `if __name__` block):

```python
    def test_confirmed_apply_records_a_change(self):
        from dewey_time.attendance_engine import schedule_api

        add_group = {
            "days": ["Monday"],
            "profile": {"start_time": "09:00:00", "end_time": "17:00:00"},
            "shift_type": {"action": "use", "name": "FT"},
            "shift_schedule": {"action": "use", "name": "PAT_USE"},
        }
        plan = {"groups": [add_group], "needs_create": False, "warnings": []}
        reconcile = {
            "effective_from": "2026-07-01",
            "disable_ssas": [],
            "add_identities": ["k1"],
            "unchanged_identities": [],
            "add_labels": ["MON 09-17"],
            "leaving_labels": [],
            "affected_assignments": [],
        }
        result, _, _ = self._apply(enabled=True, plan=plan, reconcile=reconcile, confirm=True)
        self.assertTrue(result.get("ok"))
        self._record.assert_called_once()
```

And update the `_apply` helper to patch `record_schedule_change` and expose it as `self._record`. In `_apply`, add to the `with` chain (alongside the other `patch.object` calls) and capture it:

```python
        ), patch.object(schedule_api, "record_schedule_change", return_value="SCL-1") as record, patch.object(
            schedule_api, "shift_generation_end_date", return_value="2026-09-29"
        ):
            self._record = record
            result = schedule_api.apply_weekly_schedule(
                employee="EMP-1",
                week_pattern=VALID_PATTERN,
                create_shifts_after="2026-07-01",
                confirm_create=confirm,
            )
        return result, recon, gen
```

> This patches the audit write out of every existing `_apply`-based test (keeping them isolated under real `bench run-tests`) and lets the new test assert it is called.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest dewey_time.tests.test_apply_weekly_schedule -v`
Expected: FAIL — `schedule_api` has no attribute `record_schedule_change` (the `patch.object` raises), and/or the new test's `assert_called_once` fails.

- [ ] **Step 3: Write the implementation** — in `schedule_api.py`:

Add the import (near the other `attendance_engine` imports at the top of the file, e.g. after the `schedule_resolver` import block):

```python
from dewey_time.attendance_engine.schedule_change_log import record_schedule_change
```

Then, inside `apply_weekly_schedule`'s `try` block, **immediately before** `frappe.db.commit()` (the line after the `for group ...` loop), insert:

```python
        record_schedule_change(
            employee=employee,
            effective_from=effective,
            reconcile=reconcile,
            created={"shift_types": created_shift_types, "shift_schedules": created_shift_schedules},
            ssas=ssas_out,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run from repo root:
```bash
python3 -m unittest dewey_time.tests.test_apply_weekly_schedule dewey_time.tests.test_schedule_resolver dewey_time.tests.test_schedule_change_log dewey_time.tests.test_schedule_reconcile
```
Expected: OK (all green). Then `python3 -m py_compile dewey_time/attendance_engine/schedule_api.py`.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/schedule_api.py dewey_time/tests/test_apply_weekly_schedule.py
git commit -m "feat(schedule): record a Schedule Change Log row on each confirmed apply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- A1 guard logic → Task 1. ✓
- A2 banner + A3 typed gate + dialog retitle → Task 2. ✓
- A4 lib tests → Task 1; e2e → Task 2. ✓
- B1 DocType → Task 3. ✓
- B2 helper + B4 helper tests → Task 4. ✓
- B3 wire into apply + B4 apply-test isolation → Task 5. ✓
- Defensive/never-raises → Task 4 (`test_never_raises_on_failure`). ✓
- No API change; typed gate client-side → Tasks 1-2 only. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete.

**3. Type consistency:** `reconcileRetiresShifts`/`confirmNameMatches` signatures identical in Task 1 (def) and Task 2 (use). `record_schedule_change(*, employee, effective_from, reconcile, created, ssas)` identical in Task 4 (def), Task 5 (call), and the Task 5 test patch. The `reconcile` dict keys read by the helper (`leaving_labels`, `add_labels`, `affected_assignments`) match the `build_reconcile_preview` contract shipped in PR #38. The `created` dict shape (`shift_types`, `shift_schedules`) matches what `apply_weekly_schedule` already assembles.
