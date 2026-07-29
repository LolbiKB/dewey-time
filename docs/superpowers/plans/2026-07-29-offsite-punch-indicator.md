# Off-site Punch Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show HR at a glance which worked time happened at a site other than the employee's primary one, as a quiet note rather than an alarm.

**Architecture:** Detection already exists and is untouched. The backend exposes the employee's primary branch in the calendar payload (it is already computed, just never returned), reclassifies the flag from `WARNING` to `INFO`, and backfills existing rows. The frontend compares each worked segment's branch against that value and renders a diagonal hatch on the ones that differ.

**Tech Stack:** Python 3 / Frappe v16 (backend, `unittest` via `bench run-tests`), React 19 + TypeScript + TailwindCSS v4 (frontend, `tsx --test` + `renderToStaticMarkup`), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-29-offsite-punch-indicator-design.md`

## Global Constraints

- **Detection logic must not change.** `_non_primary_site_punch_flag` (`closeout.py:395`) and the equivalent block in `intraday.py:113` are out of bounds. This plan changes only how the existing signal is classified and displayed.
- **`FLAG_SEVERITY` is duplicated** in `dewey_time/attendance_engine/closeout.py:61` and `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py:6`. Any severity change must be made in **both**, or they silently diverge.
- **No orange.** `--brand-accent: #c2410c` is reserved as "the urgent / attention signal" (`src/brand/tokens.css:14`) and is already used by device alerts and holiday cells. The off-site marker introduces no new colour — it is a white-overlay texture on the existing fill.
- **The hatch applies only to worked (green) segments.** Never to accent/off-shift segments, never to gap bands (missing-time, away, lunch).
- **A blank `employee_branch` must produce no hatch anywhere.** Many employees have no `Employee.branch` set; a naive `!==` comparison marks every segment off-site for all of them. The backend already guards this (`if not employee_branch: return None`).
- **Built assets are the deployed artifact and MUST be committed.** After frontend changes, run `npm run build` from `dewey_time/frontend/hr_attendance/` and commit `dewey_time/public/hr_attendance/**` plus `dewey_time/www/hr-{attendance,schedule}.html` in the same PR. Frappe Cloud never builds this SPA.
- **A patch file without a `dewey_time/patches.txt` entry never runs.**

---

### Task 1: Expose the employee's primary branch in the calendar payload

Nothing else in this plan works until this lands — the frontend currently has no way to know which segment is off-site.

**Files:**
- Modify: `dewey_time/attendance_engine/hr_calendar.py:643-651`
- Test: `dewey_time/tests/test_hr_calendar.py` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `get_employee_calendar()` returns an additional key `"employee_branch": str | None` — the value of `Employee.branch` for the requested employee. Task 5 consumes it as `payload.employee_branch`.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/tests/test_hr_calendar.py`. Note the `getdate` patch: the shared mock harness sets `frappe.utils.getdate = lambda value: value` (identity), which leaves `start`/`end` as **strings**, and `get_employee_calendar` advances its day loop with `cur + timedelta(days=1)` (`hr_calendar.py:641`). Without a real date the call raises `TypeError`.

```python
class TestCalendarPayloadEmployeeBranch(unittest.TestCase):
    """The payload must carry the employee's primary branch: the SPA compares each
    punch's device branch against it, and cannot do so if it is never sent."""

    def _call(self, branch):
        from datetime import date as _date

        import dewey_time.attendance_engine.hr_calendar as hc

        def _get_value(doctype, name, field=None, *args, **kwargs):
            if doctype == "Employee" and field == "branch":
                return branch
            return None

        with patch.object(hc, "_require_calendar_access"), patch.object(
            hc, "getdate", lambda v: _date.fromisoformat(str(v))
        ), patch.object(hc, "get_datetime", lambda v: str(v)), patch.object(
            hc.frappe.db, "get_value", side_effect=_get_value
        ), patch.object(
            hc.frappe, "get_all", return_value=[]
        ), patch.object(
            hc.frappe.db, "table_exists", return_value=False
        ):
            return hc.get_employee_calendar("EMP-001", "2026-07-27", "2026-07-27")

    def test_payload_exposes_employee_branch(self):
        self.assertEqual(self._call("BRANCH-A")["employee_branch"], "BRANCH-A")

    def test_payload_exposes_none_when_branch_unset(self):
        payload = self._call(None)
        self.assertIn("employee_branch", payload)
        self.assertIsNone(payload["employee_branch"])
```

If the call raises because it reaches a frappe attribute the harness has not stubbed, **extend the `patch.object` list — do not weaken the assertions.** The assertions are the requirement.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_hr_calendar`

Expected: FAIL with `KeyError: 'employee_branch'`.

- [ ] **Step 3: Add the key to the payload**

In `dewey_time/attendance_engine/hr_calendar.py`, the return of `get_employee_calendar`:

```python
    return {
        "employee": employee,
        "start_date": str(start),
        "end_date": str(end),
        "days": days,
        "device_alerts": device_alerts,
        "device_sync": device_sync,
        # The employee's primary site. Already resolved above for the closeout-alert
        # and sync-status lookups, so this adds no query. The SPA needs it to tell
        # which punches happened somewhere other than home; without it the client
        # cannot make that comparison at all. May be None — a great many employees
        # have no branch set, and every consumer must treat that as "do not judge".
        "employee_branch": employee_branch,
        **_employee_nav_meta(employee),
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_hr_calendar`

Expected: PASS, and the module's other tests still pass (25 before this change).

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/hr_calendar.py dewey_time/tests/test_hr_calendar.py
git commit -m "feat(hr-calendar): return employee_branch in the calendar payload"
```

---

### Task 2: Reclassify NON_PRIMARY_SITE_PUNCH from WARNING to INFO

**Files:**
- Modify: `dewey_time/attendance_engine/closeout.py:61-76`
- Modify: `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py:6-20`
- Test: `dewey_time/tests/test_closeout.py` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `FLAG_SEVERITY["NON_PRIMARY_SITE_PUNCH"] == "INFO"` in both modules. Task 3 backfills rows written before this.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/tests/test_closeout.py`:

```python
class TestNonPrimarySiteSeverity(unittest.TestCase):
    """Punching at another site is a note, not a warning — HR described it as
    "not a major offense" and something the employee can justify."""

    def test_severity_is_info_in_closeout(self):
        from dewey_time.attendance_engine.closeout import FLAG_SEVERITY

        self.assertEqual(FLAG_SEVERITY["NON_PRIMARY_SITE_PUNCH"], "INFO")

    def test_severity_is_info_in_doctype(self):
        from dewey_time.dewey_time.doctype.attendance_flag.attendance_flag import (
            FLAG_SEVERITY as DOCTYPE_SEVERITY,
        )

        self.assertEqual(DOCTYPE_SEVERITY["NON_PRIMARY_SITE_PUNCH"], "INFO")

    def test_the_two_severity_maps_agree(self):
        """They are duplicated, so they can drift. Pin them together: a future
        edit to one is then a failing test rather than a silent inconsistency."""
        from dewey_time.attendance_engine.closeout import FLAG_SEVERITY
        from dewey_time.dewey_time.doctype.attendance_flag.attendance_flag import (
            FLAG_SEVERITY as DOCTYPE_SEVERITY,
        )

        self.assertEqual(FLAG_SEVERITY, DOCTYPE_SEVERITY)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_closeout`

Expected: the first two FAIL with `'WARNING' != 'INFO'`. `test_the_two_severity_maps_agree` PASSES already (they start identical) — that is correct; it is a guard against the next edit, and it must still pass at the end of this task.

- [ ] **Step 3: Change both maps**

In `dewey_time/attendance_engine/closeout.py`, within `FLAG_SEVERITY`:

```python
    "NON_PRIMARY_SITE_PUNCH": "INFO",
```

In `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py`, within `FLAG_SEVERITY`, make the identical change:

```python
    "NON_PRIMARY_SITE_PUNCH": "INFO",
```

Change nothing else in either dict.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_closeout`

Expected: all three PASS, and the rest of the module is unaffected.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/closeout.py dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py dewey_time/tests/test_closeout.py
git commit -m "feat(flags): NON_PRIMARY_SITE_PUNCH is INFO, not WARNING"
```

---

### Task 3: Backfill existing NON_PRIMARY_SITE_PUNCH rows to INFO

Severity is stamped at insert (`attendance_flag.py` `before_insert`), so rows written before Task 2 keep `WARNING`. Without this, the same flag reads differently depending on when it was generated, and historical weeks keep an inflated warning count.

**Files:**
- Create: `dewey_time/patches/non_primary_site_punch_severity_to_info.py`
- Modify: `dewey_time/patches.txt` (append one line)
- Test: `dewey_time/tests/test_non_primary_severity_patch.py`

**Interfaces:**
- Consumes: `FLAG_SEVERITY["NON_PRIMARY_SITE_PUNCH"] == "INFO"` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_non_primary_severity_patch.py`:

```python
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


class TestNonPrimarySeverityPatch(unittest.TestCase):
    def test_patch_updates_only_non_primary_rows(self):
        from dewey_time.patches import non_primary_site_punch_severity_to_info as patch_mod

        with patch.object(patch_mod.frappe.db, "sql") as sql:
            patch_mod.execute()

        self.assertEqual(sql.call_count, 1)
        statement = sql.call_args[0][0]
        self.assertIn("tabAttendance Flag", statement)
        self.assertIn("NON_PRIMARY_SITE_PUNCH", statement)
        self.assertIn("INFO", statement)

    def test_patch_is_idempotent_by_construction(self):
        """It must skip rows already at INFO, so a second migrate is a no-op
        rather than a full-table rewrite."""
        from dewey_time.patches import non_primary_site_punch_severity_to_info as patch_mod

        with patch.object(patch_mod.frappe.db, "sql") as sql:
            patch_mod.execute()

        statement = " ".join(sql.call_args[0][0].split())
        self.assertIn("severity != 'INFO'", statement)

    def test_registered_in_patches_txt(self):
        """A patch file with no manifest entry never runs."""
        from pathlib import Path

        manifest = Path(__file__).resolve().parents[1] / "patches.txt"
        self.assertIn(
            "dewey_time.patches.non_primary_site_punch_severity_to_info",
            manifest.read_text(),
        )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_non_primary_severity_patch`

Expected: FAIL with `ModuleNotFoundError: No module named 'dewey_time.patches.non_primary_site_punch_severity_to_info'`.

- [ ] **Step 3: Write the patch**

Create `dewey_time/patches/non_primary_site_punch_severity_to_info.py`:

```python
import frappe


def execute():
    """Re-rate historical NON_PRIMARY_SITE_PUNCH flags from WARNING to INFO.

    Severity is stamped once, at insert (see AttendanceFlag.before_insert), so
    changing FLAG_SEVERITY only affects rows generated afterwards. Left alone,
    the same flag would read as a warning on last month's days and a note on
    this month's, and historical weeks would keep an inflated warning count.

    Idempotent: the `severity != 'INFO'` guard means a second run matches
    nothing rather than rewriting every row.
    """
    frappe.db.sql(
        """
        UPDATE `tabAttendance Flag`
        SET severity = 'INFO'
        WHERE flag_code = 'NON_PRIMARY_SITE_PUNCH' AND severity != 'INFO'
        """
    )
```

- [ ] **Step 4: Register it in the manifest**

Append to `dewey_time/patches.txt` as the last line:

```
dewey_time.patches.non_primary_site_punch_severity_to_info
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_non_primary_severity_patch`

Expected: all three PASS.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/patches/non_primary_site_punch_severity_to_info.py dewey_time/patches.txt dewey_time/tests/test_non_primary_severity_patch.py
git commit -m "feat(patch): backfill NON_PRIMARY_SITE_PUNCH severity to INFO"
```

---

### Task 4: The off-site predicate

A pure function, isolated so the null cases can be pinned exhaustively without rendering anything. This is where the plan's highest-risk requirement lives.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/attendanceTime.ts` (append)
- Test: `dewey_time/frontend/hr_attendance/src/lib/attendanceTime.test.ts` (append; create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `isOffSiteSegment(segmentBranch: string | null | undefined, employeeBranch: string | null | undefined): boolean` — exported from `@/lib/attendanceTime`. Task 5 calls it.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/frontend/hr_attendance/src/lib/attendanceTime.test.ts`. If the file does not exist, create it with this header first:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { isOffSiteSegment } from "./attendanceTime";
```

Then the tests:

```ts
test("off-site: a different branch is off-site", () => {
  assert.equal(isOffSiteSegment("BRANCH-B", "BRANCH-A"), true);
});

test("off-site: the same branch is not", () => {
  assert.equal(isOffSiteSegment("BRANCH-A", "BRANCH-A"), false);
});

test("off-site: an unknown punch branch is never off-site", () => {
  // A punch with no device branch is UNKNOWN_DEVICE_BRANCH / ATTENDANCE_ISSUE's
  // problem. Claiming it is off-site would assert a location we do not have.
  assert.equal(isOffSiteSegment(null, "BRANCH-A"), false);
  assert.equal(isOffSiteSegment(undefined, "BRANCH-A"), false);
  assert.equal(isOffSiteSegment("", "BRANCH-A"), false);
});

test("off-site: nothing is off-site when the employee has no primary branch", () => {
  // THE case to get right. Many employees have a blank Employee.branch; a naive
  // `a !== b` marks every segment off-site for all of them, hatching the whole
  // screen. Matches the backend, which no-ops on a falsy employee_branch.
  assert.equal(isOffSiteSegment("BRANCH-B", null), false);
  assert.equal(isOffSiteSegment("BRANCH-B", undefined), false);
  assert.equal(isOffSiteSegment("BRANCH-B", ""), false);
  assert.equal(isOffSiteSegment("BRANCH-B", "   "), false);
});

test("off-site: comparison ignores surrounding whitespace", () => {
  assert.equal(isOffSiteSegment(" BRANCH-A ", "BRANCH-A"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/attendanceTime.test.ts`

Expected: FAIL — `isOffSiteSegment` is not exported.

- [ ] **Step 3: Implement the predicate**

Append to `dewey_time/frontend/hr_attendance/src/lib/attendanceTime.ts`:

```ts
/**
 * Did this segment's punches happen somewhere other than the employee's primary site?
 *
 * Both blanks are deliberately NOT off-site, and for different reasons:
 * - no punch branch → the location is unknown, not elsewhere; that is
 *   ATTENDANCE_ISSUE's job, and asserting "off-site" would invent a fact.
 * - no employee branch → there is no primary site to be away from. A great many
 *   employees have `Employee.branch` unset, and treating that as "everywhere is
 *   off-site" would mark their entire calendar. The backend guards the same way
 *   (`if not employee_branch: return None`).
 */
export function isOffSiteSegment(
  segmentBranch: string | null | undefined,
  employeeBranch: string | null | undefined,
): boolean {
  const segment = (segmentBranch ?? "").trim();
  const primary = (employeeBranch ?? "").trim();
  if (!segment || !primary) return false;
  return segment !== primary;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/attendanceTime.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify the tests are load-bearing (mutation check)**

Temporarily change the implementation's guard to `if (!segment) return false;` (dropping the `!primary` half), re-run the test, and confirm **"nothing is off-site when the employee has no primary branch"** fails. Restore the correct implementation and confirm the suite is green again. Do not commit the mutation.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/attendanceTime.ts dewey_time/frontend/hr_attendance/src/lib/attendanceTime.test.ts
git commit -m "feat(hr-attendance): add isOffSiteSegment predicate"
```

---

### Task 5: Thread the primary branch through and render the hatch

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/types/calendar.ts:90-102`
- Modify: `dewey_time/frontend/hr_attendance/src/brand/base.css` (append)
- Modify: `dewey_time/frontend/hr_attendance/src/ui/App.tsx` (two call sites)
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeekView.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeekDayView.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/DayTimeline.tsx`
- Test: `dewey_time/frontend/hr_attendance/src/ui/offSiteSegment.test.tsx` (create)

**Interfaces:**
- Consumes: `isOffSiteSegment` from `@/lib/attendanceTime` (Task 4); `payload.employee_branch` from Task 1.
- Produces: a new optional prop `employeeBranch?: string | null` on `WeekView`, `WeekDayView`, and `DayCell`; the CSS class `seg-offsite` on qualifying segments.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/frontend/hr_attendance/src/ui/offSiteSegment.test.tsx`:

```tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { WeekView } from "./WeekView";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** One 08:00–17:00 worked day per date, punched at `branch`. */
function weekAt(branch: string, shiftAssigned: boolean): Map<string, Day> {
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: shiftAssigned
            ? {
                shift_assigned: true,
                shift_type: "FT",
                start_time: "08:00:00",
                end_time: "17:00:00",
                lunch_start: "12:00:00",
                lunch_end: "13:00:00",
              }
            : { shift_assigned: false },
          checkins: [
            { time: `${date} 08:00:00`, custom_device_branch: branch },
            { time: `${date} 17:00:00`, custom_device_branch: branch },
          ],
          gross_minutes: 540,
        } satisfies Day,
      ];
    }),
  );
}

function render(days: Map<string, Day>, employeeBranch: string | null): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={WEEK}
        daysByDate={days}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        employeeBranch={employeeBranch}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

test("a worked segment punched at another site is hatched", () => {
  assert.match(render(weekAt("BRANCH-B", true), "BRANCH-A"), /seg-offsite/);
});

test("a worked segment punched at the home site is not hatched", () => {
  assert.doesNotMatch(render(weekAt("BRANCH-A", true), "BRANCH-A"), /seg-offsite/);
});

test("nothing is hatched when the employee has no primary branch", () => {
  // The failure that would hit the most employees: blank Employee.branch must
  // not turn the whole calendar into off-site.
  assert.doesNotMatch(render(weekAt("BRANCH-B", true), null), /seg-offsite/);
  assert.doesNotMatch(render(weekAt("BRANCH-B", true), ""), /seg-offsite/);
});

test("gap bands never carry the hatch", () => {
  // The lunch band sits inside an off-site day, so a selector that matched every
  // positioned block would hatch it too — which is exactly what happened while
  // mocking this up. Only the worked segments may carry it.
  const html = render(weekAt("BRANCH-B", true), "BRANCH-A");
  const bands = html.match(/class="[^"]*bg-muted[^"]*"/g) ?? [];
  for (const band of bands) {
    assert.doesNotMatch(band, /seg-offsite/, `a gap band was hatched: ${band}`);
  }
});

test("an off-shift (accent-toned) segment is never hatched, even at another site", () => {
  // Such a day already renders salmon with dashed red borders — the
  // OFF_SHIFT_PUNCH language. A second marker there buys nothing and the
  // white hatch is invisible on that fill anyway.
  assert.doesNotMatch(render(weekAt("BRANCH-B", false), "BRANCH-A"), /seg-offsite/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/ui/offSiteSegment.test.tsx`

Expected: FAIL — `WeekView` has no `employeeBranch` prop (TypeScript error), and no `seg-offsite` class exists.

- [ ] **Step 3: Add the payload type**

In `src/types/calendar.ts`, inside `CalendarPayload`, after `is_clock_based?: boolean;`:

```ts
  /** The employee's primary site (Employee.branch). Null/absent for the many
   *  employees who have none — consumers must treat that as "do not judge". */
  employee_branch?: string | null;
```

- [ ] **Step 4: Add the hatch class**

Append to `src/brand/base.css`:

```css
/* —— off-site punch: a worked segment recorded at a site other than the
   employee's primary one ——
   Texture, not colour. The orange accent above is reserved for the urgent
   signal and is already spent on device alerts and holidays; this is a minor
   note the employee can usually explain, so it must not borrow that weight.
   Being a background-image, it layers over the segment's existing fill and
   survives at any block height — unlike a badge, which vanishes on short
   segments. */
.seg-offsite {
  background-image: repeating-linear-gradient(
    135deg,
    rgb(255 255 255 / 0.13) 0 5px,
    transparent 5px 13px
  );
}
```

- [ ] **Step 5: Thread the prop through the two week surfaces**

In `src/ui/WeekView.tsx`, add to `WeekViewProps`:

```ts
  employeeBranch?: string | null;
```

and pass it to each `DayCell` in the timeline grid, alongside the existing props:

```tsx
                employeeBranch={props.employeeBranch}
```

In `src/ui/WeekDayView.tsx`, add the same field to `WeekDayViewProps`:

```ts
  employeeBranch?: string | null;
```

and pass it to the single `DayCell`:

```tsx
            employeeBranch={props.employeeBranch}
```

- [ ] **Step 6: Thread it into DayTimeline and apply the class**

In `src/ui/DayTimeline.tsx`, add to the `DayCell` props object:

```ts
  employeeBranch?: string | null;
```

pass it down where `DayCell` renders `DayDayTrack`:

```tsx
              employeeBranch={props.employeeBranch}
```

add the same field to the `DayDayTrack` props object:

```ts
  employeeBranch?: string | null;
```

import the predicate at the top of the file:

```ts
import { isOffSiteSegment } from "@/lib/attendanceTime";
```

and in the segment `.map(...)` (the block whose className currently reads `workedTone ? cn(color, "shadow-sm ring-1 ring-foreground/10") : offShiftSegmentClass`), compute the flag next to the existing `branchLabel` line:

```tsx
            const branchLabel = formatBranchLabel(s.branch);
            // Only worked (green) segments carry it: an off-shift day is already
            // salmon with dashed red borders, and stacking a second signal there
            // makes the louder one harder to read.
            const offSite = workedTone && isOffSiteSegment(s.branch, props.employeeBranch);
```

then extend that className:

```tsx
                  className={cn(
                    "absolute inset-x-2 rounded-sm",
                    workedTone
                      ? cn(color, "shadow-sm ring-1 ring-foreground/10")
                      : offShiftSegmentClass,
                    offSite && "seg-offsite"
                  )}
```

Apply it **only** here. Do not touch the gap-band renderers (missing-time, away, lunch) or the `DayDaySpan` fallback.

- [ ] **Step 7: Wire the payload value at the call sites**

In `src/ui/App.tsx`, both the `<WeekDayView ... />` and `<WeekView ... />` elements gain, next to the existing `isClockBased` prop:

```tsx
                      employeeBranch={payload.employee_branch ?? null}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/ui/offSiteSegment.test.tsx`

Expected: all four PASS.

- [ ] **Step 9: Verify the tests are load-bearing (mutation check)**

Temporarily drop `workedTone &&` from the `offSite` expression and confirm **"an off-shift (accent-toned) segment is never hatched"** fails and the others still pass. Restore it, confirm green, and do not commit the mutation.

- [ ] **Step 10: Run the whole frontend suite and typecheck**

Run: `cd dewey_time/frontend/hr_attendance && npm run test:web && npx tsc --noEmit`

Expected: all tests pass. `tsc` reports only the pre-existing `TS5101` `baseUrl` deprecation from `tsconfig.json` — no other errors.

- [ ] **Step 11: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/types/calendar.ts dewey_time/frontend/hr_attendance/src/brand/base.css dewey_time/frontend/hr_attendance/src/ui/App.tsx dewey_time/frontend/hr_attendance/src/ui/WeekView.tsx dewey_time/frontend/hr_attendance/src/ui/WeekDayView.tsx dewey_time/frontend/hr_attendance/src/ui/DayTimeline.tsx dewey_time/frontend/hr_attendance/src/ui/offSiteSegment.test.tsx
git commit -m "feat(hr-attendance): hatch worked segments punched at another site"
```

---

### Task 6: Neutral wording

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagLabels.ts:13` and `:72`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagDetails.ts:57-58`
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagLabels.test.ts` (append; create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `FLAG_FILTER_GROUPS.otherSite` replaces `FLAG_FILTER_GROUPS.wrongSite`.

- [ ] **Step 1: Find every consumer of the old key**

Run: `cd dewey_time/frontend/hr_attendance && grep -rn "wrongSite" src/`

Record the list. Every hit must be updated in Step 4 — the filter UI reads `FLAG_FILTER_GROUPS`, so a missed rename silently drops the filter.

- [ ] **Step 2: Write the failing test**

Append to `src/lib/flagLabels.test.ts`. If the file does not exist, create it with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { FLAG_LABELS, FLAG_FILTER_GROUPS } from "./flagLabels";
```

Then:

```ts
test("the off-site flag is worded as a note, not an accusation", () => {
  // HR's framing: "not a major offense, but nice to know and employee can justify".
  assert.equal(FLAG_LABELS.NON_PRIMARY_SITE_PUNCH, "Other site");
});

test("the filter group is renamed to match", () => {
  assert.deepEqual(FLAG_FILTER_GROUPS.otherSite, ["NON_PRIMARY_SITE_PUNCH"]);
  assert.equal("wrongSite" in FLAG_FILTER_GROUPS, false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/flagLabels.test.ts`

Expected: FAIL — label is `"Wrong site"` and the group key is `wrongSite`.

- [ ] **Step 4: Apply the rewording**

In `src/lib/flagLabels.ts`, change the label:

```ts
  NON_PRIMARY_SITE_PUNCH: "Other site",
```

and the filter-group key:

```ts
  otherSite: ["NON_PRIMARY_SITE_PUNCH"],
```

Then update every consumer found in Step 1 to use `otherSite`.

In `src/lib/flagDetails.ts`, replace the description:

```ts
  NON_PRIMARY_SITE_PUNCH:
    "At least one punch came from a site other than the employee's primary site. This is often expected — cover shifts, deliveries, or multi-site roles.",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd dewey_time/frontend/hr_attendance && npm run test:web && npx tsc --noEmit`

Expected: the new tests PASS, the full suite is green, and `tsc` reports only the pre-existing `TS5101`. A `tsc` error naming `wrongSite` means a consumer was missed in Step 4.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/flagLabels.ts dewey_time/frontend/hr_attendance/src/lib/flagDetails.ts dewey_time/frontend/hr_attendance/src/lib/flagLabels.test.ts
git commit -m "feat(hr-attendance): reword the off-site flag as a note"
```

---

### Task 7: Rebuild and commit the shipped bundle

This is a real deliverable, not bookkeeping. Assets went un-rebuilt from PR #58 through #74 — four PRs of frontend work that shipped nothing — because the built files look like generated clutter. If this task is skipped, Tasks 5 and 6 reach no user.

**Files:**
- Modify: `dewey_time/public/hr_attendance/**` (build output)
- Modify: `dewey_time/www/hr-attendance.html`, `dewey_time/www/hr-schedule.html`

**Interfaces:**
- Consumes: all frontend changes from Tasks 4–6.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Run the full frontend suite one last time**

Run: `cd dewey_time/frontend/hr_attendance && npm run test:web && npm run test:e2e`

Expected: unit tests green; e2e reports `28 passed` with the rest skipped.

- [ ] **Step 2: Build**

Run: `cd dewey_time/frontend/hr_attendance && npm run build`

Expected: `✓ built in …` followed by the `Copied … -> … hr-attendance.html, … hr-schedule.html` line.

- [ ] **Step 3: Confirm the shipped bundle actually contains the change**

Run:

```bash
cd /Users/lolbikb/projects/dewey-time
grep -c "seg-offsite" dewey_time/public/hr_attendance/assets/index.css
```

Expected: `1` or more. A `0` means the class was purged by Tailwind — check that `base.css` is imported by `src/index.css` and that the class name is written literally in `DayTimeline.tsx` rather than assembled from fragments.

- [ ] **Step 4: Commit the build output**

```bash
git add dewey_time/public/hr_attendance dewey_time/www/hr-attendance.html dewey_time/www/hr-schedule.html
git commit -m "build(hr-attendance): rebuild bundle with the off-site indicator"
```

---

## Manual verification before merge

Not a task — a checklist for the human, since two of these cannot be asserted in CI.

- [ ] `bench --site <site> migrate` runs the new patch without error, and a second `migrate` is a no-op.
- [ ] In the SPA, an employee with punches at another branch shows hatched segments; a colleague at their home branch does not.
- [ ] An employee with a blank `Employee.branch` shows **no** hatching at all.
- [ ] The chip reads "Other site", and the flag no longer counts toward the week's warning tally.
