# Flag Queue — The Row

**Date:** 2026-08-07
**Status:** approved for planning
**Depends on:** `2026-08-06-flag-queue-pattern-nesting-design.md`

## What this is

The nesting spec fixes the queue's *structure* — a person stops producing fourteen rows
over a fortnight. This spec fixes what a row *shows*. They are one piece of work: nesting
makes an entry span several dates, and the moment it does, the row has to say which dates
those were.

Chosen direction, from four mocked alternatives: **a person-first card with a fortnight
strip**. The row leads with a photo and a name, states the finding in words, and carries a
14-cell strip on the right showing that person's fortnight at a glance.

```
[40px photo]  Sokheng Hon  also 1 outlier          ▂▂█▂▂░▂ ▂▂▂▂▂▂▂
              Missing time · 3h 12m · Thu 6 Aug
```

## Why a strip

The nesting spec names two defects. Nesting alone fixes the first (volume) and leaves the
second: *"five late mornings is a materially different situation from one, and it is the
thing HR most wants to know."* Nesting puts the five rows together; it still reports them
as the sentence "4 late starts".

A strip makes the difference a shape. Six consecutive mornings and four scattered across a
fortnight produce visibly different strips, and that distinction is exactly what decides
whether a pattern is excused as a habit or escalated as a problem. Because every strip
occupies the same fixed column, two members of a pattern group can be compared by eye
without reading either row — which is the entire reason for grouping them together.

## The row

| Slot | Content | Notes |
|---|---|---|
| Avatar | `EmployeeAvatar` at 40px | Existing component, already used in four places. Initials fallback when there is no photo. |
| Name | `employee_name` | Truncates. |
| Cross-reference badge | "also 1 outlier" | Only when the person appears in more than one entry. From the nesting spec's safeguard. |
| Sub-line | The finding in words | For a person row: worst flag + date. For a group member: "4 late starts · worst 31 min". |
| Strip | 14 cells | Right-aligned, fixed column. |

40px is a floor, not a preference. At 20px an avatar is decoration — too small to recognise
anyone — so if photos are to earn their space the row cannot be denser than this. The
measured cost is about a third fewer rows per screen than a single-line layout.

Group headers keep the same shape but carry **overlapping member avatars** instead of a
strip, so "who is in here?" is answerable without expanding the group.

## Avatar loading

`EmployeeAvatar` today renders the photo **or** the initials:

```tsx
{props.employee?.image ? <img src={...} /> : employeeInitials(...)}
```

Three things follow from that `or`, and a list of forty photos is where all three become
obvious:

1. **The photo paints in half-drawn.** Until it loads, the circle is empty; then the browser
   fills it top-down as bytes arrive.
2. **A failed load leaves an empty circle.** `alt=""` means a 404 shows nothing at all —
   not the initials, which are right there and would have been correct.
3. **Decode can block.** Nothing marks the image as non-urgent.

### The fix: initials underneath, photo fades in over them

**Render the initials always, as the base layer.** Lay the `<img>` on top at zero opacity
and fade it in on `load`. On `error`, leave it hidden and the initials simply remain.

The avatar is then never empty, never half-painted, and never a broken-image icon. Every
state is a real avatar.

| State | What is on screen |
|---|---|
| No `image` | Initials, still. |
| Photo loading, under 150ms | Initials, still. Nothing animates. |
| Photo loading, over 150ms | Initials **plus a spinning ring** on the circle's edge. |
| Photo loaded | Photo, faded in over ~150ms. |
| Photo failed | Initials, still, permanently. |

**No skeleton or shimmer.** A pulsing grey circle would replace meaningful content — whose
initials these are — with a meaningless placeholder. The initials are a *better* loading
state than a skeleton because they already carry the answer to "who is this row about".
This is why the base layer is initials rather than the `bg-muted` circle.

### The loading ring

Initials alone are ambiguous: at a glance they read identically whether a photo is still
arriving or none exists. A **2px arc travelling the circle's perimeter** resolves that
without spending what the layering just bought — the initials stay fully legible underneath,
so the row still says whose it is while the photo is in flight.

It is deliberately *not* the shared `Spinner` component. `Spinner` is a centred
`Loader2Icon`, and at 40px there is no room for a centred spinner and readable initials at
the same time — it would cover the very thing the base layer exists to show. The ring takes
`Spinner`'s accessibility contract even though it cannot take its shape: `role="status"` and
`aria-label="Loading"`.

**The ring is delayed ~150ms.** A cached photo resolves in tens of milliseconds, and an
indicator that appears and disappears inside 50ms reads as a flicker — across forty rows, as
the page malfunctioning. Nothing animates unless the photo is *still* loading when the delay
elapses, so the common fast case is completely still.

Also set `decoding="async"` so decode never blocks paint, and `loading="lazy"` so a queue
of forty rows does not fetch every photo before the first is visible.

Under `prefers-reduced-motion` both animations change rather than vanish:

- The fade becomes instant (`motion-reduce:transition-none`). Still an improvement, because
  the photo appears *whole*.
- **The ring stops rotating but stays on screen** as a static dimmed ring. The signal is
  what matters; spinning is only how it is usually delivered. Dropping it entirely would
  hand reduced-motion users back exactly the loading-versus-no-photo ambiguity the ring
  exists to remove.

### Scope

This changes one file. `EmployeeAvatar` is the only `<img>` in the SPA, and its props are
unchanged, so the four existing callers — `EmployeePicker`, `ScheduleEmployeePicker`,
`ClearEmployeeScheduleDialog`, `schedule-coverage/EmployeeLine` — inherit the improvement
without edits.

## The strip

**One cell per day, capped at the most recent 14 days of the queried range.** The window is
shared by every row so the cells form a column. A range shorter than 14 days produces a
shorter strip — seven days gives seven cells, not fourteen padded with blanks, because a
padded cell would have to mean something and there is nothing true for it to mean. Cell
size is fixed; only the count varies.

Fourteen is a fitted number, not a round one. The list pane is `22rem` / 352px
(`FlagQueuePage.tsx:547`). After 18px padding, a 40px avatar and two 9px gaps, 276px
remains for text and strip. At 6px cells with 2.5px gaps a 14-cell strip is 117px, leaving
~160px for the name and sub-line. Twenty-one cells would take 176px and squeeze names into
truncation.

### Three states

| State | Rendering | Source |
|---|---|---|
| Flagged | Coloured, height by tier — routine < review < act | The person's flags on that date |
| Clean | Short green cell | Any in-range day with no flag and no outage |
| No data | Short neutral-grey cell | `(employee_branch, date)` in the outage set |

**Green means "no flag on this day" — nothing more.** It deliberately does not claim the
person worked, because the queue does not load shift assignments and cannot know. A day
someone was rostered off and a day they worked cleanly both render green. This is honest:
the strip asserts only what was measured.

The grey state exists to stop a specific lie. A branch with no device data produces no
flags, so a naive "no flag → green" would tell HR someone was fine on a day nobody measured
them. `outage_branch_dates` already distinguishes these (`flag_queue_api.py:308`) and costs
nothing extra to surface.

Severity is encoded by **height as well as colour**, so the strip does not depend on colour
alone.

### Ranges longer than 14 days

The range picker allows up to 31 days (`QUEUE_MAX_RANGE_DAYS = 31`). The strip stays 14
cells and covers the most recent 14 of the range; a person with flags older than the window
carries a **"+N earlier"** marker beside the strip.

A widened range can therefore produce a row whose sub-line names a serious flag while the
strip is all green — the flag is older than the window. The "+N earlier" marker is what
keeps that honest, and the sub-line remains driven by the person's worst flag across the
whole range, not the strip's window.

### A group member's strip shows all their flags

Sokheng sits inside "repeatedly late" for four `LATE_START` flags and also holds a
three-hour `MISSING_TIME` that puts him in a second entry. **His strip inside the group
shows both** — the act-tier day appears as a tall red cell among the routine ones.

This makes the nesting spec's cross-reference badge visible rather than merely counted. The
badge says "also 1 outlier"; the strip shows what it is and when. HR sees the thing before
bulk-excusing the group.

The strip is therefore *not* a preview of what a bulk decision would write. That is a real
tension and it resolves in favour of visibility: the failure mode the badge exists to
prevent is HR excusing the group and never seeing the absence, and a strip that hides the
outlier would reintroduce exactly that.

## Data contract

Three additions. Nothing is restructured.

1. **`image` on the employee fetch.** `flag_queue_api.py:234` already selects
   `name`, `employee_name`, `branch` from Employee; `image` joins that list and flows into
   `employees_by_id`, then onto the person entry.

2. **`attendance_date` on each `FlagOut`.** Today the date lives on the person entry
   because entries *are* person-days. Once nesting makes an entry span dates, each flag has
   to carry its own. The value is already fetched (`flag_queue_api.py:140`); it is dropped
   when the flag is shaped in `flag_grouping.py`.

3. **The outage set in the payload.** `alerts` is already returned but is only part of the
   signal — `_outage_branch_dates` combines alert rows *and* device sync watermarks
   (`flag_queue_api.py:308`). The assembled `(branch, date)` set has to reach the client for
   the grey state to be correct.

**The API stays unbounded and window-free.** It returns every flag in the queried range,
each with its date; no fixed-size per-day array. The 14-day window is a decision the flag
page makes when it renders. A future employee-profile page can bucket the same payload into
90 cells without an API change — which is why the window does not belong in the contract.

## Counts

Unchanged from the nesting spec: the header states people *and* rows ("40 people · 12
rows"), so the toolbar total and the list length cannot read as contradicting each other.

## Accessibility

- The strip is decorative reinforcement of a sub-line the reader has already been given. It
  takes a single `aria-label` summarising the fortnight ("4 flagged days in the last 14");
  its cells are `aria-hidden`.
- Severity never rests on hue alone — cell height carries it too.
- Individual cells are not interactive. At 6px they are not a click target; the row is.
  A tooltip on hover may name the day and its flag, but nothing may depend on reaching it.

## What this does not change

- **`groupPayload` and the bulk-decision safety property.** Per-member exclusion and the
  rule that unchecking a member removes every one of their flags are untouched.
- **The decision record.** No change to `Attendance Flag Decision`, `flag_identity`, or
  `evidence_fingerprint`.
- **Triage ranks.** `flag_triage.py` is untouched; the strip reads tiers, it does not
  compute them.
- **The evidence panel.** Shipped separately (`2026-08-06-flag-evidence-panel-design.md`).

## Testing

- A person with no photo renders initials, not a broken image.
- **The initials are in the DOM while the photo is still loading** — the property that stops
  the half-drawn paint. Assert they are present before any `load` event, not merely that
  they appear when `image` is absent.
- **A photo that fails to load leaves the initials visible**, and no broken-image element.
- The `<img>` carries `decoding="async"` and `loading="lazy"`.
- **No ring renders before the delay elapses** — the anti-flicker property. Assert on a photo
  that resolves immediately: initials present, ring absent, nothing animated.
- **A photo still loading after the delay renders the ring**, and the initials remain readable
  underneath it rather than being replaced.
- **The ring disappears on both `load` and `error`** — a failed photo must not leave a row
  spinning forever.
- The ring carries `role="status"` and an accessible name.
- A day with a flag renders at that flag's tier; a day with several renders the worst.
- An in-range day with no flag renders clean.
- **A day in the outage set renders as no-data, not clean** — the distinction the grey state
  exists for.
- A group member with an out-of-group flag shows it in their strip, and their entry carries
  the cross-reference badge.
- A range longer than 14 days produces a 14-cell strip plus a "+N earlier" marker, and the
  sub-line still names the worst flag across the whole range.
- The strip's `aria-label` states the flagged-day count; cells are hidden from assistive
  technology.
- Every row's strip has the same cell count within one render, so the column is stable.
- A range shorter than 14 days produces a strip of that many cells, not a padded one.

> `test:web` is a non-recursive per-directory glob; new frontend tests go directly in
> `src/lib/` or `src/ui/`. `flag_grouping` is a pure module with no frappe import — keep it
> that way.

## Out of scope

- **The phone layout.** Below 768px the grid collapses and the decision panel stacks beneath
  the list, so tapping a row on a phone selects something you then scroll past the whole
  queue to reach. This ships today, is independent of this design, and should be filed
  separately. `ResponsiveModal` — already imported by `FlagQueuePage` — is the right
  primitive when it is picked up. Note that this design makes it marginally worse by
  lengthening rows.
- **Shading rostered-off days.** Requires shift-assignment data the queue does not load.
  The three-state strip is shaped so a fourth state can be added later without changing its
  geometry.
- **Making cells interactive.** Deliberate: see Accessibility.
