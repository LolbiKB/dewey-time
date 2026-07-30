import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { plannedDaysFromSchedule } from "../lib/plannedDays";
import { resolveWeekTimelineWindow } from "../lib/weekTimelineWindow";
import { WeekView } from "./WeekView";
import { PlannedWeekCanvas } from "./PlannedWeekCanvas";
import type { Day } from "../types/calendar";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

function scheduledWeek(): Map<string, Day> {
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
          checkins: [],
        } as unknown as Day,
      ];
    }),
  );
}

const labels = (html: string) => [...html.matchAll(/>(\d{1,2} [AP]M)</g)].map((m) => m[1]);

test("both week surfaces put the same hours on the axis", () => {
  // The anti-drift guard. These two views previously used different layouts,
  // different time axes and different densities; sharing WeekCanvasFrame is
  // what stops that recurring, and this is the assertion that notices if it does.
  const days = scheduledWeek();
  const attendance = renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={WEEK}
        daysByDate={days}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
  const schedule = renderToStaticMarkup(
    <TooltipProvider>
      <PlannedWeekCanvas
        days={plannedDaysFromSchedule(WEEK, days)}
        window={resolveWeekTimelineWindow(WEEK, days)}
      />
    </TooltipProvider>,
  );

  assert.ok(labels(attendance).length > 0, "attendance rendered no hour labels");
  assert.deepEqual(labels(schedule), labels(attendance));
});

test("WeekCanvasFrame keeps both per-day wrappers as `className=\"contents\"`", () => {
  // Nothing else guards these two wrappers. Delete either and every other test
  // in this suite stays green while the UI breaks in one of two distinct ways:
  //
  // - the header wrapper: the returned header stops being the direct grid item,
  //   so it takes `align-self: stretch` for itself instead, and an off-day or
  //   holiday tint stops short of the row's bottom edge on shorter columns.
  // - the day wrapper: `DayCell`'s root is a `<button>` (inline-level), so
  //   without `contents` it shrinks to a sliver instead of filling its grid
  //   cell — issue #71 recurring.
  const src = readFileSync(resolve(PKG, "src/ui/WeekCanvasFrame.tsx"), "utf8");
  // Matches the closing `>` of the real JSX wrappers, not the doc comment
  // above them that also mentions the string `className="contents"`.
  const occurrences = src.match(/className="contents">/g) ?? [];
  assert.equal(
    occurrences.length,
    2,
    "expected exactly two `className=\"contents\"` wrappers — one around renderHeader " +
      "(its loss lets a tint stop short of the row) and one around renderDay (its loss " +
      "collapses DayCell's <button> to a sliver, issue #71)",
  );
});
