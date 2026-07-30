import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { plannedDaysFromSchedule } from "../lib/plannedDays";
import { resolveWeekTimelineWindow } from "../lib/weekTimelineWindow";
import { PlannedWeekCanvas } from "./PlannedWeekCanvas";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

type Spec = { start: string; end: string; lunch?: [string, string] } | "off" | "leave";

function week(specs: Spec[]): Map<string, Day> {
  return new Map(
    WEEK.map((d, i) => {
      const date = format(d, "yyyy-MM-dd");
      const s = specs[i] ?? "off";
      if (s === "off") return [date, { date, shift: { shift_assigned: false } } as unknown as Day];
      if (s === "leave") {
        return [
          date,
          {
            date,
            shift: { shift_assigned: false },
            leave: { on_leave: true, leave_type: "Annual Leave" },
          } as unknown as Day,
        ];
      }
      return [
        date,
        {
          date,
          shift: {
            shift_assigned: true,
            shift_type: "FT",
            start_time: s.start,
            end_time: s.end,
            lunch_start: s.lunch?.[0] ?? null,
            lunch_end: s.lunch?.[1] ?? null,
          },
        } as unknown as Day,
      ];
    }),
  );
}

function render(specs: Spec[]): string {
  const daysByDate = week(specs);
  return renderToStaticMarkup(
    <TooltipProvider>
      <PlannedWeekCanvas
        days={plannedDaysFromSchedule(WEEK, daysByDate)}
        window={resolveWeekTimelineWindow(WEEK, daysByDate)}
      />
    </TooltipProvider>,
  );
}

/** Every `height:N%` in source order. */
function heights(html: string): number[] {
  return [...html.matchAll(/height:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
}

test("shifts of different duration render blocks of different height", () => {
  // THE defect. The old day-card list drew a fixed h-[4.5rem] pill for every
  // day, so a 4-hour shift and an 11-hour shift were pixel-identical. If this
  // assertion ever passes trivially, the canvas has stopped encoding duration.
  const html = render([
    { start: "08:00:00", end: "12:00:00" }, // 4h
    { start: "06:00:00", end: "17:00:00" }, // 11h
  ]);
  const [short, long] = heights(html);
  assert.ok(short != null && long != null, "expected two blocks");
  assert.ok(long! > short! * 2, `11h block (${long}%) must dwarf the 4h one (${short}%)`);
});

test("a late shift starts lower on the axis than an early one", () => {
  const html = render([
    { start: "08:00:00", end: "16:00:00" },
    { start: "13:00:00", end: "21:00:00" },
  ]);
  // Blocks are the only elements whose style attribute carries `top` and
  // `height` together — HourGrid/HourGutter each emit their own `top:N%`
  // ticks (one per hour, per day column), so a bare `top:` scan matches
  // those too and can pass against a canvas rendering zero blocks.
  const blockTops = [...html.matchAll(/top:\s*([\d.]+)%;height:/g)].map((m) => Number(m[1]));
  assert.equal(blockTops.length, 2, "expected exactly two positioned blocks");
  // Asserted in source order (Mon 08:00 then Tue 13:00), not max > min —
  // the ordered form also catches an inverted axis, which max > min cannot.
  assert.ok(
    blockTops[1]! > blockTops[0]!,
    "the 13:00 shift must sit below the 08:00 one",
  );
});

test("lunch renders as a gap between two blocks, not a notch", () => {
  const one = render([{ start: "08:00:00", end: "17:00:00" }]);
  const two = render([
    { start: "08:00:00", end: "17:00:00", lunch: ["12:00:00", "13:00:00"] },
  ]);
  assert.equal(heights(one).length, 1, "no lunch → one block");
  assert.equal(heights(two).length, 2, "lunch → two blocks");
});

test("off and leave days render their state and no block", () => {
  const html = render(["off", "leave"]);
  assert.match(html, /Day off/);
  assert.match(html, /Annual Leave/);
  assert.equal(heights(html).length, 0);
});
