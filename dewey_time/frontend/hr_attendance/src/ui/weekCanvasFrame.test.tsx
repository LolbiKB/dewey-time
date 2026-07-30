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
import { WeekCanvasFrame } from "./WeekCanvasFrame";
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
  // Matches the real JSX wrappers (whitespace or `>` after the closing
  // quote, robust to attribute reordering or line wrapping), not the doc
  // comment above them that also mentions the string `className="contents"`
  // — there a backtick follows the closing quote instead.
  const occurrences = src.match(/className="contents"[\s>]/g) ?? [];
  assert.equal(
    occurrences.length,
    2,
    "expected exactly two `className=\"contents\"` wrappers — one around renderHeader " +
      "(its loss lets a tint stop short of the row) and one around renderDay (its loss " +
      "collapses DayCell's <button> to a sliver, issue #71)",
  );
});

function colsTemplate(html: string): string | undefined {
  return html.match(/grid-cols-\[3\.5rem_repeat\(7,minmax\([^)]*\)\)\]/)?.[0];
}

function renderFrame(minDayWidth?: string): string {
  return renderToStaticMarkup(
    <WeekCanvasFrame
      weekDates={WEEK}
      window={null}
      renderHeader={() => <div />}
      renderDay={() => <div />}
      minDayWidth={minDayWidth}
    />,
  );
}

test("omitting minDayWidth keeps the attendance grid's original 8rem template, byte-identical", () => {
  // The literal string WeekCanvasFrame hardcoded before minDayWidth existed.
  // WeekView never passes minDayWidth, so this is what it still renders.
  assert.equal(colsTemplate(renderFrame()), "grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]");
});

test("both week surfaces' actual render output carries the unchanged 8rem template", () => {
  // Not just the isolated WeekCanvasFrame case above — the real WeekView call
  // site, so a stray minDayWidth added there would be caught here too.
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
  assert.equal(colsTemplate(attendance), "grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]");
});

test("minDayWidth narrows the day-column minimum — the mechanism the schedule preview dialog relies on to fit seven columns", () => {
  assert.equal(colsTemplate(renderFrame("3rem")), "grid-cols-[3.5rem_repeat(7,minmax(3rem,1fr))]");
});
