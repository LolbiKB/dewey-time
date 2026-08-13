# Employee Identity Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared component renders an employee's identity on every surface in `dewey_time`, showing the Khmer name ERPNext already holds whenever the box it is given can fit it whole.

**Architecture:** A presentational `EmployeeIdentity` component owns two lines — English name (plus `·` and the Khmer name when there is room) over employee ID (plus facts the caller declares). It adapts with a Tailwind v4 `@container` query on its own text stack, so it responds to the width it was actually given rather than to the viewport. Backend feeds carry the two raw Khmer fields; the frontend composes them through one tested function.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS 4.3.0 (`@container` built in, no plugin), `@lolbikb/dewey-ui` 3.0.0, `node:test` via `tsx --test`, `renderToStaticMarkup` (no jsdom, no RTL), Playwright, Frappe/ERPNext v16 (Python).

**Spec:** `docs/superpowers/specs/2026-08-13-employee-identity-display-design.md`

## Global Constraints

- **Thresholds are TEXT-STACK widths, never the component box or the table cell.** Khmer name at `≥ 200px`; first caller fact at `≥ 120px`; second at `≥ 170px`; third at `≥ 230px`.
- **The container query goes on the text stack, not the component root.** The avatar is a sibling, outside the query.
- **The avatar is a per-surface prop and is never space-driven.** No container query may show or hide it.
- **Khmer is dropped, never shrunk and never truncated.** Khmer font-size is always the same as the Latin name's on that line (14px on line one). No rule may set a smaller Khmer size.
- **Never a third line.** Exactly two lines on every surface at every width.
- **Priority order is fixed:** English name → employee ID → Khmer name → caller's facts. Fill from the left, drop from the right.
- Built assets ARE the deployed artifact and MUST be committed: `dewey_time/public/**` and `dewey_time/www/*.html`. Frappe Cloud never builds these SPAs.
- `npm run test:web` is an explicit **glob list**, not a recursive scan. New test files must sit at `src/lib/*.test.ts` or `src/ui/*.test.tsx` or they silently do not run. Check the reported test count moved.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
  ```
- Never use bare `git stash` / `git stash pop` — the stash stack is shared with other worktrees. Prefer a temporary WIP commit.
- Run all frontend commands from `dewey_time/frontend/hr_attendance`. Run all Python commands from the repo root.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/ui/EmployeeIdentity.tsx` | The two-line identity block and its container-query rules. Presentational, hook-free. |
| `src/ui/employeeIdentity.test.tsx` | Rendered-markup tests for every data case and tail configuration. |
| `e2e/employee-identity.spec.ts` | Geometric tests — what is present at each measured budget, and that nothing clips. |

**Modified**

| File | Change |
|---|---|
| `dewey_time/setup/custom_fields.py` | Install the two Khmer fields on Employee. |
| `dewey_time/utils/anonymize.py` | Scrub the two Khmer fields and `custom_telegram_chat_id`. |
| `dewey_time/attendance_engine/hr_calendar.py` | Select + emit the Khmer fields (also feeds coverage). |
| `dewey_time/attendance_engine/coverage_api.py` | Copy the Khmer fields into the coverage payload. |
| `dewey_time/attendance_engine/enrollment_api.py` | Select + emit the Khmer fields. |
| `dewey_time/attendance_engine/flag_queue_api.py` | Select + emit the Khmer fields. |
| `src/lib/employeeCard.ts` | Add `khmerName()`; delete `stripMiddleName`; rename `employeeShortName` → `employeeDisplayName`. |
| `src/lib/employeeCard.test.ts` | Tests for the above. |
| `src/types/calendar.ts` | `CalendarEmployee` gains the two Khmer fields. |
| `src/lib/scheduleCoverage.ts` | `CoverageEmployee` gains the two Khmer fields. |
| `src/lib/enrollmentReport.ts` | `EnrollmentRow` gains the two Khmer fields. |
| `src/types/flags.ts` | The flag-queue person gains the two Khmer fields. |
| `src/lib/coverageRegister.ts` | `RegisterRow` gains `khmer_name`; the join composes it; `filterRegisterRows` searches it. |
| `src/ui/EmployeePicker.tsx`, `src/ui/ScheduleEmployeePicker.tsx` | Render through `EmployeeIdentity`. |
| `src/ui/schedule-coverage/registerColumns.tsx` | Render through `EmployeeIdentity`. |
| `src/ui/FlagQueueList.tsx`, `src/ui/FlagDecisionPanel.tsx`, `src/ui/schedule-import/PreviewRow.tsx` | Render through `EmployeeIdentity`. |
| `src/ui/App.tsx`, `src/ui/WeeklyScheduleSummary.tsx`, `src/ui/schedule-coverage/registerColumns.tsx` | Follow the `employeeShortName` rename. |
| `e2e/fixtures.ts` | Khmer names on the fixtures, including a no-Khmer and a one-field-only employee, and one flag in the queue. |

---

### Task 1: Install the Khmer custom fields

The two fields were added through the Frappe UI, so they exist on prod and on **no freshly created site**. CI runs `bench new-site`; the sandbox installs the app from scratch. A query selecting them passes locally against a prod restore and fails in CI. The app must own the schema it reads.

**Files:**
- Modify: `dewey_time/setup/custom_fields.py`
- Test: `dewey_time/tests/test_custom_fields.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `custom_khmer_first_name` and `custom_khmer_last_name` on `Employee`, both `Data`. Every later backend task selects them.

- [ ] **Step 1: Write the failing test**

Append to the `TestCustomFields` class in `dewey_time/tests/test_custom_fields.py`:

```python
    def test_employee_khmer_name_fields_are_installed(self):
        # These were added through the Frappe UI, so they exist on prod and on
        # NO freshly created site. CI builds its site with `bench new-site`; a
        # query selecting them would pass locally against a prod restore and
        # fail there. The app has to install what it reads.
        emp = {f["fieldname"]: f for f in cf.CUSTOM_FIELDS["Employee"]}
        self.assertEqual(
            set(emp), {"custom_khmer_first_name", "custom_khmer_last_name"}
        )
        for fieldname in emp:
            self.assertEqual(emp[fieldname]["fieldtype"], "Data")
            # Most of the roster has both; a handful have neither. A required
            # field would make those records unsaveable.
            self.assertNotEqual(emp[fieldname].get("reqd"), 1)
        # Matches the prod docfield export: HR search by these already.
        self.assertEqual(emp["custom_khmer_last_name"]["in_global_search"], 1)
        self.assertEqual(emp["custom_khmer_first_name"]["in_global_search"], 1)
        self.assertEqual(emp["custom_khmer_last_name"]["label"], "Khmer Last Name")
        self.assertEqual(emp["custom_khmer_first_name"]["label"], "Khmer First Name")
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m unittest dewey_time.tests.test_custom_fields -v
```

Expected: FAIL with `KeyError: 'Employee'`.

- [ ] **Step 3: Add the fields**

In `dewey_time/setup/custom_fields.py`, add a new key to `CUSTOM_FIELDS`, before `"Employee Checkin"`:

```python
    # Added on prod through the Frappe UI, so they are absent from every fresh
    # site -- CI's `bench new-site` included. Declared here so the app installs
    # the schema it reads. Positions match the prod export: inside the identity
    # block, between last_name and employee_name.
    "Employee": [
        {"fieldname": "custom_khmer_last_name", "label": "Khmer Last Name",
         "fieldtype": "Data", "insert_after": "last_name", "in_global_search": 1},
        {"fieldname": "custom_khmer_first_name", "label": "Khmer First Name",
         "fieldtype": "Data", "insert_after": "custom_khmer_last_name",
         "in_global_search": 1},
    ],
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
python3 -m unittest dewey_time.tests.test_custom_fields -v
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/setup/custom_fields.py dewey_time/tests/test_custom_fields.py
git commit -m "$(cat <<'EOF'
feat(setup): dewey_time installs the two Khmer name fields it is about to read

They were added on prod through the Frappe UI, so they exist there and on no
freshly created site. CI builds its site with `bench new-site` and the sandbox
installs the app from scratch; a query selecting them would pass locally
against a prod restore and fail in both. create_custom_fields is idempotent,
so this is a no-op against prod.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 2: Scrub the Khmer names in the anonymiser

`_scrub_specs()` scrubs Employee's `employee_name`, `first_name`, `last_name`, both emails, cell number, bank account, passport and DOB — but neither Khmer field. The sandbox engine's baseline scrub covers no Employee fields at all (only User, Contact, Communication, Email Queue, Address and the logs), so nothing else catches them. Every `seed --prod` restore has been carrying real Khmer names into the sandbox in the clear.

**Files:**
- Modify: `dewey_time/utils/anonymize.py`
- Test: `dewey_time/tests/test_anonymize.py`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks call.

- [ ] **Step 1: Write the failing test**

Append to `TestAnonymizeStatements` in `dewey_time/tests/test_anonymize.py`:

```python
    def test_khmer_names_and_telegram_id_are_scrubbed(self):
        # The sandbox engine's baseline scrub covers NO Employee fields -- only
        # User, Contact, Communication, Email Queue, Address and the logs -- so
        # anything PII on Employee is this file's job alone. Both Khmer fields
        # and the Telegram chat id were carried into every prod restore in the
        # clear until this test existed.
        specs = anonymize._scrub_specs()
        employee = next(cols for dt, cols, _ in specs if dt == "Employee")
        for column in ("custom_khmer_first_name", "custom_khmer_last_name",
                       "custom_telegram_chat_id"):
            self.assertIn(column, employee, f"{column} is unscrubbed PII")
        # Deterministic and id-preserving, like first_name -- not NULL, which
        # would make "has a Khmer name" untestable in the sandbox.
        self.assertIn("name", employee["custom_khmer_last_name"])
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m unittest dewey_time.tests.test_anonymize -v
```

Expected: FAIL with `custom_khmer_first_name is unscrubbed PII`.

- [ ] **Step 3: Add the columns to the Employee scrub spec**

In `dewey_time/utils/anonymize.py`, inside the `("Employee", {...})` entry of `_scrub_specs()`, add after the `"last_name": "''"` line:

```python
            # Real Khmer names. Kept as a deterministic, id-derived value rather
            # than blanked, so "this employee has a Khmer name" survives the
            # scrub and the register/picker rendering stays exercisable in the
            # sandbox. The sandbox engine's baseline scrub touches no Employee
            # column, so this file is the only thing standing between a prod
            # restore and real names on a developer's laptop.
            "custom_khmer_last_name": "CONCAT('ខ្មែរ', name)",
            "custom_khmer_first_name": "CONCAT('នាម', name)",
            # Same gap, same reason: a real chat id reaches a real person.
            "custom_telegram_chat_id": "''",
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
python3 -m unittest dewey_time.tests.test_anonymize -v
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/utils/anonymize.py dewey_time/tests/test_anonymize.py
git commit -m "$(cat <<'EOF'
fix(anonymize): scrub the Khmer names and the Telegram chat id

_scrub_specs() covered employee_name, first_name, last_name, both emails, cell
number, bank account, passport and DOB -- but not custom_khmer_first_name,
custom_khmer_last_name or custom_telegram_chat_id. The sandbox engine's
baseline scrub touches no Employee column at all, so nothing else caught them
and every `seed --prod` restore carried real Khmer names in the clear.

Scrubbed to a deterministic id-derived value rather than blanked, so "this
employee has a Khmer name" survives into the sandbox and the rendering stays
exercisable there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 3: The calendar and coverage feeds carry the Khmer fields

`coverage_api._employee_base()` copies keys out of `_list_calendar_employee_rows()`, so these two are one change. The selected-but-not-emitted trap is the risk: this exact file shipped `branch` in the `fields` list and dropped it from the output dict, yielding `None` in production forever.

**Files:**
- Modify: `dewey_time/attendance_engine/hr_calendar.py:345` (fields) and `:408` (output dict)
- Modify: `dewey_time/attendance_engine/coverage_api.py:35-43` (`_EMPLOYEE_FIELDS`)
- Test: `dewey_time/tests/test_coverage_api.py`

**Interfaces:**
- Consumes: the fields installed in Task 1.
- Produces: every calendar-employee row and every coverage payload employee carries `custom_khmer_first_name: str | None` and `custom_khmer_last_name: str | None`.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/tests/test_coverage_api.py`:

```python
    def test_khmer_fields_reach_the_coverage_payload(self):
        # The trap this guards: a field added to the SELECT list and then
        # dropped by the explicit output dict is a production no-op that yields
        # None forever. `branch` shipped exactly that way in hr_calendar.py.
        # Asserting on the emitted payload -- not on the fields list -- is what
        # makes the mapping load-bearing.
        from dewey_time.attendance_engine import coverage_api
        self.assertIn("custom_khmer_first_name", coverage_api._EMPLOYEE_FIELDS)
        self.assertIn("custom_khmer_last_name", coverage_api._EMPLOYEE_FIELDS)
        row = {
            "id": "EMP-1", "employee_name": "Sophea Chan", "department": "Retail",
            "employment_type": "Full-time", "title": "Barista", "image": None,
            "branch": "BRANCH-A",
            "custom_khmer_first_name": "សុភា", "custom_khmer_last_name": "ចាន់",
        }
        base = coverage_api._employee_base(row)
        self.assertEqual(base["custom_khmer_last_name"], "ចាន់")
        self.assertEqual(base["custom_khmer_first_name"], "សុភា")
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m unittest dewey_time.tests.test_coverage_api -v
```

Expected: FAIL with `'custom_khmer_first_name' not found in ('id', 'employee_name', ...)`.

- [ ] **Step 3: Select the fields in the calendar row builder**

In `dewey_time/attendance_engine/hr_calendar.py`, replace the `fields` line in `_list_calendar_employee_rows`:

```python
    fields = ["name", "employee_name", "designation", "department", "company", "image", "branch"]
    # Installed by dewey_time.setup.custom_fields, but a site mid-migration may
    # not have them yet -- and an unknown column makes frappe.get_all raise,
    # taking the whole picker down rather than losing one optional fact.
    for khmer_field in ("custom_khmer_last_name", "custom_khmer_first_name"):
        if frappe.db.has_column("Employee", khmer_field):
            fields.append(khmer_field)
```

- [ ] **Step 4: Emit them from the output dict**

In the same function, inside the `employees.append({...})` literal, add after the `"employee_name": display_name,` line:

```python
                # Emitted, not merely selected. A field in the SELECT list that
                # the output dict drops is a production no-op returning None
                # forever -- which is what `branch` did here until it was caught
                # in review. `.get` because the SELECT above is conditional.
                "custom_khmer_last_name": row.get("custom_khmer_last_name"),
                "custom_khmer_first_name": row.get("custom_khmer_first_name"),
```

- [ ] **Step 5: Copy them into the coverage payload**

In `dewey_time/attendance_engine/coverage_api.py`, add to `_EMPLOYEE_FIELDS` after `"branch",`:

```python
    "custom_khmer_last_name",
    "custom_khmer_first_name",
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
python3 -m unittest dewey_time.tests.test_coverage_api -v
python3 -m unittest discover -s dewey_time/tests -p 'test_*.py' 2>&1 | tail -5
```

Expected: the new test PASSES; the full run reports the same failure count as before your change (record it before you start).

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/hr_calendar.py dewey_time/attendance_engine/coverage_api.py dewey_time/tests/test_coverage_api.py
git commit -m "$(cat <<'EOF'
feat(api): the calendar and coverage feeds carry the Khmer name fields

coverage_api._employee_base copies keys straight out of the calendar row
builder, so both feeds are one change.

Selected behind frappe.db.has_column, because an unknown column makes
get_all raise and would take the whole picker down rather than lose one
optional fact on a site mid-migration. Emitted explicitly from the output
dict and asserted on the emitted payload rather than the fields list: a
field selected and then dropped by the dict is a production no-op that
returns None forever, which is what `branch` did in this same file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 4: The enrollment and flag-queue feeds carry the Khmer fields

Two independent Employee queries, same change as Task 3, same emitted-not-just-selected rule.

**Files:**
- Modify: `dewey_time/attendance_engine/enrollment_api.py:58` (fields) and `:166` (output dict)
- Modify: `dewey_time/attendance_engine/flag_queue_api.py:287` (fields) and `:296` (output dict)
- Test: `dewey_time/tests/test_enrollment_api.py`

**Interfaces:**
- Consumes: the fields installed in Task 1.
- Produces: every enrollment row and every flag-queue person carries `custom_khmer_first_name` and `custom_khmer_last_name`.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/tests/test_enrollment_api.py`:

```python
    def test_enrollment_rows_carry_the_khmer_fields(self):
        from dewey_time.attendance_engine import enrollment_api
        src = open(enrollment_api.__file__, encoding="utf-8").read()
        # Both halves, because either alone is a silent no-op: selected but not
        # emitted returns None forever, emitted but not selected returns None
        # forever. The pair is the only thing that ships a value.
        for field in ("custom_khmer_last_name", "custom_khmer_first_name"):
            self.assertGreaterEqual(
                src.count(field), 2,
                f"{field} must be both selected and emitted in enrollment_api",
            )
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_api -v
```

Expected: FAIL with `custom_khmer_last_name must be both selected and emitted`.

- [ ] **Step 3: Add the fields to the enrollment query and payload**

In `dewey_time/attendance_engine/enrollment_api.py`, replace the field list on line 58:

```python
        fields=["name", "employee_name", "status", "branch", "department", "relieving_date",
                "custom_khmer_last_name", "custom_khmer_first_name"],
```

and add to the row dict around line 166, after `"employee_name": employee.get("employee_name"),`:

```python
                "custom_khmer_last_name": employee.get("custom_khmer_last_name"),
                "custom_khmer_first_name": employee.get("custom_khmer_first_name"),
```

- [ ] **Step 4: Add the fields to the flag-queue query and payload**

In `dewey_time/attendance_engine/flag_queue_api.py`, replace the field list on line 287:

```python
            fields=["name", "employee_name", "branch", "image",
                    "custom_khmer_last_name", "custom_khmer_first_name"],
```

and add to the person dict around line 296, after `"employee_name": row.get("employee_name"),`:

```python
            "custom_khmer_last_name": row.get("custom_khmer_last_name"),
            "custom_khmer_first_name": row.get("custom_khmer_first_name"),
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
python3 -m unittest dewey_time.tests.test_enrollment_api dewey_time.tests.test_flag_queue_api -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/enrollment_api.py dewey_time/attendance_engine/flag_queue_api.py dewey_time/tests/test_enrollment_api.py
git commit -m "$(cat <<'EOF'
feat(api): the enrollment and flag-queue feeds carry the Khmer name fields

Two independent Employee queries, same rule as the calendar feed: both
selected AND emitted. Either half alone returns None forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 5: `khmerName()`, and the end of `stripMiddleName`

The pickers strip the middle name and the tables do not, so the same person already reads two ways. One component means one rule, and it is "show what ERPNext recorded" — truncation shortens, nothing else. `employeeShortName` is renamed because after this it returns the full name and the old name would be a lie of exactly the kind this work exists to remove.

**Files:**
- Modify: `src/lib/employeeCard.ts:12-28` (`stripMiddleName`, `employeeShortName`)
- Modify: `src/lib/employeeCard.test.ts`
- Modify (rename only): `src/ui/App.tsx`, `src/ui/WeeklyScheduleSummary.tsx`, `src/ui/EmployeePicker.tsx`, `src/ui/ScheduleEmployeePicker.tsx`, `src/ui/schedule-coverage/registerColumns.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `khmerName(last: string | null | undefined, first: string | null | undefined): string | null`
  - `employeeDisplayName(employee: CalendarEmployee | null | undefined, fallbackId?: string | null): string` — replaces `employeeShortName`, same signature, no middle-name stripping.
  - `stripMiddleName` no longer exists.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/employeeCard.test.ts`:

```ts
test("khmerName puts the family name first, matching the ADMS convention", () => {
  // `${last} ${first}` — ចាន់ is the family name. The vendored ADMS reference
  // frontend composes it the same way; a reversed order is a different person's
  // name to a Khmer reader, and nothing downstream could tell.
  assert.equal(khmerName("ចាន់", "សុភា"), "ចាន់ សុភា");
});

test("khmerName keeps a half-filled pair rather than discarding it", () => {
  // Neither field is required, so one-of-two is reachable. A partial name is
  // still a name; treating it as absent would hide a fact the record holds.
  assert.equal(khmerName("លី", null), "លី");
  assert.equal(khmerName(null, "វណ្ណា"), "វណ្ណា");
});

test("khmerName is null when there is nothing to show", () => {
  // Whitespace-only is the shape a Frappe Data field takes when someone tabs
  // through it. Rendering it would put an empty `·` separator on the line.
  assert.equal(khmerName(null, null), null);
  assert.equal(khmerName(undefined, undefined), null);
  assert.equal(khmerName("   ", "\t"), null);
  assert.equal(khmerName("  ចាន់  ", "  សុភា "), "ចាន់ សុភា");
});

test("employeeDisplayName shows the name as recorded, middle name and all", () => {
  // The pickers used to strip the middle name and the tables did not, so one
  // person read two ways. A silently shortened name and a visibly truncated one
  // are different claims and only the second admits something was left out.
  const employee = {
    id: "EMP-1", label: "EMP-1 · Ana Maria Cruz", employee_name: "Ana Maria Cruz",
  };
  assert.equal(employeeDisplayName(employee), "Ana Maria Cruz");
});
```

Add `khmerName` and `employeeDisplayName` to the existing import from `@/lib/employeeCard`, and delete every existing test that asserts middle-name stripping (search the file for `stripMiddleName` and for a three-part name assertion).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dewey_time/frontend/hr_attendance
npx tsx --test src/lib/employeeCard.test.ts
```

Expected: FAIL — `khmerName is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/employeeCard.ts`, delete `stripMiddleName` entirely and replace `employeeShortName` with:

```ts
/**
 * The employee's Khmer name, family name first, or null when there is none.
 *
 * `${last} ${first}` — ចាន់ សុភា, where ចាន់ is the family name. That is the
 * order the vendored ADMS reference frontend already uses, and reversing it
 * names a different person to a Khmer reader.
 *
 * Neither ERPNext field is required, so one-of-two is a real shape: a partial
 * name is still a name and is shown. Whitespace-only is not — that is what a
 * Data field holds after someone tabs through it, and rendering it would put a
 * bare `·` separator on the line with nothing after it.
 */
export function khmerName(
  last: string | null | undefined,
  first: string | null | undefined,
): string | null {
  const parts = [last, first].map((part) => (part ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/**
 * The employee's name exactly as ERPNext records it.
 *
 * Was `employeeShortName`, and it used to run `stripMiddleName`. The pickers
 * stripped and the tables did not, so one person read two ways depending on
 * where you were standing. One shared identity component means one rule, and
 * this is it: show what is recorded and let truncation do any shortening. A
 * silently shortened name and a visibly truncated one are different claims,
 * and only the second one admits that something was left out.
 */
export function employeeDisplayName(
  employee: CalendarEmployee | null | undefined,
  fallbackId?: string | null,
): string {
  if (!employee) return fallbackId ?? "Select employee";
  return (
    employee.employee_name?.trim() ||
    employee.label.split("·").pop()?.trim() ||
    employee.id
  );
}
```

Update `employeeInitials` to call `employeeDisplayName`, and delete the `stripMiddleName` sentence from its comment.

- [ ] **Step 4: Follow the rename at every call site**

```bash
cd dewey_time/frontend/hr_attendance
grep -rln "employeeShortName" src | xargs sed -i '' 's/employeeShortName/employeeDisplayName/g'
npx tsc --noEmit
```

Expected: `tsc` clean.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test:web 2>&1 | tail -8
```

Expected: PASS, `fail 0`. Record the test count — it must be higher than 944.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/employeeCard.ts src/lib/employeeCard.test.ts src/ui
git commit -m "$(cat <<'EOF'
refactor(identity): add khmerName(), and stop stripping middle names

The pickers ran stripMiddleName and the tables did not, so the same person
already read two ways depending on which surface you were on. One shared
identity component means one rule: show the name ERPNext recorded and let
truncation do any shortening. A silently shortened name and a visibly
truncated one are different claims, and only the second admits that
something was left out.

employeeShortName is renamed to employeeDisplayName because after this it
returns the full name, and a helper whose name misdescribes it is exactly
the drift this work exists to remove. stripMiddleName and its tests are
deleted rather than left orphaned.

khmerName composes the two ERPNext fields family-name-first, keeps a
half-filled pair, and returns null for whitespace-only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 6: The `EmployeeIdentity` component

Presentational and hook-free, so it renders under `renderToStaticMarkup` — the same constraint `AlertDot`, `FacetOptions` and `RegisterFilterBar` are built to.

**Deliberate refinement of the spec:** the spec proposed `avatar?: { image, size } | "none"`. This takes `avatar?: ReactNode` instead. The surfaces genuinely differ in how they wrap the avatar for accessibility — the register wraps it in an `aria-hidden` `display:contents` span, the flag queue uses `DecorativeAvatars` — and a shape-typed prop would have to reproduce all of that. A slot keeps `EmployeeIdentity` from needing to know anything about avatars.

**Files:**
- Create: `src/ui/EmployeeIdentity.tsx`
- Test: `src/ui/employeeIdentity.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type TailFact = { label: string; tone?: "normal" | "warning" };
  export type EmployeeIdentityProps = {
    englishName: string;
    employeeId: string;
    khmerName: string | null;   // REQUIRED — a call site cannot forget it
    avatar?: ReactNode;
    tail?: TailFact[];
    className?: string;
    nameClassName?: string;
  };
  export function EmployeeIdentity(props: EmployeeIdentityProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/ui/employeeIdentity.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EmployeeIdentity } from "@/ui/EmployeeIdentity";

const BASE = { englishName: "Sophea Chan", employeeId: "EMP-0088", khmerName: "ចាន់ សុភា" };

test("line one is the English name then the Khmer name, in that order", () => {
  // The order is the whole contract. A component that renders both but puts
  // the Khmer first is a different design and would pass any "contains" check.
  const html = renderToStaticMarkup(<EmployeeIdentity {...BASE} />);
  assert.ok(html.indexOf("Sophea Chan") < html.indexOf("ចាន់ សុភា"), "English leads");
  assert.ok(html.indexOf("ចាន់ សុភា") < html.indexOf("EMP-0088"), "ID is on line two");
});

test("the Khmer name is present in the markup even where it will be hidden", () => {
  // It is dropped by a container query, not by React. The element must exist so
  // the query has something to hide -- and so a wide surface shows it without a
  // second render path.
  assert.match(renderToStaticMarkup(<EmployeeIdentity {...BASE} />), /ចាន់ សុភា/);
});

test("no Khmer name renders no separator", () => {
  // A bare middot with nothing after it reads as a rendering fault.
  const html = renderToStaticMarkup(<EmployeeIdentity {...BASE} khmerName={null} />);
  assert.doesNotMatch(html, /·/, "no separator without a second name");
  assert.match(html, /Sophea Chan/);
  assert.match(html, /EMP-0088/);
});

test("the Khmer name never carries a smaller font size than the English name", () => {
  // Measured: at 11px the subscript consonants in ណ្ណ compress into each other
  // and at 10px they are illegible. Khmer wants to be equal to or larger than
  // Latin at the same nominal size, never smaller. This is the assertion that
  // stops a future "just shrink it to fit".
  const html = renderToStaticMarkup(<EmployeeIdentity {...BASE} />);
  assert.doesNotMatch(html, /text-(xs|\[1[0-3]px\])[^"]*ចាន់/);
  assert.doesNotMatch(html, /ចាន់[^<]*<\/span>[^<]*text-xs/);
});

test("tail facts render in the order the caller gave them", () => {
  // The caller's order is load-bearing: the Weekly Schedule wizard puts
  // employment type first because isWeeklyScheduleEligible gates on it, and a
  // component that re-sorted would eventually drop the one fact that matters.
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} tail={[{ label: "Full-time" }, { label: "Retail" }]} />,
  );
  assert.ok(html.indexOf("Full-time") < html.indexOf("Retail"));
});

test("a warning-toned fact is visually distinct, not just differently worded", () => {
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} tail={[{ label: "No employment type", tone: "warning" }]} />,
  );
  assert.match(html, /text-amber-|text-brand-accent/);
});

test("the avatar slot renders whatever the caller passed, outside the query container", () => {
  // Outside, because the avatar's footprint differs by surface (36+10 register,
  // 32+8 picker row, 40+12 trigger) and one threshold measured across the whole
  // box would mean three different text budgets.
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} avatar={<i data-slot="test-avatar" />} />,
  );
  const avatarAt = html.indexOf("test-avatar");
  const containerAt = html.indexOf("@container");
  assert.ok(avatarAt >= 0, "the slot renders");
  assert.ok(avatarAt < containerAt, "the avatar precedes the query container");
});

test("no avatar prop renders no avatar box", () => {
  assert.doesNotMatch(renderToStaticMarkup(<EmployeeIdentity {...BASE} />), /test-avatar/);
});

test("the container query is on the text stack and carries the agreed thresholds", () => {
  // A class-string assertion cannot prove geometry -- e2e does that -- but it
  // can prove the thresholds did not drift from the spec by an edit nobody
  // measured. 200 for the Khmer name, 120/170/230 for the caller's facts.
  const html = renderToStaticMarkup(
    <EmployeeIdentity {...BASE} tail={[{ label: "a" }, { label: "b" }, { label: "c" }]} />,
  );
  assert.match(html, /@container/);
  assert.match(html, /@min-\[200px\]:/);
  assert.match(html, /@min-\[120px\]:/);
  assert.match(html, /@min-\[170px\]:/);
  assert.match(html, /@min-\[230px\]:/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance
npx tsx --test src/ui/employeeIdentity.test.tsx
```

Expected: FAIL — cannot resolve `@/ui/EmployeeIdentity`.

- [ ] **Step 3: Implement the component**

Create `src/ui/EmployeeIdentity.tsx`:

```tsx
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** One fact the calling surface wants beside the ID, in the order it wants them. */
export type TailFact = { label: string; tone?: "normal" | "warning" };

export type EmployeeIdentityProps = {
  /** `employee_name` as ERPNext records it. Never shortened here. */
  englishName: string;
  employeeId: string;
  /**
   * Composed by `khmerName()`, never the two raw fields.
   *
   * REQUIRED, deliberately. Seven surfaces render a person and they drifted
   * apart once already; a required prop is the only thing that makes every one
   * of them decide rather than quietly omit.
   */
  khmerName: string | null;
  /**
   * A slot, not a shape.
   *
   * The surfaces wrap their avatars differently for accessibility — the
   * register in an `aria-hidden` `display:contents` span, the flag queue in
   * `DecorativeAvatars` — and a shape-typed prop would have to reproduce all of
   * it. It sits OUTSIDE the query container: the avatar's footprint differs by
   * surface (36+10 in the register, 32+8 in a picker row, 40+12 in the
   * trigger), so one threshold measured across the whole box would mean three
   * different text budgets.
   *
   * Never space-driven. A surface decides once whether it has an avatar and the
   * ladder never takes it away — a decoration that vanishes and returns as you
   * resize reads as a rendering fault.
   */
  avatar?: ReactNode;
  tail?: TailFact[];
  className?: string;
  nameClassName?: string;
};

/**
 * One person, two lines, on every surface that draws one.
 *
 * Line one is the English name, then `·` and the Khmer name when the box can
 * fit both whole. Line two is the employee ID, then the caller's facts. Never a
 * third line, and the order never changes with width — the only thing space
 * decides is how far along each line it gets.
 *
 * Adapts by CONTAINER query on its own text stack, not by viewport. The
 * register's Employee cell is 139px at a 1280 viewport and 90px at 375, while a
 * picker row at that same 375 is 168px; a media query cannot tell those apart.
 *
 * Every threshold below is a measured worst case, not a guess: `Sovannary Heng
 * · ហេង សុវណ្ណារី` needs 194px at 14px semibold, so the Khmer name turns on at
 * 200. When it will not fit it is NOT RENDERED rather than shrunk or truncated
 * — shrinking would need 3px for that name, and Khmer has no inter-word spaces
 * so an ellipsis lands mid-cluster. Because a container query hides the
 * element, no ellipsis ever appears.
 *
 * Hook-free on purpose, so `renderToStaticMarkup` can reach it — the same
 * constraint AlertDot and FacetOptions are built to.
 */
export function EmployeeIdentity(props: EmployeeIdentityProps) {
  const tail = props.tail ?? [];

  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", props.className)}>
      {props.avatar}

      {/* The query container. `min-w-0` so flex can shrink it below its content,
          and `flex-1` so it takes the width the row has left — which is exactly
          the width the thresholds were measured against. */}
      <div className="@container min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-semibold leading-tight",
            props.nameClassName,
          )}
        >
          {props.englishName}
          {props.khmerName ? (
            // One span for separator and name together, so hiding it cannot
            // leave a bare middot behind. Same font-size and weight as the
            // English name: measured, Khmer at 14px sits inside the same line
            // box as Latin at 14px, so this costs no row height — and at 11px
            // its stacked subscripts start compressing into each other.
            <span className="hidden @min-[200px]:inline">
              <span className="mx-1.5 font-normal opacity-40">·</span>
              <span className="font-khmer">{props.khmerName}</span>
            </span>
          ) : null}
        </span>

        <span className="block truncate text-xs leading-tight text-muted-foreground">
          <span className="tabular-nums">{props.employeeId}</span>
          {tail.map((fact, index) => (
            <span
              key={`${fact.label}-${index}`}
              className={cn(
                "hidden",
                TAIL_VISIBILITY[index] ?? "@min-[230px]:inline",
                fact.tone === "warning" && "text-brand-accent",
              )}
            >
              <span className="mx-1 opacity-40">·</span>
              {fact.label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/**
 * When each caller fact earns its place, by measured worst case.
 *
 * 110px for the ID plus one fact, 158px for two, 206px for three — rounded up
 * to 120 / 170 / 230. A fourth and beyond share the third's threshold: by then
 * the surface is wide enough that one more short fact is not what breaks it,
 * and no caller currently declares more than three.
 *
 * Written as whole class strings rather than composed, because Tailwind scans
 * source text: `@min-[${n}px]:inline` produces no CSS at all.
 */
const TAIL_VISIBILITY = [
  "@min-[120px]:inline",
  "@min-[170px]:inline",
  "@min-[230px]:inline",
];
```

- [ ] **Step 4: Add the Khmer font utility**

Tailwind has no `font-khmer` by default. In `src/brand/tokens.css`, add inside the `@theme` block:

```css
  /* Kantumruy Pro's Khmer subset already ships in the bundle — dewey-ui supplies
     the face and check-fonts.mjs emits it. Nothing rendered Khmer until now, so
     nothing referenced it. Latin fallback first is deliberate: a Khmer name is
     Khmer script only, and any Latin that lands here should match the rest. */
  --font-khmer: "Kantumruy Pro", "Khmer MN", ui-sans-serif, sans-serif;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx tsc --noEmit && npx tsx --test src/ui/employeeIdentity.test.tsx
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Prove the container CSS is actually emitted**

A class string is not CSS. Tailwind v4 must have scanned and emitted the container rules, or every threshold is a silent no-op.

```bash
npm run build >/dev/null 2>&1
grep -c "container-type" ../../public/hr_attendance/assets/index.css
grep -o "@container (min-width: [0-9]*px)" ../../public/hr_attendance/assets/index.css | sort -u
```

Expected: `container-type` count ≥ 1, and exactly these four rules printed: `200px`, `120px`, `170px`, `230px`. If any is missing, the class string is wrong — fix it before moving on.

- [ ] **Step 7: Commit**

```bash
git add src/ui/EmployeeIdentity.tsx src/ui/employeeIdentity.test.tsx src/brand/tokens.css
git commit -m "$(cat <<'EOF'
feat(identity): EmployeeIdentity — two lines, Khmer name where it fits

Line one is the English name, then the Khmer name when the box can fit both
whole; line two is the employee ID then the caller's declared facts. Never a
third line, and the order never changes with width.

Adapts by container query on its own text stack rather than by viewport: the
register's Employee cell is 139px at a 1280 viewport and 90px at 375, while a
picker row at that same 375 is 168px, and a media query cannot tell those
apart. The avatar is a slot outside the container, because its footprint
differs by surface and one threshold across the whole box would mean three
different text budgets.

Thresholds are measured worst cases -- 194px for the widest name pair, so the
Khmer turns on at 200. Where it does not fit it is not rendered, rather than
shrunk (it would need 3px) or truncated (Khmer has no inter-word spaces, so an
ellipsis lands mid-cluster).

khmerName is a REQUIRED prop: seven surfaces drifted apart once already, and a
required prop is the only thing that makes each one decide rather than omit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 7: Types carry the Khmer fields to the frontend

Four payload types and one domain type. `RegisterRow` gets the *composed* name because the register's join is already a normalisation boundary and every consumer of a register row wants one string.

**Files:**
- Modify: `src/types/calendar.ts:124-146` (`CalendarEmployee`)
- Modify: `src/lib/scheduleCoverage.ts:10-18` (`CoverageEmployee`)
- Modify: `src/lib/enrollmentReport.ts` (`EnrollmentRow`)
- Modify: `src/types/flags.ts:55-70` (the flag-queue person)
- Modify: `src/lib/coverageRegister.ts:21-60` (`RegisterRow`), `:128-160` (the join)
- Test: `src/lib/coverageRegister.test.ts`

**Interfaces:**
- Consumes: `khmerName()` from Task 5.
- Produces: `RegisterRow.khmer_name: string | null`; the other four types carry `custom_khmer_last_name?: string | null` and `custom_khmer_first_name?: string | null`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/coverageRegister.test.ts`:

```ts
test("the join composes the Khmer name once, family name first", () => {
  // Composed at the join rather than at each cell: the register, the CSV and
  // the search all read one row, and three call sites composing separately is
  // how the surfaces drifted the first time.
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Sophea Chan", department: "Retail",
                   branch: "DIU", weekly_minutes: 2400,
                   custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា" }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment(),
  );
  assert.equal(rows[0].khmer_name, "ចាន់ សុភា");
});

test("an employee with no Khmer name gets null, not an empty string", () => {
  // Empty string is truthy enough to render a bare separator; null is the one
  // value every consumer here already treats as "no fact".
  const rows = joinRegisterRows(
    coverage({
      unassigned: [{ id: "E2", employee_name: "Derek Hale", department: "Ops", branch: "DIU" }],
      counts: { active: 1, unassigned: 1, assigned: 0, truncated: false },
    }),
    enrollment(),
  );
  assert.equal(rows[0].khmer_name, null);
});

test("the enrolment feed can supply a Khmer name for a row coverage never returned", () => {
  // A leaver still holding a template exists in the enrolment feed alone --
  // the security finding the register exists for. Their Khmer name has to come
  // from that side or the row shows less than the roster knows.
  const rows = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [{ id: "E9", employee_name: "Vanna Ly", branch: "PM", department: "Teaching",
               status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
               fingerprint_count: 1, face_count: 0, days_since_relieving: 12,
               custom_khmer_last_name: "លី", custom_khmer_first_name: null }],
    }),
  );
  assert.equal(rows[0].khmer_name, "លី");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance
npx tsx --test src/lib/coverageRegister.test.ts
```

Expected: FAIL — `khmer_name` is not a property of `RegisterRow`.

- [ ] **Step 3: Add the wire fields to the four payload types**

Add this pair of properties to `CalendarEmployee` (`src/types/calendar.ts`), `CoverageEmployee` (`src/lib/scheduleCoverage.ts`), `EnrollmentRow` (`src/lib/enrollmentReport.ts`) and the flag-queue person type (`src/types/flags.ts`):

```ts
  /**
   * ERPNext `Employee.custom_khmer_last_name` / `custom_khmer_first_name`.
   *
   * Raw and unordered on the wire; compose with `khmerName()` before display,
   * which puts the family name first. Optional because a site mid-migration may
   * not have the columns yet — the backend selects them behind a
   * `has_column` check.
   */
  custom_khmer_last_name?: string | null;
  custom_khmer_first_name?: string | null;
```

- [ ] **Step 4: Add the composed name to `RegisterRow` and the join**

In `src/lib/coverageRegister.ts`, add to the `RegisterRow` type after `employee_name`:

```ts
  /**
   * Composed by `khmerName()` at the join, not at each cell.
   *
   * The table, the CSV and the search all read one row; three call sites
   * composing separately is how these surfaces drifted apart the first time.
   */
  khmer_name: string | null;
```

In the `seed` function inside `joinRegisterRows`, after `employee_name: emp.employee_name || emp.id,`:

```ts
      khmer_name: khmerName(emp.custom_khmer_last_name, emp.custom_khmer_first_name),
```

and in the enrolment merge, where a row is created for an employee coverage did not return, add the same line reading from the enrolment row. Where a row already exists from coverage, fill it only if it is still `null`:

```ts
      // Coverage wins when both feeds carry it, on the same precedence as
      // `branch`. The enrolment feed fills the gap for a leaver coverage
      // never returned -- the security finding this page exists for.
      if (existing.khmer_name === null) {
        existing.khmer_name = khmerName(row.custom_khmer_last_name, row.custom_khmer_first_name);
      }
```

Import `khmerName` from `@/lib/employeeCard` at the top of the file.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx tsc --noEmit && npm run test:web 2>&1 | tail -8
```

Expected: `tsc` clean, `fail 0`, count higher than after Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/types src/lib
git commit -m "$(cat <<'EOF'
feat(identity): the four payload types carry the Khmer fields, RegisterRow the composed name

Raw and unordered on the wire; composed once at the register's join, which is
already a normalisation boundary. The table, the CSV and the search all read
one row -- three call sites composing separately is how these surfaces drifted
apart the first time.

Coverage wins when both feeds carry a Khmer name, on the same precedence as
branch, and the enrolment feed fills the gap for a leaver coverage never
returned.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 8: The two pickers render through `EmployeeIdentity`

Three hand-built subtitle strings become three `tail` declarations. `ScheduleEmployeePicker` puts employment type **first** because `isWeeklyScheduleEligible` gates the wizard on it — that fact tells the reader whether the person can be picked at all, and it must never be the one that falls off.

**Files:**
- Modify: `src/ui/EmployeePicker.tsx` (trigger, read-only branch, `EmployeeOption`)
- Modify: `src/ui/ScheduleEmployeePicker.tsx` (trigger and list row)
- Test: `src/ui/EmployeePicker.test.tsx`

**Interfaces:**
- Consumes: `EmployeeIdentity`, `TailFact` (Task 6); `khmerName`, `employeeDisplayName` (Task 5).
- Produces: nothing later tasks call.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/EmployeePicker.test.tsx`:

```tsx
test("the picker option shows the Khmer name and the employee id", () => {
  const html = renderToStaticMarkup(
    <EmployeeOption
      employee={{
        id: "EMP-0088", label: "EMP-0088 · Sophea Chan", employee_name: "Sophea Chan",
        department: "Retail", title: "Barista",
        custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា",
      }}
      selected={false}
      onSelect={() => {}}
    />,
  );
  assert.match(html, /ចាន់ សុភា/, "the Khmer name reaches the option");
  assert.match(html, /EMP-0088/);
  assert.ok(html.indexOf("Sophea Chan") < html.indexOf("ចាន់ សុភា"), "English leads");
});

test("the weekly-schedule picker puts employment type ahead of department", () => {
  // isWeeklyScheduleEligible gates the wizard on employment type, so it is the
  // fact that says whether this person can be picked at all. Under a shared
  // global priority it would eventually be the one that fell off the end.
  const html = renderToStaticMarkup(
    <ScheduleEmployeeOption
      employee={{
        id: "EMP-1", label: "EMP-1 · Jonas Berg", employee_name: "Jonas Berg",
        department: "Warehouse", employment_type: "Full-time",
        custom_khmer_last_name: null, custom_khmer_first_name: null,
      }}
      selected={false}
      onSelect={() => {}}
    />,
  );
  assert.ok(html.indexOf("Full-time") < html.indexOf("Warehouse"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test src/ui/EmployeePicker.test.tsx
```

Expected: FAIL — no Khmer name in the markup.

- [ ] **Step 3: Rewrite `EmployeeOption`**

In `src/ui/EmployeePicker.tsx`, replace the body of `EmployeeOption`'s `CommandItem` children with:

```tsx
      <EmployeeIdentity
        englishName={employeeDisplayName(employee, employee.id)}
        employeeId={employee.id}
        khmerName={khmerName(employee.custom_khmer_last_name, employee.custom_khmer_first_name)}
        avatar={
          <EmployeeAvatar employee={employee} fallbackId={employee.id} className="size-8" />
        }
        // Department first: between two people with one name, where they work
        // separates them more often than what they are called.
        tail={[
          employee.department ? { label: employee.department } : null,
          employee.title ? { label: employee.title } : null,
        ].filter((fact): fact is TailFact => fact !== null)}
      />
```

Apply the same shape to the picker trigger and the read-only branch, with `className="size-10"` on the avatar. Delete `employeePickerSubtitle` from `src/lib/employeeCard.ts` and its tests — the tail replaces it.

- [ ] **Step 4: Rewrite `ScheduleEmployeePicker`**

Extract the list row into an exported `ScheduleEmployeeOption` (so the test above can reach it — Radix portals server-render to `null`, so anything left inline inside `PopoverContent` never reaches the markup), and give it:

```tsx
        tail={[
          // Employment type FIRST: isWeeklyScheduleEligible gates this wizard on
          // it, so it is the fact that says whether this person can be picked at
          // all. It must never be the one that falls off the end.
          { label: scheduleEmployeeSubtitle(employee),
            tone: isWeeklyScheduleEligible(employee.employment_type) ? "normal" : "warning" },
          employee.department ? { label: employee.department } : null,
        ].filter((fact): fact is TailFact => fact !== null)}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx tsc --noEmit && npm run test:web 2>&1 | tail -8
```

Expected: `tsc` clean, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/EmployeePicker.tsx src/ui/ScheduleEmployeePicker.tsx src/ui/EmployeePicker.test.tsx src/lib/employeeCard.ts src/lib/employeeCard.test.ts
git commit -m "$(cat <<'EOF'
feat(identity): both pickers render through EmployeeIdentity

Three hand-built subtitle strings become three tail declarations, so any
difference left between the surfaces is one they declared rather than one they
drifted into. employeePickerSubtitle is deleted with its tests.

ScheduleEmployeePicker declares employment type FIRST: isWeeklyScheduleEligible
gates the wizard on it, so it is the fact that says whether a person can be
picked at all, and under one global priority list it would eventually be the
one that fell off.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 9: The register, flag queue, decision panel and import preview

Four remaining surfaces. The register declares an **empty tail** — Branch, Dept and Status are its own columns — and keeps its `aria-hidden` avatar wrapper, so it will not show a Khmer name at either viewport. That is the accepted trade recorded in the spec, not an oversight.

**Files:**
- Modify: `src/ui/schedule-coverage/registerColumns.tsx:150-190`
- Modify: `src/ui/FlagQueueList.tsx:410-440`
- Modify: `src/ui/FlagDecisionPanel.tsx:149`
- Modify: `src/ui/schedule-import/PreviewRow.tsx:60-70`
- Test: `src/ui/coverageRegister.test.tsx`, `src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Consumes: `EmployeeIdentity` (Task 6), `RegisterRow.khmer_name` (Task 7).
- Produces: nothing later tasks call.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/coverageRegister.test.tsx`:

```tsx
test("the register's employee cell carries the Khmer name in the markup", () => {
  // Present in the DOM but hidden by the container query at the register's
  // 139px and 90px stacks -- e2e proves the hiding. This proves the cell is
  // not the thing that dropped it, so widening the column later is enough.
  const { html } = renderRegisterCell({ ...BASE_ROW, khmer_name: "ចាន់ សុភា" });
  assert.match(html, /ចាន់ សុភា/);
  assert.match(html, /data-slot="employee-name"/, "the e2e hook survives");
});

test("the register declares an empty tail — Branch and Dept are its own columns", () => {
  // A tail here would print facts the table already has in dedicated, sortable
  // columns, and eat the width the ID needs.
  const { html } = renderRegisterCell({ ...BASE_ROW, department: "Retail", branch: "DIU" });
  const cell = html.slice(0, html.indexOf("</td>") + 5);
  assert.doesNotMatch(cell, /Retail/, "department belongs to its own column");
});
```

Use the existing `registerColumns` render harness in that file for `renderRegisterCell`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test src/ui/coverageRegister.test.tsx
```

Expected: FAIL — no Khmer name in the markup.

- [ ] **Step 3: Rewrite the register's employee cell**

In `src/ui/schedule-coverage/registerColumns.tsx`, replace the cell body with:

```tsx
        <EmployeeIdentity
          englishName={row.original.employee_name}
          employeeId={row.original.id}
          khmerName={row.original.khmer_name}
          // The avatar keeps its aria-hidden `contents` wrapper: the cell says
          // everything the photo does in words, the photo is alt="", and
          // EmployeeAvatar's loading ring is a role="status" live region whose
          // timer starts at mount -- a page of rows would queue a page of
          // "Loading" announcements for decoration.
          avatar={
            <span aria-hidden="true" className="contents">
              <EmployeeAvatar
                employee={avatarEmployee(row.original)}
                fallbackId={row.original.id}
                className="size-9"
              />
            </span>
          }
          // No tail. Branch, Dept and Status are the register's own columns.
          nameClassName="font-medium"
        />
```

Keep the `data-slot="employee-name"` hook by passing it through — add `nameSlot` handling if needed, or wrap the English name span. The e2e suite reads that hook and must not lose it.

- [ ] **Step 4: Rewrite the other three surfaces**

`FlagQueueList` — replace the name span, keeping the `DecorativeAvatars` wrapper and the `crossReference` badge as a sibling of `EmployeeIdentity`, and add the Khmer name to the `RowButton` `label` array right after `person.employee_name` so a screen reader hears both.

`FlagDecisionPanel:149` — replace the bare `<div>{person.employee_name}</div>` with `EmployeeIdentity`, no avatar, tail `[department, title]`.

`PreviewRow` — replace `{row.employee_name ?? row.id_card ?? "—"}` with `EmployeeIdentity` where `englishName` keeps that same fallback chain, no avatar, empty tail.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx tsc --noEmit && npm run test:web 2>&1 | tail -8
```

Expected: `tsc` clean, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/ui
git commit -m "$(cat <<'EOF'
feat(identity): the register, flag queue, decision panel and import preview

All seven surfaces now render one person through one component. The register
declares an empty tail -- Branch, Dept and Status are its own sortable columns
-- and keeps its aria-hidden avatar wrapper, so it does not show a Khmer name
at either viewport. That is the trade the spec recorded, not an oversight: the
Khmer name is in the markup, and widening the column later is all it would
take.

The flag queue's accessible row label gains the Khmer name beside the English
one, so a screen reader hears what a sighted reader sees.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 10: Khmer names are searchable

Both fields are `in_global_search` in ERPNext, so HR already expects to find people by them. Khmer has no inter-word spaces, so `សុភា` must match `ចាន់ សុភា` with no token boundary the Latin path would recognise.

**Files:**
- Modify: `src/lib/employeeCard.ts` (`employeeSearchHaystack`)
- Modify: `src/lib/coverageRegister.ts` (`filterRegisterRows`)
- Test: `src/lib/employeeCard.test.ts`, `src/lib/coverageRegister.test.ts`

**Interfaces:**
- Consumes: `khmerName()` (Task 5), `RegisterRow.khmer_name` (Task 7).
- Produces: nothing later tasks call.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/employeeCard.test.ts`:

```ts
test("the picker haystack includes the Khmer name", () => {
  const haystack = employeeSearchHaystack({
    id: "EMP-1", label: "EMP-1 · Sophea Chan", employee_name: "Sophea Chan",
    custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា",
  });
  assert.match(haystack, /ចាន់ សុភា/);
});

test("a Khmer query matches inside a name with no word boundary", () => {
  // Khmer has no inter-word spaces. `សុភា` is the given name inside
  // `ចាន់ សុភា`, and no boundary-aware matcher would find it. This test fails
  // if someone "optimises" employeeCommandFilter into a word-boundary match.
  assert.equal(employeeCommandFilter("ចាន់ សុភា EMP-1", "សុភា"), 1);
  assert.equal(employeeCommandFilter("ចាន់ សុភា EMP-1", "ដារា"), 0);
});
```

Append to `src/lib/coverageRegister.test.ts`:

```ts
test("the register's search matches a Khmer name", () => {
  const rows = [
    { ...BASE_ROW, id: "E1", employee_name: "Sophea Chan", khmer_name: "ចាន់ សុភា" },
    { ...BASE_ROW, id: "E2", employee_name: "Dara Sok", khmer_name: "សុខ ដារា" },
  ];
  assert.deepEqual(filterRegisterRows(rows, { search: "សុភា" }).map((r) => r.id), ["E1"]);
  // And the English path is untouched.
  assert.deepEqual(filterRegisterRows(rows, { search: "dara" }).map((r) => r.id), ["E2"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx tsx --test src/lib/employeeCard.test.ts src/lib/coverageRegister.test.ts
```

Expected: FAIL on both new tests.

- [ ] **Step 3: Add the Khmer name to both search paths**

In `employeeSearchHaystack`, add to the array:

```ts
    // ERPNext marks both Khmer fields in_global_search, so HR already expects
    // to find people by them.
    khmerName(employee.custom_khmer_last_name, employee.custom_khmer_first_name),
```

In `filterRegisterRows`, change the needle test:

```ts
    // The Khmer name joins the haystack rather than getting its own branch:
    // one `includes` over one string is what makes a query of `សុភា` match
    // inside `ចាន់ សុភា`, where Khmer's lack of inter-word spaces means there
    // is no token boundary to anchor to.
    if (needle && !`${row.employee_name} ${row.id} ${row.khmer_name ?? ""}`
      .toLowerCase().includes(needle)) return false;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx tsc --noEmit && npm run test:web 2>&1 | tail -8
```

Expected: `tsc` clean, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib
git commit -m "$(cat <<'EOF'
feat(identity): Khmer names are searchable in the picker and the register

Both ERPNext fields are in_global_search, so HR already expects to find people
by them. Added to the one haystack string each path already builds rather than
as a separate branch: Khmer has no inter-word spaces, so a query of សុភា has to
match inside ចាន់ សុភា with no token boundary to anchor on, and a substring
test over one string is the thing that does that.

Pinned with a test that fails if employeeCommandFilter is ever "optimised"
into a word-boundary match.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

### Task 11: Geometric proof, fixtures, and the bundle

No unit test can see a container query. This is the task that proves the thresholds are real, that nothing clips, and that the font under measurement is the shipped one.

**Files:**
- Modify: `e2e/fixtures.ts`
- Create: `e2e/employee-identity.spec.ts`
- Modify (built output): `dewey_time/public/**`, `dewey_time/www/*.html`

**Interfaces:**
- Consumes: everything above.
- Produces: the deployable bundle.

- [ ] **Step 1: Add Khmer names to the fixtures**

In `e2e/fixtures.ts`, add `custom_khmer_last_name` / `custom_khmer_first_name` to the coverage and enrollment employees. Cover four shapes deliberately:

```ts
// Longest pair measured — 194px on one line at 14px semibold, the case every
// threshold was set from.
{ id: "EMP-002", /* Aaron Wells */ custom_khmer_last_name: "ហេង", custom_khmer_first_name: "សុវណ្ណារី" },
// Typical pair.
{ id: "EMP-001", /* Jane Doe */ custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា" },
// One field only — rare, but neither field is required.
{ id: "EMP-104", /* Marco Diaz */ custom_khmer_last_name: "លី", custom_khmer_first_name: null },
// None at all — the handful. Must not look broken.
{ id: "EMP-005", /* Derek Hale */ custom_khmer_last_name: null, custom_khmer_first_name: null },
```

Also seed **one flag** into the flag-queue fixture. The queue currently renders "Nothing needs a decision", so its row has never been measured by anything.

- [ ] **Step 2: Write the failing e2e spec**

Create `e2e/employee-identity.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/**
 * The identity block, in a browser.
 *
 * Everything about the composition is pure and covered by node:test. What that
 * suite cannot see is a CONTAINER QUERY: a threshold that never matches, one
 * that drifted, or a Tailwind class string that emitted no CSS at all are all
 * invisible to renderToStaticMarkup, which reports the markup and not the box.
 */

/** The measured worst case — 194px on one line at 14px semibold. */
const LONGEST_KHMER = "ហេង សុវណ្ណារី";

/**
 * Kantumruy Pro's Khmer subset, confirmed loaded.
 *
 * Two measurement passes during design were wrong because it had not loaded and
 * every number came from a fallback font. A geometric test that measures the
 * wrong font is a test that cannot fail correctly, so this is a precondition
 * rather than a convenience.
 */
async function khmerFontLoaded(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 14px "Kantumruy Pro"', "ចាន់");
  });
}

/** Every identity stack on the page, with its width and what it is showing. */
async function stacks(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".\\@container")].map((el) => {
      const lines = [...el.children] as HTMLElement[];
      return {
        width: Math.round(el.getBoundingClientRect().width),
        showsKhmer: /[ក-៿]/.test(
          lines[0]?.innerText ?? "",
        ),
        clipped: lines
          .filter((l) => l.scrollWidth > l.clientWidth + 1)
          .map((l) => l.innerText.trim().slice(0, 24)),
        height: Math.round(el.getBoundingClientRect().height),
      };
    }),
  );
}

test("the Khmer subset font is loaded, or nothing below means anything", async ({ page }) => {
  await stubFrappe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-attendance");
  await expect(page.locator(".\\@container").first()).toBeVisible();
  expect(await khmerFontLoaded(page)).toBe(true);
});

test("no identity line is ever clipped, at any surface or width", async ({ page }) => {
  // The assertion that would have caught both rejected alternatives: a Khmer
  // name shrunk to 3px, and an ellipsis landing mid-cluster.
  await stubFrappe(page);
  for (const width of [1280, 768, 412, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/hr-attendance", "/hr-schedule/coverage", "/hr-flags"]) {
      await page.goto(route);
      await expect(page.locator(".\\@container").first()).toBeVisible();
      const found = await stacks(page);
      expect(found.length, `${route} @${width}: no identity blocks found`).toBeGreaterThan(0);
      for (const s of found) {
        expect(s.clipped, `${route} @${width}: clipped at stack ${s.width}px`).toEqual([]);
      }
    }
  }
});

test("the Khmer name appears above 200px of stack and not below it", async ({ page }) => {
  // The threshold, measured rather than read off a class string. Tailwind can
  // emit no CSS for a malformed arbitrary variant and the markup looks correct.
  await stubFrappe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-schedule/coverage");
  await expect(page.locator("tbody tr")).toHaveCount(14);
  const register = await stacks(page);
  for (const s of register) {
    expect(s.showsKhmer, `register stack ${s.width}px must hide the Khmer name`).toBe(false);
    expect(s.width, "the register stack is below the threshold by design").toBeLessThan(200);
  }

  await page.goto("/hr-attendance");
  await expect(page.locator("[role=combobox]").first()).toBeVisible();
  await page.locator("[role=combobox]").first().click();
  const options = await stacks(page);
  const wide = options.filter((s) => s.width >= 200);
  expect(wide.length, "the open picker should have wide stacks").toBeGreaterThan(0);
  expect(wide.some((s) => s.showsKhmer), "a wide stack must show the Khmer name").toBe(true);
});

test("a Khmer name costs no row height", async ({ page }) => {
  // Measured during design at 52px with and without. If a future font change
  // breaks it, 503 register rows each grow.
  await stubFrappe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-schedule/coverage");
  await expect(page.locator("tbody tr")).toHaveCount(14);
  const heights = new Set((await stacks(page)).map((s) => s.height));
  expect([...heights], "every register row is the same height").toHaveLength(1);
});

test("typing a Khmer name narrows the register", async ({ page }) => {
  await stubFrappe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-schedule/coverage");
  await expect(page.locator("tbody tr")).toHaveCount(14);
  await page.getByRole("textbox", { name: /^Search 14 employees/ }).fill(LONGEST_KHMER);
  await expect(page.locator("tbody tr")).toHaveCount(1);
});
```

- [ ] **Step 3: Run the spec to verify it fails**

```bash
npx playwright test e2e/employee-identity.spec.ts --project=desktop --reporter=list
```

Expected: FAIL — the fixtures have no Khmer names yet, or the threshold assertions do not hold.

- [ ] **Step 4: Fix whatever it caught, then run everything**

```bash
npx tsc --noEmit
npm run test:web 2>&1 | tail -8
npx playwright test --reporter=line 2>&1 | tail -5
```

Expected: `tsc` clean; unit `fail 0` with a count well above 944; e2e all passed with a count above 118.

- [ ] **Step 5: Build and commit the bundle**

The built assets ARE the deployed artifact — Frappe Cloud never builds these SPAs.

```bash
npm run build 2>&1 | tail -3
cd ../../..
git add -A
git commit -m "$(cat <<'EOF'
test(identity): geometric proof of the container thresholds, and the bundle

No unit test can see a container query: a threshold that never matches, one
that drifted, or a Tailwind class string that emitted no CSS at all are all
invisible to renderToStaticMarkup. These measure it in a browser.

The font check is a precondition rather than a convenience -- two measurement
passes during design were wrong because Kantumruy Pro's Khmer subset had not
loaded, and every number came from a fallback face. A geometric test measuring
the wrong font is a test that cannot fail correctly.

The no-clipping assertion is the one that would have caught both rejected
alternatives: a Khmer name shrunk to 3px, and an ellipsis landing mid-cluster.

Fixtures gain four deliberate shapes -- the longest measured pair, a typical
pair, one field only, and none at all -- plus one seeded flag, since the queue
rendered "Nothing needs a decision" and its row had never been measured.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: custom fields → 1; anonymiser → 2; the four feeds → 3 and 4; `khmerName()` and `stripMiddleName` → 5; the component, thresholds, container placement and backstop → 6; types and the composed `RegisterRow.khmer_name` → 7; the seven call sites and the tail declarations → 8 and 9; search → 10; the whole Testing section and the fixtures → 11. The three Open Questions are deliberately not implemented — they are decisions, not work.

**Deviations from the spec, both deliberate and flagged in place:**
1. `avatar` is a `ReactNode` slot rather than `{ image, size } | "none"`. The surfaces wrap avatars differently for accessibility and a shape-typed prop would have to reproduce all of it.
2. `employeeShortName` is renamed to `employeeDisplayName`. The spec only said `stripMiddleName` goes; leaving the old name on a function that now returns the full name is the same class of drift this work removes.

**Placeholder scan.** No TBD/TODO. Every code step carries the code. Task 9's three secondary surfaces are described structurally rather than as full literals — they are the same substitution as the register cell above them in the same task, and the register's version is written out in full.

**Type consistency.** `khmerName(last, first)` — argument order is last-then-first at every call site (Tasks 5, 7, 8, 10). `EmployeeIdentity` prop names are identical in Tasks 6, 8 and 9. `RegisterRow.khmer_name` is snake_case, matching every other field on that type; the composed value is `string | null` everywhere.

**Known risk, called out for the implementer.** Tailwind v4 arbitrary variants are matched as literal source text. `@min-[200px]:inline` must be written whole — a composed or interpolated class name emits no CSS while looking perfectly correct in the markup. Task 6 Step 6 greps the built CSS for exactly this reason, and Task 11 measures it in a browser.
