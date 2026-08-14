# `/hr-schedule` Preview-First — Design

**Date:** 2026-08-14
**Status:** approved, ready to plan
**Surface:** `/hr-schedule` (`WeeklySchedulePage.tsx`)

## Goal

Land on a read-only view of the employee's schedule, put editing behind an
explicit trigger, and reclaim the vertical space the always-on editing chrome
costs.

## Why

Today the page opens in an editable wizard whatever state the employee is in.
Someone who came to *check* a schedule is handed a live form, and the controls
that only matter when saving — the template picker, "Effective from", "Generate
through", Save — occupy the screen the whole time.

Three facts found while scoping, all of which shrink the work:

1. **`scheduleReadOnly` already exists and is inert.** It is threaded through
   eight controls — the template picker, `WeekPatternGroupEditor`, both footer
   date inputs and the limit switch — and pinned `const scheduleReadOnly =
   false`. The mechanism for disabling editing is already written and wired.
2. **The read-only week visual already exists.** `SchedulePlanPreviewDialog`
   renders `PlannedWeekCanvas` from `plannedDaysFromWeekPattern(weekPattern)`
   with `resolveWeekPatternWindow(weekPattern)` at `minDayWidth="3rem"`. Preview
   mode reuses exactly that, inline.
3. **All three `Clear*` dialogs are dev-only.** Each opens
   `if (!IS_DEV_BUILD) return null`, pinned by `devControlsHidden.test.tsx`. In
   a production build the four-button row under the picker holds exactly one
   button — `SpreadsheetImportTrigger`, which is not dev-gated. A whole row of
   vertical space for one control.

`previewOnly` also sits beside `scheduleReadOnly`, declared and never read. Both
were pinned by PR #38, whose log reads "unlock wizard for in-place editing with
reconcile review": the page used to be *locked* when a schedule existed, and #38
unlocked it. This design does not undo that. It adds a third state — editable,
but opt-in — rather than returning to "cannot edit".

## Modes

One piece of state, one button. No tabs, no segmented control.

```ts
type ScheduleMode = "preview" | "edit";
```

**Preview-first applies only when the employee already has a schedule.**
`hasLiveSchedule` (today's `isEditing`, renamed — see below) already means
exactly that: `(context?.enabled_ssa_count ?? 0) > 0`.

| employee state | opening mode | why |
|---|---|---|
| has a live schedule | `preview` | nothing can be nudged by accident |
| has no schedule | `edit` | there is nothing to preview, and editing is the only thing they can do |

The dangerous case is the guarded one; the "set up a new hire" path gains no
click.

## Preview

```
[ EmployeePicker lg ]                        [Import]  [Edit schedule]
┌────────────────────────────────────────────────────────────────────┐
│  Mon  Tue  Wed  Thu  Fri  Sat  Sun     ← PlannedWeekCanvas         │
│  5 work days · 2 off · 40h             ← summarizeWeekPattern      │
└────────────────────────────────────────────────────────────────────┘
```

Nothing is written to render this. `PlannedWeekCanvas`,
`plannedDaysFromWeekPattern`, `resolveWeekPatternWindow` and
`summarizeWeekPattern` are all already exported and already used together by
`SchedulePlanPreviewDialog`.

Preview renders **no** Card header, **no** template picker, **no** footer and
**no** `ScrollArea`. Those exist to serve editing.

## Edit

Today's page, unchanged, plus a Cancel beside Save. Entering edit mode stops
pinning `scheduleReadOnly` false; the eight controls it already gates come
alive.

### Leaving edit mode

Cancel discards. It **confirms only when the form is dirty**:

- **Clean** — return to preview silently. This is the common case: pressed
  Edit, looked, left.
- **Dirty** — one confirm, through `ResponsiveModal`, which this page already
  imports. No new component; one boolean of state.

`blocksFingerprint(blocks)` already answers "is this dirty" — the page uses it
today via `appliedTemplateFingerprint` to detect template modification. Compare
the current blocks' fingerprint against the fingerprint taken when edit mode was
entered.

Dropping the confirm entirely was considered, to save a modal. Rejected: this
page makes you *type an employee's name* to change a schedule, so a bare
one-click discard of unsaved work is out of character for it.

**Switching employee while dirty raises the same confirm — the same modal, not
a second one.** One rule the reader can hold ("unsaved changes are confirmed
before they are lost") beats two ("Cancel confirms, switching does not").

Mechanically this needs one extra piece of state, not new UI: the picker's
`onChange` writes to `pendingEmployeeId` instead of calling `selectEmployee`
when the form is dirty, and the confirm's accept path calls `selectEmployee`
with it. When the form is clean, `onChange` calls `selectEmployee` directly and
nothing appears.

Today the form silently reseeds from the server on switch. That is already a
quiet data-loss path; it gets worse once edits are deliberate rather than
incidental, which is why it is in scope here rather than left alone.

## Layout changes

**Import moves up beside the picker.** The picker caps at 512px (`lg`), leaving
room on its right at desktop widths. On a phone the actions wrap to a second
line — one line of small buttons, not a 2-column grid of four.

**The dev row must be gated at the wrapper.** The three `Clear*` dialogs each
return `null` in production, but their wrapper is a child of a
`flex flex-col gap-2`, so an empty wrapper still costs a gap. The wrapper itself
is gated on `IS_DEV_BUILD`, not left to collapse. `WeeklySchedulePage.tsx` does
not import `IS_DEV_BUILD` today — the dialogs self-gate — so the import is new.

**The mode also resets on employee change**, to that employee's default from the
table above. The dirty confirm above gates the switch, so the reset happens
after the switch is accepted, never with unsaved work still on screen.

### Vertical reclaimed, preview mode, production

| | desktop | phone |
|---|---|---|
| button row + its gap | ~44px | ~88px (2-col grid, two rows) |
| footer — border, two date controls, buttons | ~90px | ~120px |
| Card header + template picker | 0 (shares the title row) | ~36px |
| **total** | **~134px** | **~244px** |

These are derived from the current class strings, not measured. The
implementation plan measures them in a browser before the numbers are repeated
anywhere user-facing.

## Redundancy removed

- **`previewOnly`** — dead since PR #38. Deleted.
- **The four-button row** — dissolved, as above.
- **The "Editing an existing schedule — changes apply from the effective date."
  `CardDescription`** — deleted. Once Edit is a button you pressed, a line
  telling you that you are editing is noise. (This copy landed hours earlier in
  the shared-picker work; it was right for a page with no mode and is not right
  for one with a mode.) The card description reverts to its single line, "One
  block per shared pattern — like Frappe Shift Schedule repeat days."
- **`isEditing` → `hasLiveSchedule`.** It means "this employee already has
  SSAs". Sitting beside a real edit mode, the old name is actively misleading.
  Eight occurrences in `WeeklySchedulePage.tsx`: the declaration, one comment,
  and six uses — one of which (`isEditingNotice`) is deleted with the
  `CardDescription` above, leaving five to rename.

## Deliberately unchanged

- **`SchedulePlanPreviewDialog`** stays as it is. It answers "what Shift
  Assignments will this create", not "what is the pattern" — a different
  question, still worth a modal. It renders the same `PlannedWeekCanvas`
  component as preview mode, so there is no duplicated code, only a repeated
  visual in two contexts that ask different things. It remains reachable only
  from edit mode, where saving is possible.
- **`scheduleReadOnly`** stays as the mechanism rather than being replaced. It
  is already wired to all eight controls; edit mode simply stops pinning it
  false.
- **The typed-name confirmation** on schedule changes, and the reconcile review.
  Untouched.
- **The empty states** for "no employee selected" and "employee not eligible".
  Untouched.

## Testing

**Unit — `WeeklySchedulePage`'s mode logic.** The page is 715 lines and mostly
untestable through `renderToStaticMarkup` because of Radix portals, so the mode
decision is extracted as a pure function in `src/lib/` and tested there as data:
opening mode by `hasLiveSchedule`; mode resets on employee change; dirty
detection from two fingerprints.

**Unit — rendering.** Preview mode renders a `PlannedWeekCanvas` and no
`Save`/`Effective from`; edit mode renders both. The dev row is absent from
production markup, and — the part that would otherwise regress silently — its
*wrapper* is absent too, not merely empty.

**E2E.** Land on `/hr-schedule` with an employee who has a schedule and assert
preview: canvas present, no Save button. Press Edit, assert the editor and
footer appear. Press Cancel with no changes, assert a silent return. An employee
with no schedule lands in edit directly.

**Measured in a browser.** The vertical figures above are derived. One
Playwright check records the actual page height in preview versus edit at a
1280 and a 375 viewport, so the saving is a measured number rather than an
estimate — the same discipline the shared-picker work used after its chrome
budget turned out to hinge on an avatar size changed later in the design.

## Out of scope

- Any change to the reconcile/apply pipeline or its backend.
- Any change to `PlannedWeekCanvas`, `WeekCanvasFrame`, or the planned-day
  adapters.
- Making the `Clear*` dialogs available in production.
- The `/hr-schedule/import` page itself; only the trigger's position moves.
