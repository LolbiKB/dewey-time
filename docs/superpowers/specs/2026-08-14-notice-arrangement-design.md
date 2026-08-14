# Notice Arrangement — `/hr-flags` and `/hr-attendance` — Design

**Date:** 2026-08-14
**Status:** approved, ready to plan
**Surfaces:** `/hr-flags` (`FlagQueuePage.tsx`), `/hr-attendance` (`App.tsx`, `AttendanceToolbar.tsx`)

## Goal

Take the notice stack off both pages. Nothing new is added above the queue or
the calendar; the one control anyone uses keeps a home, one fact moves to where
it is finally relevant, and the rest are deleted.

## Why

Six things can stack above the flag queue at once: the `PageHeader` title and
description, a rollout banner, the truncation strip, two orphan-count lines,
the outage band, and a device-alert `Section`. Below them `Section grow` is
`min-h-0 flex-1 overflow-hidden` — flex-basis 0 — so the queue is only ever
handed positive free space and **every pixel the notices take is a pixel the
queue never gets**. `OutageBand` already carries a comment recording that
exact fight: unwrapped, its header row took 474px at 412px wide and the queue
was allotted 0.

`/hr-attendance` has the same problem in miniature. `DeviceCloseoutBanner` and
`DeviceSyncStalenessBanner` render *inside* `Section grow` (`App.tsx:328-333`),
directly above the week view, so they eat the calendar's height rather than the
page's.

The decisive fact came from the operator: **nobody acts on any of them.** Of
everything in the stack, only two things are ever pressed — the outage band's
**Excuse**, occasionally, and the narrow-range buttons, "probably much less".

So the arrangement is not a tidier stack. It is a deletion, with three
survivors placed where they earn their space.

## What was ruled

Three calls, made by the operator after reviewing a browser mockup:

1. **Excuse moves behind the chip.** It is the one control that gets used and
   it becomes one click further away. Accepted: thirteen branches of prose on
   every arrival, including every healthy day, is too much to pay to keep an
   occasional action visible.
2. **The orphan counts are deleted outright** — not compressed, not moved into
   the popover. Nobody audits from this screen.
3. **The narrow-to-7/3 buttons are dropped.** The date pickers do the same job
   in the same row, and the terminal row names the fix in words.

## The arrangement

### One chip, in a row that already exists

A single button, at the height of its neighbours, inside each page's existing
toolbar row. It costs **zero vertical pixels at desktop widths** — measured at
1280, the `/hr-flags` toolbar is 40px with the chip and 40px without — because
the row is already there and already that tall.

**On a phone it is not free: 44px, one wrap line, on both routes.** Measured at
375, the flags toolbar is 132px with the chip and 88px without; the attendance
toolbar is 142px against 98px. The retreat this spec named
in advance (drop the chevron and the `+N` below `sm`) was tried and changed
nothing — the date pickers already need the full row at that width, so the
chip takes a line of its own however narrow it is. It is still a large net
saving there, against a page header, a 134px outage band, a capped strip and
up to two orphan lines.

On `/hr-flags` it takes the horizontal space the deleted title vacates. On
`/hr-attendance` it rides in the gap `AttendanceToolbar`'s
`sm:justify-between` already leaves between the picker block and the week nav
(`AttendanceToolbar.tsx:60`).

```
/hr-flags   [⚠ 13 branches offline ⌄]         [4 Aug]–[14 Aug] [All tiers] [Decided 1,005]
/hr-attend  [Jane Doe ▾][Schedule] [⚠ Last sync 22h ago +1 ⌄]   [‹ 4–10 Aug ›] [↻]
```

Pressing it opens a **popover**, which displaces no layout. Inside is
everything the deleted notices said, plus the per-branch checkboxes and Excuse.

**When there are no conditions the chip is not rendered at all** — not
present-and-empty. On a healthy day both toolbars look exactly as they do
today.

### The label

The chip shows the first condition's `summary`, then `+N` for the rest, in the
order the builder returns them. Both pages can carry more than one: `/hr-flags`
has outages and flagless device-closeout alerts, `/hr-attendance` has stale sync
and pending closeouts.

Below `sm` the chip drops to the icon and the leading number (`⚠ 13 ⌄`). The
label is the first thing to go when the row is short of width, because the
popover is one tap away. This is the design's weakest point and is accepted
deliberately.

### One tone, and why there is no second

Every condition that reaches the chip means **something is wrong right now** —
that is the entry criterion, not a property to be graded afterwards. The chip
is amber; there is no `tone` field.

A muted tier was designed and cut. It only ever had two members, the cap and
the orphan counts, and both leave the chip: the cap for the list end, the
orphan counts for deletion. A field with no members is machinery to keep in
step for nothing.

Making the cap amber and keeping it in the chip was considered and rejected
separately: it is structural at production volume and never clears, so the chip
would be permanently amber and the colour would stop meaning anything.

**One tone change falls out of this.** `DeviceCloseoutBanner` is currently
`tone="accent"` (the brand orange, the *urgent* signal) while
`DeviceSyncStalenessBanner` is amber. Merged into one chip they share amber.
Amber is the right one of the two — a pending closeout is a data-freshness
problem, not the urgent-action signal the brand orange is reserved for in
`src/brand/tokens.css`.

### The cap becomes the last row of the list

`FlagQueueList` grows one optional prop and renders a terminal row after the
final entry when the query was capped:

```
  … Hun Sreyneang        Branch D · 1 flag         Tier 3
  ⚠ End of the newest 3,445 flags. Older days in 4 Aug – 14 Aug aren't
    loaded — narrow the dates to reach them.
```

Same zero pixels above the fold, better timing. A chip reading "newest 3,445"
is a fact read before there is any use for it; a final row arrives at the exact
moment someone has worked to the bottom and is about to conclude the period is
clear — the only moment the fact changes what they do.

This is the one piece argued for against the "all noise" verdict. Nobody acting
on the amber strip is evidence the *copy* failed, not that the fact is
unimportant: believing the queue is complete when it holds the newest 3,445 of
a larger number is how a period gets closed out with flags still undecided.

## Components

Two new files, split so the copy is testable as data — the shape
`flagQueueLabels.ts` and `scheduleEdit.ts` already use.

### `src/lib/dataHealth.ts`

```ts
export type HealthCondition = {
  /** Stable React key and test handle. */
  key: string;
  /** Terse form, for the chip label. */
  summary: string;
  /** Shorter still, for viewports below sm. Usually a bare count. */
  short: string;
};
```

`detail` is deliberately **not** on this type. A `ReactNode` field would make
the builders un-unit-testable as data and drag JSX into `src/lib`. The popover
body is composed by the chip's callers instead — see below.

Two pure builders, each returning conditions in display order — the leading one
is the chip's label, the rest become `+N`:

```ts
flagQueueHealth(input: {
  outageBranches: number;
  outagePeople: number;
  closeoutAlerts: number;
}): HealthCondition[]

attendanceHealth(input: {
  staleSyncMinutes: number | null;
  closeoutAlerts: number;
}): HealthCondition[]
```

`closeoutAlerts` is on **both**: `/hr-flags` already receives flagless Device
Closeout Alerts as `props.alerts` and renders them in their own `Section`, so
they are a second condition there, not only on attendance.

Both return `[]` when there is nothing to report, which is what makes the chip
absent rather than empty.

### `src/ui/DataHealthButton.tsx`

```tsx
export function DataHealthButton(props: {
  conditions: HealthCondition[];
  /** Popover body. Rendered only when the popover is open. */
  children: ReactNode;
}): ReactElement | null;
```

Returns `null` for an empty `conditions` array. Knows nothing about flags or
attendance. The caller passes the body, so `/hr-flags` hands it the outage
panel and `/hr-attendance` hands it the sync and closeout detail.

### `OutageBand` becomes `OutageExcusePanel`

The band loses its own section chrome, amber frame, headline row and
`open`/`setOpen` state — the popover owns disclosure now. Everything else
survives unchanged: the per-branch checkboxes, `outageWrite`, the day spans,
the flag counts, the Device health link and the Excuse button. `outageBandHeadline`
and `outageBandSubline` move into the panel's header, where there is room for
the full sentence.

The `defaultOpen` test seam goes with the state. It existed because
`renderToStaticMarkup` cannot click; the panel is now always-rendered-when-open,
so tests reach it by rendering the panel directly.

## Copy

| Where | Copy |
|---|---|
| Chip, outage | `13 branches offline` · short `13` |
| Chip, stale sync | `Last sync 22h 3m ago` · short `22h` |
| Chip, closeouts | `2 device closeouts pending` · short `2` |
| Popover, outage header | unchanged: `13 branches had no device data · 262 people affected` / `4 Aug – 14 Aug · 1,677 flags · the machines didn't record — nobody is being judged here` |
| Terminal row | `End of the newest 3,445 flags. Older days in 4 Aug – 14 Aug aren't loaded — narrow the dates to reach them.` |

The outage popover header keeps its full existing wording, including "nobody is
being judged here". That sentence is the whole reason the outage was lifted out
of the judgment queue; a popover has room for it where a toolbar chip does not.

## What is deleted

| Thing | Fate |
|---|---|
| `PageHeader` on `/hr-flags` — title `"Flags"` and `queueSplitDescription` | deleted |
| `max-w-[calc(100vw-16rem)]` clamp and its ~25-line comment | deleted |
| Truncation `AttentionStrip`, `cappedHeadline`, `CAPPED_EXPLAINER` | → terminal row |
| Narrow-range buttons and `narrowRangeLabel` | deleted |
| `orphanedFlagGoneSummary`, `orphanedEvidenceChangedSummary`, the `orphanLines` block | deleted |
| `OutageBand`'s band chrome and its always-on placement | → popover |
| Device-alert `Section`, `DEVICE_ALERT_EXPLAINER` | → popover |
| `DeviceCloseoutBanner`, `DeviceSyncStalenessBanner` out of `Section grow` | → popover |

Every one of those label functions has **exactly one non-test consumer**
(verified by grep), so each deletion is local.

Two things fall out for free. The `max-w` clamp exists solely to stop the
toolbar crushing the `PageHeader` title to zero width — with the title gone, so
is its reason. And `queueSplitDescription`'s three-way split
("206 people · 206 rows · 262 waiting on a device fault") disappears with the
description that carried it.

### The heading does not go with the title

`chromeMigration.test.tsx:282` requires every routed page to carry a heading via
`PageHeader` or its own `sr-only` `h1`. `/hr-flags` gets
`<h1 className="sr-only">Flags</h1>`, matching what `/hr-attendance`
(`App.tsx:285`) and `/hr-schedule` already do. `sr-only` is absolutely
positioned and measures zero pixels, so the space is still reclaimed.

## Deliberately unchanged

- **`SHOWING_DECIDED_MESSAGE`** stays where it is. It appears only when the user
  has pressed the Decided toggle themselves, so it is a response to an action
  rather than an unsolicited notice — and without it the extra rows read as a
  bug.
- **`writeFailure` and `bulkFailure` strips** stay as strips. They are
  transient consequences of something the user just did; putting a failure
  behind a chip the user has no reason to open would lose it.
- **The rollout banner** stays. It is set by configuration for the length of a
  pilot, is `tone="accent"` rather than amber, and is not a data-health fact.
- **`DeviceAlertRow`**, the per-day detail inside the attendance day view, is
  untouched.
- **`flag_grouping.py` and every backend path.** No API change: the chip is
  built from counts the pages already receive.

## Testing

**Unit — the builders as data.** Ordering, the `short` forms, singular/plural
at 1, and the empty case returning `[]`. Pure functions, no mounting, in
`src/lib/dataHealth.test.ts`.

**Unit — rendering.** `DataHealthButton` returns `null` for `[]`. The chip
renders the first summary and `+N` for the remainder. The outage panel still
contains the checkboxes and the Excuse button. `FlagQueueList` renders the
terminal row when capped and not when uncapped — and renders it **after** the
last entry, not before.

**Unit — the deletions are pinned.** `FlagQueuePage.tsx` no longer matches
`PageHeader`, `orphaned`, `CAPPED_EXPLAINER`, `narrowRangeLabel`, or
`max-w-[calc(100vw-16rem)]`, and does match `sr-only`. This is the
source-text convention `chromeMigration.test.tsx` already uses, and it exists
because Radix portals server-render to `null`, putting most of this 1,391-line
page out of `renderToStaticMarkup`'s reach.

**E2E — the vertical claim is measured, not asserted.** This repo has twice
published derived layout figures that a browser then contradicted — the shared
picker's chrome budget, and `--font-khmer` naming a family that did not exist
— so "the chip is free" is a measurement or it is not in the spec.

`e2e/notice-arrangement.spec.ts` measures the `/hr-flags` toolbar with and
without the chip, at both widths, and pins the difference exactly:

| Route | Width | With chip | Without | Cost |
|---|---|---|---|---|
| `/hr-flags` | 1280 | 40px | 40px | **0px** |
| `/hr-flags` | 375 | 132px | 88px | **44px — one wrap line** |
| `/hr-attendance` | 1280 | 58px | 58px | **0px** |
| `/hr-attendance` | 375 | 142px | 98px | **44px — one wrap line** |

The attendance row was not measured in the first pass, and a review caught a
second defect there that no comment predicted: `AttendanceToolbar`'s `<header>`
is `flex flex-col` below `sm`, so the default `align-items: stretch` made the
chip a **full-width 335px amber bar** — precisely the banner shape this design
deletes. `self-start` fixes it; measured, the chip is now 84px wide at 375.
Both routes are measured every run.

The 375px case is the one that failed, exactly as this section anticipated it
could. The stated retreat — drop the chevron and the `+N` at that width — was
applied and re-measured: **still 132 vs 88**, because below `sm` the date
pickers already claim the whole row, so the chip is a separate flex line no
matter how narrow it is. The retreat was therefore reverted (it cost the chip
its only affordance for nothing) and the phone keeps one extra wrap line.

The assertion pins 44 rather than relaxing to "no worse than": a change that
added a SECOND line would still fail.

**E2E — behaviour.** Landing on `/hr-flags` with an outage shows the chip and
no band; opening it reveals Excuse; a queue with no outage has no chip. The
terminal row appears at the end of a capped list.

**Existing tests that will need rework**, named so the plan budgets for them:
`flagQueuePage.test.tsx` (the largest — it asserts the header description, both
orphan lines, the capped strip and the band), `outageBand.test.tsx`,
`flagQueueBanner.test.tsx`, `deviceAlerts.test.tsx`, and `e2e/flags.spec.ts`
(lines 276 and 305 assert the band text and the header description verbatim).

## Risks

- **Excuse is one click further away.** Ruled and accepted. If usage drops
  noticeably, the fallback is a slim always-on band for outages only, with the
  facts still in the chip.
- **The 375px chip may not be free.** Measured, with a stated fallback above.
- **Deleting the orphan counts removes the only surface reporting them.** Ruled
  and accepted; they remain in the API response and in the database, so
  restoring a report elsewhere costs nothing but a place to put it.

## Out of scope

- Any backend change, including the shape of `orphans` in the API response.
- `SchedulePlanPreviewDialog`, `FlagDecisionPanel`, `FlagDetailPanel`, and the
  evidence timeline.
- The rollout banner's copy or its trigger.
- Adding a route or report for the orphaned decisions.
