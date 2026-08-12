# Coverage Readiness Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three coverage views with one readiness register — an audit table, one row per employee, one column per readiness fact.

**Architecture:** dewey-ui's `GenericDataTable` renders; all join/filter/sort/derivation logic lives in `src/lib/coverageRegister.ts` as pure tested functions, because the primitive wires only `getCoreRowModel` and sets `manualFiltering`/`manualSorting`. Two existing endpoints are joined client-side on employee ID so the feeds keep failing independently.

**Tech Stack:** React 19 · TypeScript · TanStack Query + TanStack Table · `@lolbikb/dewey-ui` · `node:test` + `tsx --test` for unit tests · Playwright for e2e · Frappe v16 / Python for the one backend change.

**Spec:** `docs/superpowers/specs/2026-08-12-coverage-readiness-register-design.md`

## Global Constraints

- **Built assets are the deployed artifact and MUST be committed** — `dewey_time/public/**` and `dewey_time/www/*.html`. Frappe Cloud never builds these SPAs (private `@lolbikb/dewey-ui` dependency). Rebuild once, in Task 8 only, to avoid bundle churn on every commit.
- **`test:web` is an explicit glob LIST, not a recursive scan.** New frontend tests must live in `src/lib/`, `src/brand/`, `src/pwa/`, `src/components/`, `src/components/ui/`, or `src/ui/`. A file anywhere else runs locally and never in CI.
- **Frontend tests use `node:test` + `node:assert/strict` via `tsx --test`.** There is no vitest, no jsdom, no `@testing-library/react` in this app. Component tests use `renderToStaticMarkup` from `react-dom/server`.
- **Absent data is never rendered as a fact.** A missing feed removes its columns; it never blanks them or substitutes a default.
- **Colour never carries meaning alone.** Every state that colour distinguishes must also differ in shape or text, and carry an accessible name.
- **Exactly one backend change is in scope:** adding `branch` to `_list_calendar_employee_rows` and `coverage_api._EMPLOYEE_FIELDS`. No other server behaviour changes.
- **Do not add a `Punches 30d` column** — the payload has no punch field, and the Biometric column already distinguishes zero from non-zero.
- **Status has no default filter.** Defaulting to Active hides every leaver-still-enrolled row while the alert dot still counts it.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A`

## File Structure

**Backend (Task 1)**
- Modify `dewey_time/attendance_engine/hr_calendar.py:345` — add `"branch"` to the employee field list
- Modify `dewey_time/attendance_engine/coverage_api.py:33` — add `"branch"` to `_EMPLOYEE_FIELDS`
- Modify `dewey_time/tests/test_coverage_api.py` — pin that branch reaches the payload

**Pure logic (Tasks 2–4)** — one file, one responsibility: turning two payloads into a rendered table's data
- Create `src/lib/coverageRegister.ts`
- Create `src/lib/coverageRegister.test.ts`

**Data (Task 5)**
- Create `src/hooks/useCoverageRegister.ts`
- Modify `src/lib/queryKeys.ts` — no new family needed; documents the reuse

**UI (Tasks 6–7)**
- Create `src/ui/schedule-coverage/AlertDot.tsx`
- Create `src/ui/schedule-coverage/registerColumns.tsx`
- Create `src/ui/schedule-coverage/CoverageRegisterPage.tsx`
- Create `src/ui/coverageRegister.test.tsx`
- Modify `src/main.tsx` — one route plus a redirect
- Delete `ScheduleCoveragePage.tsx`, `BiometricEnrollmentPage.tsx`, `CoverageViewNav.tsx`, `UnassignedList.tsx`, `HoursBuckets.tsx`, `EmployeeLine.tsx`, `src/ui/BiometricEnrollmentView.tsx` and their tests

**Enforcement (Task 8)**
- Modify `e2e/page-insets.spec.ts` — add the route
- Create `e2e/coverage-register.spec.ts`
- Modify `src/ui/chromeMigration.test.tsx` — generalise to every routed page
- Rebuild and commit the SPA bundles

---

### Task 1: Branch reaches the coverage payload

**Files:**
- Modify: `dewey_time/attendance_engine/hr_calendar.py:345`
- Modify: `dewey_time/attendance_engine/coverage_api.py:33`
- Test: `dewey_time/tests/test_coverage_api.py`

**Interfaces:**
- Consumes: nothing
- Produces: `get_schedule_coverage()` rows gain a `branch` key (`str | None`)

**Why:** branch is an attribute of an active employee, orthogonal to biometrics. Sourcing it from the schedule feed is what lets site filtering survive a biometric outage.

- [ ] **Step 1: Write the failing test**

Add to `dewey_time/tests/test_coverage_api.py`:

```python
    def test_branch_reaches_the_payload_so_site_filtering_survives_a_biometric_outage(self):
        """Branch must come from the SCHEDULE feed, not the enrollment feed.

        Sourced from enrollment, a biometric outage would take branch with it and
        the register would lose site filtering at exactly the moment the reader
        needs to know what is still knowable.
        """
        from dewey_time.attendance_engine import coverage_api as mod

        row = {
            "id": "HR-EMP-0001",
            "employee_name": "Sok Dara",
            "department": "Finance",
            "employment_type": "Full-time",
            "title": "Analyst",
            "image": None,
            "branch": "DIU",
        }
        self.assertEqual(mod._employee_base(row)["branch"], "DIU")
        self.assertIn("branch", mod._EMPLOYEE_FIELDS)
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/lolbikb/projects/dewey-time
python3 -m unittest dewey_time.tests.test_coverage_api -v
```

Expected: FAIL — `KeyError: 'branch'` or `AssertionError: 'branch' not found in (...)`.

- [ ] **Step 3: Add the field in both places**

`dewey_time/attendance_engine/coverage_api.py:33`:

```python
# Keys copied verbatim from the calendar employee rows into the coverage payload.
# `branch` is here so the register can filter by site even when the biometric
# feed is down -- branch is a property of the employee, not of their enrolment.
_EMPLOYEE_FIELDS = (
    "id",
    "employee_name",
    "department",
    "employment_type",
    "title",
    "image",
    "branch",
)
```

`dewey_time/attendance_engine/hr_calendar.py:345`:

```python
    fields = ["name", "employee_name", "designation", "department", "company", "image", "branch"]
```

- [ ] **Step 4: Run the backend suite**

```bash
rm -rf ~/Library/Caches/com.apple.python
find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null
python3 -m unittest discover -s dewey_time/tests -t .
```

Expected: PASS, count one higher than before.

- [ ] **Step 5: Mutation-check it can fail**

Remove `"branch"` from `_EMPLOYEE_FIELDS`, re-run `test_coverage_api`, confirm FAIL, restore, confirm PASS. Clear both bytecode caches between runs (Step 4's two commands) — Apple's `python3` keeps a second cache at `~/Library/Caches/com.apple.python` that survives `rm -rf __pycache__` and is still read under `-B`.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/hr_calendar.py \
        dewey_time/attendance_engine/coverage_api.py \
        dewey_time/tests/test_coverage_api.py
git commit -m "feat(coverage): carry branch in the schedule payload

Branch is a property of the employee, not of their enrolment. Sourcing it from
the schedule feed is what lets the register filter by site when the biometric
feed is down.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 2: Register types and the join

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/lib/coverageRegister.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/coverageRegister.test.ts`

**Interfaces:**
- Consumes: `ScheduleCoveragePayload`, `CoverageEmployee`, `CoverageAssignedEmployee` from `@/lib/scheduleCoverage`; `EnrollmentPayload`, `EnrollmentRow` from `@/lib/enrollmentReport`
- Produces:
  ```ts
  export type FeedHealth = { schedule: boolean; biometric: boolean };
  export type RegisterRow = { … };            // full shape in Step 3
  export function joinRegisterRows(
    coverage: ScheduleCoveragePayload | undefined,
    enrollment: EnrollmentPayload | undefined,
  ): RegisterRow[];
  ```

**Note on populations:** coverage returns Active employees only (`hr_calendar.py:349` filters `{"status": "Active"}`). Enrollment returns Active **plus** leavers who still hold a template. So a leaver appears in the enrollment feed and not the coverage feed, and the join must keep it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/coverageRegister.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { joinRegisterRows } from "@/lib/coverageRegister";
import type { ScheduleCoveragePayload } from "@/lib/scheduleCoverage";
import type { EnrollmentPayload } from "@/lib/enrollmentReport";

function coverage(over: Partial<ScheduleCoveragePayload> = {}): ScheduleCoveragePayload {
  return {
    unassigned: [],
    assigned: [],
    counts: { active: 0, unassigned: 0, assigned: 0, truncated: false },
    ...over,
  };
}

function enrollment(over: Partial<EnrollmentPayload> = {}): EnrollmentPayload {
  return {
    rows: [],
    counts: {
      reported: 0, needs_enrollment: 0, enrolled_not_punching: 0, ok: 0,
      leaver_still_enrolled: 0, excluded_status: 0, truncated: false,
    },
    last_snapshot_at: "2026-08-12 09:00:00",
    window_days: 30,
    ...over,
  };
}

test("an employee in both feeds becomes one row carrying both halves", () => {
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Sok Dara", department: "Finance",
                   branch: "DIU", weekly_minutes: 2400 } as never],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
               status: "Active", bucket: "OK", is_registered: true,
               fingerprint_count: 2, face_count: 0, days_since_relieving: null }],
    }),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { schedule: rows[0].schedule, biometric: rows[0].biometric, weekly_minutes: rows[0].weekly_minutes },
    { schedule: "assigned", biometric: "enrolled", weekly_minutes: 2400 },
  );
});

test("a leaver present only in the enrollment feed is KEPT", () => {
  // Coverage filters status:Active server-side, so a leaver never appears
  // there. Dropping rows missing from coverage would delete the security
  // finding this page exists to surface.
  const rows = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [{ id: "E9", employee_name: "Ly Vanna", branch: "PM Primary", department: "Teaching",
               status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
               fingerprint_count: 1, face_count: 0, days_since_relieving: 12 }],
    }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].biometric, "still_enrolled");
  assert.equal(rows[0].days_since_relieving, 12);
  assert.equal(rows[0].schedule, null, "no schedule fact is known for someone coverage never returned");
});

test("an employee only in the coverage feed keeps null biometric, never 'none'", () => {
  // "none" means the bridge told us there is no template. Absence of a row is
  // not that statement, and rendering it as one invents a finding.
  const rows = joinRegisterRows(
    coverage({
      unassigned: [{ id: "E2", employee_name: "Chan Sophea", department: "Ops", branch: "DIU" } as never],
      counts: { active: 1, unassigned: 1, assigned: 0, truncated: false },
    }),
    enrollment(),
  );
  assert.equal(rows[0].biometric, null);
  assert.equal(rows[0].schedule, "missing");
});

test("branch comes from coverage so it survives a missing biometric feed", () => {
  const rows = joinRegisterRows(
    coverage({
      unassigned: [{ id: "E2", employee_name: "Chan Sophea", department: "Ops", branch: "DIU" } as never],
      counts: { active: 1, unassigned: 1, assigned: 0, truncated: false },
    }),
    undefined,
  );
  assert.equal(rows[0].branch, "DIU");
  assert.equal(rows[0].status, null, "status is a biometric-feed fact; never defaulted to Active");
});

test("rows are returned in employee-name order", () => {
  const rows = joinRegisterRows(
    coverage({
      unassigned: [
        { id: "E2", employee_name: "Zara", department: null, branch: null } as never,
        { id: "E1", employee_name: "Alice", department: null, branch: null } as never,
      ],
      counts: { active: 2, unassigned: 2, assigned: 0, truncated: false },
    }),
    enrollment(),
  );
  assert.deepEqual(rows.map((r) => r.employee_name), ["Alice", "Zara"]);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd dewey_time/frontend/hr_attendance
npx tsx --test src/lib/coverageRegister.test.ts
```

Expected: FAIL — cannot resolve `@/lib/coverageRegister`.

- [ ] **Step 3: Write the module**

Create `src/lib/coverageRegister.ts`:

```ts
import type {
  CoverageAssignedEmployee,
  CoverageEmployee,
  ScheduleCoveragePayload,
} from "@/lib/scheduleCoverage";
import type { EnrollmentPayload, EnrollmentRow } from "@/lib/enrollmentReport";

/**
 * One row per employee, joined from the two coverage feeds.
 *
 * Every field a feed cannot speak to is `null`, never a default. The two feeds
 * fail independently and a missing feed must remove facts, not invent them:
 * `biometric: "none"` means the bridge REPORTED no template, which is a
 * different statement from "we did not hear from the bridge".
 */
export type RegisterRow = {
  id: string;
  employee_name: string;
  branch: string | null;
  department: string | null;
  /** Biometric-feed fact. Coverage filters status:Active, so it cannot supply this. */
  status: string | null;
  schedule: "assigned" | "missing" | null;
  weekly_minutes: number | null;
  biometric: "enrolled" | "none" | "still_enrolled" | null;
  fingerprint_count: number | null;
  days_since_relieving: number | null;
};

export type FeedHealth = { schedule: boolean; biometric: boolean };

function biometricOf(row: EnrollmentRow): RegisterRow["biometric"] {
  if (row.bucket === "LEAVER_STILL_ENROLLED") return "still_enrolled";
  if (row.bucket === "NEEDS_ENROLLMENT") return "none";
  return "enrolled";
}

/**
 * Join on employee id. The union of both feeds, not the intersection: coverage
 * returns Active employees only, so a leaver still holding a template exists in
 * the enrollment feed alone — and that row is the security finding this page
 * exists to show.
 */
export function joinRegisterRows(
  coverage: ScheduleCoveragePayload | undefined,
  enrollment: EnrollmentPayload | undefined,
): RegisterRow[] {
  const byId = new Map<string, RegisterRow>();

  const seed = (emp: CoverageEmployee, schedule: "assigned" | "missing", minutes: number | null) => {
    byId.set(emp.id, {
      id: emp.id,
      employee_name: emp.employee_name || emp.id,
      branch: (emp as CoverageEmployee & { branch?: string | null }).branch ?? null,
      department: emp.department ?? null,
      status: null,
      schedule,
      weekly_minutes: minutes,
      biometric: null,
      fingerprint_count: null,
      days_since_relieving: null,
    });
  };

  for (const emp of coverage?.unassigned ?? []) seed(emp, "missing", null);
  for (const emp of coverage?.assigned ?? []) {
    seed(emp, "assigned", (emp as CoverageAssignedEmployee).weekly_minutes);
  }

  for (const row of enrollment?.rows ?? []) {
    const existing = byId.get(row.id);
    const merged: RegisterRow = existing ?? {
      id: row.id,
      employee_name: row.employee_name || row.id,
      branch: row.branch ?? null,
      department: row.department ?? null,
      status: null,
      // Coverage never returned this person, so no schedule fact is known.
      schedule: null,
      weekly_minutes: null,
      biometric: null,
      fingerprint_count: null,
      days_since_relieving: null,
    };
    merged.status = row.status ?? null;
    merged.biometric = biometricOf(row);
    merged.fingerprint_count = row.fingerprint_count;
    merged.days_since_relieving = row.days_since_relieving;
    // Coverage is authoritative for branch/department when it has the employee;
    // fall back to the enrollment copy for rows coverage never returned.
    merged.branch = merged.branch ?? row.branch ?? null;
    merged.department = merged.department ?? row.department ?? null;
    byId.set(row.id, merged);
  }

  return [...byId.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}
```

- [ ] **Step 4: Run to green**

```bash
npx tsx --test src/lib/coverageRegister.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation-check the two that matter**

Change the enrollment loop to skip ids absent from `byId` (intersection instead of union) → the leaver test must FAIL. Restore.
Change the coverage-only default to `biometric: "none"` → the third test must FAIL. Restore. Re-run: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/coverageRegister.ts src/lib/coverageRegister.test.ts
git commit -m "feat(register): join the two coverage feeds into one row per employee

Union, not intersection: coverage filters status:Active server-side, so a leaver
still holding a template exists only in the enrollment feed — and that row is
the security finding the page exists to show.

Every fact a feed cannot speak to is null, never a default. biometric:'none'
means the bridge reported no template; it is not the same statement as not
having heard from the bridge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 3: Filtering and sorting

**Files:**
- Modify: `src/lib/coverageRegister.ts`
- Test: `src/lib/coverageRegister.test.ts`

**Interfaces:**
- Consumes: `RegisterRow` from Task 2
- Produces:
  ```ts
  export type RegisterFilters = {
    search?: string;
    branch?: string[];
    department?: string[];
    status?: "Active" | "Left";
    schedule?: "assigned" | "missing";
    biometric?: "enrolled" | "none" | "still_enrolled";
    readiness?: "not-ready";
    sort?: "name" | "hours" | "prints";
    order?: "asc" | "desc";
  };
  export function isNotReady(row: RegisterRow): boolean;
  export function filterRegisterRows(rows: RegisterRow[], filters: RegisterFilters): RegisterRow[];
  export function sortRegisterRows(rows: RegisterRow[], filters: RegisterFilters): RegisterRow[];
  ```

**Why here and not in the table:** `GenericDataTable` wires only `getCoreRowModel` and sets `manualFiltering`/`manualSorting`. It renders controls and emits intent; it filters and sorts nothing.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/coverageRegister.test.ts`:

```ts
import {
  filterRegisterRows, isNotReady, sortRegisterRows,
  type RegisterRow,
} from "@/lib/coverageRegister";

const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
  id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
  status: "Active", schedule: "assigned", weekly_minutes: 2400,
  biometric: "enrolled", fingerprint_count: 2, days_since_relieving: null, ...over,
});

test("not-ready covers missing schedule, missing template, and live leavers", () => {
  assert.equal(isNotReady(row({ schedule: "missing" })), true);
  assert.equal(isNotReady(row({ biometric: "none" })), true);
  assert.equal(isNotReady(row({ biometric: "still_enrolled" })), true);
  assert.equal(isNotReady(row()), false);
});

test("an unknown fact is not a problem", () => {
  // A null biometric means the feed is down, not that someone is unenrolled.
  // Counting it as not-ready would report 241 findings during an outage.
  assert.equal(isNotReady(row({ biometric: null })), false);
  assert.equal(isNotReady(row({ schedule: null, biometric: "enrolled" })), false);
});

test("enrolled-but-not-punching is not a readiness problem", () => {
  // They can clock in; they simply have not. That is an attendance question,
  // not a coverage one, and putting it here floods the list.
  assert.equal(isNotReady(row({ biometric: "enrolled", fingerprint_count: 1 })), false);
});

test("search matches name and employee id, case-insensitively", () => {
  const rows = [row({ id: "HR-EMP-0042", employee_name: "Sok Dara" }),
                row({ id: "HR-EMP-0117", employee_name: "Chan Sophea" })];
  assert.equal(filterRegisterRows(rows, { search: "sok" }).length, 1);
  assert.equal(filterRegisterRows(rows, { search: "0117" })[0].employee_name, "Chan Sophea");
  assert.equal(filterRegisterRows(rows, { search: "   " }).length, 2);
});

test("filters compose — problems AND one branch", () => {
  const rows = [
    row({ id: "A", employee_name: "A", branch: "DIU", schedule: "missing" }),
    row({ id: "B", employee_name: "B", branch: "PM", schedule: "missing" }),
    row({ id: "C", employee_name: "C", branch: "DIU" }),
  ];
  const got = filterRegisterRows(rows, { readiness: "not-ready", branch: ["DIU"] });
  assert.deepEqual(got.map((r) => r.id), ["A"]);
});

test("severity order when filtered to problems, name order otherwise", () => {
  const rows = [
    row({ id: "S", employee_name: "Zed", schedule: "missing", biometric: "enrolled" }),
    row({ id: "L", employee_name: "Amy", biometric: "still_enrolled", status: "Left" }),
    row({ id: "N", employee_name: "Moe", biometric: "none" }),
  ];
  assert.deepEqual(
    sortRegisterRows(rows, { readiness: "not-ready" }).map((r) => r.id),
    ["L", "N", "S"],
    "leaver, then cannot-clock-in, then no-schedule",
  );
  assert.deepEqual(
    sortRegisterRows(rows, {}).map((r) => r.employee_name),
    ["Amy", "Moe", "Zed"],
  );
});

test("sorting by hours puts unknown minutes last in both directions", () => {
  const rows = [row({ id: "A", weekly_minutes: null }), row({ id: "B", weekly_minutes: 2400 })];
  assert.deepEqual(sortRegisterRows(rows, { sort: "hours", order: "asc" }).map((r) => r.id), ["B", "A"]);
  assert.deepEqual(sortRegisterRows(rows, { sort: "hours", order: "desc" }).map((r) => r.id), ["B", "A"]);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx tsx --test src/lib/coverageRegister.test.ts
```

Expected: FAIL — `isNotReady` / `filterRegisterRows` / `sortRegisterRows` are not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/coverageRegister.ts`:

```ts
export type RegisterFilters = {
  search?: string;
  branch?: string[];
  department?: string[];
  status?: "Active" | "Left";
  schedule?: "assigned" | "missing";
  biometric?: "enrolled" | "none" | "still_enrolled";
  readiness?: "not-ready";
  sort?: "name" | "hours" | "prints";
  order?: "asc" | "desc";
};

/**
 * Can this person be tracked today?
 *
 * A NULL fact is never a problem. Null means the feed did not speak, and
 * counting silence as a finding is how a bridge outage becomes 241 false
 * alarms. Only a positive statement of absence counts.
 *
 * ENROLLED_NOT_PUNCHING is deliberately absent: they can clock in and simply
 * have not, which is an attendance question, not a coverage one.
 */
export function isNotReady(row: RegisterRow): boolean {
  return row.schedule === "missing" || row.biometric === "none" || row.biometric === "still_enrolled";
}

/** Severity for the filtered view: worst first. Lower sorts earlier. */
function severity(row: RegisterRow): number {
  if (row.biometric === "still_enrolled") return 0;
  if (row.biometric === "none") return 1;
  if (row.schedule === "missing") return 2;
  return 3;
}

export function filterRegisterRows(rows: RegisterRow[], filters: RegisterFilters): RegisterRow[] {
  const needle = (filters.search ?? "").trim().toLowerCase();

  return rows.filter((row) => {
    if (needle && !`${row.employee_name} ${row.id}`.toLowerCase().includes(needle)) return false;
    if (filters.branch?.length && !filters.branch.includes(row.branch ?? "")) return false;
    if (filters.department?.length && !filters.department.includes(row.department ?? "")) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.schedule && row.schedule !== filters.schedule) return false;
    if (filters.biometric && row.biometric !== filters.biometric) return false;
    if (filters.readiness === "not-ready" && !isNotReady(row)) return false;
    return true;
  });
}

export function sortRegisterRows(rows: RegisterRow[], filters: RegisterFilters): RegisterRow[] {
  const out = [...rows];
  const dir = filters.order === "desc" ? -1 : 1;

  // A flat filter cannot group the way a modal would; severity ordering while
  // filtered is what recovers "worst first".
  if (filters.readiness === "not-ready" && !filters.sort) {
    return out.sort(
      (a, b) => severity(a) - severity(b) || a.employee_name.localeCompare(b.employee_name),
    );
  }

  if (filters.sort === "hours" || filters.sort === "prints") {
    const key = filters.sort === "hours" ? "weekly_minutes" : "fingerprint_count";
    return out.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      // Unknown sorts last in BOTH directions — an absent value is not a small
      // one, and flipping it to the top on desc would read as a finding.
      if (av === null && bv === null) return a.employee_name.localeCompare(b.employee_name);
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir || a.employee_name.localeCompare(b.employee_name);
    });
  }

  return out.sort((a, b) => a.employee_name.localeCompare(b.employee_name) * dir);
}
```

- [ ] **Step 4: Run to green**

```bash
npx tsx --test src/lib/coverageRegister.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Mutation-check the null-safety rule**

Change `isNotReady` to `row.biometric !== "enrolled"` → the "unknown fact is not a problem" test must FAIL. Restore.
Remove the `if (av === null) return 1` guard → the hours test must FAIL. Restore. Re-run: 12 pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/coverageRegister.ts src/lib/coverageRegister.test.ts
git commit -m "feat(register): filtering and severity-aware sorting

The table primitive sets manualFiltering/manualSorting and wires only
getCoreRowModel, so this logic is ours. Pure and tested, per this app's
convention.

A null fact is never a problem: null means the feed did not speak, and counting
silence as a finding is how a bridge outage becomes 241 false alarms. Unknown
values also sort last in BOTH directions — an absent value is not a small one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 4: Feed health, the alert, and column visibility

**Files:**
- Modify: `src/lib/coverageRegister.ts`
- Test: `src/lib/coverageRegister.test.ts`

**Interfaces:**
- Consumes: `RegisterRow`, `FeedHealth`, `isNotReady`
- Produces:
  ```ts
  export type RegisterAlert = {
    tone: "problem" | "clear" | "degraded";
    count: number;
    knowable: boolean;
    label: string;
  };
  export function feedHealth(
    coverage: ScheduleCoveragePayload | undefined,
    enrollment: EnrollmentPayload | undefined,
    nowMs: number,
  ): FeedHealth;
  export function registerAlert(rows: RegisterRow[], feeds: FeedHealth): RegisterAlert;
  export function visibleColumnIds(feeds: FeedHealth): string[];
  ```

Reuse `isFeedConnected` and the existing `STALE_AFTER_MINUTES` from `@/lib/enrollmentReport`. Do not redefine the threshold.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/coverageRegister.test.ts`:

```ts
import { feedHealth, registerAlert, visibleColumnIds } from "@/lib/coverageRegister";

const HEALTHY = { schedule: true, biometric: true };

test("the alert counts problems and reads as a problem", () => {
  const got = registerAlert([row(), row({ id: "X", schedule: "missing" })], HEALTHY);
  assert.equal(got.tone, "problem");
  assert.equal(got.count, 1);
  assert.equal(got.knowable, true);
  assert.match(got.label, /1 needs attention/i);
});

test("all clear is a rendered state, never an absence", () => {
  // A missing indicator cannot distinguish "nothing wrong" from "failed to
  // load", so the clear state has to be something you can see.
  const got = registerAlert([row(), row({ id: "B", employee_name: "B" })], HEALTHY);
  assert.equal(got.tone, "clear");
  assert.equal(got.count, 0);
  assert.match(got.label, /all 2 ready/i);
});

test("a dead biometric feed degrades the alert and says what it cannot see", () => {
  const got = registerAlert(
    [row({ biometric: null, schedule: "missing" })],
    { schedule: true, biometric: false },
  );
  assert.equal(got.tone, "degraded");
  assert.equal(got.knowable, false);
  assert.match(got.label, /biometrics unavailable/i);
});

test("a degraded alert still reports the problems it CAN see", () => {
  const got = registerAlert(
    [row({ biometric: null, schedule: "missing" }), row({ id: "B", biometric: null })],
    { schedule: true, biometric: false },
  );
  assert.equal(got.count, 1);
});

test("a dead biometric feed hides the biometric columns AND status", () => {
  // Status is a biometric-feed fact: coverage filters status:Active, so every
  // row it returns is Active by construction and leavers never appear there.
  // Showing "Active" for all 241 would assert what the data cannot support.
  const hidden = visibleColumnIds({ schedule: true, biometric: false });
  assert.ok(!hidden.includes("biometric"));
  assert.ok(!hidden.includes("fingerprint_count"));
  assert.ok(!hidden.includes("status"));
  assert.ok(hidden.includes("branch"), "branch comes from the schedule feed and survives");
  assert.ok(hidden.includes("schedule"));
});

test("a dead schedule feed hides only its own columns", () => {
  const shown = visibleColumnIds({ schedule: false, biometric: true });
  assert.ok(!shown.includes("schedule"));
  assert.ok(!shown.includes("weekly_minutes"));
  assert.ok(shown.includes("biometric"));
});

test("feed health treats a never-reported snapshot as down", () => {
  const now = Date.parse("2026-08-12T09:00:00Z");
  assert.equal(feedHealth(undefined, undefined, now).biometric, false);
  assert.equal(
    feedHealth(undefined, { rows: [], counts: {} as never, last_snapshot_at: null, window_days: 30 }, now).biometric,
    false,
  );
});

test("feed health treats a snapshot older than the shared stale threshold as down", () => {
  const now = Date.parse("2026-08-12T09:00:00Z");
  const fresh = { rows: [], counts: {} as never, last_snapshot_at: "2026-08-12 08:00:00", window_days: 30 };
  const old = { rows: [], counts: {} as never, last_snapshot_at: "2026-08-09 08:00:00", window_days: 30 };
  assert.equal(feedHealth(undefined, fresh, now).biometric, true);
  assert.equal(feedHealth(undefined, old, now).biometric, false);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx tsx --test src/lib/coverageRegister.test.ts
```

Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/coverageRegister.ts`:

```ts
import { STALE_AFTER_MINUTES, isFeedConnected } from "@/lib/enrollmentReport";

export type RegisterAlert = {
  tone: "problem" | "clear" | "degraded";
  count: number;
  /** False when a feed is down, so the count covers only part of the roster. */
  knowable: boolean;
  /** The accessible name. Colour never carries meaning alone. */
  label: string;
};

/** Column ids that survive when a feed is unavailable. */
const SCHEDULE_COLUMNS = ["schedule", "weekly_minutes"];
const BIOMETRIC_COLUMNS = ["biometric", "fingerprint_count", "status"];
const ALWAYS = ["employee", "branch", "department", "action"];

export function feedHealth(
  coverage: ScheduleCoveragePayload | undefined,
  enrollment: EnrollmentPayload | undefined,
  nowMs: number,
): FeedHealth {
  if (!isFeedConnected(enrollment)) return { schedule: Boolean(coverage), biometric: false };

  const reportedAt = Date.parse((enrollment?.last_snapshot_at ?? "").replace(" ", "T") + "Z");
  const minutes = Number.isNaN(reportedAt) ? Infinity : (nowMs - reportedAt) / 60000;

  return { schedule: Boolean(coverage), biometric: minutes <= STALE_AFTER_MINUTES };
}

export function registerAlert(rows: RegisterRow[], feeds: FeedHealth): RegisterAlert {
  const count = rows.filter(isNotReady).length;
  const knowable = feeds.schedule && feeds.biometric;

  if (!knowable) {
    const missing = !feeds.biometric ? "biometrics unavailable" : "schedules unavailable";
    return {
      tone: "degraded",
      count,
      knowable: false,
      // Says what it cannot see. A bare count here reads as reassurance at
      // exactly the moment the page knows least.
      label: `${count} need attention · ${missing}`,
    };
  }

  if (count === 0) {
    return { tone: "clear", count: 0, knowable: true, label: `All ${rows.length} ready` };
  }

  return {
    tone: "problem",
    count,
    knowable: true,
    label: `${count} ${count === 1 ? "needs" : "need"} attention — show ${count === 1 ? "it" : "them"}`,
  };
}

/**
 * Columns are REMOVED when their feed is absent, never blanked. An empty
 * Biometric column reads as 241 people who cannot clock in — a bridge fault
 * rendered as a workforce crisis.
 *
 * `status` counts as biometric: coverage filters status:Active server-side, so
 * it cannot supply the field and leavers never appear in it.
 */
export function visibleColumnIds(feeds: FeedHealth): string[] {
  return [
    ...ALWAYS,
    ...(feeds.schedule ? SCHEDULE_COLUMNS : []),
    ...(feeds.biometric ? BIOMETRIC_COLUMNS : []),
  ];
}
```

Export `STALE_AFTER_MINUTES` from `src/lib/enrollmentReport.ts` by changing
`const STALE_AFTER_MINUTES = 24 * 60;` to `export const STALE_AFTER_MINUTES = 24 * 60;`.

- [ ] **Step 4: Run to green**

```bash
npx tsx --test src/lib/coverageRegister.test.ts
npx tsc --noEmit
```

Expected: PASS, 20 tests; typecheck clean.

- [ ] **Step 5: Mutation-check the suppression rule**

Move `"status"` from `BIOMETRIC_COLUMNS` to `ALWAYS` → the "hides biometric columns AND status" test must FAIL. Restore.
Make `registerAlert` return `tone: "clear"` when `count === 0` regardless of `knowable` → the degraded test must FAIL. Restore. Re-run: 20 pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/coverageRegister.ts src/lib/coverageRegister.test.ts src/lib/enrollmentReport.ts
git commit -m "feat(register): feed health, the alert, and column suppression

Columns are removed when their feed is absent, never blanked — an empty
Biometric column reads as 241 people who cannot clock in.

Status counts as a biometric column: coverage filters status:Active, so it
cannot supply the field and leavers never appear in it. Showing 'Active' for
everyone during an outage would assert what the data cannot support.

The clear state is rendered, not omitted: a missing indicator cannot
distinguish 'nothing wrong' from 'failed to load'. A degraded alert names what
it cannot see rather than reporting a reassuring partial count.

Reuses STALE_AFTER_MINUTES from enrollmentReport rather than redefining it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 5: The hook

**Files:**
- Create: `src/hooks/useCoverageRegister.ts`

**Interfaces:**
- Consumes: `getScheduleCoverage` from `@/services/coverage`, `getEnrollmentReport` from `@/services/enrollment`, everything from Task 2–4, `queryKeys` from `@/lib/queryKeys`
- Produces:
  ```ts
  export function useCoverageRegister(nowMs: number): {
    rows: RegisterRow[];          // joined, unfiltered
    feeds: FeedHealth;
    alert: RegisterAlert;
    truncated: boolean;
    isLoading: boolean;
    bothFailed: boolean;
    refresh: () => void;
  };
  ```

Two independent `useQuery` calls under the existing `queryKeys.coverage.all` and `queryKeys.enrollment.all` families — separate keys so one feed's failure or invalidation never touches the other. That independence is what makes column suppression possible.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useCoverageRegister.ts`:

```ts
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getScheduleCoverage } from "@/services/coverage";
import { getEnrollmentReport } from "@/services/enrollment";
import { queryKeys } from "@/lib/queryKeys";
import {
  feedHealth,
  joinRegisterRows,
  registerAlert,
  type FeedHealth,
  type RegisterAlert,
  type RegisterRow,
} from "@/lib/coverageRegister";

export type CoverageRegister = {
  rows: RegisterRow[];
  feeds: FeedHealth;
  alert: RegisterAlert;
  truncated: boolean;
  isLoading: boolean;
  /** Neither feed answered — there is genuinely nothing to render. */
  bothFailed: boolean;
  refresh: () => void;
};

export function useCoverageRegister(nowMs: number): CoverageRegister {
  // TWO queries, deliberately. A merged endpoint would couple the feeds and a
  // biometric outage would take schedule data down with it — the opposite of
  // what per-column suppression is for.
  const coverage = useQuery({
    queryKey: queryKeys.coverage.all,
    queryFn: getScheduleCoverage,
  });
  const enrollment = useQuery({
    queryKey: queryKeys.enrollment.all,
    queryFn: getEnrollmentReport,
  });

  return useMemo(() => {
    const rows = joinRegisterRows(coverage.data, enrollment.data);
    const feeds = feedHealth(coverage.data, enrollment.data, nowMs);

    return {
      rows,
      feeds,
      alert: registerAlert(rows, feeds),
      truncated: Boolean(coverage.data?.counts?.truncated || enrollment.data?.counts?.truncated),
      isLoading: coverage.isLoading || enrollment.isLoading,
      bothFailed: Boolean(coverage.error) && Boolean(enrollment.error),
      refresh: () => {
        void coverage.refetch();
        void enrollment.refetch();
      },
    };
  }, [coverage, enrollment, nowMs]);
}
```

- [ ] **Step 2: Typecheck**

```bash
cd dewey_time/frontend/hr_attendance && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useCoverageRegister.ts
git commit -m "feat(register): the hook, two independent queries

Separate query keys so one feed's failure or invalidation never touches the
other. That independence is exactly what makes per-column suppression possible;
a merged endpoint would let a biometric outage take schedule data down with it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 6: AlertDot and the column definitions

**Files:**
- Create: `src/ui/schedule-coverage/AlertDot.tsx`
- Create: `src/ui/schedule-coverage/registerColumns.tsx`
- Test: `src/ui/coverageRegister.test.tsx`

**Interfaces:**
- Consumes: `RegisterAlert`, `RegisterRow` from `@/lib/coverageRegister`
- Produces:
  ```ts
  export function AlertDot(props: { alert: RegisterAlert; active: boolean; onToggle: () => void }): JSX.Element;
  export function registerColumns(onOpen: (row: RegisterRow) => void,
                                  onAddSchedule: (row: RegisterRow) => void): ColumnDef<RegisterRow, unknown>[];
  ```

Column ids MUST match `visibleColumnIds`: `employee`, `branch`, `department`, `status`, `schedule`, `weekly_minutes`, `biometric`, `fingerprint_count`, `action`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/coverageRegister.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AlertDot } from "@/ui/schedule-coverage/AlertDot";
import { registerColumns } from "@/ui/schedule-coverage/registerColumns";
import { visibleColumnIds } from "@/lib/coverageRegister";

const noop = () => {};

test("the dot carries its count and words in the accessible name", () => {
  // "Minimal via colour" cannot be colour alone: red/green is the most common
  // colour blindness, and a hue tells a screen reader nothing.
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 8, knowable: true, label: "8 need attention — show them" }}
              active={false} onToggle={noop} />,
  );
  assert.match(html, /aria-label="8 need attention — show them"/);
});

test("clear and problem states differ in more than colour", () => {
  const problem = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 3, knowable: true, label: "3 need attention" }}
              active={false} onToggle={noop} />,
  );
  const clear = renderToStaticMarkup(
    <AlertDot alert={{ tone: "clear", count: 0, knowable: true, label: "All 241 ready" }}
              active={false} onToggle={noop} />,
  );
  assert.match(problem, /data-tone="problem"/);
  assert.match(clear, /data-tone="clear"/);
  // Filled vs hollow is a shape difference, not a hue difference.
  assert.notEqual(
    /border-2/.test(problem),
    /border-2/.test(clear),
    "the clear state must be a ring, not just a green disc",
  );
});

test("the clear state still renders — absence is not a signal", () => {
  const clear = renderToStaticMarkup(
    <AlertDot alert={{ tone: "clear", count: 0, knowable: true, label: "All 241 ready" }}
              active={false} onToggle={noop} />,
  );
  assert.match(clear, /<button/);
});

test("every column id is one visibleColumnIds knows about", () => {
  // A typo here silently makes a column permanently invisible.
  const ids = registerColumns(noop, noop).map((c) => c.id);
  const known = visibleColumnIds({ schedule: true, biometric: true });
  for (const id of ids) assert.ok(known.includes(id!), `unknown column id: ${id}`);
  for (const id of known) assert.ok(ids.includes(id), `visibleColumnIds names a column that does not exist: ${id}`);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx tsx --test src/ui/coverageRegister.test.tsx
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Write AlertDot**

Create `src/ui/schedule-coverage/AlertDot.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { RegisterAlert } from "@/lib/coverageRegister";

/**
 * Minimal alert beside the page title. Not a filter control — it sits with the
 * title because it is an alarm, not a facet.
 *
 * Colour never carries meaning alone: `problem` and `degraded` are filled
 * discs, `clear` is a hollow ring, so the states differ in SHAPE. The count and
 * the words live in the accessible name. It never disappears — an absent
 * indicator cannot distinguish "nothing is wrong" from "the page failed".
 */
export function AlertDot({
  alert,
  active,
  onToggle,
}: {
  alert: RegisterAlert;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-tone={alert.tone}
      aria-label={alert.label}
      aria-pressed={active}
      title={alert.label}
      onClick={onToggle}
      className={cn(
        "size-3 shrink-0 rounded-full transition-shadow",
        alert.tone === "problem" && "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20",
        alert.tone === "degraded" && "bg-brand-accent shadow-[0_0_0_3px] shadow-brand-accent/20",
        alert.tone === "clear" && "border-2 border-primary bg-transparent",
        active && "ring-2 ring-offset-1 ring-current",
      )}
    />
  );
}
```

- [ ] **Step 4: Write the column definitions**

Create `src/ui/schedule-coverage/registerColumns.tsx`:

```tsx
import type { ColumnDef } from "@tanstack/react-table";

import { Badge, Button } from "@lolbikb/dewey-ui";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import type { RegisterRow } from "@/lib/coverageRegister";

const BIOMETRIC_LABEL: Record<NonNullable<RegisterRow["biometric"]>, string> = {
  enrolled: "Enrolled",
  none: "No fingerprint",
  still_enrolled: "Still enrolled",
};

/** Ids MUST match visibleColumnIds() — a mismatch hides a column permanently. */
export function registerColumns(
  onOpen: (row: RegisterRow) => void,
  onAddSchedule: (row: RegisterRow) => void,
): ColumnDef<RegisterRow, unknown>[] {
  return [
    {
      id: "employee",
      header: "Employee",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.original.employee_name}</span>
          <span className="truncate text-xs text-muted-foreground">{row.original.id}</span>
        </span>
      ),
    },
    { id: "branch", header: "Branch", cell: ({ row }) => row.original.branch ?? "—" },
    { id: "department", header: "Dept", cell: ({ row }) => row.original.department ?? "—" },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.status ? (
          <Badge variant={row.original.status === "Left" ? "destructive" : "secondary"}>
            {row.original.status}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      id: "schedule",
      header: "Schedule",
      cell: ({ row }) => {
        if (row.original.schedule === null) return "—";
        return (
          <Badge variant={row.original.schedule === "missing" ? "outline" : "secondary"}>
            {row.original.schedule === "missing" ? "Missing" : "Assigned"}
          </Badge>
        );
      },
    },
    {
      id: "weekly_minutes",
      header: "Hrs/wk",
      cell: ({ row }) =>
        row.original.weekly_minutes === null
          ? "—"
          : formatScheduleDuration(row.original.weekly_minutes),
    },
    {
      id: "biometric",
      header: "Biometric",
      cell: ({ row }) => {
        const value = row.original.biometric;
        if (value === null) return "—";
        const days = row.original.days_since_relieving;
        return (
          <span className="flex items-center gap-1.5">
            <Badge variant={value === "enrolled" ? "secondary" : "destructive"}>
              {BIOMETRIC_LABEL[value]}
            </Badge>
            {value === "still_enrolled" && days !== null ? (
              <span className="text-xs tabular-nums text-destructive">
                {days} {days === 1 ? "day" : "days"}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "fingerprint_count",
      header: "Prints",
      cell: ({ row }) =>
        row.original.fingerprint_count === null ? "—" : row.original.fingerprint_count,
    },
    {
      id: "action",
      header: "",
      // Empty unless the row has a problem. A button on every row is noise, and
      // it is what made the old Needs list read as a to-do list.
      cell: ({ row }) => {
        if (row.original.schedule === "missing") {
          return (
            <Button size="sm" variant="outline" onClick={() => onAddSchedule(row.original)}>
              Add schedule
            </Button>
          );
        }
        if (row.original.biometric === "none" || row.original.biometric === "still_enrolled") {
          return (
            <Button size="sm" variant="ghost" onClick={() => onOpen(row.original)}>
              Open
            </Button>
          );
        }
        return null;
      },
    },
  ];
}
```

- [ ] **Step 5: Run to green**

```bash
npx tsx --test src/ui/coverageRegister.test.tsx
npx tsc --noEmit
```

Expected: PASS, 4 tests; typecheck clean.

- [ ] **Step 6: Mutation-check the id contract**

Rename the `"branch"` column id to `"branches"` → the "every column id" test must FAIL in both directions. Restore, re-run green.

- [ ] **Step 7: Commit**

```bash
git add src/ui/schedule-coverage/AlertDot.tsx src/ui/schedule-coverage/registerColumns.tsx src/ui/coverageRegister.test.tsx
git commit -m "feat(register): the alert dot and column definitions

The dot differs in SHAPE as well as colour — filled disc for problems, hollow
ring for clear — because red/green is the most common colour blindness and a
hue tells a screen reader nothing. The count and words live in the accessible
name, and the clear state renders rather than disappearing.

The action cell is empty unless the row has a problem. A button on every row is
noise, and is what made the old Needs list read as a to-do list.

A test pins column ids against visibleColumnIds in both directions: a typo
would otherwise make a column permanently invisible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 7: The page, the route, and deleting what it replaces

**Files:**
- Create: `src/ui/schedule-coverage/CoverageRegisterPage.tsx`
- Modify: `src/main.tsx:31-32`
- Test: `src/ui/coverageRegister.test.tsx` (append)
- Delete: `src/ui/schedule-coverage/ScheduleCoveragePage.tsx`, `BiometricEnrollmentPage.tsx`, `CoverageViewNav.tsx`, `UnassignedList.tsx`, `HoursBuckets.tsx`, `EmployeeLine.tsx`, `src/ui/BiometricEnrollmentView.tsx`, `src/ui/biometricEnrollmentView.test.tsx`

**Interfaces:**
- Consumes: `useCoverageRegister`, `registerColumns`, `AlertDot`, `filterRegisterRows`, `sortRegisterRows`, `visibleColumnIds`
- Produces: the routed page at `/hr-schedule/coverage`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/coverageRegister.test.tsx`:

```tsx
import { readFileSync } from "node:fs";

const pageSource = readFileSync(
  new URL("./schedule-coverage/CoverageRegisterPage.tsx", import.meta.url), "utf8");

test("the page uses dewey-ui Page chrome like every other routed page", () => {
  // The old biometrics page was the only routed page without it, which is why
  // the shared nav shifted 16px between tabs (Page is px-5 sm:px-8, that page
  // hand-rolled px-4).
  assert.ok(pageSource.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(pageSource.includes("PageHeader"), "expected PageHeader");
  assert.ok(!/className="[^"]*\bpx-4\b/.test(pageSource), "no hand-rolled page inset");
});

test("the page gates on hrStaff like its siblings", () => {
  assert.ok(pageSource.includes("hrStaff"));
  assert.ok(pageSource.includes("Navigate"));
});

test("the page holds no derivation of its own", () => {
  // All logic lives in lib/ as pure tested functions. A second site would drift.
  assert.ok(!pageSource.includes(".filter("), "filtering belongs in filterRegisterRows");
  assert.ok(!pageSource.includes(".sort("), "sorting belongs in sortRegisterRows");
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx tsx --test src/ui/coverageRegister.test.tsx
```

Expected: FAIL — `CoverageRegisterPage.tsx` does not exist.

- [ ] **Step 3: Write the page**

Create `src/ui/schedule-coverage/CoverageRegisterPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { EmptyState, GenericDataTable, Page, PageHeader } from "@lolbikb/dewey-ui";
import { AlertTriangleIcon } from "lucide-react";
import { Navigate, useNavigate, useOutletContext } from "react-router-dom";

import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { useCoverageRegister } from "@/hooks/useCoverageRegister";
import {
  filterRegisterRows,
  sortRegisterRows,
  visibleColumnIds,
  type RegisterFilters,
  type RegisterRow,
} from "@/lib/coverageRegister";
import { AlertDot } from "@/ui/schedule-coverage/AlertDot";
import { registerColumns } from "@/ui/schedule-coverage/registerColumns";

export function CoverageRegisterPage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<RegisterFilters>({});
  const nowMs = useMemo(() => Date.now(), []);
  const { rows, feeds, alert, truncated, isLoading, bothFailed, refresh } =
    useCoverageRegister(nowMs);

  const columns = useMemo(
    () =>
      registerColumns(
        (row: RegisterRow) => navigate(`/hr-attendance?employee=${encodeURIComponent(row.id)}`),
        (row: RegisterRow) => navigate(`/hr-schedule?employee=${encodeURIComponent(row.id)}`),
      ),
    [navigate],
  );

  const visible = useMemo(() => new Set(visibleColumnIds(feeds)), [feeds]);
  const shownColumns = useMemo(
    () => columns.filter((column) => visible.has(column.id as string)),
    [columns, visible],
  );

  const data = useMemo(
    () => sortRegisterRows(filterRegisterRows(rows, filters), filters),
    [rows, filters],
  );

  if (sessionLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={Spinner} title="Loading…" className="border-none" />
      </div>
    );
  }
  if (!hrStaff) return <Navigate to="/hr-attendance" replace />;

  return (
    <Page>
      <PageHeader
        title="Coverage"
        description={`${rows.length} employees`}
        actions={
          <AlertDot
            alert={alert}
            active={filters.readiness === "not-ready"}
            onToggle={() =>
              setFilters((prev) => ({
                ...prev,
                readiness: prev.readiness === "not-ready" ? undefined : "not-ready",
              }))
            }
          />
        }
      />

      {/* AttentionStrip, NOT FailureBlock: FailureBlock carries a 13rem
          min-height and is a full-region placeholder — as a banner above a
          working table it would squash the table. AttentionStrip's tone union
          is exactly "amber" | "accent"; there is no "destructive"/"warning". */}
      {!feeds.biometric ? (
        <AttentionStrip
          tone="amber"
          icon={<AlertTriangleIcon className="size-4 text-amber-600" aria-hidden="true" />}
        >
          Biometric feed unavailable — enrolment <strong>and leaver detection</strong> are hidden
          rather than shown as empty. Every employee would otherwise read as unenrolled, which is a
          bridge fault, not 241 people losing their fingerprints. Schedule coverage is unaffected.
        </AttentionStrip>
      ) : null}

      {truncated ? (
        <AttentionStrip
          tone="accent"
          icon={<AlertTriangleIcon className="size-4 text-brand-accent" aria-hidden="true" />}
        >
          The roster is partial — some employees are not shown.
        </AttentionStrip>
      ) : null}

      {bothFailed ? (
        <FailureBlock title="Coverage didn’t load" onRetry={refresh} />
      ) : (
        <GenericDataTable
          columns={shownColumns}
          data={data}
          loading={isLoading}
          filters={filters}
          onFiltersChange={setFilters}
          getRowId={(row: RegisterRow) => row.id}
          layout="fill"
          columnWidths="fixed"
          hidePageSize
          config={{
            entityName: "employees",
            entityNameSingular: "employee",
            searchPlaceholder: "Search by name or employee ID…",
          }}
        />
      )}
    </Page>
  );
}
```

- [ ] **Step 4: Rewire the route and delete the old surfaces**

In `src/main.tsx`, replace lines 31–32 with:

```tsx
                <Route path="/hr-schedule/coverage" element={<CoverageRegisterPage />} />
                <Route
                  path="/hr-schedule/coverage/biometrics"
                  element={<Navigate to="/hr-schedule/coverage" replace />}
                />
```

Update the import to `import { CoverageRegisterPage } from "@/ui/schedule-coverage/CoverageRegisterPage";` and drop the `ScheduleCoveragePage` / `BiometricEnrollmentPage` imports.

```bash
git rm src/ui/schedule-coverage/ScheduleCoveragePage.tsx \
       src/ui/schedule-coverage/BiometricEnrollmentPage.tsx \
       src/ui/schedule-coverage/CoverageViewNav.tsx \
       src/ui/schedule-coverage/UnassignedList.tsx \
       src/ui/schedule-coverage/HoursBuckets.tsx \
       src/ui/schedule-coverage/EmployeeLine.tsx \
       src/ui/BiometricEnrollmentView.tsx \
       src/ui/biometricEnrollmentView.test.tsx
```

Then remove `bucketByWeeklyHours` and `HoursBucket` from `src/lib/scheduleCoverage.ts` and their tests from `src/lib/scheduleCoverage.test.ts` — nothing imports them once `HoursBuckets` is gone. Keep `CoverageEmployee`, `CoverageAssignedEmployee`, `CoverageCounts`, `ScheduleCoveragePayload` and `roundMinutesToHalfHour` if still referenced; delete `roundMinutesToHalfHour` too if `grep -rn roundMinutesToHalfHour src/` returns only its own definition and test.

- [ ] **Step 5: Run everything**

```bash
npx tsc --noEmit
npm run test:web
```

Expected: typecheck clean; suite green with the biometric-view tests gone and the four new ones present. If `tsc` reports an unused import in `main.tsx`, remove it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(coverage): one readiness register replaces all three views

/hr-schedule/coverage is now a single audit table; /coverage/biometrics
redirects to it. CoverageViewNav, the two-tab split and the Needs/Hours
switcher are deleted rather than repaired — which removes the 16px nav jump
outright, since it came from the biometrics page being the only routed page
without dewey-ui's <Page>.

The page holds no derivation: filtering, sorting and column visibility all come
from lib/ as pure tested functions, and a test pins that the page contains no
.filter( or .sort( of its own.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 8: Enforcement, and ship the bundles

**Files:**
- Modify: `e2e/page-insets.spec.ts:21-27`
- Create: `e2e/coverage-register.spec.ts`
- Modify: `src/ui/chromeMigration.test.tsx`
- Modify: `dewey_time/public/**`, `dewey_time/www/*.html` (built output)

**Why:** the original defect existed because this surface sat outside every guard. Adding the page without adding the guards would leave the next surface free to drift the same way.

- [ ] **Step 1: Generalise the chrome test**

Replace the first test in `src/ui/chromeMigration.test.tsx` with:

```tsx
import { readdirSync } from "node:fs";

// Was "WeeklySchedulePage uses <Page>" — a per-file assertion. The biometrics
// page then shipped as the only routed page WITHOUT <Page>, hand-rolling px-4
// against Page's px-5 sm:px-8, so the nav it shared with its sibling shifted
// 16px between tabs. The guard existed; it just named one page instead of the
// class. This is the generalised form.
test("every routed page uses dewey-ui's Page rather than a hand-rolled container", () => {
  const routed = readdirSync(new URL(".", import.meta.url), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith("Page.tsx") && !f.includes(".test."));

  assert.ok(routed.length >= 5, `expected to find the routed pages, saw ${routed.length}`);

  for (const file of routed) {
    const src = source(file);
    assert.ok(src.includes("<Page>"), `${file} must render dewey-ui's <Page>`);
    assert.ok(!src.includes("max-w-7xl"), `${file} must not hand-roll a container`);
  }
});
```

- [ ] **Step 2: Run it and confirm it passes now, and would have failed before**

```bash
npx tsx --test src/ui/chromeMigration.test.tsx
```

Expected: PASS. Then `git stash`-free check: temporarily add `const x = "max-w-7xl";` to `CoverageRegisterPage.tsx`, re-run, confirm FAIL, remove it.

- [ ] **Step 3: Add the route to the inset measurement**

In `e2e/page-insets.spec.ts`, the `ROUTES` array becomes:

```ts
const ROUTES = [
  "/hr-attendance",
  "/hr-schedule",
  "/hr-schedule/import",
  "/hr-schedule/coverage",
  "/hr-flags",
];
```

This is unchanged in content — `/hr-schedule/coverage` was already listed — but it now measures the register. Confirm the register renders `[data-slot="page"]`, which the helper requires and the old biometrics page never did.

- [ ] **Step 4: Write the e2e spec**

Create `e2e/coverage-register.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { stubFrappe } from "./fixtures";

test("the register lists employees and the dot filters to problems", async ({ page }) => {
  await stubFrappe(page);
  await page.goto("/hr-schedule/coverage");

  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();

  const dot = page.getByRole("button", { name: /need attention|All \d+ ready/ });
  await expect(dot).toBeVisible();

  const before = await page.getByRole("row").count();
  await dot.click();
  await expect
    .poll(async () => page.getByRole("row").count())
    .toBeLessThan(before);
});

test("the biometrics URL redirects to the register", async ({ page }) => {
  await stubFrappe(page);
  await page.goto("/hr-schedule/coverage/biometrics");
  await expect(page).toHaveURL(/\/hr-schedule\/coverage$/);
});
```

If `stubFrappe` does not yet stub `get_schedule_coverage` and `get_enrollment_report`, add fixtures for both — the enrollment stub must include one `LEAVER_STILL_ENROLLED` row and one `NEEDS_ENROLLMENT` row so the dot has something to count.

- [ ] **Step 5: Run the e2e suite**

```bash
npx playwright test e2e/coverage-register.spec.ts e2e/page-insets.spec.ts
```

Expected: PASS. Fix fixtures until it does.

- [ ] **Step 6: Rebuild and commit the bundles**

```bash
npm run build
cd /Users/lolbikb/projects/dewey-time
git status --porcelain    # expect dewey_time/public/** and dewey_time/www/*.html
```

The bundles ARE the deployed artifact — Frappe Cloud never builds them.

- [ ] **Step 7: Full verification**

```bash
python3 -m unittest discover -s dewey_time/tests -t .
cd dewey_time/frontend/hr_attendance && npm run test:web && npx tsc --noEmit
```

Expected: backend green, frontend green, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test(coverage): put the register inside every guard it escaped

The original defect existed because this surface sat outside all of them:
page-insets.spec.ts measures gutter geometry on every route the shell wraps but
the biometrics page could never be added (its helper throws without a
[data-slot=\"page\"], which that page never rendered); no e2e spec visited the
route; and the chrome test named WeeklySchedulePage rather than the class of
routed pages.

chromeMigration now enumerates every *Page.tsx and asserts <Page> on all of
them, so the next surface cannot opt out silently.

Includes the rebuilt SPA bundles — they are the deployed artifact.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

## Self-review

**Spec coverage.** Structure → Task 7. Alert dot and its three states → Tasks 4, 6. Columns → Task 6. Filters/sort/severity → Task 3. Client-side join and feed independence → Tasks 2, 5. Failure states → Task 4 (logic), Task 7 (rendering). Branch backend change → Task 1. Testing and enforcement → Task 8. Deferred `/dashboard` items → correctly absent.

**Placeholders.** None: every step carries the code or the exact command.

**Type consistency.** `RegisterRow`, `RegisterFilters`, `FeedHealth`, `RegisterAlert` are defined in Task 2/3/4 and used unchanged after. Column ids in Task 6 are pinned against `visibleColumnIds` from Task 4 by a test asserting both directions.

**Known risks for the implementer.** Each verified against the real source while
writing this plan, so none of them is a guess:

1. `GenericDataTable`'s `TFilters extends BaseFilters` expects
   `page`/`limit`/`sort`/`order`/`search`, all optional. `RegisterFilters`
   supplies `search`, `sort`, `order`. If TS complains, widen `RegisterFilters`
   — never change the primitive.
2. The primitive forwards `actions` straight through as react-table `meta`.
   This plan passes callbacks by closure in `registerColumns` instead, which
   sidesteps the `BaseTableActions` TS2559 trap documented at
   `adms/src/components/users/data-table.tsx:66-71`.
3. `formatScheduleDuration(totalMinutes: number)` (`weekSchedule.ts:107`)
   already returns `"—"` for `<= 0`, which is exactly the unresolved-SSA case —
   do not add a second guard around it.
4. `AttentionStrip`'s tone union is **only** `"amber" | "accent"`
   (`notice.tsx:19`). A plan on the previous branch specified `"destructive"`
   and `"warning"`; neither exists and typecheck fails.
5. `FailureBlock` (`notice.tsx:76`) carries a 13rem min-height and is a
   full-region placeholder. Use it only for the both-feeds-failed case, never
   as a banner above a working table.
6. Badge variants that exist: `default`, `secondary`, `destructive`, `outline`.
7. Frontend tests use `node:test`, **not vitest** — and `test:web`'s glob is a
   list, so `src/ui/coverageRegister.test.tsx` is inside it while a file in
   `src/hooks/` would not be.
8. If a mutation check on Python code behaves impossibly, clear
   `~/Library/Caches/com.apple.python` as well as `__pycache__` — Apple's
   `python3` keeps a second bytecode cache that survives `-B` and has already
   cost one full debugging detour on this codebase.
