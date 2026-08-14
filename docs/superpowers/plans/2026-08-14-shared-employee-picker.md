# Shared Employee Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `EmployeePicker` and `ScheduleEmployeePicker` with one component whose `size` prop sets width only, and surface each employee's branch on both routes.

**Architecture:** One `EmployeePicker` in `src/ui/EmployeePicker.tsx` with props for the parts that genuinely differ per surface (`tail`, `isDisabled`, `badge`, `readOnly`, `size`). The two line-two fact orderings become named pure functions in `src/lib/employeeCard.ts`, tested as data without rendering. `branch` needs no backend change — `hr_calendar.py` already emits it and the frontend drops it by never declaring the field.

**Tech Stack:** React 19, TypeScript, Tailwind v4.3, Radix (Popover) via `@lolbikb/dewey-ui`, cmdk (`Command`), `node:test` + `tsx` for unit tests, Playwright for e2e, Python `unittest` for the Frappe backend.

**Spec:** `docs/superpowers/specs/2026-08-14-shared-employee-picker-design.md`

## Global Constraints

- All commands run from `/Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance` unless a step says otherwise. **Use absolute paths in `cd`** — `cd` is intercepted by zoxide on this machine and a bare relative `cd` has silently run scripts in the wrong package.
- `size` sets **width only**. Height, avatar size and type are identical across all three sizes. Never pass `nameClassName="text-base"` or otherwise scale type: `EmployeeIdentity`'s thresholds (Khmer at 200px, tail facts at 120/170/230) are measured at 14px semibold and scaling the type invalidates all of them.
- Size tokens are exactly: `sm` → `w-60 max-w-full` (240px), `md` → `w-88 max-w-full` (352px), `lg` → `w-full max-w-lg` (fluid, 512px cap).
- The trigger uses `min-h-14` and a `size-10` avatar. **`min-h-`, never `h-`** — a hard height clips Khmer descenders.
- List rows keep their `size-8` avatar.
- Copy strings, verbatim: search placeholder `"Search name, ID, branch, department…"`; empty state `"No employees match your search."`; unselected id-slot prompt `"Choose an employee"`.
- Popover: `align="start"`, class `w-[var(--radix-popover-trigger-width)] min-w-[min(100%,22rem)] max-w-[calc(100vw-2rem)] p-0`, list `max-h-[min(60vh,320px)]`.
- Branch displays through `formatBranchLabel()` from `src/lib/attendanceTime.ts`. A null or whitespace-only branch **omits the fact entirely** — never render "No branch".
- `employeeSearchHaystack()` gets the **raw** `employee.branch`, not the formatted label.
- `EmployeeOption` stays a separately exported component. Radix portals server-render to `null`, so anything inline inside `PopoverContent` cannot be reached by `renderToStaticMarkup`.
- Built assets are the deployed artifact, but **do not run `npm run build` or commit `dewey_time/public/**` in this plan** — bundles are rebuilt once at branch close, not per task, to avoid guaranteed merge conflicts on fixed filenames.
- `npm run test:web` runs a glob. **Read the test count in the output**, not just the exit code — a glob that matches nothing exits 0. Record the count in each task's report.
- Every task ends green on `npm run typecheck` and `npm run test:web`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `dewey_time/tests/test_hr_calendar.py` | Pin that the employee-list row emits `branch` | 1 |
| `src/types/calendar.ts` | Declare `branch` on `CalendarEmployee` | 1 |
| `src/lib/employeeCard.ts` | Branch into the search haystack; the two tail builders | 1, 2 |
| `src/lib/employeeCard.test.ts` | Haystack and tail-builder tests | 1, 2 |
| `e2e/fixtures.ts` | Give the stubbed employee a branch | 1 |
| `src/ui/EmployeePicker.tsx` | The one picker: trigger, popover, row, `ClockBadge` | 3 |
| `src/ui/AttendanceToolbar.tsx` | Owns the bordered box, the divider and `ScheduleAccessButton` | 3 |
| `src/ui/EmployeePicker.test.tsx` | Merged unit suite for the one picker | 3, 4 |
| `src/ui/weeklyScheduleSummary.test.tsx` | Renders the summary + button directly, not through the picker | 3 |
| `src/ui/WeeklySchedulePage.tsx` | No `PageHeader`; sr-only h1; `lg` picker on its own row | 4 |
| `src/ui/ScheduleEmployeePicker.tsx` | **Deleted** | 4 |
| `e2e/schedule.spec.ts`, `e2e/schedule-edit.spec.ts` | Heading matcher, editing-notice text | 4 |
| `e2e/employee-picker.spec.ts` | The measured claims | 5 |

---

## Task 1: Surface `branch` through the type boundary and search

`branch` is emitted by the backend and discarded by the frontend because `CalendarEmployee` never declares it. Nothing renders yet — this task only makes the field reachable and searchable.

**Files:**
- Modify: `dewey_time/tests/test_hr_calendar.py` (append a test class)
- Modify: `dewey_time/frontend/hr_attendance/src/types/calendar.ts:124-156`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/employeeCard.ts:125-141`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/employeeCard.test.ts`
- Modify: `dewey_time/frontend/hr_attendance/e2e/fixtures.ts:117-133`

**Interfaces:**
- Consumes: nothing.
- Produces: `CalendarEmployee.branch?: string | null`. Tasks 2–5 all rely on this field existing.

- [ ] **Step 1: Write the failing backend test**

Append to `/Users/lolbikb/projects/dewey-time/dewey_time/tests/test_hr_calendar.py`. `_list_calendar_employee_rows` is already imported at the top of that file.

```python
class TestCalendarEmployeeRowBranch(unittest.TestCase):
    """The picker's employee rows must carry `branch`.

    The field was once in the SELECT list and absent from the emitted dict --
    "a production no-op returning None forever", per the comment at
    hr_calendar.py:417 -- and only review caught it. Nothing pinned it until
    now, so it could regress the same way twice.
    """

    def _call(self, rows):
        import dewey_time.attendance_engine.hr_calendar as hc

        with patch.object(hc.frappe.db, "has_column", return_value=False), patch.object(
            hc.frappe, "get_all", return_value=rows
        ) as get_all, patch.object(
            hc, "_shift_schedule_assignment_metadata_by_employee", return_value={}
        ), patch.object(
            hc, "shift_assignment_bounds_by_employee", return_value={}
        ), patch.object(
            hc, "first_checkin_date_by_employee", return_value={}
        ):
            out = hc._list_calendar_employee_rows(["EMP-001"], include_all=True)
        return out, get_all

    def test_branch_is_in_the_select_list(self):
        # In the SELECT list and in the emitted dict are different claims, and
        # it was the second one that failed last time. Both are asserted.
        _out, get_all = self._call([])
        self.assertIn("branch", get_all.call_args.kwargs["fields"])

    def test_branch_reaches_the_emitted_row(self):
        out, _ = self._call(
            [{"name": "EMP-001", "employee_name": "Jane Doe", "branch": "BRANCH-A"}]
        )
        self.assertEqual(out[0]["branch"], "BRANCH-A")

    def test_branch_is_none_when_unset(self):
        out, _ = self._call([{"name": "EMP-001", "employee_name": "Jane Doe"}])
        self.assertIn("branch", out[0])
        self.assertIsNone(out[0]["branch"])
```

- [ ] **Step 2: Run it and confirm it passes**

```bash
cd /Users/lolbikb/projects/dewey-time && python -m unittest dewey_time.tests.test_hr_calendar.TestCalendarEmployeeRowBranch -v
```

Expected: 3 tests, all PASS. This one is characterisation, not TDD — the backend behaviour already exists and the test exists to stop it regressing. **If any of the three fails, stop and report**: the spec's central claim ("branch is already on the wire") is wrong and the rest of the plan needs re-scoping.

If a stale bytecode cache produces a confusing failure, note that macOS keeps a second cache at `~/Library/Caches/com.apple.python` that survives deleting `__pycache__` and `-B`.

- [ ] **Step 3: Declare the field on `CalendarEmployee`**

In `src/types/calendar.ts`, inside the `CalendarEmployee` type, immediately after the `department` line:

```ts
  /**
   * ERPNext `Employee.branch` — the person's primary site.
   *
   * Already emitted by `_list_calendar_employee_rows`; this declaration is
   * what stops it being discarded at the type boundary. Null for the many
   * employees who have none, which consumers must treat as "do not judge",
   * not as a finding.
   */
  branch?: string | null;
```

- [ ] **Step 4: Write the failing haystack test**

Append to `src/lib/employeeCard.test.ts`:

```ts
test("branch is searchable, raw rather than formatted", () => {
  // Raw, not formatBranchLabel'd: employeeCommandFilter matches on `includes`,
  // and "BRANCH-Iconic" contains "Iconic", so the raw value matches both what
  // HR types and what the row displays. The formatted one would match only
  // the first.
  const haystack = employeeSearchHaystack({
    id: "EMP-1",
    label: "EMP-1 · Jane Doe",
    employee_name: "Jane Doe",
    branch: "BRANCH-Iconic",
  });
  assert.match(haystack, /BRANCH-Iconic/);
  assert.equal(employeeCommandFilter(haystack, "Iconic"), 1);
  assert.equal(employeeCommandFilter(haystack, "BRANCH-Iconic"), 1);
  assert.equal(employeeCommandFilter(haystack, "Warehouse"), 0);
});

test("a missing branch adds nothing to the haystack", () => {
  const haystack = employeeSearchHaystack({ id: "EMP-2", label: "EMP-2 · Ana Ruiz" });
  assert.doesNotMatch(haystack, /undefined|null/);
});
```

- [ ] **Step 5: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:web
```

Expected: FAIL on `branch is searchable, raw rather than formatted` — `assert.match(haystack, /BRANCH-Iconic/)` fails because the haystack does not include branch yet.

- [ ] **Step 6: Add branch to the haystack**

In `src/lib/employeeCard.ts`, in `employeeSearchHaystack`, add `employee.branch` to the array immediately after `employee.department`:

```ts
    employee.department,
    // Raw, not formatBranchLabel'd: the filter matches on `includes`, so the
    // raw value covers both the typed "Iconic" and the stored "BRANCH-Iconic".
    employee.branch,
    employee.company,
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean; test count up by 2 from the pre-task baseline, 0 failures. Record both counts.

- [ ] **Step 8: Give the e2e fixture a branch**

In `e2e/fixtures.ts`, in the `EMPLOYEE` object (currently lines 117-133), add after the `department` line:

```ts
  branch: "BRANCH-A",
```

`EMPLOYEE` is declared `satisfies CalendarEmployee`, so this only typechecks once Step 3 has landed. The enrollment fixture already uses `"BRANCH-A"`, so the two feeds stay consistent.

- [ ] **Step 9: Run e2e to confirm nothing broke**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:e2e
```

Expected: PASS, unchanged count. Nothing renders branch yet.

- [ ] **Step 10: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/tests/test_hr_calendar.py dewey_time/frontend/hr_attendance/src/types/calendar.ts dewey_time/frontend/hr_attendance/src/lib/employeeCard.ts dewey_time/frontend/hr_attendance/src/lib/employeeCard.test.ts dewey_time/frontend/hr_attendance/e2e/fixtures.ts
git commit -m "feat(picker): branch reaches the frontend and the search haystack

hr_calendar.py already emitted Employee.branch; CalendarEmployee never
declared it, so it was discarded at the type boundary. Declaring it and
adding the raw value to the search haystack makes it reachable. The backend
test is characterisation: the field's own comment records it being silently
dropped once before and caught only in review.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The two line-two fact orderings

Pure functions, tested as data. Nothing consumes them yet — Task 3 and Task 4 wire them up.

Line two truncates from its end, so order is priority. These two orderings are product decisions, which is why they live in a tested library function rather than inline JSX in two components.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/employeeCard.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/employeeCard.test.ts`

**Interfaces:**
- Consumes: `CalendarEmployee.branch` from Task 1.
- Produces:
  - `attendancePickerTail(employee: CalendarEmployee): TailFact[]`
  - `schedulePickerTail(employee: CalendarEmployee): TailFact[]`

  Both are passed directly as the `tail` prop in Tasks 3 and 4, whose signature is `(employee: CalendarEmployee) => TailFact[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/employeeCard.test.ts`. Add `attendancePickerTail` and `schedulePickerTail` to the existing import block from `@/lib/employeeCard`.

```ts
test("the attendance tail puts branch ahead of department, and title last", () => {
  // Line two truncates from its end, so this order IS the priority order.
  // Branch first: thirteen sites, and "which Sokha" is a site question before
  // it is an org-chart one. Title last -- it has never separated two people
  // who share a name.
  assert.deepEqual(
    attendancePickerTail({
      id: "EMP-1",
      label: "EMP-1 · Jane Doe",
      branch: "BRANCH-Iconic",
      department: "Retail",
      title: "Cashier",
    }),
    [{ label: "Iconic" }, { label: "Retail" }, { label: "Cashier" }],
  );
});

test("the attendance tail omits absent facts rather than blanking them", () => {
  // Never "No branch": the backend is explicit that many employees have none
  // and that consumers must treat that as "do not judge", not as a finding.
  assert.deepEqual(
    attendancePickerTail({ id: "EMP-2", label: "EMP-2 · Ana Ruiz", department: "Ops" }),
    [{ label: "Ops" }],
  );
  assert.deepEqual(
    attendancePickerTail({ id: "EMP-3", label: "EMP-3 · Bo Lin", branch: "   " }),
    [],
  );
});

test("the schedule tail leads with employment type, then branch, then department", () => {
  // isWeeklyScheduleEligible gates the whole wizard on employment type, so it
  // is the fact that says whether this person can be picked at all. It must
  // never be the one that falls off the end.
  assert.deepEqual(
    schedulePickerTail({
      id: "EMP-4",
      label: "EMP-4 · Jonas Berg",
      employment_type: "Full-time",
      branch: "BRANCH-Iconic",
      department: "Warehouse",
    }),
    [
      { label: "Full-time", tone: "normal" },
      { label: "Iconic" },
      { label: "Warehouse" },
    ],
  );
});

test("the schedule tail always emits employment type, warning-toned when ineligible", () => {
  assert.deepEqual(
    schedulePickerTail({ id: "EMP-5", label: "EMP-5 · Casey Ward", employment_type: "Casual" }),
    [{ label: "Casual", tone: "warning" }],
  );
  assert.deepEqual(
    schedulePickerTail({ id: "EMP-6", label: "EMP-6 · Dee Osei" }),
    [{ label: "Employment type not set", tone: "warning" }],
  );
});

test("neither tail exceeds three facts", () => {
  // EmployeeIdentity's ladder has exactly three rungs; a fourth silently
  // shares the third's threshold and appears at the same width as it.
  const full: CalendarEmployee = {
    id: "EMP-7",
    label: "EMP-7 · Full House",
    employment_type: "Full-time",
    branch: "BRANCH-Iconic",
    department: "Retail",
    title: "Cashier",
  };
  assert.ok(attendancePickerTail(full).length <= 3);
  assert.ok(schedulePickerTail(full).length <= 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:web
```

Expected: FAIL at import — `attendancePickerTail` and `schedulePickerTail` are not exported.

- [ ] **Step 3: Implement the two builders**

In `src/lib/employeeCard.ts`, add the import and the two functions. `formatBranchLabel` comes from `@/lib/attendanceTime`, which this file already imports `parseDateKey` from — extend that import rather than adding a second one. `TailFact` is imported from `@/ui/EmployeeIdentity`.

```ts
import { formatBranchLabel, parseDateKey } from "@/lib/attendanceTime";
import type { TailFact } from "@/ui/EmployeeIdentity";
```

```ts
/**
 * Line-two facts for the /hr-attendance picker, in truncation-priority order.
 *
 * Line two truncates from its END, so the order here IS the priority order,
 * and it stays load-bearing even at widths where all three render: a long
 * branch or department name still pushes the last one off.
 *
 * Branch leads. There are thirteen sites, and the question attendance actually
 * asks is which Sokha — the one at this building or that one — which is a site
 * question before it is an org-chart one. Title is last because it has never
 * separated two people who share a name.
 *
 * An absent fact is omitted, never blanked: `Employee.branch` is null for many
 * people and the backend is explicit that consumers must treat that as "do not
 * judge". "No branch" belongs on the day inspector, where absence is the
 * finding; in a picker it is just absence.
 */
export function attendancePickerTail(employee: CalendarEmployee): TailFact[] {
  return [formatBranchLabel(employee.branch), employee.department, employee.title]
    .map((label) => (label ?? "").trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

/**
 * Line-two facts for the /hr-schedule picker.
 *
 * Employment type is FIRST and is never omitted: `isWeeklyScheduleEligible`
 * gates the whole wizard on it, so it is the fact that says whether this person
 * can be picked at all. Under the attendance ordering it would eventually be
 * the one that fell off the end.
 */
export function schedulePickerTail(employee: CalendarEmployee): TailFact[] {
  const facts: TailFact[] = [
    {
      label: scheduleEmployeeSubtitle(employee),
      tone: isWeeklyScheduleEligible(employee.employment_type) ? "normal" : "warning",
    },
  ];
  for (const label of [formatBranchLabel(employee.branch), employee.department]) {
    const trimmed = (label ?? "").trim();
    if (trimmed) facts.push({ label: trimmed });
  }
  return facts;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean; test count up by 5 from Task 1's baseline, 0 failures.

If typecheck reports an import cycle between `src/lib/employeeCard.ts` and `src/ui/EmployeeIdentity.tsx`, note that `TailFact` is a **type-only** import (`import type`), which is erased at compile time and creates no runtime cycle. Do not restructure to avoid it.

- [ ] **Step 5: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/frontend/hr_attendance/src/lib/employeeCard.ts dewey_time/frontend/hr_attendance/src/lib/employeeCard.test.ts
git commit -m "feat(picker): the two line-two fact orderings as tested pure functions

Attendance leads with branch, schedule leads with employment type because
isWeeklyScheduleEligible gates the wizard on it. Extracted rather than left
inline so the ordering — which is a product decision, not styling — is
testable as data.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The unified picker, and `/hr-attendance` onto it

Rewrites `EmployeePicker` and moves `/hr-attendance` to it. `ScheduleEmployeePicker` is untouched and still compiles — Task 4 removes it. The build stays green throughout.

**Files:**
- Rewrite: `dewey_time/frontend/hr_attendance/src/ui/EmployeePicker.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/AttendanceToolbar.tsx:48-67`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/EmployeePicker.test.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/weeklyScheduleSummary.test.tsx:190-212`

**Interfaces:**
- Consumes: `attendancePickerTail` from Task 2; `CalendarEmployee.branch` from Task 1.
- Produces:
  - `EmployeePickerSize = "sm" | "md" | "lg"`
  - `EmployeePicker(props: EmployeePickerProps)` — full prop list in Step 3
  - `EmployeeOption(props: { employee, selected, disabled?, tail, badge?, onSelect })`
  - `ClockBadge()` — the neutral "Clock" chip
  - `ScheduleAccessButton(props: { weekAssignedShiftDays: number; disabled?: boolean })`, now exported from `AttendanceToolbar.tsx`

  Task 4 consumes `EmployeePicker`, `EmployeeOption` and `EmployeePickerSize`.

- [ ] **Step 1: Write the failing tests for the new shape**

Replace the two render harnesses at the top of `src/ui/EmployeePicker.test.tsx` with one, and add the new cases. Keep every existing `EmployeePicker`/`EmployeeOption` test — only the harness call signature changes. Leave the `ScheduleEmployeePicker` tests alone; Task 4 ports them.

New imports for the file:

```ts
import type { ReactNode } from "react";

import { attendancePickerTail, schedulePickerTail } from "@/lib/employeeCard";
import type { TailFact } from "@/ui/EmployeeIdentity";

import {
  ClockBadge,
  EmployeeOption,
  EmployeePicker,
  type EmployeePickerProps,
} from "./EmployeePicker";
```

New harness (replaces the existing `renderRow`):

```ts
// CommandItem needs a Command/CommandList/CommandGroup ancestor to render at
// all, so option rows go through this harness rather than bare.
function renderRow(
  employee: CalendarEmployee,
  opts?: {
    selected?: boolean;
    disabled?: boolean;
    tail?: (e: CalendarEmployee) => TailFact[];
    badge?: ReactNode;
    onSelect?: () => void;
  },
): string {
  return renderToStaticMarkup(
    <Command>
      <CommandList>
        <CommandGroup>
          <EmployeeOption
            employee={employee}
            selected={opts?.selected ?? false}
            disabled={opts?.disabled}
            tail={opts?.tail ?? attendancePickerTail}
            badge={opts?.badge}
            onSelect={opts?.onSelect ?? (() => {})}
          />
        </CommandGroup>
      </CommandList>
    </Command>,
  );
}

// Destructure before spreading. A trailing `{...overrides}` would re-apply
// `tail: undefined` for any caller that omitted it, overriding the default and
// crashing on `props.tail(selected)`.
function renderTrigger(overrides: Partial<EmployeePickerProps> = {}): string {
  const { employees, value, onChange, tail, ...rest } = overrides;
  return renderToStaticMarkup(
    <EmployeePicker
      employees={employees ?? []}
      value={value ?? null}
      onChange={onChange ?? (() => {})}
      tail={tail ?? attendancePickerTail}
      {...rest}
    />,
  );
}
```

New cases:

```ts
test("the option row shows the branch, prefix stripped", () => {
  const html = renderRow({
    id: "EMP-0088",
    label: "EMP-0088 · Sophea Chan",
    employee_name: "Sophea Chan",
    branch: "BRANCH-Iconic",
    department: "Retail",
  });
  assert.match(html, />Iconic</, "the formatted branch label reaches the row");
  assert.doesNotMatch(html, /BRANCH-Iconic/, "the raw value is for search, not display");
  assert.ok(html.indexOf("Iconic") < html.indexOf("Retail"), "branch leads department");
});

test("an employee with no branch gets no branch fact at all", () => {
  const html = renderRow({ id: "EMP-9", label: "EMP-9 · Bo Lin", department: "Ops" });
  assert.doesNotMatch(html, /No branch/);
});

test("a disabled option cannot be chosen", () => {
  let chosen = false;
  const html = renderRow(
    { id: "EMP-5", label: "EMP-5 · Casey Ward", employment_type: "Casual" },
    { disabled: true, tail: schedulePickerTail, onSelect: () => { chosen = true; } },
  );
  assert.match(html, /data-disabled="true"/);
  assert.equal(chosen, false);
});

test("each size token maps to its width class and nothing else", () => {
  // Width only. A token that also changed height or type would invalidate
  // EmployeeIdentity's thresholds, which are measured at 14px semibold.
  assert.match(renderTrigger({ size: "sm" }), /w-60/);
  assert.match(renderTrigger({ size: "md" }), /w-88/);
  assert.match(renderTrigger({ size: "lg" }), /max-w-lg/);
  for (const size of ["sm", "md", "lg"] as const) {
    const html = renderTrigger({ size });
    assert.match(html, /min-h-14/, `${size} must use the shared minimum height`);
    assert.doesNotMatch(html, /text-base/, `${size} must not scale the name type`);
  }
});

test("the trigger's height is a minimum, never a fixed height", () => {
  // A hard h-14 clips a Khmer descender: line one's line box grows with the
  // Khmer face's ascent and descent, and `truncate` already sets
  // overflow:hidden on it.
  const html = renderTrigger({ size: "lg" });
  assert.match(html, /min-h-14/);
  assert.doesNotMatch(html, /class="[^"]*\bh-14\b/);
});

test("read-only renders no combobox at all", () => {
  const html = renderTrigger({ readOnly: true });
  assert.doesNotMatch(html, /role="combobox"/);
  assert.match(html, /Choose an employee/);
});

test("the Clock badge is neutral and appears only when the caller asks", () => {
  assert.match(renderRow({ id: "EMP-1", label: "x" }, { badge: <ClockBadge /> }), />Clock</);
  assert.doesNotMatch(renderRow({ id: "EMP-1", label: "x" }), />Clock</);
  assert.doesNotMatch(renderRow({ id: "EMP-1", label: "x" }, { badge: <ClockBadge /> }), /destructive/);
});
```

Delete the three now-obsolete `EmployeePicker` tests that assert the picker itself owns the Clock chip (`"a clock-based employee's picker row carries a Clock chip"`, `"a scheduled employee's picker row has no Clock chip"`, `"the picker Clock chip is neutral, never destructive"`) — the last new test above replaces all three, and the chip is now the caller's to supply.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:web
```

Expected: FAIL — `ClockBadge` is not exported and `EmployeeOption` does not accept `tail`.

- [ ] **Step 3: Write the new `EmployeePicker.tsx`**

Replace the whole of `src/ui/EmployeePicker.tsx`:

```tsx
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  employeeCommandFilter,
  employeeDisplayName,
  employeeSearchHaystack,
  khmerName,
} from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";
import { EmployeeIdentity, type TailFact } from "@/ui/EmployeeIdentity";

export type EmployeePickerSize = "sm" | "md" | "lg";

/**
 * Width, and only width.
 *
 * Height, avatar and type are identical across all three, because
 * `EmployeeIdentity` is a CONTAINER-QUERY component: it already adapts
 * continuously to the width of its own text stack, and a size token just
 * chooses where on that ladder the picker sits. Scaling the type instead would
 * invalidate every threshold inside it — the Khmer name turns on at a 200px
 * container because the worst-case pair draws 199.9px at 14px semibold, and the
 * tail facts turn on at 120 / 170 / 230 on the same basis.
 *
 * The trigger's own chrome — px-3 (24), the 40px avatar, gap-2.5 (10), gap-3
 * before the chevron (12), and the 16px chevron — costs about 102px before the
 * text stack gets any width. The tokens are deliberately not round numbers:
 * 224px would clear the 120px first rung by two pixels and 336px would clear
 * the 230px third rung by four, which is inside the margin of error of
 * arithmetic. 240 and 352 clear them by eighteen and twenty.
 *
 * Whole class strings, not composed: Tailwind scans source text, so a computed
 * `w-[${n}px]` produces no CSS at all.
 */
const SIZE_WIDTH: Record<EmployeePickerSize, string> = {
  sm: "w-60 max-w-full",
  md: "w-88 max-w-full",
  lg: "w-full max-w-lg",
};

export type EmployeePickerProps = {
  employees: CalendarEmployee[];
  value: string | null;
  onChange: (id: string) => void;
  /** Width only. Height, avatar and type are identical across all three. */
  size?: EmployeePickerSize;
  isLoading?: boolean;
  /** No popover, no chevron, no combobox role — a plain bordered display. */
  readOnly?: boolean;
  /**
   * Line-two facts in truncation-priority order.
   *
   * Called only when an employee exists, so "drop the tail when nothing is
   * selected" needs no special case at the call site: an unselected trigger
   * would otherwise carry the "Choose an employee" prompt twice.
   */
  tail: (employee: CalendarEmployee) => TailFact[];
  /** Rows failing this render disabled and cannot be chosen. */
  isDisabled?: (employee: CalendarEmployee) => boolean;
  /** Trailing chip on a list row. */
  badge?: (employee: CalendarEmployee) => ReactNode;
  className?: string;
};

/**
 * One employee picker, for every surface that picks one.
 *
 * Was two components — this one and `ScheduleEmployeePicker` — over the same
 * `CalendarEmployee[]` in the same SPA, which had drifted apart in height,
 * avatar size, name font size, popover width, popover alignment, search
 * placeholder, empty-state copy and fact ordering. Some of that was product
 * behaviour and some was accident, and there was no way to tell which by
 * reading either file.
 */
export function EmployeePicker(props: EmployeePickerProps) {
  const size = props.size ?? "md";
  const selected = useMemo(
    () => props.employees.find((e) => e.id === props.value) ?? null,
    [props.employees, props.value],
  );
  const [open, setOpen] = useState(false);
  const disabled = !props.employees.length || props.isLoading;

  const identity = (
    <EmployeeIdentity
      className="min-w-0 flex-1"
      englishName={employeeDisplayName(selected, props.value)}
      // EmployeeIdentity always renders a second line, so with nothing selected
      // the id slot carries the prompt rather than going blank. Keyed off
      // `selected`, not `props.value`: an id that names no employee in the list
      // (still loading, filtered out) should read the same as no id at all, not
      // repeat the bare id that already lost the argument on line one.
      employeeId={selected ? selected.id : "Choose an employee"}
      khmerName={khmerName(selected?.custom_khmer_last_name, selected?.custom_khmer_first_name)}
      avatar={<EmployeeAvatar employee={selected} fallbackId={props.value} className="size-10" />}
      tail={selected ? props.tail(selected) : []}
      nameSlot="picker-employee-name"
    />
  );

  // `min-h-`, never `h-`: line one's line box is the union of the Latin and
  // Khmer inline boxes and grows with the Khmer face's ascent and descent, and
  // `truncate` has already set overflow:hidden on it. A fixed height clips the
  // coeng subscripts.
  const frame = cn(
    "flex min-h-14 min-w-0 items-center rounded-xl border border-border bg-background",
    SIZE_WIDTH[size],
    disabled && "opacity-50",
    props.className,
  );

  if (props.readOnly) {
    return (
      <div className={cn(frame, "gap-3 overflow-hidden px-3 py-2")}>
        {identity}
        {props.isLoading ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin opacity-60" />
        ) : null}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            frame,
            "h-auto justify-start gap-3 px-3 py-2 font-normal shadow-none hover:bg-muted/50",
          )}
        >
          {identity}
          {props.isLoading ? (
            <Loader2Icon className="size-4 shrink-0 animate-spin opacity-60" />
          ) : (
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-40" />
          )}
        </Button>
      </PopoverTrigger>

      {/* The list has its own width, independent of the trigger. The 22rem
          floor is what stops a `sm` trigger opening a 240px list: you need the
          most information at the moment you are choosing, not after. */}
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[min(100%,22rem)] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command filter={employeeCommandFilter}>
          <CommandInput placeholder="Search name, ID, branch, department…" className="h-10" />
          <CommandList className="max-h-[min(60vh,320px)]">
            <CommandEmpty>No employees match your search.</CommandEmpty>
            <CommandGroup>
              {props.employees.map((employee) => (
                <EmployeeOption
                  key={employee.id}
                  employee={employee}
                  selected={employee.id === props.value}
                  disabled={props.isDisabled?.(employee) === true}
                  tail={props.tail}
                  badge={props.badge?.(employee)}
                  onSelect={() => {
                    props.onChange(employee.id);
                    setOpen(false);
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One row of the picker list.
 *
 * Exported so its rendering can be tested directly: Radix portals
 * server-render to `null`, so anything left inline inside `PopoverContent`
 * never reaches `renderToStaticMarkup` output.
 *
 * The avatar is `size-8` here, not the trigger's `size-10`. The trigger is a
 * page anchor and this is a dense list item — which is also why
 * `EmployeeIdentity` places the avatar OUTSIDE its query container: one
 * threshold measured across the whole box would mean a different text budget
 * on each surface.
 */
export function EmployeeOption(props: {
  employee: CalendarEmployee;
  selected: boolean;
  disabled?: boolean;
  tail: (employee: CalendarEmployee) => TailFact[];
  badge?: ReactNode;
  onSelect: () => void;
}) {
  const { employee } = props;

  return (
    <CommandItem
      value={employeeSearchHaystack(employee)}
      disabled={props.disabled}
      onSelect={() => {
        if (props.disabled) return;
        props.onSelect();
      }}
      className="gap-2 py-2"
    >
      <EmployeeIdentity
        className="min-w-0 flex-1"
        englishName={employeeDisplayName(employee, employee.id)}
        employeeId={employee.id}
        khmerName={khmerName(employee.custom_khmer_last_name, employee.custom_khmer_first_name)}
        avatar={<EmployeeAvatar employee={employee} fallbackId={employee.id} className="size-8" />}
        tail={props.tail(employee)}
      />
      {props.badge}
      {props.selected ? (
        <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      ) : null}
    </CommandItem>
  );
}

/**
 * The neutral "Clock" chip.
 *
 * `list_calendar_employees` sorts employees with shift coverage first, so
 * clock-based people land at the bottom of the list. Without the chip they read
 * as "schedule failed to import". Neutral, never destructive — being
 * clock-based is a fact about the person, not a problem with them.
 */
export function ClockBadge() {
  return (
    <span className="shrink-0 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
      Clock
    </span>
  );
}
```

- [ ] **Step 4: Move the bordered box and the schedule button into `AttendanceToolbar`**

In `src/ui/AttendanceToolbar.tsx`, replace the `<EmployeePicker … />` element (currently lines 56-66) with the block below, and add the imports it needs:

```tsx
import { CalendarDaysIcon, /* …existing icons… */ } from "lucide-react";
import { useState } from "react";

import { attendancePickerTail } from "@/lib/employeeCard";
import { AppTooltip } from "@/ui/AppTooltip";
import { ClockBadge, EmployeePicker } from "@/ui/EmployeePicker";
import { WeeklyScheduleSummary } from "@/ui/WeeklyScheduleSummary";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
```

Add this state inside `AttendanceToolbar`, above the `return`:

```tsx
const [scheduleOpen, setScheduleOpen] = useState(false);
```

The replacement block:

```tsx
{/* The bordered box and the divider live HERE, not in EmployeePicker. The
    weekly-schedule button is a sibling control that happens to share a border
    with the picker, not part of it — pulling it into the shared component
    would make it a grab bag and hand /hr-schedule a prop it never uses. */}
<div className="flex min-h-14 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background sm:max-w-lg sm:flex-1">
  <EmployeePicker
    size="lg"
    employees={props.employees}
    value={props.employee}
    onChange={props.onEmployeeChange}
    isLoading={props.employeeLoading}
    readOnly={!hrStaff}
    tail={attendancePickerTail}
    badge={(employee) => (employee.is_clock_based ? <ClockBadge /> : null)}
    // The wrapper owns the border and the width cap, so the picker gives both
    // up. `max-w-none` is required: twMerge would otherwise leave `lg`'s
    // max-w-lg in place and cap the picker inside an already-capped box.
    className="min-w-0 max-w-none flex-1 rounded-none border-0"
  />
  {hrStaff ? (
    <>
      <div className="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
      <WeeklyScheduleSummary
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        employee={selectedEmployee}
        weekDates={props.weekDates}
        daysByDate={props.daysByDate}
        weekAssignedShiftDays={props.weekAssignedShiftDays}
        showWeekDetail={props.showWeekScheduleHint === true}
      >
        <ScheduleAccessButton
          weekAssignedShiftDays={props.weekAssignedShiftDays}
          // `!selectedEmployee`, not `!props.employee`: an id that names nobody
          // in the current list has no schedule to show, and the old picker
          // gated on the RESOLVED employee for exactly that reason.
          disabled={
            !selectedEmployee || !props.employees.length || props.employeeLoading === true
          }
        />
      </WeeklyScheduleSummary>
    </>
  ) : null}
</div>
```

`selectedEmployee` is the resolved row, computed once alongside `scheduleOpen`:

```tsx
const selectedEmployee = props.employees.find((e) => e.id === props.employee) ?? null;
```

Then move `ScheduleAccessButton` out of `EmployeePicker.tsx` and into `AttendanceToolbar.tsx`, **exported** so the summary test can reach it:

```tsx
/**
 * The weekly-schedule button welded to the right of the employee picker.
 *
 * Exported so `weeklyScheduleSummary.test.tsx` can render the real
 * summary + button composition without dragging the whole picker in.
 */
export function ScheduleAccessButton(props: { weekAssignedShiftDays: number; disabled?: boolean }) {
  const detail =
    props.weekAssignedShiftDays > 0
      ? `${props.weekAssignedShiftDays} scheduled this week`
      : "View expected shifts";

  return (
    // Tooltip outside, popover trigger inside: both are `asChild` slots, and
    // only this order lets each merge onto the button. Reversed, the popover's
    // props land on the tooltip's Root and its click handler is dropped.
    <AppTooltip content={detail} side="bottom">
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={props.disabled}
          aria-label="View weekly schedule"
          className="h-auto min-h-14 w-11 shrink-0 rounded-none border-0 px-0 shadow-none hover:bg-muted/50"
        >
          <CalendarDaysIcon className="size-4" strokeWidth={2} />
          <span className="sr-only">Weekly schedule</span>
        </Button>
      </PopoverTrigger>
    </AppTooltip>
  );
}
```

- [ ] **Step 5: Repoint the summary test at the real composition**

In `src/ui/weeklyScheduleSummary.test.tsx`, the test `"the picker's schedule button is wired to the popover, tooltip and all"` renders `<EmployeePicker>` with `weekDates` / `daysByDate` / `weekAssignedShiftDays`, props the picker no longer takes. Replace its render with the composition that now exists, keeping all four assertions unchanged:

```tsx
import { ScheduleAccessButton } from "./AttendanceToolbar";
```

```tsx
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <WeeklyScheduleSummary
        open={false}
        onOpenChange={() => {}}
        employee={ADA}
        weekDates={WEEK}
        daysByDate={week()}
        weekAssignedShiftDays={5}
        showWeekDetail={false}
      >
        <ScheduleAccessButton weekAssignedShiftDays={5} />
      </WeeklyScheduleSummary>
    </TooltipProvider>,
  );
```

This is a better test than the one it replaces — it exercises the nesting that actually ships, without a picker in the way.

- [ ] **Step 6: Run typecheck and the unit suite**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean; 0 failures. The count changes by (new cases added) minus (3 Clock tests deleted) — state both numbers in the report rather than only the total.

- [ ] **Step 7: Run e2e**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:e2e
```

Expected: PASS. `/hr-attendance` should look unchanged apart from the branch now appearing as the first tail fact. If `attendance.spec.ts` or `mobile-surfaces.spec.ts` fails on text ordering, that is the branch fact arriving — update the assertion, do not remove the branch.

- [ ] **Step 8: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/frontend/hr_attendance/src/ui/EmployeePicker.tsx dewey_time/frontend/hr_attendance/src/ui/AttendanceToolbar.tsx dewey_time/frontend/hr_attendance/src/ui/EmployeePicker.test.tsx dewey_time/frontend/hr_attendance/src/ui/weeklyScheduleSummary.test.tsx
git commit -m "feat(picker): one picker with a width-only size scale, /hr-attendance onto it

size sets width and nothing else — height, avatar and type stay fixed
because EmployeeIdentity's thresholds are measured at 14px semibold.
The bordered box and the weekly-schedule button move to AttendanceToolbar:
the button is a sibling that shares a border, not part of the picker.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: `/hr-schedule` onto the shared picker, and the header goes

Migrates the second call site, deletes `ScheduleEmployeePicker`, and removes `/hr-schedule`'s visible `PageHeader`. These cannot be split: a `lg` picker cannot sit in a header row that never stacks.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeeklySchedulePage.tsx:1, 354-372, 377-418, 447-462`
- Delete: `dewey_time/frontend/hr_attendance/src/ui/ScheduleEmployeePicker.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/EmployeePicker.test.tsx`
- Modify: `dewey_time/frontend/hr_attendance/e2e/schedule.spec.ts:8-18`
- Modify: `dewey_time/frontend/hr_attendance/e2e/schedule-edit.spec.ts:10`

**Interfaces:**
- Consumes: `EmployeePicker`, `EmployeeOption` from Task 3; `schedulePickerTail`, `isWeeklyScheduleEligible` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Port the schedule tests onto the shared row**

In `src/ui/EmployeePicker.test.tsx`, delete the `renderScheduleRow` harness and the `ScheduleEmployeePicker` import. Five `ScheduleEmployeePicker` tests exist; four are ported below in full and the fifth is dropped.

Dropped: `"with nothing selected, the compact weekly-schedule trigger still prompts"`. `compact` no longer exists, and Task 3 already pins all three `size` tokens.

This is a harness port, not new behaviour — the shared row landed in Task 3, so these should go green immediately.

```ts
test("the weekly-schedule tail puts employment type ahead of department", () => {
  // isWeeklyScheduleEligible gates the wizard on employment type, so it is the
  // fact that says whether this person can be picked at all. Under the
  // attendance ordering it would eventually be the one that fell off the end.
  const html = renderRow(
    {
      id: "EMP-1",
      label: "EMP-1 · Jonas Berg",
      employee_name: "Jonas Berg",
      department: "Warehouse",
      employment_type: "Full-time",
    },
    { tail: schedulePickerTail },
  );
  // Without this, the ordering assertion below passes as `-1 < N` if the
  // employment-type fact vanished from the markup entirely.
  assert.match(html, /Full-time/);
  assert.ok(html.indexOf("Full-time") < html.indexOf("Warehouse"));
});

test("with nothing selected, the trigger prompts in the id slot, not a tail fact", () => {
  // The prompt has to live in the always-rendered `employeeId` slot: tail facts
  // hide below their container-query threshold, so a fact-only prompt would
  // reappear blank in a narrow trigger.
  const html = renderTrigger({ tail: schedulePickerTail });
  assert.match(html, /<span class="tabular-nums">Choose an employee<\/span>/);
  assert.equal(
    (html.match(/Choose an employee/g) ?? []).length,
    1,
    "the prompt is not also duplicated into a tail fact",
  );
});

test("an ineligible employment type carries the warning tone on its own fact span", () => {
  const html = renderRow(
    {
      id: "EMP-2",
      label: "EMP-2 · Casey Ward",
      employee_name: "Casey Ward",
      department: "Ops",
      employment_type: "Casual",
    },
    { tail: schedulePickerTail },
  );
  // On the fact's OWN span, not just anywhere in the document — a tone class
  // landing on the wrong element would still satisfy a whole-markup match.
  assert.match(
    html,
    /class="[^"]*text-brand-accent[^"]*"><span aria-hidden="true" class="mx-1 opacity-40">·<\/span>Casual/,
  );
});

test("an id absent from the employee list does not repeat itself on both lines", () => {
  // The id names nobody in the list (still loading, filtered out), so line one
  // falls back to the bare id and line two must not repeat it: it should read
  // the same "Choose an employee" prompt as no id at all.
  const html = renderTrigger({ value: "EMP-404", tail: schedulePickerTail });
  assert.match(html, /EMP-404/, "line one still shows the unresolved id");
  assert.match(html, /<span class="tabular-nums">Choose an employee<\/span>/);
  assert.equal((html.match(/EMP-404/g) ?? []).length, 1, "the id is not repeated on line two");
});
```

- [ ] **Step 2: Run the ported tests**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:web
```

Expected: PASS, 0 failures, count down by 1 from Task 3's baseline (five ported to four). There is no red phase here by design — the shared row these now exercise landed in Task 3, and porting a test to a new harness is a refactor. If any of the four **fails**, the shared row does not reproduce a behaviour `ScheduleEmployeePicker` had: fix `EmployeePicker`, not the assertion.

- [ ] **Step 3: Rewrite the `/hr-schedule` header region**

In `src/ui/WeeklySchedulePage.tsx`:

Change the dewey-ui import on line 1 — `PageHeader` goes, `Page` and `Section` stay:

```tsx
import { EmptyState, Page, Section } from "@lolbikb/dewey-ui";
```

Swap the picker import (`ScheduleEmployeePicker` on line 72) for the shared one, and extend the existing `@/lib/employeeCard` import block on lines 59-62:

```tsx
import {
  isWeeklyScheduleEligible,
  schedulePickerTail,
  weeklyScheduleIneligibleMessage,
} from "@/lib/employeeCard";
import { EmployeePicker } from "@/ui/EmployeePicker";
```

Delete the `headerDescription` const (currently lines 354-372) entirely, along with its comment block. `PencilLineIcon` becomes unused — remove it from the `lucide-react` import on line 3 if nothing else uses it.

Replace the `<PageHeader …>…</PageHeader>` element (lines 378-418) with:

```tsx
{/* No PageHeader. The nav tab the reader arrived through already reads
    "Schedule", and a visible title costs roughly 40px of vertical space on
    the viewport that can least afford it. /hr-attendance (App.tsx:269) and
    /hr-schedule/coverage (CoverageRegisterPage.tsx:143) are the existing
    precedents; this route converges on them. `<Page>` stays — that is what
    page-insets.spec.ts and the chrome parity guard actually require.

    The heading does NOT go with it. `sr-only` is absolutely positioned and
    measures zero pixels, so the space is still reclaimed, but a nav tab is
    not a heading: it does not appear in a screen reader's heading list, and
    a route with none has no answer to "where am I". */}
<h1 className="sr-only">Weekly Schedule</h1>

{/* The picker gets its own row rather than sitting beside a title. It is the
    page's subject selector — everything below operates on whatever it holds —
    and at `lg` it is wide enough to show the Khmer name, which the old
    header-actions slot never was. */}
<div className="flex flex-col gap-2">
  <EmployeePicker
    size="lg"
    employees={employees}
    value={employee}
    onChange={selectEmployee}
    isLoading={employeesLoading || (employeeLoading && isScheduleLoading)}
    tail={schedulePickerTail}
    isDisabled={(candidate) => !isWeeklyScheduleEligible(candidate.employment_type)}
  />

  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
    <SpreadsheetImportTrigger
      onClick={() => navigate("/hr-schedule/import")}
      className="w-full sm:w-auto"
    />
    <ClearEmployeeScheduleDialog
      employee={scheduleEmployeeId}
      employeeRow={selectedEmployee}
      employeeLabel={employeeLabel}
      triggerClassName="h-9 w-full shrink-0 sm:w-auto"
      disabled={!scheduleEmployeeId}
      onSuccess={() => void reseedFormFromServer()}
    />
    <ClearAllSchedulesDialog triggerClassName="h-9 w-full shrink-0 sm:w-auto" />
    <ClearSitePatternsDialog triggerClassName="h-9 w-full shrink-0 sm:w-auto" />
  </div>
</div>
```

`isWeeklyScheduleEligible` is **already** imported in this file (line 60, alongside `weeklyScheduleIneligibleMessage`) — add `schedulePickerTail` to that same import block rather than opening a second one.

- [ ] **Step 4: Move the editing notice into the Shift blocks card**

In the same file, in the `CardHeader` block (currently lines 447-462), replace the two-branch description with three branches. Precedence is validation issue → read-only → editing → default:

```tsx
{validationIssues[0] && !scheduleReadOnly ? (
  <CardDescription className="text-destructive">
    {validationIssues[0].message}
  </CardDescription>
) : (
  <CardDescription>
    {scheduleReadOnly
      ? "Preview only — clear existing SSAs to edit."
      : isEditing
        ? // Was the page header's description. It loses the employee's name:
          // the `lg` picker directly above now says who, and the effective
          // date is deliberately absent because the "Effective from" control
          // below owns it and formats it properly.
          "Editing an existing schedule — changes apply from the effective date."
        : "One block per shared pattern — like Frappe Shift Schedule repeat days."}
  </CardDescription>
)}
```

- [ ] **Step 5: Delete `ScheduleEmployeePicker`**

```bash
cd /Users/lolbikb/projects/dewey-time && git rm dewey_time/frontend/hr_attendance/src/ui/ScheduleEmployeePicker.tsx
```

- [ ] **Step 6: Run typecheck and the unit suite**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean — any surviving import of `ScheduleEmployeePicker` fails here. 0 test failures.

`chromeMigration.test.tsx:282` ("every routed page has a heading — via PageHeader, or its own sr-only h1") must still pass without editing it: the sr-only h1 satisfies it. **If it fails, do not edit that test** — the guard is correct and the page is wrong.

- [ ] **Step 7: Update the two e2e specs**

`e2e/schedule.spec.ts` — the heading is now `sr-only`, which is zero pixels tall, so `toBeVisible()` cannot pass. Follow the pattern `coverage-register.spec.ts:96-105` already documents:

```ts
test("weekly schedule page renders for HR staff (no auth gate)", async ({ page }) => {
  await page.goto("/hr-schedule");
  // The heading is `sr-only` since the page header was dropped: still a real
  // heading in the accessibility tree — getByRole finds it, and so does a
  // screen reader's heading list — but zero pixels tall, so `toBeVisible`
  // would fail on it. Attached-ness is the claim that matters.
  await expect(
    page.getByRole("heading", { name: "Weekly Schedule", level: 1 }),
  ).toBeAttached();
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
  await expect(page.getByText("Sign in required")).toHaveCount(0);
});
```

`e2e/schedule-edit.spec.ts:10` — the notice lost the employee's name and moved into the Shift blocks card:

```ts
    await expect(
      page.getByText(/Editing an existing schedule — changes apply from the effective date/),
    ).toBeVisible();
```

- [ ] **Step 8: Run e2e**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:e2e
```

Expected: PASS, full suite. If `page-insets.spec.ts` or `mobile-surfaces.spec.ts` fails on `/hr-schedule`, the picker row's wrapper is the likely cause — it must not introduce its own horizontal padding, since `<Page>` owns all page padding.

- [ ] **Step 9: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add -A dewey_time/frontend/hr_attendance
git commit -m "feat(schedule): /hr-schedule onto the shared picker; the page header goes

The picker moves out of PageHeader's actions slot — which never stacks, and
so held it at 160px where a Khmer name can never fit — onto its own row at
lg. PageHeader's title is a required prop, so the component goes entirely,
converging with /hr-attendance and the coverage register. The sr-only h1
stays: a nav tab is not a heading.

The editing notice moves into the Shift blocks CardDescription and drops the
employee's name, which the picker above now supplies.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Measure the three derived claims in a browser

Every width figure in the spec and in Task 3's comments is **derived arithmetic**. Derived layout numbers have been wrong on this codebase before — most recently `--font-khmer` naming a font family that did not exist, so every Khmer name rendered in a macOS system face while the intended subset downloaded unused, and the e2e precondition written to catch exactly that could not fail. This task replaces arithmetic with measurement.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/e2e/employee-picker.spec.ts`
- Modify (only if a measurement disagrees): `dewey_time/frontend/hr_attendance/src/ui/EmployeePicker.tsx` (`SIZE_WIDTH`)

**Interfaces:**
- Consumes: `EmployeePicker` from Task 3, rendered live on `/hr-attendance`.
- Produces: nothing consumed by later tasks.

`EmployeePicker` stamps `nameSlot="picker-employee-name"` on line one's name span. That span is a `block` child of `EmployeeIdentity`'s query container, which has no padding, so **its width equals the container width the thresholds are measured against**. That is the measurement hook; no change to `EmployeeIdentity` is needed.

- [ ] **Step 1: Write the measurement spec**

Create `e2e/employee-picker.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/**
 * The trigger's chrome: everything between the trigger's own box and the width
 * EmployeeIdentity's container queries actually see. Width-independent, so
 * measuring it once validates the arithmetic behind all three size tokens.
 */
async function chromeBudget(page: Page): Promise<number> {
  return page.evaluate(() => {
    const trigger = document.querySelector('[role="combobox"]') as HTMLElement;
    const name = trigger.querySelector('[data-slot="picker-employee-name"]') as HTMLElement;
    return trigger.getBoundingClientRect().width - name.getBoundingClientRect().width;
  });
}

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

test("the trigger chrome costs no more than the 102px the size tokens assume", async ({
  page,
}) => {
  // px-3 (24) + the 40px avatar + gap-2.5 (10) + gap-3 (12) + a 16px chevron.
  // If this is larger, every token's text stack is smaller than claimed and
  // the tokens move — the claim does not.
  await page.goto("/hr-attendance");
  await expect(page.getByRole("combobox")).toBeVisible();
  expect(await chromeBudget(page)).toBeLessThanOrEqual(102);
});

test("each size token leaves the text stack clear of the rung it promises", async ({ page }) => {
  // EmployeeIdentity's measured rungs: first tail fact 120, second 170,
  // Khmer 200, third fact 230. sm promises one fact; md and lg promise all
  // three plus Khmer.
  await page.goto("/hr-attendance");
  await expect(page.getByRole("combobox")).toBeVisible();
  const chrome = await chromeBudget(page);
  expect(240 - chrome).toBeGreaterThanOrEqual(120);
  expect(352 - chrome).toBeGreaterThanOrEqual(230);
  expect(512 - chrome).toBeGreaterThanOrEqual(230);
});

test("a Khmer name fits the trigger's minimum height without clipping", async ({ page }) => {
  // The Kantumruy line box is 17.50px against the Latin line's 17.50px, and a
  // Khmer row grows about half a pixel. min-h-14 (56px) must still leave real
  // padding around the two-line stack — if it does not, a hard height would
  // have clipped the coeng subscripts.
  await page.goto("/hr-attendance");
  const trigger = page.getByRole("combobox");
  await expect(trigger).toBeVisible();

  const fits = await page.evaluate(() => {
    const el = document.querySelector('[role="combobox"]') as HTMLElement;
    const stack = el.querySelector('[data-slot="picker-employee-name"]')
      ?.parentElement as HTMLElement;
    return {
      khmer: !!el.querySelector(".font-khmer"),
      trigger: el.getBoundingClientRect().height,
      stack: stack.getBoundingClientRect().height,
    };
  });

  expect(fits.khmer, "the fixture employee must have a Khmer name for this to mean anything").toBe(
    true,
  );
  expect(fits.trigger).toBeGreaterThanOrEqual(56);
  expect(fits.stack).toBeLessThanOrEqual(fits.trigger - 8);
});

test("/hr-schedule at 375px does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/hr-schedule");
  await expect(page.getByRole("heading", { name: "Weekly Schedule", level: 1 })).toBeAttached();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 2: Run the spec and record every measured number**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx playwright test e2e/employee-picker.spec.ts --reporter=list
```

Expected: 4 passed.

**Record the actual measured chrome budget in the task report**, not just pass/fail. If a test fails, add a temporary `console.log` of the measured value, read it, then remove the log — the number is the deliverable here, and "it passed" is not the same claim.

The third test's `khmer` precondition exists because the rest of it is meaningless without a Khmer name on screen; a precondition that cannot fail is the exact trap the font bug hid behind.

- [ ] **Step 3: If a measurement disagrees, move the token**

Only if Step 2 failed. Adjust `SIZE_WIDTH` in `src/ui/EmployeePicker.tsx` to the next Tailwind spacing step that clears the rung with real margin, update the class assertions in `EmployeePicker.test.tsx`, update the comment above `SIZE_WIDTH` with the **measured** chrome figure, and re-run both suites. Do not adjust the rung thresholds in `EmployeeIdentity` — they are out of scope and separately measured.

- [ ] **Step 4: Run the whole suite green**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web && npm run test:e2e
cd /Users/lolbikb/projects/dewey-time && python -m unittest discover -s dewey_time/tests -t . 2>&1 | tail -5
```

Expected: all green. Report the web unit count, the e2e count and the Python count.

- [ ] **Step 5: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/frontend/hr_attendance/e2e/employee-picker.spec.ts dewey_time/frontend/hr_attendance/src/ui/EmployeePicker.tsx dewey_time/frontend/hr_attendance/src/ui/EmployeePicker.test.tsx
git commit -m "test(picker): measure the chrome budget rather than asserting the arithmetic

Every width figure behind the size tokens was derived. This measures the
trigger chrome in a browser and checks each token clears the rung it
promises, plus that a Khmer name fits min-h-14 and /hr-schedule does not
scroll sideways at 375px. The Khmer assertion carries a precondition: a
check that cannot fail is what hid the --font-khmer bug.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Branch close

After Task 5, before opening the PR:

- [ ] Rebuild the committed bundles once — they are the deployed artifact and Frappe Cloud never builds these SPAs:

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run build
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/public dewey_time/www && git commit -m "chore(build): rebuild hr_attendance bundle

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] Then use superpowers:finishing-a-development-branch. Base branch is `main`; the repo convention is a squash-merge via PR with a `(#NNN)` suffix on the title.
