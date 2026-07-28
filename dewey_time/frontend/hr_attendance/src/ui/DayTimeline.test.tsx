import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../components/ui/tooltip";
import { DayCell } from "./DayTimeline";
import { WeekDayView } from "./WeekDayView";
import { WeekView } from "./WeekView";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** Exact class attributes the timeline paints — the tone under test, not a substring. */
const WORKED_SEGMENT =
  'class="absolute inset-x-2 rounded-sm bg-primary shadow-sm ring-1 ring-foreground/10"';
const OFF_SHIFT_SEGMENT =
  'class="absolute inset-x-2 rounded-sm border border-dashed border-brand-accent/50 bg-brand-accent/25 shadow-sm ring-1 ring-brand-accent/20"';
const NEUTRAL_GAP =
  'class="absolute inset-x-2 rounded-sm border border-muted-foreground/40 bg-muted/40"';
const EXCEPTION_GAP =
  'class="absolute inset-x-2 rounded-sm border border-destructive/40 bg-destructive/15"';
const DENSE_WORKED_SPAN =
  'class="absolute left-1/2 w-[12px] -translate-x-1/2 rounded-sm bg-primary"';
const DENSE_OFF_SHIFT_SPAN =
  'class="absolute left-1/2 w-[12px] -translate-x-1/2 rounded-sm border border-dashed border-brand-accent/50 bg-brand-accent/25"';

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
 * DayCell's compact variant (no call site passes dense today) falls back to a single
 * span when no punch carries a branch. Pin its tone too — otherwise the fix only
 * holds for the full-height timeline.
 */
function renderDenseDay(isClockDay: boolean): string {
  const date = "2026-07-13";
  return renderToStaticMarkup(
    <TooltipProvider>
      <DayCell
        date={new Date(`${date}T00:00:00`)}
        outside={false}
        today={false}
        info={{
          date,
          shift: { shift_assigned: false },
          checkins: [{ time: `${date} 08:00:00` }, { time: `${date} 16:00:00` }],
          first_in: `${date} 08:00:00`,
          last_out: `${date} 16:00:00`,
        }}
        dense
        isClockDay={isClockDay}
        onInspectDay={() => {}}
      />
    </TooltipProvider>,
  );
}

test("the dense span follows the same rule as the full timeline", () => {
  assert.ok(renderDenseDay(true).includes(DENSE_WORKED_SPAN), "clock day: worked");
  assert.ok(renderDenseDay(false).includes(DENSE_OFF_SHIFT_SPAN), "otherwise: off shift");
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
