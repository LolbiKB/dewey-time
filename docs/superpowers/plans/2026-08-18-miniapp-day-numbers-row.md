# The Day tab's numbers row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the day's worked and rostered totals under the timeline, and move the flags pill into that same in-flow row so it can no longer overlap the tab bar.

**Architecture:** One derivation (`dayNumbers` in `miniDay.ts`) feeds one presentational component (`MiniDayNumbers.tsx`), which `MyDayPage` renders as a flex sibling of the timeline grid. The floating pill and every constant that positioned it are deleted, so no `position: fixed` survives on this page.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `node:test` + `renderToStaticMarkup` for unit tests, Playwright for e2e. All commands run from `dewey_time/frontend/hr_attendance/`.

**Spec:** `docs/superpowers/specs/2026-08-18-miniapp-day-numbers-row-design.md`

**Status: COMPLETE** — executed inline on `feat/miniapp-day-numbers-row`
(6a07f56c, d080fd2f, 02915cf6, d7b9c49f, plus be72660a and two asset builds).
Ledger: `.superpowers/sdd/2026-08-18-miniapp-day-numbers-row/progress.md`.
No independent review has run; that is still owed before merge.

## Global Constraints

- **Never change `netWorkedMinutes`** (`src/lib/clockDay.ts`). It is HR's payable figure and the calendar sheet's month total reads it. The open run is added on top, in the Mini App layer only.
- **Every user-visible string comes from `miniStrings.ts`**, in both `en` and `km`. A bare literal is a string that exists in English only, and `miniFlagsSheet.test.tsx` guards this.
- **Every digit goes through `fmt.worked` / `fmt.digits`.** A Latin `8h` beside Khmer words is the leak the e2e guard forbids.
- **`MiniFlagButton.tsx` keeps its filename.** `miniFlagsSheet.test.tsx` reads it with `readFileSync` by name; a rename throws instead of failing a useful assertion.
- **`TAB_BAR_FLOOR_PX` stays.** The nav's padding uses it and `miniAppShell.test.tsx` pins it at two inset values. Only `TAB_BAR_HEIGHT_PX` goes.
- **Amber, never `destructive`**, for anything problem-flavoured on this surface.
- Run the unit suite with `npm run test:web`, the build with `npm run build`, e2e with `npx playwright test e2e/miniapp.spec.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/miniapp/miniStatus.ts` | **Modify.** Export `openRunStartedAt(day)` — the unclosed arrival, derived from the `stillInside` logic that already backs the status chip. |
| `src/miniapp/miniDay.ts` | **Modify.** Add `DayNumbers` + `dayNumbers(day, date, today, now)`. `dayFacts` and `totalWorkedMinutes` are untouched. |
| `src/miniapp/MiniDayNumbers.tsx` | **Create.** The row: numbers left, flags pill right. Owns visibility and the sr-only sentence. |
| `src/miniapp/MiniFlagButton.tsx` | **Modify.** Loses `lift` and all fixed positioning. Becomes an ordinary pill. |
| `src/miniapp/MyDayPage.tsx` | **Modify.** Renders `MiniDayNumbers`; loses `flagLift` and `DEFAULT_FLAG_LIFT_PX`. |
| `src/miniapp/MiniAppShell.tsx` | **Modify.** Deletes `TAB_BAR_HEIGHT_PX` and the `flagLift` prop. |
| `src/miniapp/miniStrings.ts` | **Modify.** Four new keys, `en` and `km`. |
| `src/miniapp/miniDay.test.ts` | **Modify.** Cases for `dayNumbers`. |
| `src/miniapp/miniDayNumbers.test.tsx` | **Create.** Render cases + the no-fixed-positioning source guard. |
| `e2e/miniapp.spec.ts` | **Modify.** Geometry assertion at `safeAreaInset.bottom = 34`. |

---

### Task 1: `dayNumbers` — the two figures, including the open run

**Files:**
- Modify: `src/miniapp/miniStatus.ts`
- Modify: `src/miniapp/miniDay.ts`
- Test: `src/miniapp/miniDay.test.ts`

**Interfaces:**
- Consumes: `dayFacts` (existing, unchanged), `parseDateTimeLocal` from `@/lib/attendanceTime` (already imported by `miniDay.ts`), `isSameDay` from `date-fns` (already imported).
- Produces: `openRunStartedAt(day: Day | undefined): string | null`,
  `netWorkedFor(day: Day | undefined): number | null`, and
  `dayNumbers(day: Day | undefined, date: Date, today: Date, now: Date): DayNumbers`
  where `DayNumbers = { worked: number | null; rostered: number | null; live: boolean }`.
  Task 2 renders exactly this shape.

- [x] **Step 1: Write the failing tests**

Append to `src/miniapp/miniDay.test.ts`. Add `dayNumbers` to the existing import from `@/miniapp/miniDay`.

```ts
/** A day with an unclosed arrival — somebody currently at work. */
function stillIn(date: string, since = "07:58:00"): Day {
  return {
    date,
    shift: {
      shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
      lunch_start: "12:00:00", lunch_end: "13:00:00",
    },
    first_in: `${date} ${since}`,
    last_out: null,
    checkins: [
      { time: `${date} ${since}`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;
}

test("a finished day reports net worked against net rostered", () => {
  // 07:58-17:06 with a 12:00-13:00 lunch punched out and back in.
  const day = {
    date: "2026-08-10",
    shift: {
      shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
      lunch_start: "12:00:00", lunch_end: "13:00:00",
    },
    checkins: [
      { time: "2026-08-10 07:58:00", log_type: "IN", custom_device_branch: "A" },
      { time: "2026-08-10 12:01:00", log_type: "OUT", custom_device_branch: "A" },
      { time: "2026-08-10 12:58:00", log_type: "IN", custom_device_branch: "A" },
      { time: "2026-08-10 17:06:00", log_type: "OUT", custom_device_branch: "A" },
    ],
  } as unknown as Day;
  const n = dayNumbers(day, MON, FRI, FRI);
  assert.equal(n.worked, 4 * 60 + 3 + (4 * 60 + 8));
  // Rostered is NET: nine hours of window less the rostered hour of lunch.
  assert.equal(n.rostered, 8 * 60);
  assert.equal(n.live, false);
});

test("an open run on TODAY accrues up to now, and says so", () => {
  // The whole reason this function exists: netWorkedMinutes pairs punches, so
  // somebody three hours into a shift reads as null until they clock out.
  const today = new Date(2026, 7, 10, 11, 0, 0);
  const n = dayNumbers(stillIn("2026-08-10"), today, today, today);
  assert.equal(n.worked, 3 * 60 + 2);
  assert.equal(n.live, true);
});

test("an open run on a PAST day accrues nothing", () => {
  // An unclosed punch on a past day is a MISSING_IN_OR_OUT flag, not somebody
  // still at work. Counting it would grow that day's total forever.
  const date = new Date(2026, 7, 10);
  const today = new Date(2026, 7, 14, 11, 0, 0);
  const n = dayNumbers(stillIn("2026-08-10"), date, today, today);
  assert.equal(n.worked, null);
  assert.equal(n.live, false);
});

test("a clock skewed into the future never subtracts minutes", () => {
  const today = new Date(2026, 7, 10, 7, 0, 0); // before the 07:58 punch
  const n = dayNumbers(stillIn("2026-08-10"), today, today, today);
  assert.equal(n.worked, 0);
  assert.equal(n.live, true);
});

test("leave and holiday have no rostered figure to fall short of", () => {
  const base = {
    date: "2026-08-10",
    shift: {
      shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
      lunch_start: "12:00:00", lunch_end: "13:00:00",
    },
    checkins: [],
  };
  const onLeave = { ...base, leave: { on_leave: true, leave_type: "Annual Leave" } };
  const holiday = { ...base, holiday: { description: "Constitution Day" } };
  assert.equal(dayNumbers(onLeave as unknown as Day, MON, FRI, FRI).rostered, null);
  assert.equal(dayNumbers(holiday as unknown as Day, MON, FRI, FRI).rostered, null);
});

test("work punched on a holiday still counts, alone", () => {
  const day = {
    date: "2026-08-10",
    holiday: { description: "Constitution Day" },
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    checkins: [
      { time: "2026-08-10 09:00:00", log_type: "IN", custom_device_branch: "A" },
      { time: "2026-08-10 11:00:00", log_type: "OUT", custom_device_branch: "A" },
    ],
  } as unknown as Day;
  const n = dayNumbers(day, MON, FRI, FRI);
  assert.equal(n.worked, 120);
  assert.equal(n.rostered, null);
});

test("an overnight shift's rostered figure spans the wrap", () => {
  const day = {
    date: "2026-08-10",
    shift: {
      shift_assigned: true, start_time: "22:00:00", end_time: "06:00:00",
      lunch_start: "02:00:00", lunch_end: "02:30:00",
    },
    checkins: [],
  } as unknown as Day;
  // Eight hours across midnight, less the half-hour break.
  assert.equal(dayNumbers(day, MON, FRI, FRI).rostered, 7 * 60 + 30);
});

test("a day with no roster and no punches has neither figure", () => {
  const day = { date: "2026-08-08", shift: { shift_assigned: false }, checkins: [] } as unknown as Day;
  const n = dayNumbers(day, MON, FRI, FRI);
  assert.equal(n.worked, null);
  assert.equal(n.rostered, null);
  assert.equal(n.live, false);
});
```

- [x] **Step 2: Run the tests and watch them fail**

Run: `npm run test:web 2>&1 | tail -20`
Expected: FAIL — `dayNumbers` is not exported from `@/miniapp/miniDay`.

- [x] **Step 3: Export the open run from `miniStatus.ts`**

Append to `src/miniapp/miniStatus.ts`, after `stillInside`:

```ts
/**
 * The unclosed arrival on this day, as the API's own datetime string.
 *
 * Exported so the day's worked figure and the status chip answer "are they
 * clocked in?" the same way. `stillInside` already reconciles with
 * `deriveSegments`' pairing — an odd count is an open run in both places — and
 * a fourth private copy of this test is exactly the drift that puts two
 * different answers about one Tuesday on one screen.
 *
 * Says nothing about WHICH day: a caller that does not want a past day's
 * unclosed punch treated as somebody still at work must check that itself.
 */
export function openRunStartedAt(day: Day | undefined): string | null {
  const punches = inOrder(day);
  if (!punches.length || !stillInside(punches)) return null;
  return punches[punches.length - 1]!.time ?? null;
}
```

- [x] **Step 4a: Hoist the worked-minutes derivation in `miniDay.ts`**

`dayFacts` returns EARLY on leave and on holiday — it never reaches the branch
that parses punches, so `workedMinutes` is null on those days. Work punched on
a public holiday therefore cannot be read off `dayFacts` at all, and the spec
requires it to show. Extract the derivation so both callers share it, without
changing what `dayFacts` reports.

Add the import at the top of `src/miniapp/miniDay.ts`:

```ts
import { openRunStartedAt } from "@/miniapp/miniStatus";
```

Add above `dayFacts`:

```ts
/**
 * Net worked on a day, lunch removed, from the punches alone.
 *
 * Hoisted out of `dayFacts` because that function answers leave and holiday
 * FIRST and returns before it ever looks at a punch — correct for the day's
 * tone, useless for somebody who came in for two hours on a public holiday.
 * `dayNumbers` needs the figure on exactly those days.
 *
 * One derivation, called from both, so a holiday's two hours cannot come out
 * differently depending on which surface asked.
 */
export function netWorkedFor(day: Day | undefined): number | null {
  const segments = deriveSegments(day?.checkins ?? [], {
    parseTime: parseDateTimeLocal,
    minutesFromDateTime,
    clamp,
  });
  return netWorkedMinutes(segments);
}
```

Then, inside `dayFacts`, replace the four lines that build `segments` and
`net` in the `if (range)` branch with a single call, leaving the rest of that
branch exactly as it is:

```ts
    const net = netWorkedFor(day);
```

- [x] **Step 4b: Add `dayNumbers` to `miniDay.ts`**

Append at the end of the file:

```ts
/**
 * The two numbers the Day tab's canvas cannot state.
 *
 * The canvas prints each run's own duration — 4h 3m, then 4h 8m — and nobody
 * adds those in their head. It also has no way to say what the day was
 * supposed to be net of its lunch.
 *
 * SEPARATE from `dayFacts.workedMinutes`, which stays exactly as it was.
 * That field is what `totalWorkedMinutes` sums for the calendar sheet's month
 * figure, and what HR's surfaces read; a projection must not leak into either.
 */
export type DayNumbers = {
  /** Net worked, plus any open run when the day is today. Null when none. */
  worked: number | null;
  /** Net rostered, lunch removed. Null when not rostered, or on leave/holiday. */
  rostered: number | null;
  /** A run is still open, so the worked figure is still moving. */
  live: boolean;
};

/**
 * Minutes since a punch, floored at zero.
 *
 * Never negative: a device clock running ahead of the phone would otherwise
 * SUBTRACT from the day's total, which reads as work being taken away.
 */
function minutesSince(at: string, now: Date): number {
  const started = parseDateTimeLocal(at);
  const delta = now.getTime() - started.getTime();
  if (!Number.isFinite(delta) || delta < 0) return 0;
  return Math.round(delta / 60000);
}

export function dayNumbers(
  day: Day | undefined,
  date: Date,
  today: Date,
  now: Date,
): DayNumbers {
  // Only for the day's TONE and its roster — the worked figure comes from
  // netWorkedFor below, for the reason given there.
  const facts = dayFacts(day, date, today);

  // No rostered figure on a day somebody was entitled to be away: there is
  // nothing they failed to meet, and "— / 8h" beside "Annual Leave" reads as
  // eight hours missing. Work actually punched still counts, below.
  const excused = facts.tone === "leave" || facts.tone === "holiday";
  const rostered =
    excused || facts.shiftMinutes === null
      ? null
      : facts.shiftMinutes - (facts.lunchMinutes ?? 0);

  // `netWorkedFor`, NOT `facts.workedMinutes`: dayFacts answers leave and
  // holiday before it looks at a punch, so its figure is null on exactly the
  // days where somebody may still have worked. See netWorkedFor.
  const punched = netWorkedFor(day);

  // TODAY only. `openRunStartedAt` reports an unclosed punch on any day, and
  // on a past one that is a gap in the record rather than somebody at work.
  const openedAt = isSameDay(date, today) ? openRunStartedAt(day) : null;
  const worked =
    openedAt === null ? punched : (punched ?? 0) + minutesSince(openedAt, now);

  return { worked, rostered, live: openedAt !== null };
}
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `npm run test:web 2>&1 | tail -20`
Expected: PASS, with a higher total than before — check the count moved, not just that it is green.

- [x] **Step 6: Commit**

```bash
git add src/miniapp/miniStatus.ts src/miniapp/miniDay.ts src/miniapp/miniDay.test.ts
git commit -m "feat(miniapp): the day's worked and rostered figures, open run included"
```

---

### Task 2: The row, and the end of fixed positioning

**Files:**
- Create: `src/miniapp/MiniDayNumbers.tsx`
- Modify: `src/miniapp/MiniFlagButton.tsx`, `src/miniapp/MyDayPage.tsx`, `src/miniapp/MiniAppShell.tsx`, `src/miniapp/miniStrings.ts`
- Test: `src/miniapp/miniDayNumbers.test.tsx`

**Interfaces:**
- Consumes: `dayNumbers` / `DayNumbers` from Task 1.
- Produces: `MiniDayNumbers` — props `{ day, date, today, now, flagCount, onOpenFlags }`.

- [x] **Step 1: Add the four strings**

In `src/miniapp/miniStrings.ts`, in the `en` table immediately after the `flagsNone` line:

```ts
  // The day's two figures, under the timeline. `daySoFar` marks a total that is
  // still moving, so a number below the roster does not read as a shortfall.
  daySoFar: "so far",
  // Read aloud, "8h 11m / 8h" is two durations and a slash. These are what a
  // screen reader announces instead; the visible row stays compact.
  dayAriaWorkedOfRostered: "Worked {worked} of {rostered} rostered",
  dayAriaWorkedOnly: "Worked {worked}",
  dayAriaRosteredOnly: "Rostered {rostered}, nothing worked yet",
```

And in the `km` table, at the matching position after its `flagsNone`:

```ts
  // MACHINE-DRAFTED, awaiting a native speaker — as with the ~50 already
  // queued. `daySoFar` must read as "up to now", never as "only".
  daySoFar: "គិតត្រឹមពេលនេះ",
  dayAriaWorkedOfRostered: "ធ្វើការ {worked} ក្នុងចំណោម {rostered} តាមកាលវិភាគ",
  dayAriaWorkedOnly: "ធ្វើការ {worked}",
  dayAriaRosteredOnly: "តាមកាលវិភាគ {rostered} មិនទាន់មានម៉ោងធ្វើការ",
```

- [x] **Step 2: Write the failing tests**

Create `src/miniapp/miniDayNumbers.test.tsx`:

```tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MiniDayNumbers } from "@/miniapp/MiniDayNumbers";
import type { Day } from "@/types/calendar";

/** Source with comments stripped, so a guard cannot match its own note. */
function source(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DATE = new Date(2026, 7, 10);

function render(day: Day | undefined, flagCount = 0, now = DATE) {
  return renderToStaticMarkup(
    <MiniDayNumbers
      day={day} date={DATE} today={DATE} now={now}
      flagCount={flagCount} onOpenFlags={() => {}}
    />,
  );
}

const WORKED = {
  date: "2026-08-10",
  shift: {
    shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
    lunch_start: "12:00:00", lunch_end: "13:00:00",
  },
  checkins: [
    { time: "2026-08-10 08:00:00", log_type: "IN", custom_device_branch: "A" },
    { time: "2026-08-10 16:00:00", log_type: "OUT", custom_device_branch: "A" },
  ],
} as unknown as Day;

const ON_LEAVE = {
  date: "2026-08-10",
  leave: { on_leave: true, leave_type: "Annual Leave" },
  shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
  checkins: [],
} as unknown as Day;

test("a worked day shows both figures", () => {
  const html = render(WORKED);
  assert.match(html, /8h/);
});

test("a leave day shows no numbers and no row", () => {
  // The status chip beside the date already says "Annual Leave".
  assert.equal(render(ON_LEAVE), "");
});

test("a leave day WITH a flag still renders, carrying the pill alone", () => {
  const html = render(ON_LEAVE, 2);
  assert.match(html, /2 to check/);
  // No rostered figure smuggled in beside it.
  assert.ok(!/8h/.test(html), "a leave day must not show a rostered figure");
});

test("nothing to say and nothing flagged renders nothing at all", () => {
  const empty = {
    date: "2026-08-08", shift: { shift_assigned: false }, checkins: [],
  } as unknown as Day;
  assert.equal(render(empty), "");
});

test("the figures carry a spoken sentence, not a slash", () => {
  // "8h 11m / 8h" read aloud is two durations and a punctuation mark.
  const html = render(WORKED);
  assert.match(html, /Worked .* of .* rostered/);
});

test("nothing on the Day tab is positioned fixed", () => {
  // THE defect this row exists to retire: a fixed pill cannot be laid out
  // against a tab bar it cannot measure, and it overlapped it by 35px on every
  // phone with a bottom safe-area inset. A comment is not a guard.
  for (const file of ["./MyDayPage.tsx", "./MiniFlagButton.tsx", "./MiniDayNumbers.tsx"]) {
    const code = source(file);
    assert.ok(!/\bfixed\b/.test(code), `${file} must not position anything fixed`);
    assert.ok(!/\bbottom:\s*/.test(code), `${file} must not set a bottom offset`);
  }
});
```

- [x] **Step 3: Run the tests and watch them fail**

Run: `npm run test:web 2>&1 | tail -20`
Expected: FAIL — `@/miniapp/MiniDayNumbers` does not exist.

- [x] **Step 4: Strip the positioning out of `MiniFlagButton.tsx`**

Replace the whole file with:

```tsx
/**
 * How many things on this day are worth a look.
 *
 * IN NORMAL FLOW. It was `position: fixed` at a hand-computed offset above the
 * tab bar, and the offset omitted the safe-area inset — measured at 390x560
 * with a 34px inset, the pill's bottom edge sat 35px BELOW the nav's top edge,
 * straight across the tab labels. At zero inset it cleared by nothing at all.
 *
 * The lesson is not "the number was wrong". A fixed element cannot be laid out
 * against a sibling it cannot measure, so every viewport, keyboard and inset
 * change is another chance for the two to disagree. `MiniDayNumbers` places
 * this in the flow instead, where the browser does the arithmetic.
 *
 * HIDDEN AT ZERO. The calendar mark already says a day is clean, and a
 * permanent "0 to check" is chrome on the shortest axis this app has — the same
 * objection that removed the add-to-home-screen row.
 */
import { TriangleAlertIcon } from "lucide-react";

import { useFormat, useT } from "@/miniapp/MiniLocale";

export function MiniFlagButton(props: { count: number; onOpen: () => void }) {
  const t = useT();
  const fmt = useFormat();
  if (props.count <= 0) return null;
  return (
    // The visible text is the accessible name. A plain button takes its name
    // from content, so no aria-label is needed — unlike the calendar's day
    // buttons, which needed one only because react-day-picker sets its own and
    // an aria-label beats content unconditionally.
    <button
      type="button"
      onClick={props.onOpen}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[13px] font-semibold text-foreground shadow-sm transition-colors active:bg-muted"
    >
      <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-amber-500" />
      {/* Digits in the reader's own script. Khmer numerals are the whole reason
          fmt.digits exists, and a Latin "2" beside Khmer words is the exact
          leak the e2e guard forbids. */}
      <span>{t("flagsToCheck").replace("{n}", fmt.digits(String(props.count)))}</span>
    </button>
  );
}
```

- [x] **Step 5: Create `MiniDayNumbers.tsx`**

```tsx
/**
 * The day's totals, and the way into its flags.
 *
 * One row, in the flow, between the timeline and the tab bar. It carries the
 * two things the canvas cannot state — what the day added up to, and what it
 * was supposed to be — and it gives the flags pill somewhere to live that is
 * not a floating layer above the tab bar. See MiniFlagButton for what that
 * cost before.
 *
 * IT HIDES ITSELF when it has nothing: no figures and no flags means no row,
 * rather than a border and an em dash. On the shortest axis this app has, an
 * empty strip of chrome is the objection that removed the summary block and
 * the add-to-home-screen row both.
 */
import { MiniFlagButton } from "@/miniapp/MiniFlagButton";
import { useFormat, useT } from "@/miniapp/MiniLocale";
import { dayNumbers } from "@/miniapp/miniDay";
import type { Day } from "@/types/calendar";

export function MiniDayNumbers(props: {
  day: Day | undefined;
  date: Date;
  today: Date;
  now: Date;
  flagCount: number;
  onOpenFlags: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const numbers = dayNumbers(props.day, props.date, props.today, props.now);

  // Formatted first, then tested: fmt.worked returns null for a null figure
  // and "0m" for a zero one, and zero minutes worked is a fact worth printing
  // for somebody who clocked in a minute ago.
  const worked = fmt.worked(numbers.worked);
  const rostered = fmt.worked(numbers.rostered);
  if (!worked && !rostered && props.flagCount <= 0) return null;

  // A spoken sentence, because "8h 11m / 8h" read aloud is two durations and a
  // slash. The visible row stays compact; this is what is announced.
  const spoken = worked && rostered
    ? t("dayAriaWorkedOfRostered").replace("{worked}", worked).replace("{rostered}", rostered)
    : worked
      ? t("dayAriaWorkedOnly").replace("{worked}", worked)
      : rostered
        ? t("dayAriaRosteredOnly").replace("{rostered}", rostered)
        : null;

  return (
    // justify-between with an empty span as the left item when there are no
    // figures, so a lone pill still sits where a pill always sits.
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-1 pt-2">
      {spoken ? (
        <span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
          <span className="sr-only">{spoken}</span>
          <span aria-hidden="true" className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-semibold text-foreground">
              {worked ?? "—"}
              {/* Only while a run is open. On a closed day the total is final
                  and "so far" would understate a finished figure. */}
              {numbers.live ? (
                <span className="ml-1 font-normal text-muted-foreground">{t("daySoFar")}</span>
              ) : null}
            </span>
            {rostered ? (
              <span className="shrink-0 text-muted-foreground">/ {rostered}</span>
            ) : null}
          </span>
        </span>
      ) : (
        <span />
      )}
      <MiniFlagButton count={props.flagCount} onOpen={props.onOpenFlags} />
    </div>
  );
}
```

- [x] **Step 6: Wire it into `MyDayPage.tsx`**

Replace the `MiniFlagButton` import with:

```tsx
import { MiniDayNumbers } from "@/miniapp/MiniDayNumbers";
```

Delete the whole `DEFAULT_FLAG_LIFT_PX` constant and its docstring, and delete the `flagLift` entry from the props type along with its comment.

Replace the `<MiniFlagButton ... />` element with:

```tsx
      <MiniDayNumbers
        day={info}
        date={date}
        today={today}
        now={now}
        flagCount={flagCount(info)}
        onOpenFlags={() => setFlagsOpen(true)}
      />
```

Then update the file's opening docstring — the bullet claiming the net total is missing is no longer true. Replace that bullet with:

```
 *   - the NET TOTAL, which now sits in the row beneath the canvas along with
 *     the rostered figure it is read against. The month total stays in the
 *     calendar sheet.
```

- [x] **Step 7: Delete the dead constant in `MiniAppShell.tsx`**

Delete `TAB_BAR_HEIGHT_PX` and its entire docstring (the one beginning "The tab bar's painted height"), whose claim that the bar's padding "already absorbs" the inset is the false statement behind the overlap.

Then remove the `flagLift` prop from the `MyDayPage` element, leaving:

```tsx
          <MyDayPage
            date={openDay ?? undefined}
            onPickDate={() => {
              openHaptic(window);
              setPickerOpen(true);
            }}
          />
```

- [x] **Step 8: Run the tests and the build**

Run: `npm run test:web 2>&1 | tail -20 && npm run build 2>&1 | tail -5`
Expected: all unit tests PASS, build clean. If `miniAppShell.test.tsx` fails on a missing `TAB_BAR_HEIGHT_PX` import, remove that name from its import list — it imports `TAB_BAR_FLOOR_PX`, which stays.

- [x] **Step 9: Commit**

```bash
git add src/miniapp/ && git commit -m "feat(miniapp): the day's numbers row, and the end of the floating pill"
```

---

### Task 3: Pin the geometry in e2e

**Files:**
- Modify: `e2e/miniapp.spec.ts`

**Interfaces:**
- Consumes: the existing `openMiniApp(page, opts)` helper. `{ fullscreen: true }` already sets `safeAreaInset.bottom = 34`, which is the device shape that produced the bug.

- [x] **Step 1: Write the failing test**

Append to `e2e/miniapp.spec.ts`:

```ts
test("the flags pill never overlaps the tab bar on a notched phone", async ({ page }) => {
  // The suite asserted the pill's TEXT and its sheet, never its box — which is
  // how a 35px overlap across the tab labels shipped. `fullscreen` is the
  // 34px bottom inset; the pill used to be drawn inside it.
  await openMiniApp(page, { fullscreen: true, flags: [miniFlag("LATE_START")] });

  const pill = page.getByRole("button", { name: "1 to check" });
  await expect(pill).toBeVisible();

  const pillBox = await pill.boundingBox();
  const navBox = await page.getByRole("navigation").boundingBox();
  if (!pillBox || !navBox) throw new Error("pill or tab bar has no box");

  expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(navBox.y);
});
```

- [x] **Step 2: Prove the guard can fail**

A geometry assertion that passes against the broken layout is worthless. Put
the old positioning back on the pill alone, confirm the new test FAILS, then
undo it. No stash — the stack is shared with other sessions.

Edit `src/miniapp/MiniFlagButton.tsx`, adding to the `<button>`:

```tsx
      style={{ bottom: 56 }}
      className="fixed left-3.5 z-40 flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[13px] font-semibold text-foreground shadow-sm transition-colors active:bg-muted"
```

Run: `npx playwright test e2e/miniapp.spec.ts -g "never overlaps" 2>&1 | tail -15`
Expected: FAIL, reporting a pill bottom edge below the nav's top edge.

Then undo it:

```bash
git checkout -- src/miniapp/MiniFlagButton.tsx
git diff --quiet src/miniapp/MiniFlagButton.tsx && echo "RESTORED clean"
```

Expected: `RESTORED clean`. Do not continue until that prints.

- [x] **Step 3: Run it against the new layout**

Run: `npx playwright test e2e/miniapp.spec.ts 2>&1 | tail -15`
Expected: PASS, and the rest of the miniapp spec still green.

- [x] **Step 4: Commit**

```bash
git add e2e/miniapp.spec.ts
git commit -m "test(miniapp): pin that the flags pill clears the tab bar on a notched phone"
```

---

### Task 4: Stop `MyDayPage` shadowing the global `window`

**Files:**
- Modify: `src/miniapp/MyDayPage.tsx`

**Interfaces:** None. A local rename with no exported surface.

- [x] **Step 1: Rename the local**

In `src/miniapp/MyDayPage.tsx`, rename the local `window` to `timelineWindow` — the declaration and both uses:

```tsx
  const timelineWindow = resolveWeekTimelineWindow([date], byDate);
```

```tsx
        <HourGutter window={timelineWindow} />
```

```tsx
          timelineStartMin={timelineWindow.startMin}
          timelineEndMin={timelineWindow.endMin}
```

Add above the declaration:

```tsx
  // NOT `window`. It was, and it shadowed the global across this whole
  // component: a read below the declaration silently returned this object
  // instead of the browser's window, and a read above it threw "Cannot access
  // 'window' before initialization" and white-screened the app. Both were hit
  // while designing the row below — the silent one produced a layout that
  // looked implemented and rendered in the wrong place.
```

- [x] **Step 2: Prove the shadow is gone**

Run: `grep -n "const window" src/miniapp/MyDayPage.tsx`
Expected: no output.

- [x] **Step 3: Run the tests and the build**

Run: `npm run test:web 2>&1 | tail -10 && npm run build 2>&1 | tail -5`
Expected: PASS and clean — this is a pure rename, so any failure means a use was missed.

- [x] **Step 4: Commit**

```bash
git add src/miniapp/MyDayPage.tsx
git commit -m "fix(miniapp): MyDayPage no longer shadows the global window"
```

---

## Verification before finishing

- [x] `npm run test:web` — green, and the test count is HIGHER than at the start. A glob that silently matched nothing reads exactly like a pass here.
- [x] `npm run build` — clean.
- [x] `npx playwright test e2e/miniapp.spec.ts` — green.
- [x] The design spike harness still exists and is git-excluded (`index.spike.html`, `spike.html`). Serve with `PORT=8099 npm run dev` and open `http://localhost:8099/index.spike.html?inset=34` to see the real layout on a notched phone. Confirm by eye that the row sits above the tab bar and that toggling `&lang=km` keeps it on one line at 390px.
- [x] `git log --oneline` shows four commits, one per task.
