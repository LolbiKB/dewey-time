# Notice system — design

**Status:** approved 2026-07-31
**Scope:** HR attendance SPA (`dewey_time/frontend/hr_attendance`). No backend change.

## Goal

Replace nine independently-invented persistent notices with a vocabulary of three roles, so a
routine fact stops looking like an emergency and a single failure stops being reported twice.

## Why

The trigger was the schedule page's editing banner. Investigating it surfaced three separate
problems, all evidenced in the code rather than inferred.

**It is not a warning about an edit.** `isEditing` is
`(context?.enabled_ssa_count ?? 0) > 0` (`WeeklySchedulePage.tsx:160`) — "this employee already
has a live schedule". It is true the instant an employee is selected, before any keystroke, and
stays true if nothing is changed.

**Its alarming claim is false.** "Existing future shifts will be replaced" overstates the code. On
a confirmed save (`schedule_resolver.reconcile_orphan_ssas:672-707`) SSAs are soft-disabled
(`enabled=0`, `shift_status="Inactive"`), future Shift Assignments are set `Inactive` or have
`end_date` trimmed, and identities present in both old and new sets are skipped entirely. Nothing
is deleted, the backend refuses any effective date on or before today
(`schedule_api.py:400-404`), and every change writes a `Schedule Change Log` row.

**The accurate warning already exists, one click later.** The confirm modal
(`WeeklySchedulePage.tsx:596-705`) shows a server-computed reconcile preview — "What changes on
&lt;date&gt;", "Retiring MON-FRI 09–17", "N future shifts inactivated", "N shifts trimmed to end
&lt;date&gt;" — and gates the save behind typing the employee's name, but *only* when shifts would
really be retired (`reconcileRetiresShifts`, `lib/scheduleEdit.ts:51-58`). The banner fires
unconditionally; the modal fires accurately.

Two mechanical defects found alongside:

- A calendar-fetch failure renders a destructive banner (`App.tsx:265-295`) **and** replaces the
  week grid with a second card that points back at it (`App.tsx:354-362`).
- `Alert` hardcodes `role="alert"` (`components/ui/alert.tsx:30`) — an assertive live region. Two
  purely informational notices use it, so a screen reader interrupts itself for a routine fact.

## The system

Three roles. Each has exactly one structural rule.

### Role 1 — Context

A fact about what you are looking at. Present on arrival, true until you leave.

**Rule: never an alert, never its own row.** It goes in a line the page already has.

No `role`. No border, no fill. Muted text, optional 3.5-size leading icon.

### Role 2 — Attention

The data may be stale or incomplete. You might want to act; nothing is broken.

**Rule: one line at rest.** Detail hides behind the header row itself, never a second row.

`role="status"` (polite).

### Role 3 — Failure

What you asked for did not load, and there is an action that might fix it.

**Rule: reported where the missing content would have been, and only there.**

`role="alert"` is correct here and stays.

## Assignment

| # | Notice | Location | Becomes |
|---|---|---|---|
| 1 · 2 | Attendance load failure, twice | `App.tsx:265`, `:354` | **Failure** — one `FailureBlock` in the grid slot; the top banner is deleted |
| 3 | Device closeout pending | `DeviceAlerts.tsx:8-33` | **Attention** — one line + count, devices behind the disclosure |
| 4 | Device data may be stale | `DeviceAlerts.tsx:39-52` | **Attention** — same strip, tightened to match |
| 5 | Employee not eligible | `WeeklySchedulePage.tsx:398-404` | **Deleted** — see below |
| 6 | Editing an existing schedule | `WeeklySchedulePage.tsx:406-416` | **Context** — into the existing `description` slot |
| 7 | Coverage failed to load | `ScheduleCoveragePage.tsx:101-104` | **Failure** — `FailureBlock`, no retry (see below) |
| 8 | Import parse error | `UploadStep.tsx:116-120` | **Failure in tone only** — stays inline (see below) |
| 9 | No shifts this week | `WeeklyScheduleSummary.tsx:144-148` | **Context** — already in a popover; unchanged |

### #5 is a strict duplicate, so it is deleted

When the selected employee is ineligible, `scheduleEmployeeId` is `null`
(`WeeklySchedulePage.tsx:114-118`), so the page already renders

```tsx
<EmptyState
  title={ineligibleMessage ? "Employee not eligible" : "Select an employee"}
  description={ineligibleMessage ?? "Their current pattern loads when available."}
/>
```

— the same message, in the content region, per the Role 3 rule. The banner states it a second
time above.

It is also close to unreachable: `ScheduleEmployeePicker.tsx:91-101` sets `disabled={!eligible}`
and its `onSelect` early-returns for ineligible employees, so the state only arises from an
ineligible id arriving by URL.

`weeklyScheduleIneligibleMessage` (`lib/employeeCard.ts:75-89`) is **kept** — the `EmptyState`
still calls it. Only the `Alert` at `:398-404` is removed.

### #7 gets no retry button

`useScheduleCoverage()` returns `{ unassigned, buckets, counts, isLoading, error }`
(`ScheduleCoveragePage.tsx:18`) — it exposes no refetch. `FailureBlock` therefore renders without
`onRetry`, and the cause keeps the current instruction: `Try refreshing the page.`

Exposing a refetch from the hook is a small change and would be an improvement, but it is a
different piece of work and is deliberately excluded here so this lands as a presentation change
only.

### #8 is the exception, and stays inline

Role 3's rule is "reported where the missing content would have been". For a spreadsheet parse
error the content is the parsed file — but the drop zone is the affordance you retry *with*, so
replacing it would remove the way out. `FailureBlock`'s centred `min-h-[13rem]` block is the wrong
shape here.

`UploadStep.tsx:116-120` therefore keeps its inline placement above the drop zone. The only change
is aligning its ad-hoc classes with `FailureBlock`'s tokens (`border-destructive/25
bg-destructive/[0.035]`) so the family reads as one system. This exception is named rather than
smoothed over: a rule with an unstated exception is worse than a rule with a stated one.

## Components

Both live in a new `src/components/ui/notice.tsx`. `alert.tsx` is untouched and remains the
Role 3 primitive for cases that genuinely need an assertive announcement.

### `AttentionStrip`

```tsx
export function AttentionStrip(props: {
  tone: "amber" | "accent";
  icon: React.ReactNode;
  children: React.ReactNode;
  /** When present, the header row becomes a disclosure toggle. */
  detail?: React.ReactNode;
  /** Shown right-aligned in the header row. */
  count?: number;
}): React.JSX.Element;
```

Without `detail` it renders a single `div role="status"`. With `detail` it renders
`<details role="status">` whose `<summary>` **is** the header row — so it stays one line at rest —
with a chevron that rotates via `group-open:rotate-90`.

Tones: `amber` → `border-amber-500/25 bg-amber-500/[0.06]`; `accent` →
`border-brand-accent/30 bg-brand-accent/[0.05]`. Row padding `px-3 py-2`, `text-sm`, `gap-2.5`.
The count uses `tabular-nums`.

### `FailureBlock`

```tsx
export function FailureBlock(props: {
  title: string;
  cause?: string;
  onRetry?: () => void;
}): React.JSX.Element;
```

`role="alert"`. Centred column, `min-h-[13rem]`, `border-destructive/25
bg-destructive/[0.035]`, a `CloudOffIcon`, the title, the optional cause in muted text, and an
outline `Retry` button when `onRetry` is given.

### Context convention

No component. Role 1 is a `<p className="flex items-start gap-1.5 text-sm text-muted-foreground">`
with an optional `size-3.5` leading icon, passed into whatever slot the page already has — for
`WeeklySchedulePage` that is `PageHeader`'s `description` prop, which is typed
`React.ReactNode` (`@lolbikb/dewey-ui` `index.d.ts:507-512`).

## Copy

| Where | From | To |
|---|---|---|
| Schedule header, editing | banner: `Editing {name}'s schedule. Changes take effect {ISO date}. Existing future shifts will be replaced.` | description: `Editing {name}'s existing schedule — changes apply from the effective date.` |
| Schedule header, not editing | `Configure shared shift patterns for an employee.` | unchanged |
| Attendance failure | `Could not load attendance data. Confirm you have HR User access and try again.` + separate `Attendance data unavailable` / `Use Retry above to reload.` | title `Attendance data didn't load`, cause = the existing computed access guidance and server detail |
| Closeout | `Device closeout pending (3)` | `Device closeout pending` with `3` in the count slot |
| Staleness | `Device data may be stale — last device sync 5h ago.` | `Device data may be stale — last sync 5h ago` |
| Coverage | `Couldn't load coverage. Try refreshing.` | title `Coverage didn't load`, cause `Try refreshing the page.`, no button |
| Import parse error | passthrough of `parseError` | unchanged text; container tokens aligned only |

The effective date is deliberately **not** repeated. The `Effective from` picker
(`WeeklySchedulePage.tsx:492-498`) owns it and renders it as `Jul 1, 2026`, while the banner
printed the raw ISO `2026-07-01` — the two disagreed on screen.

The existing access-guidance branch for the attendance failure (HR User access vs. employee-record
link, plus `formatAttendanceLoadError` detail) is preserved as-is and simply relocated into
`cause`.

## Accessibility

- Role 1 carries no ARIA role. It is static page content present at load.
- Role 2 uses `role="status"` — polite, announced without interrupting.
- Role 3 keeps `role="alert"`.
- The disclosure is a native `<details>`/`<summary>`, so it is keyboard-operable and announces its
  expanded state without custom ARIA. `list-none` hides the default marker; the chevron is
  `aria-hidden`.
- Icons are decorative and `aria-hidden`; the text carries the meaning.

## Files

**Create** `src/components/ui/notice.tsx`, `src/components/ui/notice.test.tsx`

**Modify** `src/ui/WeeklySchedulePage.tsx` (#5 delete, #6 to description) ·
`src/ui/DeviceAlerts.tsx` (#3, #4) · `src/ui/App.tsx` (#1 delete, #2 to `FailureBlock`) ·
`src/ui/schedule-coverage/ScheduleCoveragePage.tsx` (#7) ·
`src/ui/schedule-import/UploadStep.tsx` (#8) · `e2e/schedule-edit.spec.ts` (assertion)

## Testing

Unit tests go in `src/components/ui/notice.test.tsx` — **`src/components/` is inside the
`test:web` glob; `src/hooks/` is not.** Confirm the printed total rises; a green run with an
unchanged count means the file was never collected.

Cover:

- `AttentionStrip` without `detail` renders no `<details>` and no toggle.
- `AttentionStrip` with `detail` renders the header row as the `<summary>`, and the detail is not
  in the accessible content until opened.
- `AttentionStrip` renders `role="status"`; `FailureBlock` renders `role="alert"`.
- `FailureBlock` omits the button when `onRetry` is absent.
- A source-level guard that no notice outside `alert.tsx` sets `role="alert"`.

`e2e/schedule-edit.spec.ts:10` asserts `/Editing Jane Doe.s schedule/` and must change to the new
description copy. `e2e/audit-walk.spec.ts` screenshots this header, so its baselines shift.

## Build

Per `CLAUDE.md`: run `npm run build` and commit the rebuilt
`dewey_time/public/hr_attendance/**` and `dewey_time/www/hr-{attendance,schedule}.html` **in the
same PR**. Frappe Cloud cannot build this SPA — a merged PR that changes `frontend/` but not
`public/hr_attendance/` ships nothing.

## Out of scope

- `alert.tsx` itself. It stays as the Role 3 primitive.
- Dismissibility. No dismissible notice pattern exists anywhere in either SPA, and none was asked
  for.
- Toasts. `src/lib/toast.ts` documents the house rule — toast is for mutation outcomes; persistent
  conditions stay inline.
- The ADMS dashboard.
- Making the schedule notice conditional on the resolved plan actually differing from the current
  pattern. It would stop the notice appearing for employees whose schedule is merely being viewed,
  but it needs the debounced resolve plan before save. Worth revisiting once the system lands.
