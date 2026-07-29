import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { WeekView } from "./WeekView";
import { WeekDayView } from "./WeekDayView";
import type { Day } from "../types/calendar";

/**
 * Regression: the check-in/out timeline scrolled for some employees and not
 * others.
 *
 * The axis used to pin 10 hours to the viewport height and grow a taller canvas
 * beyond it, so whether you got a scrollbar depended on the employee's punches —
 * a 09:00–17:00 week fitted, an early-start/late-finish week did not. Both
 * surfaces must now scale the axis to fit, whatever the span.
 */

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** `from`–`to` every day, as bare punches (no shift), e.g. NARROW vs WIDE spans. */
function weekOf(from: string, to: string): Map<string, Day> {
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: { shift_assigned: false },
          checkins: [
            { time: `${date} ${from}`, custom_device_branch: "HQ" },
            { time: `${date} ${to}`, custom_device_branch: "HQ" },
          ],
        } satisfies Day,
      ];
    }),
  );
}

/** 8h — inside the old 10h viewport, so this employee never scrolled. */
const NARROW = weekOf("09:00:00", "17:00:00");
/** 14h — past the old 10h viewport, so this employee silently got a scrollbar. */
const WIDE = weekOf("06:00:00", "20:00:00");

function renderWeek(days: Map<string, Day>): string {
  return renderToStaticMarkup(
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
}

function renderDay(days: Map<string, Day>): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekDayView
        weekDates={WEEK}
        daysByDate={days}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

for (const [surface, render] of [
  ["desktop week grid", renderWeek],
  ["phone day view", renderDay],
] as const) {
  test(`${surface}: no vertical scroller, whatever the span`, () => {
    for (const [label, days] of [
      ["narrow (09:00-17:00)", NARROW],
      ["wide (06:00-20:00)", WIDE],
    ] as const) {
      const html = render(days);
      assert.ok(!/overflow-y-auto/.test(html), `${label}: must not create a y-scroller`);
      assert.ok(!/overflow-auto/.test(html), `${label}: must not create a scroller`);
    }
  });

  test(`${surface}: no canvas taller than its container, whatever the span`, () => {
    for (const [label, days] of [
      ["narrow (09:00-17:00)", NARROW],
      ["wide (06:00-20:00)", WIDE],
    ] as const) {
      // A percentage height is how the over-tall canvas was expressed. Any
      // percentage over 100 means the container overflows and scrolls again.
      for (const [, pct] of render(days).matchAll(/height:\s*([\d.]+)%/g)) {
        assert.ok(Number(pct) <= 100, `${label}: found a ${pct}% height — canvas overflows`);
      }
    }
  });
}

test("both surfaces render the same span identically w.r.t. overflow", () => {
  // The bug was a DIFFERENCE between employees, so pin that the wide week is
  // treated exactly like the narrow one rather than merely "not scrolling today".
  const scroller = /overflow-(?:y-)?auto/;
  assert.equal(scroller.test(renderWeek(NARROW)), scroller.test(renderWeek(WIDE)));
  assert.equal(scroller.test(renderDay(NARROW)), scroller.test(renderDay(WIDE)));
});
