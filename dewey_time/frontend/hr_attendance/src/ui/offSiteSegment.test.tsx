import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { WeekView } from "./WeekView";
import { WeekDayView } from "./WeekDayView";
import type { Day } from "../types/calendar";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** One 08:00–17:00 worked day per date, punched at `branch`, with a real
 *  midday lunch gap (12:00–13:15) so gap bands actually render. */
function weekAt(branch: string, shiftAssigned: boolean): Map<string, Day> {
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: shiftAssigned
            ? {
                shift_assigned: true,
                shift_type: "FT",
                start_time: "08:00:00",
                end_time: "17:00:00",
                lunch_start: "12:00:00",
                lunch_end: "13:00:00",
              }
            : { shift_assigned: false },
          checkins: [
            { time: `${date} 08:00:00`, custom_device_branch: branch },
            { time: `${date} 12:00:00`, custom_device_branch: branch },
            { time: `${date} 13:15:00`, custom_device_branch: branch },
            { time: `${date} 17:00:00`, custom_device_branch: branch },
          ],
          gross_minutes: 465,
        } satisfies Day,
      ];
    }),
  );
}

function render(days: Map<string, Day>, employeeBranch: string | null): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={WEEK}
        daysByDate={days}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        employeeBranch={employeeBranch}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

/** Same fixture, rendered through the phone surface (WeekDayView) instead of
 *  the desktop week grid — the prop is threaded but the desktop-only render
 *  tests above never exercise this pass-down. */
function renderPhone(days: Map<string, Day>, employeeBranch: string | null): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekDayView
        weekDates={WEEK}
        daysByDate={days}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        employeeBranch={employeeBranch}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

test("a worked segment punched at another site is hatched", () => {
  assert.match(render(weekAt("BRANCH-B", true), "BRANCH-A"), /seg-offsite/);
});

test("a worked segment punched at the home site is not hatched", () => {
  assert.doesNotMatch(render(weekAt("BRANCH-A", true), "BRANCH-A"), /seg-offsite/);
});

test("nothing is hatched when the employee has no primary branch", () => {
  // The failure that would hit the most employees: blank Employee.branch must
  // not turn the whole calendar into off-site.
  assert.doesNotMatch(render(weekAt("BRANCH-B", true), null), /seg-offsite/);
  assert.doesNotMatch(render(weekAt("BRANCH-B", true), ""), /seg-offsite/);
});

test("gap bands never carry the hatch", () => {
  // The lunch band sits inside an off-site day, so a selector that matched every
  // positioned block would hatch it too — which is exactly what happened while
  // mocking this up. Only the worked segments may carry it.
  const html = render(weekAt("BRANCH-B", true), "BRANCH-A");
  const bands = html.match(/class="[^"]*bg-muted[^"]*"/g) ?? [];
  assert.ok(bands.length > 0, "fixture must render at least one gap band, or this test proves nothing");
  for (const band of bands) {
    assert.doesNotMatch(band, /seg-offsite/, `a gap band was hatched: ${band}`);
  }
});

test("an off-shift (accent-toned) segment is never hatched, even at another site", () => {
  // Such a day already renders salmon with dashed red borders — the
  // OFF_SHIFT_PUNCH language. A second marker there buys nothing and the
  // white hatch is invisible on that fill anyway.
  assert.doesNotMatch(render(weekAt("BRANCH-B", false), "BRANCH-A"), /seg-offsite/);
});

test("a worked segment punched at another site is hatched on the phone surface too", () => {
  // WeekDayView receives the same employeeBranch prop as WeekView, but no
  // render test exercises it — TypeScript catches a missing prop
  // *declaration* but not a forgotten *pass-down* to DayCell.
  assert.match(renderPhone(weekAt("BRANCH-B", true), "BRANCH-A"), /seg-offsite/);
});

test("the .seg-offsite rule exists in base.css and does not spend the orange accent", () => {
  // `seg-offsite` is an unchecked string literal shared between DayTimeline.tsx
  // (which emits the class) and base.css (which paints it) — a typo in either
  // ships an invisible marker while every render test above still passes,
  // since they only assert on the emitted HTML attribute. Also guard the "no
  // orange" constraint: --brand-accent is reserved for the urgent signal
  // (device alerts, holidays) and must not be spent here.
  const css = readFileSync(resolve(PKG, "src/brand/base.css"), "utf8");
  const start = css.indexOf(".seg-offsite {");
  assert.ok(start !== -1, ".seg-offsite rule not found in base.css");
  const end = css.indexOf("}", start);
  const rule = css.slice(start, end + 1);
  assert.doesNotMatch(rule, /--brand-accent/, "the off-site hatch must not spend the orange accent token");
});
