# Flag Queue Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each queue entry into a person-first card — a 40px photo, a name, the finding in words, and a 14-cell fortnight strip — and fix `EmployeeAvatar` so a list of forty photos never shows a half-painted circle, an empty one, or an ambiguous set of initials.

**Architecture:** Two pure modules carry the logic and two thin components render it. `src/lib/avatarLoading.ts` is a four-phase state machine (`no-photo` / `loading` / `loaded` / `failed`) plus a delay-gated ring predicate; `src/lib/flagStrip.ts` turns a person's flags, the queried range and the outage set into a fixed-width array of cells. `EmployeeAvatar` layers initials underneath a fading photo, and `FlagStrip` renders cells whose height as well as colour carries severity. The backend adds three fields and restructures nothing.

**Tech Stack:** Python 3 (frappe-free pure module + one whitelisted API), `unittest`; React 19 + TypeScript, `node:test` via `tsx`, TailwindCSS v4.

**Spec:** `docs/superpowers/specs/2026-08-07-flag-queue-row-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-07-flag-queue-pattern-nesting.md`. That plan gives every flag its own `attendance_date` and every person a `dates` span and an `entry_key`. **Do not start this plan until that one is merged** — the strip cannot render dates the grouping does not yet produce.

## Global Constraints

1. **`flag_grouping.py` stays frappe-free.** No `import frappe`, no queries, no I/O.
2. **`flag_queue_api` keeps a FIXED query count** — five queries, always. This plan adds one *column* to an existing query, never a sixth query.
3. **The API stays unbounded and window-free.** It returns every flag in the queried range, each with its date; no fixed-size per-day array. The 14-day window is a decision the flag *page* makes when it renders, so a future employee-profile page can bucket the same payload into 90 cells without an API change.
4. **`test:web` is a NON-RECURSIVE per-directory glob.** The script is
   `tsx --test src/lib/*.test.ts src/brand/*.test.ts src/brand/*.test.tsx src/pwa/*.test.ts src/pwa/*.test.tsx src/components/*.test.tsx src/components/ui/*.test.tsx src/ui/*.test.tsx`.
   A test in `src/lib/` must end `.test.ts` (NOT `.tsx`); a test in `src/ui/` must end `.test.tsx`. Wrong directory or wrong extension → it silently never runs and the suite still exits 0.
5. **There is no DOM in the unit suite.** Every `.test.tsx` renders with `renderToStaticMarkup` — no jsdom, no `happy-dom`, no `react-dom/test-utils`, no `createRoot`. React state transitions therefore **cannot** be driven from a unit test. That is why the avatar's phase logic lives in a pure `src/lib` module: it is the only way the spec's `load` / `error` / delay assertions can actually fail. Do not add a DOM library to make a component test interactive.
6. **Baseline: `npm run test:web` reports `ℹ tests N` where N is whatever the nesting plan left it at.** Every frontend task must paste the `ℹ tests` / `ℹ pass` / `ℹ fail` lines. The count only ever goes up. An exit code alone is not evidence.
7. **Run every command from the repo root, and use `python3.13` for Python tests.**
   The Bash working directory persists between calls, so a `cd` into the frontend leaks
   into the next command — `cd "$(git rev-parse --show-toplevel)"` first when unsure.
   This machine's `python3` is **3.9.6**, which cannot import `test_flag_queue_api` at all
   (it pulls in `hooks.py`, whose `str | None` annotations are evaluated at runtime).
   `python3.13` is installed and is the only interpreter these commands work under.
8. **`node_modules` is absent from a fresh worktree** and `npm install` returns **401** (private `@lolbikb/dewey-ui`). Before any frontend command, from `dewey_time/frontend/hr_attendance/`:
   `ln -sfn /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance/node_modules node_modules`
   Never run `npm install` or `npm ci`.
9. **`EmployeeAvatar`'s props do not change.** It is the only `<img>` in the SPA and has four existing callers — `EmployeePicker`, `ScheduleEmployeePicker`, `ClearEmployeeScheduleDialog`, `schedule-coverage/EmployeeLine`. They inherit the improvement without edits, and any prop change turns a one-file task into a five-file one.
10. **No skeleton, no shimmer.** A pulsing grey circle replaces meaningful content (whose initials these are) with a meaningless placeholder. The initials are a *better* loading state than a skeleton because they already answer "who is this row about".
11. **Severity never rests on hue alone** — every strip cell encodes its tier in height as well as colour.
12. **Strip cells are not interactive.** At 6px they are not a click target; the row is. Cells are `aria-hidden`; the strip carries one summarising `aria-label`.
13. **Exact geometry, verbatim from the spec:** strip capped at **14 cells**; cells **6px** wide with **2.5px** gaps; avatar **40px**; ring **2px**; ring delay and fade both **~150ms**.
14. **Reduced motion changes both animations rather than removing them.** The fade becomes instant (`motion-reduce:transition-none`) — still an improvement, because the photo appears whole. The ring **stops rotating but stays on screen** as a static dimmed ring; dropping it would hand reduced-motion users back exactly the loading-versus-no-photo ambiguity it exists to remove.
15. **Built assets are the deployed artifact.** Frappe Cloud never builds this SPA. The final task rebuilds and commits `dewey_time/public/hr_attendance/**` and `dewey_time/www/hr-{attendance,schedule}.html`.
16. **`dewey_time/public/hr_attendance/assets/index-*.css` must be ≥ 150,000 bytes after a build.** Tailwind's `@source` is a filesystem glob; with no `node_modules` it silently emits ~90 kB and exits 0. `scripts/copy-html-entry.mjs` enforces the floor — do not weaken it.

---

## File Structure

| File | Responsibility | This plan |
|---|---|---|
| `dewey_time/attendance_engine/flag_queue_api.py` | Batched reads + payload | `image` column; `outage_dates` in the payload |
| `dewey_time/attendance_engine/flag_grouping.py` | Pure entry assembly | `employee_image` on each person |
| `src/lib/avatarLoading.ts` | **NEW** — avatar phase machine + ring predicate | Created |
| `src/lib/flagStrip.ts` | **NEW** — fortnight strip model | Created |
| `src/ui/EmployeeAvatar.tsx` | The SPA's only `<img>` | Rewritten (props unchanged) |
| `src/ui/FlagStrip.tsx` | **NEW** — the strip renderer | Created |
| `src/ui/FlagQueueList.tsx` | The list and its rows | Rows rebuilt person-first |
| `src/lib/flagQueueLabels.ts` | All HR-facing queue copy | `personSubline`, strip `aria-label`, "+N earlier" |
| `src/hooks/useFlagQueue.ts` | Query wrapper | Exposes `range` and `outageDates` |
| `src/ui/FlagQueuePage.tsx` | Page shell | Threads range + outage set to the list |

---

## Interface Contract

```python
# Person gains one field (Task 1)
"employee_image": str | None    # Employee.image, or None

# Payload gains one key (Task 1) — JSON-safe, so a list of objects, not a set of tuples
"outage_dates": [{"branch": str, "date": "YYYY-MM-DD"}, ...]
```

```ts
// src/lib/avatarLoading.ts (Task 2)
export type AvatarPhase = "no-photo" | "loading" | "loaded" | "failed";
export type AvatarEvent = "load" | "error";
export const AVATAR_RING_DELAY_MS = 150;
export function initialAvatarPhase(image: string | null | undefined): AvatarPhase;
export function nextAvatarPhase(phase: AvatarPhase, event: AvatarEvent): AvatarPhase;
export function showsPhoto(phase: AvatarPhase): boolean;
export function showsRing(phase: AvatarPhase, delayElapsed: boolean): boolean;

// src/lib/flagStrip.ts (Task 4)
export const STRIP_MAX_CELLS = 14;
export type StripCellState = "flagged" | "clean" | "no-data";
export type StripCell = { date: string; state: StripCellState; tier: Tier | null };
export type Strip = { cells: StripCell[]; flaggedCount: number; earlierCount: number };
export function outageKey(branch: string | null, date: string): string;
export function buildOutageSet(rows: { branch: string; date: string }[]): ReadonlySet<string>;
export function buildEmployeeFlagIndex(entries: QueueEntry[]): Map<string, FlagOut[]>;
export function buildStrip(args: {
  flags: FlagOut[];
  branch: string | null;
  startDate: string;
  endDate: string;
  outage: ReadonlySet<string>;
}): Strip;
```

---

### Task 1: The three data additions

`image` on the employee fetch, and the assembled outage set in the payload. Nothing is
restructured; `attendance_date` on each `FlagOut` already landed in the nesting plan.

**Files:**
- Modify: `dewey_time/attendance_engine/flag_queue_api.py:225-243` (`_employees_by_id`), `:332-372` (`_build_queue_payload`)
- Modify: `dewey_time/attendance_engine/flag_grouping.py` (`_person`'s returned dict)
- Test: `dewey_time/tests/test_flag_queue_api.py`, `dewey_time/tests/test_flag_grouping.py`

**Interfaces:**
- Consumes: the nesting plan's `_person(employee, person_flags, employees_by_id, *, entry_key)`.
- Produces: `employees_by_id[id]` gains `"image"`; each person gains `"employee_image"`; the payload gains `"outage_dates"`.

- [ ] **Step 1: Write the failing tests**

In `dewey_time/tests/test_flag_grouping.py`:

```python
class EmployeeImageTests(unittest.TestCase):
    def test_a_persons_photo_reaches_the_entry(self):
        result = build_queue(
            flags=[_flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})],
            decisions_by_identity={},
            employees_by_id={
                "EMP-1": {
                    "employee_name": "Sokheng Hon",
                    "branch": "HQ",
                    "image": "/files/sokheng.jpg",
                }
            },
            outage_branch_dates=set(),
        )
        self.assertEqual(result["entries"][0]["employee_image"], "/files/sokheng.jpg")

    def test_an_employee_with_no_photo_carries_none_not_a_missing_key(self):
        result = build_queue(
            flags=[_flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})],
            decisions_by_identity={},
            employees_by_id={"EMP-1": {"employee_name": "Sokheng Hon", "branch": "HQ"}},
            outage_branch_dates=set(),
        )
        self.assertIsNone(result["entries"][0]["employee_image"])
```

In `dewey_time/tests/test_flag_queue_api.py`. This module stubs `build_queue` and asserts
on its **inputs**; `_harness(rows)` drives the five real queries from canned rows,
`_roster(n)` builds them, and `h.recorder.kwargs_for(doctype)` returns the kwargs each
query was issued with. Add `import json` to the module's imports — it is not there yet.

```python
class TestEmployeePhoto(unittest.TestCase):
    def test_the_employee_query_selects_the_photo_column(self):
        # A column, not a query: the fixed five-query budget is the defining
        # constraint of this endpoint.
        with _harness(_roster(2)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            fields = h.recorder.kwargs_for("Employee")[0]["fields"]
        self.assertIn("image", fields)

    def test_the_photo_reaches_build_queue_on_the_employee_meta(self):
        rows = _roster(1)
        rows["Employee"] = [{**_employee_row("HR-EMP-00000"), "image": "/files/sokheng.jpg"}]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            employees = h.build.call_args.kwargs["employees_by_id"]
        self.assertEqual(employees["HR-EMP-00000"]["image"], "/files/sokheng.jpg")

    def test_an_employee_with_no_photo_carries_none(self):
        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            employees = h.build.call_args.kwargs["employees_by_id"]
        self.assertIsNone(employees["HR-EMP-00000"]["image"])


class TestOutageDatesInPayload(unittest.TestCase):
    def test_a_branch_day_with_no_sync_row_reaches_the_payload(self):
        rows = _roster(2)
        rows["Device Sync Status"] = []  # nothing ever reported for BR-A that day
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["outage_dates"], [{"branch": "BR-A", "date": "2026-08-03"}])

    def test_a_branch_day_that_reported_is_not_an_outage(self):
        with _harness(_roster(2)):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["outage_dates"], [])

    def test_an_unresolved_alert_is_an_outage_even_with_a_sync_row(self):
        # `alerts` alone is not the signal and neither is the watermark: the
        # strip's grey state needs _outage_branch_dates' combination of both.
        rows = _roster(2)
        rows["Device Closeout Alert"] = [
            {
                "branch": "BR-A",
                "local_date": "2026-08-03",
                "status": "closure_failed",
                "last_error": None,
            }
        ]
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["outage_dates"], [{"branch": "BR-A", "date": "2026-08-03"}])

    def test_outage_dates_are_json_safe(self):
        # The payload is cached and returned over the wire; a set of tuples is
        # neither serialisable nor stably ordered.
        rows = _roster(2)
        rows["Device Sync Status"] = []
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        json.dumps(payload["outage_dates"])
        self.assertIsInstance(payload["outage_dates"], list)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping.EmployeeImageTests -v
python3.13 -m unittest dewey_time.tests.test_flag_queue_api -v
```
Expected: FAIL — `KeyError: 'employee_image'`, and `KeyError: 'outage_dates'`.

- [ ] **Step 3: Select the photo column**

In `flag_queue_api.py`, `_employees_by_id`:

```python
    rows = (
        frappe.get_all(
            "Employee",
            filters={"name": ["in", sorted(employee_ids)]},
            fields=["name", "employee_name", "branch", "image"],
        )
        or []
    )
    # Keyed "branch"/"image", not "employee_branch"/"employee_image":
    # flag_grouping._person reads meta["branch"] and meta["image"], and a
    # mismatch silently drops every branch group / every photo.
    return {
        row["name"]: {
            "employee_name": row.get("employee_name"),
            "branch": row.get("branch"),
            "image": row.get("image"),
        }
        for row in rows
    }
```

- [ ] **Step 4: Carry it onto the person**

In `flag_grouping.py`'s `_person`, beside `employee_branch`:

```python
        "employee_branch": meta.get("branch"),
        # Employee.image — a site-relative path like "/files/sokheng.jpg", or
        # None for the many employees with no photo on file. The row renders
        # initials for None, which is a real avatar rather than a placeholder.
        "employee_image": meta.get("image"),
```

- [ ] **Step 5: Surface the outage set**

In `_build_queue_payload`, hoist the outage set so it can be both passed to `build_queue`
and returned:

```python
    outage_branch_dates = _outage_branch_dates(
        flags=flags,
        employees_by_id=employees_by_id,
        alert_rows=alert_rows,
        sync_pairs=sync_pairs,
    )

    queue = build_queue(
        flags=flags,
        decisions_by_identity=decisions_by_identity,
        employees_by_id=employees_by_id,
        outage_branch_dates=outage_branch_dates,
        include_decided=include_decided,
    )
```

and add to the returned dict, beside `alerts`:

```python
        # The assembled (branch, date) outage set, so the strip can render "no
        # data" grey rather than clean green. `alerts` alone is not enough:
        # _outage_branch_dates combines unresolved closeout alerts AND branch-days
        # with no device-sync watermark at all, and a naive "no flag -> green"
        # would tell HR someone was fine on a day nobody measured them.
        #
        # A sorted list of objects, not a set of tuples: the payload is cached
        # and JSON-encoded, and a set is neither serialisable nor stably ordered.
        "outage_dates": [
            {"branch": branch, "date": day} for branch, day in sorted(outage_branch_dates)
        ],
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping dewey_time.tests.test_flag_queue_api -v
```
Expected: PASS both. Report the `Ran N tests` lines.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/flag_queue_api.py \
        dewey_time/attendance_engine/flag_grouping.py \
        dewey_time/tests/test_flag_queue_api.py \
        dewey_time/tests/test_flag_grouping.py
git commit -m "feat(flag-queue): employee photos and the outage set in the payload"
```

---

### Task 2: The avatar phase machine

A pure module, because the unit suite has no DOM (Global Constraint 5) and every one of the
spec's avatar-loading assertions is about a transition. Put this logic in the component and
none of it can be tested; put it here and all of it can.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/lib/avatarLoading.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/avatarLoading.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AvatarPhase`, `AvatarEvent`, `AVATAR_RING_DELAY_MS`, `initialAvatarPhase`, `nextAvatarPhase`, `showsPhoto`, `showsRing` — exactly as declared in the Interface Contract.

- [ ] **Step 1: Write the failing test**

Create `src/lib/avatarLoading.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AVATAR_RING_DELAY_MS,
  initialAvatarPhase,
  nextAvatarPhase,
  showsPhoto,
  showsRing,
} from "@/lib/avatarLoading";

test("an employee with no photo starts settled, never loading", () => {
  assert.equal(initialAvatarPhase(null), "no-photo");
  assert.equal(initialAvatarPhase(undefined), "no-photo");
  assert.equal(initialAvatarPhase(""), "no-photo");
});

test("an employee with a photo starts loading", () => {
  assert.equal(initialAvatarPhase("/files/sokheng.jpg"), "loading");
});

test("a load settles to loaded and an error settles to failed", () => {
  assert.equal(nextAvatarPhase("loading", "load"), "loaded");
  assert.equal(nextAvatarPhase("loading", "error"), "failed");
});

test("a late event after settling changes nothing", () => {
  // A browser can fire error after load on a replaced src. Blanking a photo
  // that already painted would be a worse bug than the one this fixes.
  assert.equal(nextAvatarPhase("loaded", "error"), "loaded");
  assert.equal(nextAvatarPhase("failed", "load"), "failed");
  assert.equal(nextAvatarPhase("no-photo", "load"), "no-photo");
});

test("the photo shows only once it has fully loaded", () => {
  assert.equal(showsPhoto("loaded"), true);
  assert.equal(showsPhoto("loading"), false);
  assert.equal(showsPhoto("failed"), false);
  assert.equal(showsPhoto("no-photo"), false);
});

test("no ring before the delay elapses — the anti-flicker property", () => {
  // A cached photo resolves in tens of milliseconds. An indicator that appears
  // and disappears inside 50ms reads as a flicker; across forty rows, as the
  // page malfunctioning.
  assert.equal(showsRing("loading", false), false);
});

test("a photo still loading after the delay gets the ring", () => {
  assert.equal(showsRing("loading", true), true);
});

test("the ring clears on both load and error", () => {
  // A failed photo must not leave a row spinning forever — the failure mode the
  // happy path hides.
  assert.equal(showsRing("loaded", true), false);
  assert.equal(showsRing("failed", true), false);
});

test("an employee with no photo never rings, however long the page is open", () => {
  assert.equal(showsRing("no-photo", true), false);
});

test("the delay is short enough to be invisible and long enough to gate a cached hit", () => {
  assert.equal(AVATAR_RING_DELAY_MS, 150);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance
ln -sfn /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance/node_modules node_modules
npm run test:web 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module '@/lib/avatarLoading'`.

- [ ] **Step 3: Write the module**

Create `src/lib/avatarLoading.ts`:

```ts
/**
 * The four states an avatar can be in, and when its loading ring is on screen.
 *
 * Pure on purpose. The unit suite renders components with `renderToStaticMarkup`
 * and installs no DOM, so a `load` or `error` event can never be fired at a
 * component in a test — every assertion about what happens when a photo arrives,
 * fails, or takes too long would be untestable if this logic lived in
 * `EmployeeAvatar`. It lives here so it can actually fail.
 *
 * Spec: docs/superpowers/specs/2026-08-07-flag-queue-row-design.md, "Avatar loading".
 */

/**
 * `no-photo` and `failed` are distinct even though both render initials: only
 * `failed` was ever waiting on the network, and conflating them would make the
 * ring's dismissal condition unexpressible.
 */
export type AvatarPhase = "no-photo" | "loading" | "loaded" | "failed";

export type AvatarEvent = "load" | "error";

/**
 * How long a photo may take before the ring appears.
 *
 * A cached photo resolves in tens of milliseconds, and an indicator that appears
 * and disappears inside 50ms reads as a flicker — across forty rows, as the page
 * malfunctioning. Nothing animates unless the photo is *still* loading when this
 * elapses, so the common fast case is completely still.
 */
export const AVATAR_RING_DELAY_MS = 150;

export function initialAvatarPhase(image: string | null | undefined): AvatarPhase {
  return image ? "loading" : "no-photo";
}

/**
 * Settled phases are terminal. A browser can fire `error` after `load` when a
 * src is replaced or a decode fails late; blanking a photo that already painted
 * would be a worse bug than the half-paint this whole module exists to fix.
 */
export function nextAvatarPhase(phase: AvatarPhase, event: AvatarEvent): AvatarPhase {
  if (phase !== "loading") return phase;
  return event === "load" ? "loaded" : "failed";
}

export function showsPhoto(phase: AvatarPhase): boolean {
  return phase === "loaded";
}

/**
 * The ring resolves an ambiguity the initials alone cannot: at a glance they
 * read identically whether a photo is still arriving or none exists. It is
 * gated on the delay so the fast path stays still, and it clears on BOTH
 * outcomes — a 404 that left the row spinning forever would be the failure mode
 * the happy path hides.
 */
export function showsRing(phase: AvatarPhase, delayElapsed: boolean): boolean {
  return phase === "loading" && delayElapsed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -12
```
Expected: `ℹ fail 0`, count up by 10. Paste the count lines.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/avatarLoading.ts \
        dewey_time/frontend/hr_attendance/src/lib/avatarLoading.test.ts
git commit -m "feat(avatar): a phase machine for photo loading, with a delayed ring"
```

---

### Task 3: EmployeeAvatar — initials underneath, photo over the top

One file, four callers inherit it. The current component renders the photo **or** the
initials; three defects follow from that `or`, and a list of forty photos is where all
three become obvious.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/EmployeeAvatar.tsx` (all 34 lines)
- Test: `dewey_time/frontend/hr_attendance/src/ui/employeeAvatar.test.tsx` (new)

**Interfaces:**
- Consumes: Task 2's `avatarLoading` module.
- Produces: nothing new. `EmployeeAvatarProps` is byte-identical (Global Constraint 9).

- [ ] **Step 1: Write the failing test**

Create `src/ui/employeeAvatar.test.tsx`:

```tsx
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EmployeeAvatar } from "@/ui/EmployeeAvatar";
import type { CalendarEmployee } from "@/types/calendar";

function employee(overrides: Partial<CalendarEmployee> = {}): CalendarEmployee {
  return { id: "EMP-1", label: "EMP-1 · Sokheng Hon", employee_name: "Sokheng Hon", ...overrides };
}

test("an employee with no photo renders initials, not a broken image", () => {
  const html = renderToStaticMarkup(<EmployeeAvatar employee={employee()} className="size-10" />);
  assert.match(html, />SH</);
  assert.equal(html.includes("<img"), false);
});

test("the initials are in the DOM while the photo is still loading", () => {
  // The property that stops the half-drawn paint: they are present BEFORE any
  // load event, not merely when `image` is absent.
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, />SH</);
  assert.match(html, /<img/);
});

test("the photo starts transparent and fades in", () => {
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, /opacity-0/);
  assert.match(html, /transition-opacity/);
});

test("reduced motion gets the photo whole rather than not at all", () => {
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, /motion-reduce:transition-none/);
});

test("the photo is non-urgent — decode never blocks paint, and forty rows do not all fetch", () => {
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.match(html, /decoding="async"/);
  assert.match(html, /loading="lazy"/);
});

test("no ring on first paint, even with a photo pending", () => {
  // The anti-flicker property, at the render layer: the delay has not elapsed.
  const html = renderToStaticMarkup(
    <EmployeeAvatar employee={employee({ image: "/files/sokheng.jpg" })} className="size-10" />,
  );
  assert.equal(html.includes('role="status"'), false);
});
```

Add a matching test to the shared-component suite so the ring's own markup is pinned once
it can render. Because the delay gate means static markup never shows it, assert the ring's
contract on the exported sub-component instead — export `AvatarLoadingRing` from
`EmployeeAvatar.tsx` and test it directly:

```tsx
test("the ring carries Spinner's accessibility contract even though it cannot take its shape", () => {
  const html = renderToStaticMarkup(<AvatarLoadingRing />);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Loading"/);
});

test("the ring spins, and stops rather than vanishing under reduced motion", () => {
  const html = renderToStaticMarkup(<AvatarLoadingRing />);
  assert.match(html, /animate-spin/);
  assert.match(html, /motion-reduce:animate-none/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -20
```
Expected: FAIL — no initials render alongside an `<img>`, no `opacity-0`, no
`decoding`/`loading` attributes, and `AvatarLoadingRing` is not exported.

- [ ] **Step 3: Rewrite the component**

Replace `src/ui/EmployeeAvatar.tsx` in full:

```tsx
import { useEffect, useState } from "react";

import { employeeInitials } from "@/lib/employeeCard";
import {
  AVATAR_RING_DELAY_MS,
  initialAvatarPhase,
  nextAvatarPhase,
  showsPhoto,
  showsRing,
} from "@/lib/avatarLoading";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";

export type EmployeeAvatarProps = {
  employee: CalendarEmployee | null;
  fallbackId?: string | null;
  className?: string;
  imageClassName?: string;
};

/**
 * A 2px arc travelling the circle's perimeter.
 *
 * Deliberately NOT the shared `Spinner` component. `Spinner` is a centred
 * `Loader2Icon`, and at 40px there is no room for a centred spinner and readable
 * initials at the same time — it would cover the very thing the base layer
 * exists to show. This takes `Spinner`'s accessibility contract even though it
 * cannot take its shape.
 *
 * Under reduced motion it stops rotating but STAYS on screen, dimmed. The signal
 * is what matters; spinning is only how it is usually delivered. Removing it
 * would hand those users back exactly the loading-versus-no-photo ambiguity the
 * ring exists to remove.
 */
export function AvatarLoadingRing() {
  return (
    <svg
      role="status"
      aria-label="Loading"
      viewBox="0 0 40 40"
      fill="none"
      className="pointer-events-none absolute inset-0 size-full animate-spin text-primary/70 motion-reduce:animate-none motion-reduce:text-muted-foreground/60"
    >
      {/* r=19 leaves the 2px stroke inside the 40px box. A 30-unit dash against
          the ~119-unit circumference is a quarter-turn arc — enough to read as
          motion without ringing the whole circle and competing with the photo
          that is about to land. */}
      <circle
        cx="20"
        cy="20"
        r="19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="30 90"
      />
    </svg>
  );
}

/**
 * The only `<img>` in the SPA.
 *
 * It used to render the photo OR the initials, and three defects followed from
 * that `or`: the photo painted in half-drawn as bytes arrived; a 404 left an
 * empty circle, because `alt=""` shows nothing; and nothing marked the image as
 * non-urgent, so decode could block.
 *
 * The fix is layering. The initials are the base layer, always rendered; the
 * photo sits on top at zero opacity and fades in on `load`. On `error` it stays
 * hidden and the initials simply remain. The avatar is then never empty, never
 * half-painted, and never a broken-image icon — every state is a real avatar.
 *
 * No skeleton or shimmer: a pulsing grey circle would replace meaningful content
 * (whose initials these are) with a meaningless placeholder. The initials are a
 * BETTER loading state than a skeleton because they already carry the answer to
 * "who is this row about".
 */
export function EmployeeAvatar(props: EmployeeAvatarProps) {
  const image = props.employee?.image ?? null;
  const [phase, setPhase] = useState(() => initialAvatarPhase(image));
  const [delayElapsed, setDelayElapsed] = useState(false);

  // Keyed on `src`: the same rendered avatar can be handed a different employee
  // as a list refetches, and a stale "loaded" would show the previous person's
  // photo under the new person's initials.
  useEffect(() => {
    setPhase(initialAvatarPhase(image));
    setDelayElapsed(false);
    if (!image) return;
    const timer = setTimeout(() => setDelayElapsed(true), AVATAR_RING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [image]);

  return (
    <span className={cn("relative shrink-0", props.className)}>
      <span
        className={cn(
          "flex size-full items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground",
          props.imageClassName
        )}
      >
        {employeeInitials(props.employee, props.fallbackId ?? null)}
        {image ? (
          <img
            src={image}
            alt=""
            decoding="async"
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setPhase((current) => nextAvatarPhase(current, "load"))}
            onError={() => setPhase((current) => nextAvatarPhase(current, "error"))}
            className={cn(
              "absolute inset-0 size-full rounded-full object-cover transition-opacity duration-150 motion-reduce:transition-none",
              showsPhoto(phase) ? "opacity-100" : "opacity-0"
            )}
          />
        ) : null}
      </span>
      {showsRing(phase, delayElapsed) ? <AvatarLoadingRing /> : null}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -12
npx tsc --noEmit 2>&1 | tail -20
```
Expected: `ℹ fail 0` and `tsc` clean. The four existing callers must still pass their own
suites — `EmployeePicker.test.tsx` in particular. Paste both.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/ui/EmployeeAvatar.tsx \
        dewey_time/frontend/hr_attendance/src/ui/employeeAvatar.test.tsx
git commit -m "fix(avatar): initials underneath, photo fades in over them, ring while in flight"
```

---

### Task 4: The strip model

A person's fortnight as an array of cells. Pure, because every rule worth testing here —
which day is grey rather than green, what happens past 14 days, whether a group member's
out-of-group flag shows — is arithmetic over the payload.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/lib/flagStrip.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagStrip.test.ts`

**Interfaces:**
- Consumes: `QueueEntry`, `FlagOut`, `Tier` from `@/types/flags`; Task 1's `outage_dates`.
- Produces: `STRIP_MAX_CELLS`, `StripCellState`, `StripCell`, `Strip`, `outageKey`, `buildOutageSet`, `buildEmployeeFlagIndex`, `buildStrip` — exactly as declared in the Interface Contract.

- [ ] **Step 1: Write the failing test**

Create `src/lib/flagStrip.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STRIP_MAX_CELLS,
  buildEmployeeFlagIndex,
  buildOutageSet,
  buildStrip,
  outageKey,
} from "@/lib/flagStrip";
import type { FlagOut, QueueEntry } from "@/types/flags";

function flag(date: string, code: string, tier: FlagOut["tier"], rank: number): FlagOut {
  return {
    flag_identity: `AUTO-${code}-${date}`,
    flag_code: code,
    attendance_date: date,
    day_closed: 1,
    evidence: {},
    rank,
    tier,
    decision_state: "undecided",
    decision: null,
  };
}

const NONE: ReadonlySet<string> = new Set();

test("a range shorter than 14 days produces that many cells, not a padded strip", () => {
  // A padded cell would have to mean something, and there is nothing true for
  // it to mean.
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.length, 7);
  assert.equal(strip.cells[0].date, "2026-08-01");
  assert.equal(strip.cells[6].date, "2026-08-07");
});

test("a range longer than 14 days keeps the most recent 14", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-07-15",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.length, STRIP_MAX_CELLS);
  assert.equal(strip.cells[0].date, "2026-07-25");
  assert.equal(strip.cells[13].date, "2026-08-07");
});

test("flags older than the window are counted, not dropped", () => {
  const strip = buildStrip({
    flags: [flag("2026-07-16", "LATE_START", "routine", 20)],
    branch: "HQ",
    startDate: "2026-07-15",
    endDate: "2026-08-07",
    outage: NONE,
  });
  // The sub-line still names the worst flag across the whole range, so the strip
  // must say out loud that it is not showing everything.
  assert.equal(strip.earlierCount, 1);
  assert.equal(strip.flaggedCount, 0);
});

test("a day with a flag renders at that flag's tier", () => {
  const strip = buildStrip({
    flags: [flag("2026-08-03", "LATE_START", "routine", 20)],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  const cell = strip.cells.find((c) => c.date === "2026-08-03");
  assert.equal(cell?.state, "flagged");
  assert.equal(cell?.tier, "routine");
});

test("a day with several flags renders the worst", () => {
  const strip = buildStrip({
    flags: [
      flag("2026-08-03", "LATE_START", "routine", 20),
      flag("2026-08-03", "MISSING_TIME", "act", 133),
    ],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-03")?.tier, "act");
});

test("an in-range day with no flag renders clean", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.deepEqual(new Set(strip.cells.map((c) => c.state)), new Set(["clean"]));
  assert.deepEqual(new Set(strip.cells.map((c) => c.tier)), new Set([null]));
});

test("a day in the outage set renders no-data, not clean", () => {
  // The lie this state exists to stop: a branch with no device data produces no
  // flags, so a naive "no flag -> green" would tell HR someone was fine on a day
  // nobody measured them.
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: buildOutageSet([{ branch: "HQ", date: "2026-08-04" }]),
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-04")?.state, "no-data");
  assert.equal(strip.cells.find((c) => c.date === "2026-08-05")?.state, "clean");
});

test("an outage at another branch does not grey this person's day", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: buildOutageSet([{ branch: "Siem Reap", date: "2026-08-04" }]),
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-04")?.state, "clean");
});

test("a flag outranks an outage on the same day", () => {
  // Something WAS measured that day, whatever the watermark says.
  const strip = buildStrip({
    flags: [flag("2026-08-04", "LATE_START", "routine", 20)],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: buildOutageSet([{ branch: "HQ", date: "2026-08-04" }]),
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-04")?.state, "flagged");
});

test("an employee with no branch is never greyed", () => {
  const strip = buildStrip({
    flags: [],
    branch: null,
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: buildOutageSet([{ branch: "HQ", date: "2026-08-04" }]),
  });
  assert.deepEqual(new Set(strip.cells.map((c) => c.state)), new Set(["clean"]));
});

test("outage keys cannot collide across branch names", () => {
  assert.notEqual(outageKey("A", "B|2026-08-04"), outageKey("A|B", "2026-08-04"));
});

test("the flag index gathers a person's flags from every entry they appear in", () => {
  // A group member's strip shows ALL their flags, including the act-tier outlier
  // that put them in a second entry. This is what makes the cross-reference
  // badge visible rather than merely counted.
  const entries: QueueEntry[] = [
    {
      kind: "group",
      group_type: "REPEAT_PATTERN",
      group_key: "REPEAT_PATTERN:LATE_START",
      branch: null,
      flag_code: "LATE_START",
      attendance_date: null,
      rank: 20,
      tier: "routine",
      members: [
        person("EMP-1", [flag("2026-08-03", "LATE_START", "routine", 20)]),
        person("EMP-2", [flag("2026-08-03", "LATE_START", "routine", 20)]),
      ],
    },
    {
      kind: "person",
      ...person("EMP-1", [flag("2026-08-06", "MISSING_TIME", "act", 133)]),
    },
  ];
  const index = buildEmployeeFlagIndex(entries);
  assert.equal(index.get("EMP-1")?.length, 2);
  assert.equal(index.get("EMP-2")?.length, 1);
});

test("a group member's strip shows the out-of-group flag", () => {
  const strip = buildStrip({
    flags: [
      flag("2026-08-03", "LATE_START", "routine", 20),
      flag("2026-08-06", "MISSING_TIME", "act", 133),
    ],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-06")?.tier, "act");
  assert.equal(strip.flaggedCount, 2);
});
```

Write a local `person(employee, flags)` fixture builder returning a full `QueuePerson`
(every field the type declares, including `entry_key`, `dates`, `also_count`,
`also_outlier_count`).

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module '@/lib/flagStrip'`.

- [ ] **Step 3: Write the module**

Create `src/lib/flagStrip.ts`:

```ts
/**
 * A person's fortnight as a fixed-width array of cells.
 *
 * Nesting alone fixes the queue's volume problem and leaves the second one the
 * spec names: "five late mornings is a materially different situation from one,
 * and it is the thing HR most wants to know" — reported as the sentence "4 late
 * starts". A strip makes the difference a shape. Six consecutive mornings and
 * four scattered across a fortnight produce visibly different strips, and that
 * distinction is what decides whether a pattern is excused as a habit or
 * escalated as a problem.
 *
 * The window lives HERE and not in the API. `get_flag_queue` returns every flag
 * in the queried range, each with its own date; capping at 14 is a decision the
 * flag page makes when it renders, so a future employee-profile page can bucket
 * the same payload into 90 cells without an API change.
 *
 * Spec: docs/superpowers/specs/2026-08-07-flag-queue-row-design.md, "The strip".
 */
import { addDays, differenceInCalendarDays, format } from "date-fns";

import { parseDateKey } from "@/lib/attendanceTime";
import type { FlagOut, QueueEntry, Tier } from "@/types/flags";

/**
 * Fourteen is fitted, not round. The list pane is 22rem / 352px
 * (FlagQueuePage.tsx). After 18px padding, a 40px avatar and two 9px gaps, 276px
 * remains for text and strip; at 6px cells with 2.5px gaps a 14-cell strip is
 * 117px, leaving ~160px for the name and sub-line. Twenty-one cells would take
 * 176px and squeeze names into truncation.
 */
export const STRIP_MAX_CELLS = 14;

export type StripCellState = "flagged" | "clean" | "no-data";

export type StripCell = {
  date: string;
  state: StripCellState;
  /** The worst tier flagged that day; null for clean and no-data. */
  tier: Tier | null;
};

export type Strip = {
  cells: StripCell[];
  flaggedCount: number;
  /** Flags older than the window — the "+N earlier" marker. */
  earlierCount: number;
};

const TIER_ORDER: Record<Tier, number> = { routine: 0, review: 1, act: 2 };

/**
 * `attendanceTime` owns date-key PARSING (`parseDateKey`) but exports no
 * formatter, so this is the local inverse rather than a second parser. Keep it
 * private: a second exported date-key helper is how two modules start
 * normalising differently, and every failure that causes here is silent (a strip
 * of fourteen clean cells).
 */
function dateKeyOf(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

/**
 * `\u0000` rather than ":" or "|": a branch name is free text and either of
 * those could appear in one, which would silently grey the wrong person's day.
 */
export function outageKey(branch: string | null, date: string): string {
  return `${branch ?? ""}\u0000${date}`;
}

export function buildOutageSet(rows: { branch: string; date: string }[]): ReadonlySet<string> {
  return new Set(rows.map((row) => outageKey(row.branch, row.date)));
}

/**
 * Every flag an employee has across the WHOLE assembled entry set, not just the
 * entry being rendered.
 *
 * Sokheng sits inside "repeatedly late" for four LATE_START flags and also holds
 * a three-hour MISSING_TIME that puts him in a second entry; his strip inside
 * the group shows both, so the act-tier day appears as a tall cell among the
 * routine ones. That makes the cross-reference badge visible rather than merely
 * counted — the badge says "also 1 outlier", the strip shows what it is and
 * when.
 *
 * The strip is therefore NOT a preview of what a bulk decision would write. That
 * is a real tension and it resolves in favour of visibility: the failure mode the
 * badge exists to prevent is HR excusing the group and never seeing the absence,
 * and a strip that hid the outlier would reintroduce exactly that.
 */
export function buildEmployeeFlagIndex(entries: QueueEntry[]): Map<string, FlagOut[]> {
  const index = new Map<string, FlagOut[]>();
  for (const entry of entries) {
    const people = entry.kind === "group" ? entry.members : [entry];
    for (const person of people) {
      const existing = index.get(person.employee);
      if (existing) existing.push(...person.flags);
      else index.set(person.employee, [...person.flags]);
    }
  }
  return index;
}

export function buildStrip(args: {
  flags: FlagOut[];
  branch: string | null;
  startDate: string;
  endDate: string;
  outage: ReadonlySet<string>;
}): Strip {
  const end = parseDateKey(args.endDate);
  const requested = differenceInCalendarDays(end, parseDateKey(args.startDate)) + 1;
  // A range shorter than 14 days gives a shorter strip — seven days is seven
  // cells, not fourteen padded with blanks, because a padded cell would have to
  // mean something and there is nothing true for it to mean. Cell size is fixed;
  // only the count varies.
  const length = Math.max(1, Math.min(requested, STRIP_MAX_CELLS));
  const windowStart = addDays(end, -(length - 1));
  const windowStartKey = dateKeyOf(windowStart);

  const worstByDate = new Map<string, Tier>();
  let earlierCount = 0;
  for (const flag of args.flags) {
    if (flag.attendance_date < windowStartKey) {
      earlierCount += 1;
      continue;
    }
    const current = worstByDate.get(flag.attendance_date);
    if (!current || TIER_ORDER[flag.tier] > TIER_ORDER[current]) {
      worstByDate.set(flag.attendance_date, flag.tier);
    }
  }

  const cells: StripCell[] = [];
  let flaggedCount = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const date = dateKeyOf(addDays(windowStart, offset));
    const tier = worstByDate.get(date);
    if (tier) {
      cells.push({ date, state: "flagged", tier });
      flaggedCount += 1;
      continue;
    }
    // Grey beats green, but a flag beats both: something WAS measured that day,
    // whatever the watermark says. Green means "no flag on this day" and nothing
    // more — it deliberately does not claim the person worked, because the queue
    // does not load shift assignments and cannot know.
    const noData = args.branch !== null && args.outage.has(outageKey(args.branch, date));
    cells.push({ date, state: noData ? "no-data" : "clean", tier: null });
  }

  return { cells, flaggedCount, earlierCount };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -12
```
Expected: `ℹ fail 0`, count up by 13. Paste the count lines.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/flagStrip.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagStrip.test.ts
git commit -m "feat(flag-queue): the fortnight strip model — flagged, clean, no data"
```

---

### Task 5: The row

Photo, name, badge, finding, strip. Group headers keep the same shape but carry overlapping
member avatars instead of a strip, so "who is in here?" is answerable without expanding.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/ui/FlagStrip.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagQueueList.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/hooks/useFlagQueue.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx`
- Test: `dewey_time/frontend/hr_attendance/src/ui/flagStrip.test.tsx` (new), `src/lib/flagQueueLabels.test.ts`, `src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces:
  - `FlagStrip({ strip, label })` — the renderer
  - `stripAriaLabel(strip): string` and `earlierMarkerLabel(count): string | null` in `flagQueueLabels.ts`
  - `personSubline(person): string` in `flagQueueLabels.ts`
  - `FlagQueueListProps` gains `range: { startDate: string; endDate: string }` and `outage: ReadonlySet<string>`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/flagStrip.test.tsx`:

```tsx
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { buildOutageSet, buildStrip } from "@/lib/flagStrip";
import type { FlagOut } from "@/types/flags";
import { FlagStrip } from "@/ui/FlagStrip";

const NONE: ReadonlySet<string> = new Set();

function flag(date: string, tier: FlagOut["tier"]): FlagOut {
  return {
    flag_identity: `AUTO-${date}-${tier}`,
    flag_code: "LATE_START",
    attendance_date: date,
    day_closed: 1,
    evidence: {},
    rank: 20,
    tier,
    decision_state: "undecided",
    decision: null,
  };
}

/** A fortnight: 2026-07-25 … 2026-08-07 inclusive is exactly 14 days. */
const FORTNIGHT = { startDate: "2026-07-25", endDate: "2026-08-07" } as const;

test("the strip states its flagged-day count and hides its cells from assistive tech", () => {
  const strip = buildStrip({
    flags: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"].map((d) => flag(d, "routine")),
    branch: "HQ",
    ...FORTNIGHT,
    outage: NONE,
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.match(html, /aria-label="4 flagged days in the last 14"/);
  // Every cell is hidden — the strip is decorative reinforcement of a sub-line
  // the reader has already been given.
  assert.equal(html.split("aria-hidden").length - 1, strip.cells.length);
});

test("severity is height as well as colour", () => {
  const strip = buildStrip({
    flags: [flag("2026-08-05", "act"), flag("2026-08-06", "review"), flag("2026-08-07", "routine")],
    branch: "HQ",
    ...FORTNIGHT,
    outage: NONE,
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.match(html, /h-3\.5 bg-destructive/); // act
  assert.match(html, /h-2\.5 bg-amber-500/); // review
  assert.match(html, /h-1\.5 bg-sky-500/); // routine
});

test("a clean day and a no-data day are different cells", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    ...FORTNIGHT,
    outage: buildOutageSet([{ branch: "HQ", date: "2026-08-04" }]),
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.match(html, /bg-emerald-500\/70/); // clean
  assert.match(html, /bg-muted-foreground\/30/); // no data
});

test("flags older than the window carry a +N earlier marker", () => {
  const strip = buildStrip({
    flags: [flag("2026-07-16", "routine"), flag("2026-07-17", "routine"), flag("2026-07-18", "act")],
    branch: "HQ",
    ...FORTNIGHT,
    outage: NONE,
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.match(html, /\+3 earlier/);
});

test("no marker when nothing is older than the window", () => {
  const strip = buildStrip({ flags: [], branch: "HQ", ...FORTNIGHT, outage: NONE });
  assert.equal(renderToStaticMarkup(<FlagStrip strip={strip} />).includes("earlier"), false);
});
```

Append to `src/ui/flagQueuePage.test.tsx`. Three fixtures are needed; write them beside the
file's existing ones, each returning a complete `QueueEntry` (every field the type
declares — `entry_key`, `dates`, `also_count`, `also_outlier_count`, `employee_image`):

- `missingTimePerson()` — kind `person`, `employee_name` "Sokheng Hon",
  `employee_image` `"/files/sokheng.jpg"`, one `MISSING_TIME` flag on `2026-08-06`
  (`evidence: { minutes: 192 }`, tier `act`), `dates: ["2026-08-06"]`.
- `repeatPerson()` — kind `person`, `employee_name` "Vichea Lim", `employee_image` null,
  four `LATE_START` flags on `2026-08-03`…`2026-08-06` with minutes `31, 12, 9, 15`
  (tier `routine`), `dates` all four.
- `patternGroupEntry()` — kind `group`, `group_type` `REPEAT_PATTERN`,
  `flag_code` `LATE_START`, `attendance_date` null, two members each with a photo.

and `listProps()` returning the non-entry props:
`{ range: { startDate: "2026-07-25", endDate: "2026-08-07" }, outage: new Set<string>(), selectedKey: null, expandedGroupKey: null, onSelect: () => {} }`.

```tsx
test("a person row leads with their photo and states the finding with its day", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList entries={[missingTimePerson()]} {...listProps()} />,
  );
  assert.match(html, /<img[^>]+src="\/files\/sokheng\.jpg"/);
  assert.match(html, /Sokheng Hon/);
  assert.match(html, /Thu 6 Aug/);
});

test("a person with several days of one code gets no single date", () => {
  // "4 late starts · worst 31 min" — naming one day would be wrong for the
  // other three.
  const html = renderToStaticMarkup(<FlagQueueList entries={[repeatPerson()]} {...listProps()} />);
  assert.match(html, /4 late starts · worst 31 min/);
  assert.equal(/· \w{3} \d+ \w{3}/.test(html), false);
});

test("a person with no photo still leads with an avatar, not a gap", () => {
  const html = renderToStaticMarkup(<FlagQueueList entries={[repeatPerson()]} {...listProps()} />);
  assert.match(html, />VL</);
  assert.equal(html.includes("<img"), false);
});

test("every row's strip has the same cell count, so the column is stable", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList entries={[missingTimePerson(), repeatPerson()]} {...listProps()} />,
  );
  const counts = [...html.matchAll(/data-strip-cells="(\d+)"/g)].map((m) => m[1]);
  assert.equal(counts.length, 2);
  assert.equal(new Set(counts).size, 1);
});

test("a group header shows who is in it, not a strip", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList entries={[patternGroupEntry()]} {...listProps()} />,
  );
  assert.match(html, /<img/); // member avatars
  assert.equal(html.includes("data-strip-cells"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module '@/ui/FlagStrip'`, and the list rows render no image.

- [ ] **Step 3: Add the copy**

In `src/lib/flagQueueLabels.ts`:

```ts
/**
 * The strip's only accessible name. Its cells are hidden: at 6px they are not a
 * click target and the sub-line has already given the reader the finding in
 * words — the strip is reinforcement, so it takes one summary and no more.
 */
export function stripAriaLabel(strip: Strip): string {
  const days = `${strip.flaggedCount} flagged ${strip.flaggedCount === 1 ? "day" : "days"}`;
  return `${days} in the last ${strip.cells.length}`;
}

/**
 * A widened range can produce a row whose sub-line names a serious flag while
 * the strip is all green — the flag is older than the window. This marker is
 * what keeps that honest. The sub-line remains driven by the person's worst flag
 * across the WHOLE range, not the strip's window.
 */
export function earlierMarkerLabel(count: number): string | null {
  return count > 0 ? `+${count} earlier` : null;
}

/**
 * The row's second line. A person row names the day; a member of a pattern group
 * does not, because naming one of four mornings would be wrong for the other
 * three. `dates.length === 1` is the honest test for which case this is.
 */
export function personSubline(person: QueuePerson): string {
  const headline = personHeadline(person);
  if (!headline || person.dates.length !== 1) return headline;
  return `${headline} · ${format(parseDateKey(person.dates[0]), "EEE d MMM")}`;
}
```

Add matching tests to `src/lib/flagQueueLabels.test.ts` for the singular/plural of
`stripAriaLabel`, `earlierMarkerLabel(0) === null`, and both `personSubline` branches.

- [ ] **Step 4: Write the strip renderer**

Create `src/ui/FlagStrip.tsx`:

```tsx
import { earlierMarkerLabel, stripAriaLabel } from "@/lib/flagQueueLabels";
import type { Strip, StripCell } from "@/lib/flagStrip";
import { cn } from "@/lib/utils";

/**
 * Height AND colour, never colour alone: the strip has to be readable to
 * someone who cannot separate the hues, and height is the one channel that
 * survives every kind of colour vision.
 *
 * Green means "no flag on this day" and nothing more. It deliberately does not
 * claim the person worked — the queue does not load shift assignments and cannot
 * know, so a day someone was rostered off and a day they worked cleanly both
 * render green. That is honest: the strip asserts only what was measured.
 */
const CELL_CLASS: Record<StripCell["state"], string> = {
  clean: "h-1 bg-emerald-500/70",
  "no-data": "h-1 bg-muted-foreground/30",
  flagged: "",
};

const TIER_CLASS = {
  act: "h-3.5 bg-destructive",
  review: "h-2.5 bg-amber-500",
  routine: "h-1.5 bg-sky-500",
} as const;

export function FlagStrip(props: { strip: Strip; className?: string }) {
  const { strip } = props;
  const marker = earlierMarkerLabel(strip.earlierCount);

  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", props.className)}>
      {strip.cells.length > 0 ? (
        <span
          role="img"
          aria-label={stripAriaLabel(strip)}
          data-strip-cells={strip.cells.length}
          className="flex h-3.5 items-end gap-[2.5px]"
        >
          {strip.cells.map((cell) => (
            <span
              key={cell.date}
              aria-hidden="true"
              className={cn(
                "w-1.5 rounded-[1px]",
                cell.tier ? TIER_CLASS[cell.tier] : CELL_CLASS[cell.state],
              )}
            />
          ))}
        </span>
      ) : null}
      {marker ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{marker}</span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 5: Rebuild the rows**

In `src/ui/FlagQueueList.tsx`, extend the props and thread the strip inputs:

```tsx
export type FlagQueueListProps = {
  entries: QueueEntry[];
  /** The queried range. The strip's 14-day window is cut from its recent end. */
  range: { startDate: string; endDate: string };
  /** (branch, date) pairs with no device data — the strip's grey state. */
  outage: ReadonlySet<string>;
  selectedKey: string | null;
  expandedGroupKey: string | null;
  onSelect: (key: string) => void;
  onCollapseGroup?: () => void;
};
```

Build the index once per render, above the row loop:

```tsx
  // Built from the whole entry set, so a group member's strip shows the outlier
  // flag that put them in a second entry — see buildEmployeeFlagIndex.
  const flagsByEmployee = useMemo(() => buildEmployeeFlagIndex(props.entries), [props.entries]);
```

Replace `PersonRow`:

```tsx
function PersonRow(props: {
  person: QueuePerson;
  strip: Strip;
  selected: boolean;
  onSelect: () => void;
}) {
  const { person } = props;
  const extra = Math.max(person.undecided_count - 1, 0);
  const crossReference = crossReferenceLabel(person);

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      {/* 40px is a floor, not a preference. At 20px an avatar is decoration —
          too small to recognise anyone — so if photos are to earn their space
          the row cannot be denser than this. */}
      <EmployeeAvatar
        employee={{ id: person.employee, label: person.employee_name, employee_name: person.employee_name, image: person.employee_image }}
        fallbackId={person.employee}
        className="size-10"
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{person.employee_name}</span>
          {crossReference ? (
            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
              {crossReference}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {personSubline(person)}
        </span>
      </span>
      {extra > 0 ? (
        <Badge variant="outline" className="shrink-0 rounded-md text-[11px] tabular-nums">
          +{extra}
        </Badge>
      ) : null}
      <FlagStrip strip={props.strip} />
    </RowButton>
  );
}
```

and give `GroupRow` overlapping member avatars where the strip sits:

```tsx
/** At most this many faces before the row would out-argue its own headline. */
const GROUP_AVATAR_LIMIT = 4;

function GroupRow(props: { entry: GroupEntry; selected: boolean; onSelect: () => void }) {
  const { entry } = props;
  const shown = entry.members.slice(0, GROUP_AVATAR_LIMIT);
  const hidden = entry.members.length - shown.length;

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {groupHeadline(entry)}
        </span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {groupSubline(entry)}
        </span>
      </span>
      {/* Faces rather than a strip: a group has no single fortnight, and "who is
          in here?" is the question a group header has to answer without being
          expanded. */}
      <span className="flex shrink-0 items-center -space-x-2">
        {shown.map((member) => (
          <EmployeeAvatar
            key={member.employee}
            employee={{ id: member.employee, label: member.employee_name, employee_name: member.employee_name, image: member.employee_image }}
            fallbackId={member.employee}
            className="size-7 ring-2 ring-background"
          />
        ))}
        {hidden > 0 ? (
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground ring-2 ring-background">
            +{hidden}
          </span>
        ) : null}
      </span>
    </RowButton>
  );
}
```

Every `PersonRow` call site (the top-level branch and the expanded-member loop) passes:

```tsx
  strip={buildStrip({
    flags: flagsByEmployee.get(person.employee) ?? person.flags,
    branch: person.employee_branch,
    startDate: props.range.startDate,
    endDate: props.range.endDate,
    outage: props.outage,
  })}
```

- [ ] **Step 6: Thread range and outage from the page**

In `src/hooks/useFlagQueue.ts`, add to the returned object:

```ts
      outageDates: data?.outage_dates ?? [],
      range: {
        startDate: data?.start_date ?? startDate,
        endDate: data?.end_date ?? endDate,
      },
```

with `outage_dates: { branch: string; date: string }[]` added to `QueuePayload` in
`src/types/flags.ts`, and the matching fields on the `FlagQueue` type.

In `src/ui/FlagQueuePage.tsx`, memoise the set once and pass both down to `FlagQueueList`:

```tsx
  const outage = useMemo(() => buildOutageSet(outageDates), [outageDates]);
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -12
npx tsc --noEmit 2>&1 | tail -20
```
Expected: `ℹ fail 0` and `tsc` clean. Paste both.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/ui/FlagStrip.tsx \
        dewey_time/frontend/hr_attendance/src/ui/flagStrip.test.tsx \
        dewey_time/frontend/hr_attendance/src/ui/FlagQueueList.tsx \
        dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx \
        dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx \
        dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.test.ts \
        dewey_time/frontend/hr_attendance/src/hooks/useFlagQueue.ts \
        dewey_time/frontend/hr_attendance/src/types/flags.ts
git commit -m "feat(flag-queue): person-first rows with a photo and a fortnight strip"
```

---

### Task 6: Rebuild and commit the assets

**Files:**
- Modify: `dewey_time/public/hr_attendance/**`
- Modify: `dewey_time/www/hr-attendance.html`, `dewey_time/www/hr-schedule.html`

- [ ] **Step 1: Build**

```bash
cd dewey_time/frontend/hr_attendance && npm run build 2>&1 | tail -20
```
Expected: a clean Vite build, then `copy-html-entry.mjs` reporting success. If it throws
the CSS floor error, `node_modules` is missing — re-run the symlink from Global
Constraint 7 and build again. Never weaken the floor.

- [ ] **Step 2: Verify the bundle actually contains this work**

```bash
cd "$(git rev-parse --show-toplevel)"
ls -l dewey_time/public/hr_attendance/assets/index-*.css
grep -l "flagged days in the last" dewey_time/public/hr_attendance/assets/*.js
grep -c "animate-spin" dewey_time/public/hr_attendance/assets/index-*.css
```
Expected: CSS ≥ 150,000 bytes; the strip's aria-label string present in a JS chunk; the
spin utility present in the CSS. An empty grep means the build did not pick up the source
or Tailwind did not scan it — stop and report it.

- [ ] **Step 3: Run both suites once more on the built tree**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping dewey_time.tests.test_flag_queue_api -v 2>&1 | tail -5
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -8
```
Expected: both green. Paste both counts.

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add dewey_time/public/hr_attendance dewey_time/www/hr-attendance.html dewey_time/www/hr-schedule.html
git commit -m "build(hr-attendance): rebuild assets for the flag queue row"
```

---

## Self-Review

**Spec coverage.** Every section of `2026-08-07-flag-queue-row-design.md` maps to a task:

| Spec section | Task |
|---|---|
| The row (avatar, name, badge, sub-line, strip) | 5 |
| Group headers carry overlapping member avatars | 5 |
| Avatar loading — the fix (initials underneath, photo fades in) | 2, 3 |
| Avatar loading — the loading ring (delay, reduced motion, `role="status"`) | 2, 3 |
| Avatar loading — scope (one file, props unchanged) | Global Constraint 9 |
| The strip — three states | 4 |
| The strip — ranges longer than 14 days, "+N earlier" | 4, 5 |
| The strip — a group member's strip shows all their flags | 4 (`buildEmployeeFlagIndex`) |
| Data contract — `image`, `attendance_date`, outage set | 1 (`attendance_date` landed in the nesting plan) |
| The API stays unbounded and window-free | Global Constraint 3 |
| Counts | Nesting plan, Task 6 |
| Accessibility | 4, 5 (`stripAriaLabel`, `aria-hidden` cells, height + colour) |
| What this does not change | Global Constraints 1–3, 9 |
| Testing (14 bullets) | 2 (5 avatar-transition bullets), 3 (4 avatar-markup bullets), 4 (5 strip bullets), 5 (strip aria, stable column, group member) |

**Type consistency.** `AvatarPhase`, `showsRing`, `StripCell`, `Strip`, `buildStrip`,
`buildOutageSet`, `outageKey`, `buildEmployeeFlagIndex`, `employee_image` and
`outage_dates` are declared once in the Interface Contract and used with those exact names
in every later task. `FlagQueueListProps` gains `range` and `outage` in Task 5, and Task 5
is the only place either is read.

**Deliberate limits, stated rather than hidden.**

- **The unit suite cannot fire a `load` event.** Global Constraint 5 explains why, and the
  phase machine is the answer — but it does mean no test asserts that `EmployeeAvatar`
  *wires* `onLoad` to `nextAvatarPhase`. That wiring is one line, visible in review, and
  the Playwright suite (`npm run test:e2e`) is where it could be proven end-to-end if it
  ever regresses.
- **The strip is not a preview of a bulk decision.** A group member's strip shows flags a
  bulk decide would not write. The spec resolves this in favour of visibility; Task 4's
  docstring records the tension so nobody "fixes" it later.
- **Out of scope, per the spec:** the phone layout (below 768px the decision panel stacks
  beneath the list, and this design makes it marginally worse by lengthening rows —
  `ResponsiveModal` is the right primitive when it is picked up); shading rostered-off
  days, which needs shift-assignment data the queue does not load; and making cells
  interactive.
