# Mini App calendar sheet — design

**Date:** 2026-08-17
**Surface:** `dewey_time/frontend/hr_attendance/src/miniapp/` (the employee Mini App at `/hr-me`)

## Goal

Replace the Week tab with a date picker: tapping the date heading on the Today
tab opens a bottom-sheet month calendar, each day carrying a mark that says
whether that day's attendance record is **complete**, and tapping a day opens it
on the Today tab.

## Why this shape

The Week tab exists to answer "which day do I want to look at?" and answers it
seven days at a time, with a whole tab of permanent chrome. A month grid answers
the same question at four times the density, from inside the tab the reader is
already on, and costs no tab.

The marks are the part worth being careful about, and the constraint that
settles the design is structural rather than aesthetic:

> **The Mini App is never shown flags.** `miniapp_api.py` narrows the HR payload
> through an allowlist — `date, shift, checkins, holiday, leave, observed_lunch,
> first_in, last_out`. No flags, no tiers, no severity, and no grace minutes.

`miniStatus.ts` states the reason: the engine's verdict on a day is provisional
until HR reviews it (intraday re-inserts AUTO flags on every punch), so the app
reports and does not judge.

So the mark reports **the record**, not a verdict on the person. "Your Tuesday
has no punches" is a fact about the record that HR can still forgive; "Tuesday
was an unauthorised absence" is a claim the app has no standing to make and no
data to support. Every mark below survives being read by the person it
describes.

This also rules out the cheap-looking alternative — deriving lateness on the
client from `first_in` versus `shift.start_time`. Grace minutes are HR-only and
not in the payload, so the phone would call someone late on a morning the engine
forgave. Two disagreeing verdicts about the same day, and the wrong one is the
one in their pocket.

## Global constraints

- **No new backend fields.** The payload allowlist in
  `dewey_time/telegram/miniapp_api.py` is not widened by this work. Everything
  the mark needs is already in `DAY_KEYS`.
- **Shared primitives, not hand-rolled ones.** `Sheet` and `Calendar` /
  `CalendarDayButton` come from `@/components/ui/*`, which re-export
  `@lolbikb/dewey-ui` v3.0.0. `react-day-picker` 10.0.1 is already in the tree
  as a dewey-ui dependency; no new package is added.
- **`ResponsiveModal` is not used.** It switches to a centre `Dialog` above a
  width breakpoint, and a Telegram Desktop Mini App can be wide enough to trip
  it. This must be a bottom sheet on every platform, so it uses `Sheet`
  directly with `side="bottom"`.
- **Khmer renders in Khmer.** Month names and weekday headers come from
  `react-day-picker`'s `locale` prop fed the same `date-fns` `km` locale the app
  already uses; day numbers go through `miniIntl.digitsFor`, because
  `react-day-picker` emits Latin digits.
- **Built assets are the deployed artifact** and must be committed
  (`dewey_time/public/**`, `dewey_time/www/hr-me.html`). Frappe Cloud does not
  build these.

---

## 1. The mark

### The states

A closed union, so an unhandled case is a compile error rather than an unstyled
cell.

```ts
export type DayMark =
  | "none"        // nothing drawn
  | "off"         // not a working day
  | "complete"    // a whole record
  | "incomplete"  // a punch never paired
  | "missing";    // rostered, over, nothing recorded
```

| mark | when | drawn as |
|---|---|---|
| `complete` | punches present and they pair up | solid dot, inheriting the button's text colour |
| `incomplete` | odd punch count on a finished day | hollow amber ring |
| `missing` | rostered, day is over, **zero** punches | solid amber |
| `off` | day off, holiday, or on leave | hollow grey ring |
| `none` | any future day, **and today while it is still running** | nothing |

### Amber for both problem states, never red

`destructive` is the loudest colour in the palette and this surface has never
spent it. Red reads as "you are in trouble" even when the sentence is only "no
record" — and HR may still forgive the day.

The two are told apart by FILL, not by ring weight. This spec first said "light
ring" versus "heavy ring", and at 8px on a phone those are the same circle —
visible only once it was screenshotted. Hollow versus solid reads at arm's
length.

### `missing` is a punch COUNT of zero, not a tone

`dayFacts` cannot separate these two: a day with one punch has no range (a
range needs both ends), so its tone is `"nothing"` — the same tone a day nobody
came to gets. Reading the mark off the tone called a forgotten clock-out an
absence, which are opposite problems to go and fix. The mark counts punches.

### Today is never marked as a problem

At 09:00 on a rostered day there is one punch and no matching out. That is
normal, not incomplete. A day is only eligible for `incomplete` or `missing`
once it is over — the same present-tense-versus-past line `miniStatus` already
draws with `isSameDay(date, now)`.

"Over" means: the date is before today, **or** it is today and the rostered
`end_time` has passed. A day with no roster at all (`shift_assigned` false) can
never be `missing`; it is `off`.

### Pairing is by parity, deliberately

`incomplete` is an odd number of punches. Not `classifyUnpairedPresentations`,
which distinguishes `openSession` from `unpairedError` more precisely — because
it reads device-sync state the Mini App payload deliberately drops, so it would
run degraded here and could classify differently from the same function in HR.

Parity is the rule `miniStatus.stillInside` and the notifier's
`direction_of` already use. Three surfaces agree on it today; a fourth rule is
exactly how they would start disagreeing about the same Tuesday.

### Where it lives

`src/miniapp/miniDayMark.ts` — one exported pure function:

```ts
export function dayMark(facts: DayFacts, date: Date, now: Date): DayMark
```

`DayFacts` already carries `tone: "worked" | "leave" | "holiday" | "off" |
"scheduled" | "nothing"`, which is most of the answer. The only thing `dayFacts`
does not distinguish is a complete record from a dangling punch — both are
`tone: "worked"` — so `dayMark` reads `day.checkins` for the parity.

Pure and outside any component, matching `flagQueuePartition.ts`'s stated
reason: the unit suite renders with `renderToStaticMarkup` and has no
react-query harness, so logic left inside a component is logic nothing can test.

---

## 2. The sheet

### Container

`Sheet` + `SheetContent side="bottom"`. Telegram's own BackButton closes it,
through the existing `bindBackButton(window, open, close)` — the same mechanism
the day drill-in already uses, so there is one back affordance on screen and it
is Telegram's.

`disableVerticalSwipes` is already on at launch, so dragging inside the grid
cannot close the whole Mini App.

### Grid

`Calendar` in `mode="single"`, `weekStartsOn: 1` (Monday-first, matching the HR
week view and `weekDatesFor`). The day cell is a wrapper around the exported
`CalendarDayButton` that renders the number plus the mark beneath it — wrapping
rather than replacing, so keyboard handling, selection state and disabled days
stay the primitive's.

### Grid details settled during implementation

`showOutsideDays={false}` — neighbouring-month days are disabled and unmarked,
so they are five greyed numbers of noise on the row the eye lands on first.

The primitive's day cell is `aspect-square`, which at 390px is a 53px square
and 320px of grid — enough to push the month total off a half-height Telegram
sheet. Overridden to `h-11`, still a comfortable target.

`formatters.formatCaption` — date-fns's `km` gives `សីហា` and then `2026`,
because it emits Latin digits in **every** locale. Without the override the one
line above a grid of Khmer numerals is Latin.

### Range

**Three months reachable in total, including the current one.** In August the
grid pages back to June and no further. Forward paging stops at the current
month, because nothing is recorded in the future.

Stated this way because "three months back" reads two ways and the difference
is a whole month: the bound is `startOfMonth(subMonths(today, 2))`, not
`subMonths(today, 3)`.

One query per month opened, keyed `["mini-calendar", start, end]` — the same key
shape the Day and Schedule tabs already use, so a month already fetched is free.
A 6-week grid is 42 days, inside the API's `MAX_RANGE_DAYS = 62`.

The query fires only when the sheet is open.

### Footer

`Worked in August · 142h 30m`, net of lunch, from
`totalWorkedMinutes(facts)` over the month's days — the helper already exists
and is already used for the weekly figure. Rendered through `useFormat().worked`
so Khmer gets Khmer numerals and its own spacing.

Null renders as `—`, matching `MyWeekPage` and `MySchedulePage`.

### Selecting a day

Closes the sheet and sets the Today tab's `openDay`, which is the state the week
drill-in already drives. Selecting today clears `openDay` rather than setting
it, so the heading reads "Today" and not the date.

`openHaptic` on selection — the same weight the week drill-in uses, because it
is the same action.

---

## 3. The trigger

The date heading in `MyDayPage`'s header becomes the button, with a chevron
after the date:

```
Today 17 August ⌄              ● In · DIS Iconic
```

The header row is the app's most contested horizontal space — measured in Khmer
at 320px, the date truncates and the status chip is already capped at 58% width.
A third element would have to take room from one of them. The date is also
where people look for a date.

It must be a real `<button>` with an accessible name that says what it does
("Choose a date"), not a click handler on the `<h1>`.

---

## 4. Removing the Week tab

### What the tab carried, and where each part goes

`MyDayPage`'s own docstring names the two things the Week tab exists to cover:

| carried by Week | lands where |
|---|---|
| picking another day | the calendar sheet, at four times the density |
| the **net weekly total** | the sheet's footer, as a **month** total |
| the **leave type name** per day | already covered — `miniStatus` returns the leave type and `StatusChip` renders it |
| per-day worked figures | the day itself, on the Today tab |

### Shared code that must survive

`MySchedulePage` imports `weekForOffset`, `weekRangeLabel` and `WeekNav` from
`MyWeekPage`. Deleting the file would take the Schedule tab's navigation with
it. These move to:

- `src/miniapp/miniWeek.ts` — `weekDatesFor`, `weekForOffset`, `weekRangeLabel`,
  `canGoForward` (pure)
- `src/miniapp/MiniWeekNav.tsx` — `WeekNav`

`MyWeekPage.tsx` is then deleted, along with `WeekRow` and `rowValue`, which
have no other caller.

### Tab bar

Two tabs: Today, Schedule. `MiniTab` narrows to `"day" | "schedule"`, and
`isMiniTab` narrows with it — which matters, because it is the guard on what
comes back out of CloudStorage. A user whose last session ended on the Week tab
has `"week"` stored; `isMiniTab` already rejects an unknown value and falls back
to `"day"`, so the stale key needs no migration.

`miniAppShell.test.tsx`'s "the shell offers exactly the three employee views"
asserts three labels and must become two — and must keep asserting that no HR
label (Flags, Coverage, Import, Biometric) ever appears, which is the part of
that test that is actually load-bearing.

### Strings

Removed with the tab: `tabWeek`, `loadingWeek`, `errorWeek`, `workedThisWeek`.
Kept, because Schedule still uses them: `previousWeek`, `nextWeek`,
`thisWeek`, `backToThisWeek`, `rosteredThisWeek`, `noShiftsThisWeek`.

Added: `chooseDate`, `workedInMonth`, and the four mark descriptions used as
accessible text on each day cell.

---

## 5. Accessibility

Colour and fill alone do not carry the mark. Each day button's accessible name
states the date and the mark in words — "Thursday 6 August, no record" —
because the whole grid is otherwise a field of identical circles to a
screen-reader user, and the marks are the reason the grid exists.

**Through `labels.labelDayButton`, not a visually-hidden span.** This spec
originally called for the span, reasoning that an `aria-label` would beat
name-from-content and silence the day number. That reasoning was right and the
conclusion was wrong, because it missed who else sets one: **react-day-picker
puts its own `aria-label` on every day button** (`"Monday, August 3rd, 2026"`).
The span was therefore never announced — the marks were silent while the source
looked correct, and a source-read test passed the entire time. Only dumping the
rendered DOM showed it.

So the guard for this is an e2e test reading the **rendered accessible name**.
A unit test that greps the source for `sr-only` is precisely the test that
passed while this was broken.

---

## 6. Testing

**Unit — `miniDayMark.test.ts`.** The mapping is a pure function over a closed
input set, so it is table-driven:

- each `DayTone` maps to its mark
- an odd punch count on a past day is `incomplete`; an even one is `complete`
- **an odd punch count on TODAY, mid-shift, is `none`** — the regression that
  matters most, because it is the difference between a live day and an accusation
- a single lone punch on a past day is `incomplete`, never `missing`
- no day after today is marked at all, including weekends and holidays
- a rostered today whose `end_time` has passed, with no punches, is `missing`
- a rostered today whose `end_time` has NOT passed, with no punches, is `none`
- an unrostered day with no punches is `off`, never `missing`
- a future rostered day is `none`
- holiday and leave outrank punches, matching `dayFacts`

**Unit — sheet rendering.** `renderToStaticMarkup` over the sheet body with a
fixed month of fixture days: the right number of marks of each kind, the footer
total, Khmer numerals in the Khmer locale with an English positive control, and
no Latin digits anywhere in the Khmer render.

**Unit — structural.** A source read asserting `MyWeekPage` is gone and that
nothing imports it; the tab bar renders exactly two tabs.

**e2e — `miniapp.spec.ts`.** Open the sheet from the heading, assert the grid is
a bottom sheet (not a centre dialog) at both project widths, tap a day, assert
the Today heading names that day and the sheet is closed. Assert the forward
arrow is disabled on the current month and the back arrow is disabled three
months out.

**Mutation checks**, each of which must fail its own guard:
- treating today's open run as `incomplete`
- moving the back bound by one month (`subMonths(today, 3)` instead of
  `subMonths(today, 2)`), or dropping the forward cap
- rendering the mark without its accessible words
- swapping the amber `missing` ring for `destructive`
- letting `ResponsiveModal` back in (asserted as a source read — the breakpoint
  behaviour is invisible at one viewport width)

---

## Out of scope

- **Widening the payload to carry flags.** Considered and rejected above. If the
  owner later wants real severity on the calendar, that is a policy decision
  about what an employee may see before HR has reviewed it, and it gets its own
  spec.
- **Translating the timeline's hour axis and punch labels.** Still Latin/English
  in both languages. They live in the shared HR `DayCell`, so changing them
  reaches into the HR console — a separate piece of work, already flagged.
- **Anything on the Schedule tab** beyond re-pointing its imports.
