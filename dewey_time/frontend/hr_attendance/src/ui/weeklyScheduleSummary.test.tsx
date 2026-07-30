import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { EmployeePicker } from "./EmployeePicker";
import { WeeklyScheduleFacts } from "./WeeklyScheduleSummary";
import type { CalendarEmployee, Day } from "../types/calendar";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

const ADA: CalendarEmployee = {
  id: "HR-EMP-00001",
  label: "Ada Lovelace",
  employee_name: "Ada Lovelace",
  has_shift_assignment: true,
  has_shift_schedule_assignment: true,
  shift_schedule_assignment: "HR-SSA-00007",
  schedule_min_date: "2025-01-06",
  schedule_max_date: null,
};

type Spec = { superseded?: boolean } | "off" | "leave";

/** Mon–Fri 08:00–17:00 with a one-hour lunch (5 × 8h = a round 40h), Sat off, Sun leave. */
function week(specs: Spec[] = [{}, {}, {}, {}, {}, "off", "leave"]): Map<string, Day> {
  return new Map(
    WEEK.map((d, i) => {
      const date = format(d, "yyyy-MM-dd");
      const spec = specs[i] ?? "off";
      if (spec === "off") return [date, { date, shift: { shift_assigned: false } } satisfies Day];
      if (spec === "leave") {
        return [
          date,
          {
            date,
            shift: { shift_assigned: false },
            leave: { on_leave: true, leave_type: "Annual Leave" },
          } satisfies Day,
        ];
      }
      return [
        date,
        {
          date,
          shift: {
            shift_assigned: true,
            shift_type: "FT_DAY",
            start_time: "08:00:00",
            end_time: "17:00:00",
            lunch_start: "12:00:00",
            lunch_end: "13:00:00",
            schedule_superseded: spec.superseded,
          },
        } satisfies Day,
      ];
    }),
  );
}

/**
 * Renders the popover *body*, not `WeeklyScheduleSummary` itself: `PopoverContent`
 * portals into `document.body`, so an open `<WeeklyScheduleSummary>` renders to
 * nothing but its trigger under `renderToStaticMarkup` (the same trap
 * `schedulePlanPreviewDialog.test.tsx` documents for Radix `Dialog`). The body is
 * exported for exactly this reason; the last test below guards the wiring between
 * the two, which no render here can reach.
 */
function render(
  options: {
    days?: Map<string, Day>;
    employee?: CalendarEmployee | null;
    weekAssignedShiftDays?: number;
  } = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeeklyScheduleFacts
        employee={options.employee === undefined ? ADA : options.employee}
        weekDates={WEEK}
        daysByDate={options.days ?? week()}
        weekAssignedShiftDays={options.weekAssignedShiftDays ?? 5}
        showWeekDetail
      />
    </TooltipProvider>,
  );
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** The definition list, as a plain label → value map. */
function facts(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<dt[^>]*>(.*?)<\/dt>.*?<dd[^>]*>(.*?)<\/dd>/g)) {
    out[stripTags(m[1]!)] = stripTags(m[2]!);
  }
  return out;
}

test("the summary states what the calendar cannot show", () => {
  const shown = facts(render());
  assert.equal(shown["Expected hours"], "40h");
  assert.equal(shown["Working days"], "5");
  // 7 = 5 working + 1 off + 1 leave. `summarizeWeekSchedule` counts an
  // unassigned leave day as "off" too, so a raw offDays here would read 2 and
  // the three rows would add to eight.
  assert.equal(shown["Days off"], "1");
  assert.equal(shown["Leave"], "1");
  assert.match(shown["Assignment"] ?? "", /HR-SSA-00007/, "Shift Schedule Assignment id");
  assert.match(shown["Assignment"] ?? "", /Jan 2025/, "coverage range");
});

test("the summary renders no shift blocks — the chart lives on the canvas now", () => {
  // The guard against the chart creeping back in. These three patterns are the
  // block treatments used by the canvas and by the two retired strips.
  const html = render();
  assert.doesNotMatch(html, /border-primary\/45/, "canvas block");
  assert.doesNotMatch(html, /h-\[4\.5rem\]/, "old Gantt pill");
  assert.doesNotMatch(html, /h-14 w-2/, "old preview mini-track");
});

test("an employee with no Shift Schedule Assignment is told where to fix it", () => {
  const html = render({
    days: week(["off", "off", "off", "off", "off", "off", "off"]),
    employee: { id: "HR-EMP-00002", label: "Grace Hopper" },
    weekAssignedShiftDays: 0,
  });
  assert.match(html, /Assign a Shift Schedule Assignment in ERPNext to enable expected hours/);
  assert.match(html, /to generate shifts/, "the no-assignment-on-file suffix");
});

test("a superseded Shift Assignment is called out", () => {
  // Only the calendar's own data says the covering assignment was retired in
  // ERP; the drawn shift looks identical either way.
  assert.doesNotMatch(render(), /Superseded in ERP/);
  assert.match(
    render({ days: week([{ superseded: true }, {}, {}, {}, {}, "off", "leave"]) }),
    /Superseded in ERP/,
  );
});

test("the picker's schedule button is wired to the popover, tooltip and all", () => {
  // The trigger sits inside two nested Radix `asChild` slots (tooltip outside,
  // popover trigger inside). Get that order wrong and the popover's props land
  // on the tooltip's Root instead of the button: it still renders, still shows
  // its tooltip, and silently opens nothing. Nothing else here would notice.
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <EmployeePicker
        employees={[ADA]}
        value={ADA.id}
        onChange={() => {}}
        weekDates={WEEK}
        daysByDate={week()}
        weekAssignedShiftDays={5}
      />
    </TooltipProvider>,
  );
  const button = (html.match(/<button[^>]*aria-label="View weekly schedule"[^>]*>/) ?? [])[0];
  assert.ok(button, "expected the schedule button to still carry its aria-label");
  assert.match(button!, /aria-haspopup="dialog"/, "the popover trigger's props reached the button");
  assert.match(button!, /aria-controls="/, "the button must point at the popover it opens");
  assert.match(button!, /data-slot="tooltip-trigger"/, "the tooltip's props reached it too");
});

test("the popover body is the facts, and the file draws no chart", () => {
  // Two holes no render above can reach: `PopoverContent` portals, so a
  // summary that mounted nothing would still pass every test here; and the
  // block patterns could return in the portaled half of the file.
  const src = readFileSync(resolve(PKG, "src/ui/WeeklyScheduleSummary.tsx"), "utf8");
  const content = src.match(/<PopoverContent[\s\S]*?<\/PopoverContent>/)?.[0];
  assert.ok(content, "expected a <PopoverContent>…</PopoverContent> in the summary");
  assert.match(content!, /<WeeklyScheduleFacts/, "the popover must mount the facts body");
  for (const pattern of [/border-primary\/45/, /h-\[4\.5rem\]/, /h-14 w-2/]) {
    assert.doesNotMatch(src, pattern, `block treatment ${pattern} is back in the summary source`);
  }
  assert.doesNotMatch(src, /Gantt/, "the retired chart must not be referenced");
});
