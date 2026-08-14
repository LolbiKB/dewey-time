# Shared Employee Picker — Design

**Date:** 2026-08-14
**Status:** approved, ready to plan
**Surfaces:** `/hr-attendance`, `/hr-schedule` (both routes of the `hr_attendance` SPA)

## Goal

Replace the two divergent employee pickers with one component that takes a
width size, renders the employee's branch when they have one, and behaves
identically on both routes.

## Why now

`EmployeePicker.tsx` and `ScheduleEmployeePicker.tsx` are two comboboxes over
the same `CalendarEmployee[]`, in the same SPA, that have drifted apart in
height, avatar size, name font size, popover width, popover alignment, search
placeholder, empty-state copy, and fact ordering. Some of that divergence is
real product behaviour and some is accident, and today there is no way to tell
which is which by reading either file.

Two facts discovered while scoping this, both of which shrink the work:

1. **Branch is already on the wire.** `hr_calendar.py:424` emits
   `"branch": row.get("branch")` for every employee row. The comment directly
   above it records that this exact field was once selected but never emitted —
   "a production no-op returning None forever" — and was caught only in review.
   The frontend then drops it a second time, because `CalendarEmployee` in
   `src/types/calendar.ts` never declares the field. Surfacing branch needs no
   backend change.
2. **The pickers already share their internals.** `EmployeeIdentity`,
   `EmployeeAvatar`, `employeeCommandFilter`, `employeeSearchHaystack`,
   `employeeDisplayName` and `khmerName` are common to both. What is duplicated
   is the trigger chrome, the popover, and the row.

## Architecture

One component, `EmployeePicker`, with props for the parts that genuinely differ
per surface. `ScheduleEmployeePicker.tsx` is deleted. The two line-two fact
orderings — which are product decisions, not styling — are extracted as named
pure functions in `src/lib/employeeCard.ts` and unit-tested there as data,
without rendering.

Two alternatives were considered and rejected:

- **A headless core plus two thin wrappers.** Three files where there were two,
  and it reconstructs per-surface components — the divergence this work exists
  to remove.
- **One component plus a per-surface "profile" object.** Collapses the props
  into one, but hides the decisions rather than reducing them.

### Size means width

`size` sets width and nothing else. Height, avatar size and type are identical
across all three sizes.

This is possible because `EmployeeIdentity` is a **container-query** component:
it already adapts continuously to the width of its own text stack. A size token
just chooses where on that existing ladder the picker sits. Nothing inside
`EmployeeIdentity` changes and nothing needs re-measuring.

It is also *necessary*. Every threshold in `EmployeeIdentity` is a measured
worst case at **14px semibold**: the Khmer name turns on at a 200px container
because `Sovannary Heng · ហេង សុវណ្ណារី` draws 199.9px, clearing by a tenth of a
pixel; the tail facts turn on at 120 / 170 / 230. Scale the type and every one
of those numbers is wrong, and the failure is not cosmetic — between the stale
threshold and the true width, line one turns Khmer *on* and then truncates it,
landing an ellipsis mid-cluster, which is the exact outcome the threshold exists
to prevent.

Note that `/hr-attendance` passes `nameClassName="text-base"` today, so its
trigger is already running outside the measured envelope. At 16px that worst-case
pair needs roughly 228px, not 200. Whether it currently lands in the bad
200–228px window at any real viewport is **not measured** — `sm:max-w-lg`
probably keeps it clear on desktop. Unifying at 14px removes the question.

The trigger's own chrome — `px-3` (24), the 40px avatar, `gap-2.5` (10),
`gap-3` before the chevron (12), and the 16px chevron — costs about **102px**
before the text stack gets any width. Each token is chosen to land clear of a
rung rather than on a round number.

| size | width | text stack | shows |
|---|---|---|---|
| `sm` | 240px (`w-60 max-w-full`) | ~138px | name, ID, one fact |
| `md` | 352px (`w-88 max-w-full`) | ~250px | + Khmer name, all three facts |
| `lg` | fluid → 512px (`w-full max-w-lg`) | ~410px | the same, plus truncation headroom |

`sm` and `md` are fixed widths that shrink below their token on a narrow parent
but never grow. `lg` fills its parent and caps. One rule per size; no caller
hand-rolls responsive width classes, which both call sites do today.

The tokens are deliberately not round. At 224px, `sm` would clear the 120px
first rung by two pixels; 240px clears it by eighteen. At 336px, `md` would
clear the 230px third rung by four pixels; 352px clears it by twenty. Tailwind
v4's spacing scale is dynamic, so `w-60` and `w-88` generate without config.

**`sm` cannot show a Khmer name.** ~138px of text stack is below the 200px
threshold. That is the ladder working as designed. Today's `/hr-schedule`
picker is `w-40` (160px), which leaves ~58px and shows neither Khmer nor a
single tail fact.

**`lg` does not unlock more content than `md`** — by 352px the ladder is
exhausted. What the extra width buys is headroom: long English names stop
truncating, and the Khmer pair clears its 199.9px worst case comfortably rather
than by a hair. This is three widths, not three tiers of information.

**Neither `sm` nor `md` has a caller today**, since both surfaces use `lg`. They
are kept because three width tokens are a three-line lookup table, not three
features. The token map is tested; the behavioural tests run at `lg`. No
parallel test suite is written per size.

### Shared height and avatar

All sizes share `min-h-14` (56px) and a `size-10` (40px) avatar on the
**trigger** — the proportions `/hr-attendance` ships today. That surface is the
one already measured and polished, and both callers are now `lg`, so adopting
its baseline leaves it visually unchanged and moves only `/hr-schedule`.

**List rows keep their `size-8` (32px) avatar**, as both pickers already do. The
trigger is a page anchor and the row is a dense list item; they are different
jobs. This is also why `EmployeeIdentity` places the avatar *outside* its query
container — the avatar's footprint differs per surface, so one threshold
measured across the whole box would mean different text budgets in each.

`min-h-`, never `h-`. Two lines at `leading-tight` are 17.5px + 15px ≈ 32.5px,
and a Khmer line one measures 17.50px exactly with roughly +0.5px of row growth.
`/hr-schedule` currently uses a hard `h-8`, overridden to `h-9` (36px) by its
caller; dewey-ui's Button has no `overflow-hidden`, so at `h-8` that stack is
over budget. A minimum cannot clip a Khmer descender.

## Component API

```ts
export type EmployeePickerSize = "sm" | "md" | "lg";

export type EmployeePickerProps = {
  employees: CalendarEmployee[];
  value: string | null;
  onChange: (id: string) => void;
  /** Width only. Height, avatar and type are identical across all three. */
  size?: EmployeePickerSize;          // default "md"
  isLoading?: boolean;
  /** No popover, no chevron, no combobox role — a plain bordered display. */
  readOnly?: boolean;
  /**
   * Line-two facts in truncation-priority order. Called only when an employee
   * exists, so "drop the tail when nothing is selected" needs no special case.
   */
  tail: (employee: CalendarEmployee) => TailFact[];
  /** Rows failing this render disabled and cannot be chosen. */
  isDisabled?: (employee: CalendarEmployee) => boolean;
  /** Trailing chip on a list row — the "Clock" badge. */
  badge?: (employee: CalendarEmployee) => ReactNode;
  className?: string;
};

const SIZE_WIDTH = {
  sm: "w-60 max-w-full",   // 240px
  md: "w-88 max-w-full",   // 352px
  lg: "w-full max-w-lg",   // fluid → 512px
};
```

`EmployeeOption` — the list row — stays a separately exported component. Radix
portals server-render to `null`, so anything left inline inside `PopoverContent`
never reaches `renderToStaticMarkup` and cannot be unit-tested. Both existing
files already do this for that reason.

### Deliberately not props

Both callers want the same value, and the argument for this approach was fewer
decisions, not hidden ones:

- Search placeholder: `"Search name, ID, branch, department…"`. One string, and
  it now tells the truth about branch being searchable.
- Empty state: `"No employees match your search."`
- The id-slot prompt when nothing is selected: `"Choose an employee"`, keyed off
  the resolved employee rather than the raw `value`. An id that names nobody
  (still loading, filtered out) reads as no selection rather than echoing a bare
  id that already lost the argument on line one.
- Popover alignment: `align="start"`. `/hr-schedule`'s `align="end"` existed only
  because it was a small control pinned right of a header that this design removes.

### Popover

`w-[var(--radix-popover-trigger-width)] min-w-[min(100%,22rem)] max-w-[calc(100vw-2rem)]`,
list height `max-h-[min(60vh,320px)]`.

The list has its own width, independent of the trigger, so branch in the options
is unconstrained by the size scale: ~270–300px of text stack once the row's
avatar, gaps and check icon are subtracted, which clears every rung. The 22rem
floor is what stops a `sm` trigger from opening a 240px list — you need the most
information at the moment you are choosing, not after.

## Branch

`CalendarEmployee` gains `branch?: string | null`. That single line is why
branch is invisible today.

`employeeSearchHaystack()` gains the **raw** branch value, not the formatted
one. `employeeCommandFilter` matches on `includes`, and `"BRANCH-Iconic"`
contains `"Iconic"`, so the raw string matches both what is typed and what is
displayed.

Display goes through the existing `formatBranchLabel()` in
`src/lib/attendanceTime.ts`, which strips a `BRANCH-` prefix — the same rule the
day inspector and the timeline already use.

A null or whitespace-only branch **omits the fact entirely** rather than
rendering "No branch". The backend is explicit that many employees have none and
that consumers must treat that as "do not judge", not as a finding. (The day
inspector does render "No branch", but there absence *is* the finding; in a
picker it is just absence.)

### Fact ordering

Line two truncates from its end, so order is priority.

```ts
/**
 * /hr-attendance. Branch first: thirteen sites, and "which Sokha" is a site
 * question before it is an org-chart one. Title last — it has never separated
 * two people who share a name.
 */
export function attendancePickerTail(employee: CalendarEmployee): TailFact[]
//   → [branch?, department?, title?]

/**
 * /hr-schedule. Employment type FIRST and never omitted: isWeeklyScheduleEligible
 * gates the whole wizard on it, so it is the fact that says whether this person
 * can be picked at all, and it must never be the one that falls off the end.
 */
export function schedulePickerTail(employee: CalendarEmployee): TailFact[]
//   → [employmentType, branch?, department?]
```

Both top out at three facts. `EmployeeIdentity`'s ladder has exactly three
rungs, and a fourth silently shares the third's threshold.

Which of branch and department better disambiguates is a judgement about this
company's data. Branch is placed first on the reasoning that thirteen sites is a
coarse, high-signal partition and that attendance is fundamentally about where
punches happened. If departments turn out to be the sharper split, swapping the
two is a one-line change in one tested function.

Rung reachability, which is what makes the ordering matter:

| | text stack | facts visible |
|---|---|---|
| `sm` trigger | ~138px | 1 |
| `md` trigger | ~250px | 3 |
| `lg` trigger | ~410px | 3 |
| list row | ~270–300px | 3 |

Only `sm` ever drops a fact, and it has no caller today. The ordering still
matters for `md` and `lg`, because line one and line two both `truncate`: order
decides which fact is cut mid-word when a long branch or department name
overruns the stack, even at widths where all three are technically rendered.

## Behaviour that moves into the shared component

- **Eligibility gate** → `isDisabled`. `/hr-schedule` passes
  `(e) => !isWeeklyScheduleEligible(e.employment_type)`.
- **Read-only display** → `readOnly`. `/hr-attendance` passes `!hrStaff`.
- **The "Clock" chip** → `badge`. `/hr-attendance` only. On `/hr-schedule`
  clock-based employees are already disabled by the gate and already carry their
  employment type as the first tail fact; a chip would be a third way of saying
  the same thing.

## Behaviour that stays out

**The weekly-schedule calendar button.** It is a sibling control that happens to
share a border with the picker, not part of it. Pulling it in makes the shared
component a grab bag and gives `/hr-schedule` a prop it never uses.

`/hr-attendance` therefore owns the bordered box and the divider itself: the
picker is passed `rounded-none border-0` (`cn` is twMerge, so the override
wins), and `WeeklyScheduleSummary`'s trigger sits beside it inside the wrapper.

## `/hr-schedule` page header

The visible `PageHeader` — title "Weekly Schedule" and the description
"Editing <name>'s existing schedule — changes apply from the effective date." —
is removed.

`PageHeader`'s `title` prop is **required**, so the component is dropped rather
than passed an empty title. This converges the route with two existing
precedents: `/hr-attendance` (App.tsx:269) and `/hr-schedule/coverage`
(CoverageRegisterPage.tsx:143) both dropped theirs on the grounds that the nav
tab already names the route and a visible title costs roughly 40px of vertical
space on the viewport that can least afford it.

**The heading does not go with it.** `<h1 className="sr-only">Weekly
Schedule</h1>` stays, immediately inside `<Page>`. An sr-only heading was
declined once on this codebase and that was wrong: `sr-only` is absolutely
positioned and measures zero pixels — checked in a browser on the register — so
the space is still reclaimed, while a nav tab is not a heading and does not
appear in a screen reader's heading list. A route without one has no answer to
"where am I".

`chromeMigration.test.tsx:282` already guards exactly this: every routed page
must have a heading "via PageHeader, or its own sr-only h1", and separately must
not hand-roll a *visible* `<h1>`. The change satisfies the guard as written; no
edit to that test is required.

**The editing notice moves** into the Shift blocks `CardDescription`, which
already switches between read-only and editable copy — one place for
schedule-state messaging. It loses the employee's name, which a `lg` picker
directly above now supplies:

> Editing an existing schedule — changes apply from the effective date.

Resulting page structure: `<Page>` → sr-only `h1` → picker row → the
four-dialog-trigger grid → `<Section grow>`.

## Files

**Rewrite**
- `src/ui/EmployeePicker.tsx` — unified trigger, popover and row. Exports
  `EmployeePicker` and `EmployeeOption`.

**Delete**
- `src/ui/ScheduleEmployeePicker.tsx`

**Modify**
- `src/types/calendar.ts` — `branch?: string | null` on `CalendarEmployee`.
- `src/lib/employeeCard.ts` — `attendancePickerTail()`, `schedulePickerTail()`,
  branch into `employeeSearchHaystack()`.
- `src/ui/AttendanceToolbar.tsx` — `size="lg"`; owns the bordered wrapper and
  the divider; calendar button becomes a sibling.
- `src/ui/WeeklySchedulePage.tsx` — drop `PageHeader`, add sr-only `h1`, picker
  to `lg` on its own row, editing notice into the Shift blocks
  `CardDescription`.
- `src/ui/EmployeePicker.test.tsx` — the two suites merge.
- `src/lib/employeeCard.test.ts` — the two tail builders.
- `e2e/schedule.spec.ts` — heading matcher.
- `e2e/schedule-edit.spec.ts` — editing-notice text and location.
- `dewey_time/tests/test_hr_calendar.py` — pin `branch` in the employee-list row.

No backend source changes.

## Testing

**Unit — `src/lib/employeeCard.test.ts`.** The two tail builders as data: fact
order; `BRANCH-` prefix stripped; null and whitespace-only branch omitted;
employment type present and first even when branch and department are both null.

**Unit — `src/ui/EmployeePicker.test.tsx`.** `node:test` plus
`renderToStaticMarkup`, rows rendered through the existing
`Command`/`CommandList`/`CommandGroup` harness (a bare `CommandItem` will not
render). Branch appears on the row; a disabled row carries the disabled state
and no select handler; the badge appears only for a clock-based employee;
`readOnly` emits no `role="combobox"`; each size token maps to its width class.

**Backend — `dewey_time/tests/test_hr_calendar.py`.** Assert
`list_calendar_employees` emits `branch`. Nothing asserts it today, and the
field's own comment records it being silently dropped once before.

**E2E.** `schedule.spec.ts`'s heading assertion follows the register's pattern —
`getByRole("heading", { name: "Weekly Schedule", level: 1 })`, **not**
`toBeVisible()`. `coverage-register.spec.ts:96-105` documents why: `sr-only` is
zero pixels tall, so Playwright will not call it visible, though `getByRole` and
a screen reader's heading list both find it. `schedule-edit.spec.ts` updates for
the notice's new text and location.

### Measured in a browser, not argued

The chrome budget and the rung arithmetic in this document are **derived**.
Derived layout numbers have been wrong on this codebase before — most recently
`--font-khmer` naming a font family that did not exist, so every Khmer name
rendered in a macOS system face while the intended subset downloaded unused.
Three claims here get measured before the work is called done:

1. The ~102px trigger chrome budget — specifically whether `md` at 352px really
   clears the 230px third rung, and whether `sm` at 240px really clears the
   120px first one. If either does not, that token moves; the claim does not.
2. The two-line stack inside `min-h-14` with a Khmer name present — no clipped
   descender.
3. `/hr-schedule` at a 375px viewport with the picker at `lg` and the button
   grid beneath it.

`e2e/employee-identity.spec.ts` already carries the CDP machinery for this
(`CSS.getPlatformFontsForNode`), so these extend an existing harness rather than
starting one.

## Out of scope

- Any change to `EmployeeIdentity`'s measured thresholds.
- Adopting the picker anywhere beyond the two routes. `RegisterFilterBar` is a
  facet multi-select, not an employee picker, and the schedule-import resolver
  has no employee combobox.
- Raising `EmployeeIdentity`'s Khmer switch-on threshold from 200 to 210, which
  is open from the identity work and tracked in its own ledger. This design does
  not depend on it either way.
