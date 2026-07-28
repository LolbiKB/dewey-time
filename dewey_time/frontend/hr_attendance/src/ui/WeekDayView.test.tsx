import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../components/ui/tooltip";
import { WeekDayView } from "./WeekDayView";
import type { Day } from "../types/calendar";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** Every day of the week unscheduled with 08:00–12:00 + 12:42–16:24 at one branch (7h 42m net). */
function clockWeek(): Map<string, Day> {
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
          gross_minutes: 504,
        } satisfies Day,
      ];
    }),
  );
}

test("WeekDayView renders a 7-pip day switcher and one selected day", () => {
  const html = renderToStaticMarkup(
    <WeekDayView
      weekDates={WEEK}
      daysByDate={new Map<string, Day>()}
      alertsByDate={new Map()}
      syncByDate={new Map()}
      onInspectDay={() => {}}
      onInspectFlag={() => {}}
    />,
  );
  const pips = html.match(/data-pip=/g) ?? [];
  assert.equal(pips.length, 7, "one pip per weekday");
  assert.match(html, /aria-label="Previous day"/);
  assert.match(html, /aria-label="Next day"/);
});

test("the phone day view reports net worked hours on a clock day", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <WeekDayView
        weekDates={WEEK}
        daysByDate={clockWeek()}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        isClockBased
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
  assert.match(html, />Clock</, "the Clock chip explains the missing schedule");
  assert.match(html, />7h 42m</, "and the headline figure is the net worked total");
});

test("the phone day view shows no worked total when the employee is not clock-based", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <WeekDayView
        weekDates={WEEK}
        daysByDate={clockWeek()}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
  assert.doesNotMatch(html, />7h 42m</);
});

test("WeekDayView reuses the shared timeline window + DayChips (no drift)", () => {
  const src = readFileSync(resolve(PKG, "src/ui/WeekDayView.tsx"), "utf8");
  assert.match(src, /useWeekTimelineWindow/, "shares the axis window with the desktop grid");
  assert.match(src, /DayCell/, "renders the standalone DayCell");
  assert.match(src, /DayChips/, "reuses the shared chip row");
  assert.match(src, /stepDay/, "chevrons step through the week");
  assert.ok(!/overflow-x-auto/.test(src), "never horizontally scrolls");
});
