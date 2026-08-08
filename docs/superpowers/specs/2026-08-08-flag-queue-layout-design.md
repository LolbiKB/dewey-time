# Flag Queue — The Page

**Date:** 2026-08-08
**Status:** approved for planning
**Depends on:** `2026-08-07-flag-queue-row-design.md`, `2026-08-06-flag-queue-pattern-nesting-design.md`

## What this is

The nesting spec fixed the queue's structure and the row spec fixed what a row shows. This
spec fixes the *page they sit on*: how much of the viewport the queue actually gets, how
wide it is allowed to be, and — the substantive change — which things belong in a queue of
judgments at all.

Six decisions follow, in descending order of how much they change. The three that matter
most:

1. **`BRANCH_NO_DEVICE_DATA` leaves the queue.** It is not a judgment about anybody, and
   mixing it with judgments makes the queue lie about the size of the job.
2. **The split stays, with the decision controls pinned.** Evidence scrolls; the form does
   not move.
3. **The page stops giving away 45% of its height and 20% of its width to chrome.**

## Measured baseline

Taken from production (`hub.deweyapps.com/hr-flags`) on 2026-08-08, viewport 1512×662.

| | Measured |
|---|---|
| Chrome above the first row | **297px** — 45% of the viewport |
| Working area for list + panel | 345px |
| Rows visible at once | 5.8 |
| List content height | 9,146px |
| Panel content, 14-flag person | 5,069px |
| Content width | 1,216px of 1,512 — **296px lost**, 704px on a 1920 monitor |
| Longest panel prose line | 106 characters at 582px |

The 297px decomposes as: app header 41 · `Page` padding 20 · `PageHeader` 224 · gap 12.
The `PageHeader`'s own 224 is title+description 52, date/tier controls 62, the capped-queue
strip 38, count chips 36, and 36 of gaps.

### What the payload actually contains

| | |
|---|---|
| Flags | 5,000 (at the cap) — **4,908 `MISSING_TIME`**, 92 `NON_PRIMARY_SITE_PUNCH` |
| Entries | 147 — 14 group, 133 person |
| Tiers | **146 `act`, 1 `review`, 0 `routine`** |
| Distinct people | 389 |
| Decided / needs re-review | 0 / 0 |
| Device Closeout Alerts | 0 |

Broken down by entry type:

| Entry type | Rows | People | Flags |
|---|---|---|---|
| `BRANCH_NO_DEVICE_DATA` | 13 | 256 | 3,277 |
| `REPEAT_PATTERN` | 1 | 3 | 13 |
| `person` | **133** | 133 | 1,710 |

Punch collection is not yet operating, so today's queue is a rollout artifact: one fact —
nobody punched — repeated 4,908 times. **The layout is therefore designed against the
intended steady state**, estimated at 30–80 rows spread across all three tiers, while
keeping the bulk path good because a branch device dropping is permanent, recurring
behaviour.

### Why there are 133 person rows

**Every one of those 133 employees has `employee_branch: null`.** All 256 group members
have a branch; all 133 person rows do not. They share the `DI-` id prefix with the grouped
population, so this is not a different class of worker — it is missing data on the Employee
record.

`_outage_branch_dates` builds its candidate set from `(branch, date)` pairs and skips any
employee whose branch is falsy, so **a branchless employee can never be claimed by an
outage group.** These 133 are in exactly the same situation as the 256 — nobody punched
anywhere — but they fall out of the collapse that exists to handle it and land as 133
individual rows.

This matters for expectations. Lifting outage groups out of the queue takes today's list
from 147 rows to **134** (133 branchless persons + 1 pattern group), not to a handful.
Setting the branch on those 133 Employee records would fold them into the existing outage
groups and take the same list to roughly **1 row** — a data fix worth more than anything in
this spec, and one this spec cannot substitute for.

## Decision 1 — the queue holds judgments only

### The problem

One list answers four different questions with one row shape and one rank scale.

| Row type | Subject | Question it asks | Evidence to weigh |
|---|---|---|---|
| `BRANCH_NO_DEVICE_DATA` | a branch and a machine | acknowledge the device was down | **none** |
| `REPEAT_PATTERN` | several people, one habit | is this habit acceptable? | yes |
| `ROUTINE_CODE` | several people, one low-stakes day | sweep these | barely |
| `person` | one person, one or more findings | was this absence acceptable? | yes |

`flag_grouping.py` already states the distinction in its own comment — *"A device outage
claims the whole day, before anything else looks at it"* — and then the UI renders that
precondition as one of 147 judgments, ranked against a person's four-hour gap.

The mixing leaks into the columns. `99 people · 30 Jul – 8 Aug` is a **scope**;
`14 gaps · worst 4h 15m` is a **severity**; they occupy the same slot with no marker for
which you are reading. `+N` means undecided flags on a person and hidden members on a
group.

### The change

`BRANCH_NO_DEVICE_DATA` entries are partitioned out of the list and rendered as a band
above it. `REPEAT_PATTERN` and `ROUTINE_CODE` stay — they *are* judgments about people —
but lead with member faces rather than a headline sentence, so a group of people never
looks like a headline about a thing.

**No backend change.** `get_flag_queue` already returns `group_type` on every group entry;
this is a client-side partition of data already on the wire.

### The band

At rest, one line — with today's real figures:

```
⚠  13 branches had no device data · 256 people
   30 Jul – 8 Aug · 3,277 flags · the machines didn't record — nobody is being judged here
                                             [ Review 13 ▾ ]  [ Excuse all 256 ]
```

`Review 13` is a **disclosure that expands in place**, not a modal. Expanded, one row per
branch: a checkbox, the branch name, a day strip marking which days had no sync row, and
`N people · M flags`. The submit label counts down as branches are unchecked
(`Excuse 157 people · 2,287 flags`).

Thirteen rows is enough that the expanded band needs its own `max-height` with internal
scroll rather than growing the page — it must not push the queue below the fold, which is
the failure it exists to prevent.

**Per-branch checkboxes only — no per-person roster.** With no device data there is no
basis for treating one person in a branch differently from another; you cannot know who
worked. The apparent exception — "I happen to know Sokha was on approved leave" — is not a
reason to withhold the excuse but to record a different *reason*, and decisions are
append-only and supersede, so that is corrected afterwards rather than by holding up 256
people. Per-branch review does earn its place: HR may want to handle one branch separately.

The band's footer states its own ceiling and links out:

> Branch and days only — nothing here maps a device to a branch. **Device health ↗**

That wording is not hedging. `_outage_branch_dates`' docstring: *"Branch granularity is by
design, not an approximation of something finer: nothing in this app maps a device to a
branch."*

**Link target is `/hr-attendance`**, where `DeviceCloseoutBanner` and
`DeviceSyncStalenessBanner` already render. There is no device-health route in this app
(`main.tsx` has exactly five: `/hr-attendance`, `/hr-schedule`, `/hr-schedule/import`,
`/hr-schedule/coverage`, `/hr-flags`) and this spec does not add one.

### Why a band and not a page

- Device health already has a better home. `DeviceAlerts.tsx` ships `DeviceCloseoutBanner`
  (carrying `device_sn`, status, `last_error`) and `DeviceSyncStalenessBanner`, both live
  on the Attendance page. The flags payload's `alerts` shape is weaker — no serial — and
  `FlagQueuePage` deliberately refuses to render `last_error` because there is no
  device↔branch registry to make the claim true. A page here would be a third device
  surface, less capable than the existing one.
- It cannot grow into an investigation. Branch granularity is a deliberate ceiling.
- A nav item would be empty most days once punches flow; a band is absent until it matters.

### What the outage claim rests on

`_outage_branch_dates` is the union of two device-layer signals: **no device sync row at
all** for a (branch, date), and an **unresolved Device Closeout Alert**. All 14 of today's
groups come from the first limb, which is why `alerts` is 0 — with no data at all no
closeout ever started, so nothing raised an alert. The candidate set is drawn from
employees who actually have flags, so a branch appears only when people were *scheduled*
and the device recorded nothing. "Had no device data" is therefore a defensible claim and
bulk-excusing on it is honest.

## Decision 2 — split layout, pinned controls

The two-column split stays: evidence must be in front of you at the moment you judge, and
the list must stay visible so you never lose your place. What changes is that the decision
form leaves the scroll flow and pins to the **bottom edge of the panel column**.

```
┌ list ──────────────┬ panel ─────────────────────┐
│ ACT · 3            │ [avatar] Sreylak Min       │
│ ▸ Sreylak Min      │ 31 Jul – 8 Aug · Toul Kork │
│ ▸ Ratana Sok       │                            │
│ ▸ Kosal Vann       │ Missing 4h — 31 Jul        │  ← scrolls
│ REVIEW · 12        │ [timeline]                 │
│ ▸ 6 people late…   │ The other 13 ▾             │
│ ▸ Phalla Chan      ├────────────────────────────┤
│ ▸ …                │ Deciding Missing 4h·31 Jul │  ← pinned
│                    │ [Excuse|Uphold][Reason][…] │
│                    │ [Excuse this day][All 14]  │
└────────────────────┴────────────────────────────┘
```

Rationale: the controls are the only thing on the page used on **every** row, and today
their position depends on how much evidence sits above them — so the one target you hit
hundreds of times a session moves every time. Pinning is the single idea worth taking from
the rejected full-width-list-plus-docked-bar option, without paying its cost of putting
evidence behind a click.

The panel column is capped at a readable measure rather than stretching to fill. Today it
takes 724px and spends it on a segmented control with its two options 360px apart, a
`Reason` select 724px wide for a 22-character option, a facts grid placing `Gap` 320px from
`4h`, and prose at 106 characters per line.

**Grid becomes `minmax(30rem, 40rem) minmax(0, 1fr)`** with the panel's own content capped
at ~62ch. The list gets the width it has been starved of; the panel gets a measure.

## Decision 3 — the chrome

Target: **297px → ~120px.** At the measured 662px viewport that takes working area from
345 → 517 (+50%); at a 900px viewport, 583 → 755 (+29%).

| Band | Today | Change |
|---|---|---|
| Title + description | 52 | Collapses onto one line with the counts: `Flags — 134 need a decision · 256 waiting on a device fault` |
| Date + tier controls | 62 | Inline, no stacked labels. From/To become one range control. |
| Capped-queue strip | 38 | **Removed** as a permanent fixture — see below |
| Count chips | 36 | **Removed.** Two of three are permanently 0; the useful number moves into the description line. `Decided` becomes a toggle chip in the toolbar, since it is the only one that ever did anything. |

The capped strip goes because at this volume capping is structural — it never clears, so a
permanent warning in the loudest colour on the page teaches people to skip that colour. It
returns only when actionable, and then as a **control** rather than a lecture:

```
Showing the newest 5,000 flags
Older days in this range aren't loaded. Narrow the dates to reach them.
[ Last 7 days ]  [ Last 3 days ]
```

Today's copy names two levers ("narrow the dates, or filter by consequence") and offers
neither in the strip itself.

## Decision 4 — the width

`Page` is `mx-auto … max-w-7xl … px-5 py-4 sm:px-8 sm:py-5`. At 1512 that yields 1,216px of
content: 232px lost to the `max-w-7xl` cap and 64px to padding. At 1920 it is 704px lost —
36.7% of the monitor.

The cap is correct for the pages it was written for; its doc comment says it exists "so
pages across both apps share the same content width," and 1280px is a sensible ceiling
where you are reading. It is wrong here for the same reason the 724px panel is wrong: **a
width tuned for reading applied to a surface built for scanning.** This is the one page
where width converts directly into rows that stop truncating.

**`max-w-none` on this page only.** The shared default is untouched, so form and settings
pages keep their 1280px. `adms/src/pages/AttendanceLogs.tsx` already overrides `Page` this
way, and dewey-ui's `cn` is `twMerge`, so the override resolves cleanly.

Gain: +248px at 1512, +656px at 1920, all of it available to the list column.

Combined with Decision 3, the working canvas goes from **1216×583 to ~1464×755 — +56%
area** before any layout change.

## Decision 5 — panel density

A 14-flag person renders 14 full cards totalling 5,069px. Each card repeats the same
generic explainer for its flag code, and each states its own numbers twice — once as prose
("Gone from 7:00 AM to 11:00 AM — 4h unaccounted") and again as a facts table (Gap 4h /
Left 7:00 AM / Back 11:00 AM).

The real path through a multi-flag person is *decide the worst one, then "same reason
applies" to the rest* — `remainingIdentities` and `applyToRemainingLabel` already exist for
exactly this. So:

- **The worst flag renders in full**: headline, narrative, timeline, facts, evidence
  disclosure.
- **The rest render as one-liners** — `1 Aug · Missing 4h 15m · [decide]` — enough to
  confirm they are the same kind of thing. Clicking one promotes it to full treatment.
- The per-code explainer appears **once**, not once per card.

Result: ~5,069px → ~900px, with no information removed from the page — only from the
repetition.

## Decision 6 — mobile

Today, below `lg`, the split collapses to one scroll surface with the panel as a sibling
*after* the list. Tap a row and the decision form is 9,146px below you, with nothing
scrolling it into view.

**The panel becomes a bottom sheet.** The list stays mounted and scrolled where it was, so
dismissing returns you exactly where you were — the property the desktop split has and the
current mobile stack loses. `ResponsiveModal` already exists and already backs the
>25-write confirm.

## Other states

| State | Treatment |
|---|---|
| Nothing waiting | "Nothing waiting — every flag in {range} has a decision", with `Show the N decided` |
| Loading | **Skeleton rows**, not a centred spinner, so the layout does not jump when data lands |
| Load failed | Unchanged — `FailureBlock` replaces the region rather than sitting above it |
| Capped | Only when actionable, and as a control (see Decision 3) |
| Partial bulk failure | Unchanged — amber `AttentionStrip` with the failing identities behind a disclosure |

## Phasing

**Phase 1 — chrome, width, outage band.** Most of the measured gain, no new behaviour,
nothing touching the write path. Deliverable: header ~120px, `max-w-none`, band with
per-branch bulk excuse, list holding judgments only.

**Phase 2 — panel restructure and mobile sheet.** Where the risk is. Deliverable: pinned
footer, worst-flag-in-full plus one-liners, bottom sheet below `lg`.

## Out of scope

**Source-side suppression of `MISSING_TIME` when a branch-day has no sync row.** This is
the real fix for the 4,908 flags — they are still generated, still transmitted, and still
consume the 5,000 cap after this work lands. Everything in this spec is presentation. It
should not be mistaken for solving the volume, and it is a backend change with its own
correctness questions (what happens to a genuinely absent employee at a branch whose device
also failed).

**Setting `branch` on the 133 Employee records that lack one.** Not a code change at all,
and larger in effect than this whole spec: it takes today's post-partition list from 134
rows to roughly 1. It is listed here so nobody reads a 134-row queue after Phase 1 as this
design underdelivering — the design is working; the data is incomplete. It also has
consequences beyond this page, since `employee_branch` drives the strip's outage shading
and the branch label on every row.

Also out: the `ACT`/`REVIEW` labels colliding with the `Needs re-review` decision state,
and the employee-photo URL privacy question. Both previously logged, neither is layout.

## Testing

The unit suite is `renderToStaticMarkup` plus regex over an HTML string — no accessibility
tree, no focus, no key events. It cannot reach most of this. Coverage split:

- **Unit** — the partition (`BRANCH_NO_DEVICE_DATA` out of `entries`, everything else in),
  band arithmetic (people/flag totals, countdown as branches are unchecked), and the
  header's split counts. Include a fixture with a **branchless person row alongside an
  outage group**: that is today's actual shape, and a partition tested only against
  branch-bearing data would not catch a filter that drops the wrong side.
- **Playwright** — pinned footer stays in place while the panel body scrolls; the roving
  tabindex, `aria-setsize`/`aria-posinset` and arrow navigation still hold with the band
  present; the mobile sheet opens over a list that keeps its scroll position; focus after a
  write still lands on the row taking the decided row's slot.
- **Python** — untouched. All 606 must stay green; no backend change is in scope.

**Written before the panel restructure merges, not after.** That code path is where the
review previously found a draft leak carrying one person's free-text note onto the next
person's form, and it is the part of this feature with the most subtle prior bugs.

## Risks

- The panel restructure touches the focus-restore loop, the highest-defect-density code in
  this feature.
- The mobile sheet is new behaviour, not a re-style.
- Removing the count chips removes `Open` and `Needs re-review` as standing numbers. `Open`
  moves to the description line; `Needs re-review` currently reads 0 and has never been
  exercised against real data, so its absence is untested against a day where it is
  non-zero. If it turns out to need standing visibility, it returns as a tier-style
  section in the list rather than as a chip.
