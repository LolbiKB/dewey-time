import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../components/ui/tooltip";
import { WeekDayView } from "./WeekDayView";
import { WeekView } from "./WeekView";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** Exact class attributes the timeline paints — the tone under test, not a substring. */
const WORKED_SEGMENT =
  'class="absolute inset-x-2 rounded-sm bg-primary shadow-sm ring-1 ring-foreground/10"';
const OFF_SHIFT_SEGMENT =
  'class="absolute inset-x-2 rounded-sm border border-dashed border-brand-accent/50 bg-brand-accent/25 shadow-sm ring-1 ring-brand-accent/20"';
// The gap bands gained a flex box so they can carry their own label: their
// meaning used to live only in a hover tooltip, which a phone cannot open.
const NEUTRAL_GAP =
  'class="absolute inset-x-2 flex items-center justify-center overflow-hidden rounded-sm border border-muted-foreground/40 bg-muted/40"';
const EXCEPTION_GAP =
  'class="absolute inset-x-2 flex items-center justify-center overflow-hidden rounded-sm border border-destructive/40 bg-destructive/15"';
const MISSING_EXPECTED_BAND =
  'class="absolute inset-x-2 rounded-sm border border-dashed border-destructive/75 bg-destructive/5"';
const OPEN_SESSION_TICK =
  'class="absolute inset-x-2 h-1 rounded-full border border-brand-accent/60 bg-brand-accent/40 shadow-sm"';

/** Every day unscheduled, worked 08:00–12:00 + 12:42–16:24 at one branch (42m away gap). */
function unscheduledWeek(): Map<string, Day> {
  const punch = (date: string, time: string) => ({
    time: `${date} ${time}`,
    custom_device_branch: "HQ",
  });
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: { shift_assigned: false },
          checkins: [
            punch(date, "08:00:00"),
            punch(date, "12:00:00"),
            punch(date, "12:42:00"),
            punch(date, "16:24:00"),
          ],
          first_in: `${date} 08:00:00`,
          last_out: `${date} 16:24:00`,
          gross_minutes: 504,
        } satisfies Day,
      ];
    }),
  );
}

/** Every day unscheduled with no punches at all. */
function silentWeek(): Map<string, Day> {
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [date, { date, shift: { shift_assigned: false }, checkins: [] } satisfies Day];
    }),
  );
}

function renderWeek(days: Map<string, Day>, isClockBased?: boolean): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={WEEK}
        daysByDate={days}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        isClockBased={isClockBased}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

test("a clock day's worked time gets the worked tone, not the off-shift treatment", () => {
  const html = renderWeek(unscheduledWeek(), true);
  assert.ok(html.includes(WORKED_SEGMENT), "clock-day segments read as worked time");
  assert.ok(
    !html.includes(OFF_SHIFT_SEGMENT),
    "and never as the dashed off-shift exception — there is no shift to be off",
  );
});

test("an unscheduled day still reads as off-shift when the employee is not clock-based", () => {
  const html = renderWeek(unscheduledWeek(), undefined);
  assert.ok(html.includes(OFF_SHIFT_SEGMENT), "off-shift punches keep the accent treatment");
  assert.ok(!html.includes(WORKED_SEGMENT), "and are not promoted to worked time");
});

test("a clock day's away gap is neutral, matching the engine's silence on MISSING_TIME", () => {
  const html = renderWeek(unscheduledWeek(), true);
  assert.ok(html.includes(NEUTRAL_GAP), "an unpaid break on a clock day is not a deviation");
  assert.ok(!html.includes(EXCEPTION_GAP), "so it is never painted as an exception");
});

test("an away gap stays an exception when the employee is not clock-based", () => {
  const html = renderWeek(unscheduledWeek(), undefined);
  assert.ok(html.includes(EXCEPTION_GAP), "unaccounted away time still needs attention");
});

test("a clock day with no punches is still a day off", () => {
  const html = renderWeek(silentWeek(), true);
  assert.match(html, />Day off</, "clocking in is optional; not clocking in means not working");
});

/**
 * An 08:00–17:00 scheduled week worked 08:00–16:50, leaving ten unworked
 * minutes at the end of the shift.
 *
 * That 16:50–17:00 remainder becomes a `missingExpected` interval, which is
 * one of the three band kinds that actually flow through `renderTimelineBand`
 * (with `scheduledFuture` and `openSession`). This matters: an unworked notch
 * in the MIDDLE of the day would instead be classified as a gap and rendered
 * by `gaps.map`, which has no floor and never touches the code under test.
 *
 * The window is 07:00–18:00 = 660 minutes, so ten minutes is 1.515% — under
 * the old 2% floor, which is exactly the case that used to be inflated.
 * The dates are in the past, so `missingExpectedMaxEndMin` returns null and
 * the band is not clipped to the present minute.
 */
function shortMissingWeek(): Map<string, Day> {
  const punch = (date: string, time: string) => ({
    time: `${date} ${time}`,
    custom_device_branch: "HQ",
  });
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: {
            shift_assigned: true,
            shift_type: "FT",
            start_time: "08:00:00",
            end_time: "17:00:00",
          },
          checkins: [punch(date, "08:00:00"), punch(date, "16:50:00")],
          first_in: `${date} 08:00:00`,
          last_out: `${date} 16:50:00`,
          gross_minutes: 530,
        } satisfies Day,
      ];
    }),
  );
}

test("a short band renders at its true height, not inflated to 2% of the window", () => {
  // 16:50-17:00 is 10 minutes of a 660-minute axis = 1.515%. The old
  // Math.max(2, …) floor drew it at exactly 2% — a confident claim of 13
  // minutes. Harmless while the axis was unreadable; a visible lie once the
  // hours beside it are labelled.
  const html = renderWeek(shortMissingWeek());
  const band = html.match(
    new RegExp(`${MISSING_EXPECTED_BAND.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} style="([^"]*)"`),
  );
  assert.ok(band, "expected a missingExpected band in the markup");
  const style = band![1]!;
  assert.match(style, /height:\s*1\.51/, "the 10-minute band must render at its true 1.51%");
  assert.doesNotMatch(style, /height:\s*2%/, "an exactly-2% band means the old floor survives");
  assert.match(style, /min-height:\s*3px/, "…and keeps a pixel floor so it stays visible");
});

/**
 * One scheduled day carrying `pairs` non-overlapping worked segments — eight
 * 30-minute stints from 08:00, each separated by a 30-minute gap.
 */
function manySegmentDay(pairs: number): Map<string, Day> {
  const date = format(WEEK[0]!, "yyyy-MM-dd");
  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
  const checkins = Array.from({ length: pairs }, (_, i) => {
    const start = 8 * 60 + i * 60;
    return [
      { time: `${date} ${hhmm(start)}`, custom_device_branch: "HQ" },
      { time: `${date} ${hhmm(start + 30)}`, custom_device_branch: "HQ" },
    ];
  }).flat();
  return new Map([
    [
      date,
      {
        date,
        shift: {
          shift_assigned: true,
          shift_type: "FT",
          start_time: "08:00:00",
          end_time: "17:00:00",
        },
        checkins,
        first_in: checkins[0]!.time,
        last_out: checkins[checkins.length - 1]!.time,
        gross_minutes: pairs * 30,
      } satisfies Day,
    ],
  ]);
}

test("every segment renders — there is no silent truncation at six", () => {
  // On a labelled axis a dropped 7th segment reads as an unexplained absence
  // rather than as truncation, which is why the cap went rather than gaining
  // a "+N more" marker.
  const html = renderWeek(manySegmentDay(8));
  const bands = html.match(new RegExp(WORKED_SEGMENT.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g")) ?? [];
  assert.equal(bands.length, 8, `expected 8 worked segments, found ${bands.length}`);
});

/**
 * A shift on "today" worked cleanly 08:00–12:00 and 12:30–17:00, plus one
 * more unpaired punch at 17:30 — after shift end. `classifyUnpairedPresentations`
 * caps an open session's `confirmedEndMin` at `min(now, shiftEndMin)`, so for
 * a punch already past shift end that cap equals `startMin`, producing a
 * zero-length open session with no `uncertainEndMin` fallback either. This
 * is deterministic regardless of the real wall-clock time the test runs at:
 * `capEnd` can never exceed shiftEndMin (17:00), which is before the 17:30
 * punch, so `confirmedEndMin` always collapses to `startMin`.
 *
 * The test below passes an explicit `now` so `DayDayTrack`'s now-line does not
 * draw itself into the markup depending on the wall clock the suite happens to
 * run at. `scheduledFuture` and `missingExpected` are not similarly pinned —
 * they read the real clock by design (the spec's §5.4 deliberately does not
 * thread `now` into them) — so this fixture's markup is still wall-clock
 * dependent outside the one exact-class assertion this test makes. Any new
 * assertion added here must stay as narrowly scoped as the existing one.
 */
function todayZeroLengthOpenSessionWeek(): Map<string, Day> {
  const today = new Date();
  const date = format(today, "yyyy-MM-dd");
  const punch = (time: string) => ({ time: `${date} ${time}`, custom_device_branch: "HQ" });
  return new Map([
    [
      date,
      {
        date,
        shift: {
          shift_assigned: true,
          shift_type: "FT",
          start_time: "08:00:00",
          end_time: "17:00:00",
        },
        checkins: [
          punch("08:00:00"),
          punch("12:00:00"),
          punch("12:30:00"),
          punch("17:00:00"),
          punch("17:30:00"),
        ],
        first_in: `${date} 08:00:00`,
        last_out: `${date} 17:30:00`,
        gross_minutes: 480,
      } satisfies Day,
    ],
  ]);
}

test("an open session with no time left to accrue still renders a marker, not nothing", () => {
  // openSession is the only presentation kind with no other fallback marker
  // (errorPresentations and offShiftPresentations both draw an h-1 tick
  // regardless). Before this fix, a zero-length open session band returned
  // null from renderTimelineBand and the punch vanished from the timeline.
  const todayWeek = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));
  // Explicit `now`: the now-line is otherwise drawn from `new Date()` inside
  // DayDayTrack, and this fixture's day is always today, so an unpinned run
  // between 07:00 and 18:00 local would inject a real now-line into markup
  // this test does not otherwise assert on.
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={todayWeek}
        daysByDate={todayZeroLengthOpenSessionWeek()}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        now={now}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
  assert.ok(html.includes(OPEN_SESSION_TICK), "the after-shift-end punch must render a visible marker");
});

test("the phone day view paints a clock day with the same worked tone", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <WeekDayView
        weekDates={WEEK}
        daysByDate={unscheduledWeek()}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        isClockBased
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
  assert.ok(html.includes(WORKED_SEGMENT), "the phone surface cannot disagree with the grid");
  assert.ok(!html.includes(OFF_SHIFT_SEGMENT));
  assert.ok(!html.includes(EXCEPTION_GAP));
});
