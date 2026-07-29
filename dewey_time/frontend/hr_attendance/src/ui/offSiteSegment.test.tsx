import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { WeekView } from "./WeekView";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** One 08:00–17:00 worked day per date, punched at `branch`. */
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
            { time: `${date} 17:00:00`, custom_device_branch: branch },
          ],
          gross_minutes: 540,
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
