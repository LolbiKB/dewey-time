# The Day tab's numbers row

**Status:** approved 2026-08-18
**Surface:** Telegram Mini App, Day tab (`dewey_time/frontend/hr_attendance/src/miniapp/`)

## Why

Two problems, one answer.

**The flags pill overlaps the tab bar on real phones.** `MiniFlagButton` is
`position: fixed` at `bottom: TAB_BAR_HEIGHT_PX + TAB_BAR_FLOOR_PX` = 56px. The
tab bar's painted height is `44 + insets.bottom + 12`, because `MiniAppShell`
applies the safe-area inset as the nav's `paddingBottom`, which grows the nav.
The comment at `MiniAppShell.tsx:99` asserts the opposite — "the bar's own
padding already absorbs it" — and that is the defect. Measured in a browser at
390x560 with `safeAreaInset.bottom = 34`: the pill's bottom edge sits **35px
below the nav's top edge**, straight across the tab labels. At zero inset it
clears by 0px, so the placement never had clearance on any device.

**The day has no total.** `MyDayPage`'s own docstring records this as a known
cost: "the canvas gives 4h 3m and 4h 8m; nobody adds those in their head". The
month total went to the calendar sheet; the day total went nowhere.

A single in-flow row solves both. It carries the two numbers the canvas cannot
state, and it gives the flags pill a home that is not a floating layer — which
retires the whole class of bug rather than re-tuning its arithmetic.

## What it is

A flex sibling between the timeline grid and the tab bar, inside `MyDayPage`.
Net worked and net rostered on the left, the flags pill on the right.

**Nothing on this page is `position: fixed` afterwards.** That is the point of
the change, not a side effect: a fixed element cannot be laid out against a
sibling it cannot measure, and every future viewport, keyboard or inset change
is another chance for the two to disagree.

Cost: roughly 34px of timeline height. The alternative measured during design
— Telegram's native `SecondaryButton` — cost 74px, and the timeline already
has a `min-h-[16rem]` floor with the page scrolling below it.

### What the row says

Two rules generate every case, and they compose:

1. **The worked figure shows whenever there is one.**
2. **The rostered figure is suppressed on leave and holiday days**, and absent
   on days with no roster.

The row itself renders when it has at least one of: a worked figure, a rostered
figure, or a flag. So a leave day with a flag still gets a row — carrying the
pill and no numbers.

| Day | Row |
|---|---|
| Finished, rostered | `8h 11m / 8h` |
| Live, currently clocked in | `7h 5m so far / 8h` |
| Scheduled, no punches yet | `— / 8h` |
| Day off or clock day, worked | `2h` alone |
| Leave or holiday, no punches | no numbers |
| Leave or holiday, worked anyway | `2h` alone — never against a rostered figure |
| Nothing, and no flags | no row at all |

### Rostered means net of lunch

`shiftMinutes - lunchMinutes`, matching `rosteredThisWeek` ("Rostered this
week, net of lunch") and `workedInMonth`. Both existing figures are net; a day
figure that was gross would be the only one on the surface that wasn't.

### The live figure

`netWorkedMinutes` sums PAIRED segments only, so an open run contributes
nothing. Someone clocked in since 07:58 reads `workedMinutes === null` at
11:00, and `4h 3m` at 16:00 when they have in fact worked nearly eight hours.
On the tab that defaults to today, that is the common case, not the edge case.

So the Mini App adds the open run on top:

- `netWorkedMinutes` is **not changed**. It is HR's payable number and the
  calendar sheet's month total reads it. A projection must not leak into either.
- The open run is identified by `miniStatus`'s existing `stillInside`, which
  already documents itself as agreeing with `deriveSegments`' pairing — "an odd
  count is an open run in both places and the two surfaces cannot disagree
  about the same day". Reusing it keeps the status chip, the timeline and this
  row on one derivation. A fourth private copy of "are they clocked in" is
  exactly the drift this codebase keeps writing guards against.
- The addition applies only when the day is today and the run is open. A past
  day with an unclosed punch is a `MISSING_IN_OR_OUT` flag, not a person still
  at work, and must never accrue minutes.

`so far` marks the figure while it is live, so a number below the roster does
not read as a shortfall. It disappears once the day is closed.

**This is a projection and the spec states it plainly:** at 11:00 the row
counts minutes against a punch that has not happened. If the person forgets to
clock out, the figure they saw was never real. The alternative — showing only
completed runs — is never wrong and routinely useless, and the owner chose the
useful one knowingly.

### Leave and holiday

The rostered figure is suppressed: on a day somebody was entitled to be away,
there is no figure they failed to meet. The status chip beside the date already
names the day ("Annual Leave", "Constitution Day"), so nothing is lost.

Work actually punched on such a day still shows, alone. Someone who came in for
two hours on a public holiday worked two hours, and the record should say so.

Two rejected alternatives, recorded because they will be proposed again:

- **`8h / 8h`, crediting the roster.** Reads as "you are square for the day",
  which is a payroll statement. This app has never made one and does not have
  the data to stand behind it.
- **`— / 8h`.** Factual, and still eight hours that look missing on a day
  somebody was entitled to be away.

### Accessibility

`8h 11m / 8h` read aloud is two durations and a slash. The row carries an
sr-only sentence naming both figures. The visible text stays as designed; the
sr-only string is what a screen reader announces.

### Localisation

Every digit goes through `fmt.worked`, which is already locale-bound — a Latin
`8h` beside Khmer words is the leak the e2e guard forbids. The separator `/` is
script-neutral and stays.

Two new strings, **both requiring Khmer from a native speaker**: the sr-only
sentence, and `so far`. They join the ~50 already awaiting review; the row
ships with machine-drafted Khmer marked as unreviewed, consistent with the
existing backlog.

## What this deletes

- `TAB_BAR_HEIGHT_PX` — its only consumer is `flagLift`, and its docstring is
  entirely about the flags pill. Both go. The false comment at
  `MiniAppShell.tsx:99` goes with the constant it describes.
- `flagLift` (the prop) and `DEFAULT_FLAG_LIFT_PX` (its fallback).
- `MiniFlagButton`'s `lift` prop and its `fixed`/`z-40`/`bottom` positioning.

`TAB_BAR_FLOOR_PX` **stays** — the nav's padding uses it and
`miniAppShell.test.tsx` pins it at two inset values.

`MiniFlagButton.tsx` **keeps its filename**. `miniFlagsSheet.test.tsx` reads it
via `readFileSync` by name; a rename throws rather than failing a useful
assertion.

## Adjacent fix, same branch, separate commit

`MyDayPage` declares `const window = resolveWeekTimelineWindow(...)`, shadowing
the global `window` across the entire component body. Reading the real
`window` below that line silently yields a timeline-window object; reading it
above throws `Cannot access 'window' before initialization` and white-screens
the app behind the error boundary. Both were hit during the design spike — the
silent one produced a variant that looked implemented and rendered in the wrong
place.

Rename to `timelineWindow`. Not required by this feature; included because it
is the trap that already cost one wrong result here.

## Testing

- Unit, `miniDay`: each row of the table above, including a past day with an
  open punch accruing nothing, and an overnight shift's rostered figure.
- Unit, `MyDayPage`: the row is absent on leave and on holiday; present with
  the pill alone when a leave day has flags.
- Source guard, extending `miniFlagsSheet.test.tsx`: no `position: fixed` in
  `MyDayPage.tsx` or `MiniFlagButton.tsx`. This is the defect the change
  exists to retire and the only assertion that stops it returning.
- E2E, `miniapp.spec.ts`: with `safeAreaInset.bottom = 34`, the pill's bounding
  box does not intersect the nav's. The existing suite asserts the pill's text
  and its sheet, never its geometry, which is why the overlap shipped.

## Out of scope

- The month total's definition. Unchanged, and it keeps reading
  `netWorkedMinutes`, so today's open run is not in it. A month total that
  moves as the day runs is a separate decision.
- The existing pill's wording.
- Any write path. The Mini App remains read-only.
