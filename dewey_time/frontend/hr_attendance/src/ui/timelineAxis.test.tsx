import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { WeekView } from "./WeekView";
import { WeekDayView } from "./WeekDayView";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** An 08:00–17:00 assigned week, so the axis resolves to 07:00–18:00. */
function week(): Map<string, Day> {
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
          checkins: [
            { time: `${date} 08:00:00`, custom_device_branch: "HQ" },
            { time: `${date} 17:00:00`, custom_device_branch: "HQ" },
          ],
        } satisfies Day,
      ];
    }),
  );
}

const common = {
  weekDates: WEEK,
  daysByDate: week(),
  alertsByDate: new Map(),
  syncByDate: new Map(),
  onInspectDay: () => {},
  onInspectFlag: () => {},
};

const desktop = () =>
  renderToStaticMarkup(
    <TooltipProvider>
      <WeekView {...common} />
    </TooltipProvider>,
  );

const phone = () =>
  renderToStaticMarkup(
    <TooltipProvider>
      <WeekDayView {...common} />
    </TooltipProvider>,
  );

test("the gutter labels every hour of the derived window", () => {
  const html = desktop();
  for (const label of ["7 AM", "8 AM", "12 PM", "5 PM", "6 PM"]) {
    assert.ok(html.includes(label), `gutter is missing ${label}`);
  }
  assert.ok(!html.includes("6 AM"), "06:00 is outside a 07:00-18:00 window");
});

test("the phone surface labels the same hours as the week grid", () => {
  // A separate call site: TypeScript catches a missing prop declaration but not
  // a forgotten pass-down, which is exactly how this kind of gap ships.
  const html = phone();
  for (const label of ["7 AM", "12 PM", "6 PM"]) {
    assert.ok(html.includes(label), `phone gutter is missing ${label}`);
  }
});

test("hour lines render behind the bands, and the fake 50% hairline is gone", () => {
  const html = desktop();
  assert.ok(/bg-border(?![-/\w])/.test(html), "expected hour lines");
  assert.ok(
    !html.includes("calc(50% - 0.5px)"),
    "the decorative mid-width hairline reads as a false axis once real gridlines exist",
  );
});

test("axis chrome is hidden from assistive tech", () => {
  // It is decoration duplicating information the bands' tooltips already carry.
  assert.ok(desktop().includes('aria-hidden="true"'));
});

/**
 * A week containing the real today, because `isToday` is still
 * `isSameDay(d, new Date())` — deliberately not rewritten to consume `now`
 * (see the spec's §5.3). Only the *position* of the line is injected.
 *
 * This is not date-dependent: every day of the fixture carries the same
 * 08:00–17:00 shift, so the window is 07:00–18:00 whatever today happens to be.
 */
const TODAY = new Date();
const LIVE_WEEK = Array.from(
  { length: 7 },
  (_, i) => new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - 3 + i),
);

function liveWeekDays(): Map<string, Day> {
  return new Map(
    LIVE_WEEK.map((d) => {
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
          checkins: [
            { time: `${date} 08:00:00`, custom_device_branch: "HQ" },
            { time: `${date} 17:00:00`, custom_device_branch: "HQ" },
          ],
        } satisfies Day,
      ];
    }),
  );
}

const AT = (h: number, m: number) =>
  new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), h, m);

function desktopAt(now: Date): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={LIVE_WEEK}
        daysByDate={liveWeekDays()}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        now={now}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

function phoneAt(now: Date): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekDayView
        weekDates={LIVE_WEEK}
        daysByDate={liveWeekDays()}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        now={now}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

test("the now-line renders once, on today's column only", () => {
  const marks = desktopAt(AT(13, 20)).match(/bg-destructive\/70/g) ?? [];
  assert.equal(marks.length, 1, "one column is today, so exactly one line");
});

test("no now-line when the clock is outside the window", () => {
  // The silent-failure case: pctFromMinute clamps to [0,100], so forgetting the
  // suppression check yields a plausible line pinned to the top edge — a
  // confident 07:00 reading at 03:00 — rather than anything visibly broken.
  assert.ok(!/bg-destructive\/70/.test(desktopAt(AT(3, 0))), "03:00 is before a 07:00 window");
  assert.ok(!/bg-destructive\/70/.test(desktopAt(AT(22, 0))), "22:00 is after an 18:00 window");
});

test("the now-line also renders on the phone surface, at the position implied by `now`", () => {
  // Same fixture and `now` as the desktop test above, but through WeekDayView:
  // TypeScript catches a missing prop declaration, not a forgotten pass-down to
  // DayCell, which is exactly how `now` could stop reaching the phone surface
  // (see offSiteSegment.test.tsx:120-125 for the same hazard on `employeeBranch`).
  // WeekDayView shows one selected day at a time and defaults selection to
  // today, so LIVE_WEEK's today column is the one rendered.
  //
  // Asserting mere presence of the `bg-destructive/70` class would not catch a
  // forgotten pass-down: DayDayTrack's `now` prop falls back to a live
  // `new Date()`, and during a working-hours test run that live clock also
  // falls inside this fixture's 07:00-18:00 window, drawing *a* line by
  // coincidence (confirmed while writing this test — removing the pass-down
  // still rendered a line, just at the wrong position). Asserting the line's
  // computed position instead, which only matches 13:20 in a 07:00-18:00
  // window, catches the regression regardless of the wall clock the suite
  // happens to run at.
  const html = phoneAt(AT(13, 20));
  assert.match(
    html,
    /top:57\.57\d*%"\s*aria-hidden="true"/,
    "the phone now-line must sit at 13:20's position (57.57…%) in the 07:00-18:00 window",
  );
});
