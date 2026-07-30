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

/** A worked day, optionally also taken as leave; or an unassigned off/leave day. */
type Spec = { superseded?: boolean; onLeave?: boolean } | "off" | "leave";

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
          // CALENDAR_DATA_CONTRACT.md:105 — `shift_assigned` stays true on a day
          // covered by an SSA row even when leave is approved on it, and
          // hr_calendar.py merges leave in under its own key. Approved leave on a
          // scheduled day is this shape, and it is the common one.
          ...(spec.onLeave ? { leave: { on_leave: true, leave_type: "Annual Leave" } } : {}),
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

/** The three day-count rows claim to partition the week; hold them to it. */
function assertDaysPartitionTheWeek(shown: Record<string, string>) {
  const rows = ["Working days", "Days off", "Leave"] as const;
  const total = rows.reduce((sum, row) => sum + Number(shown[row]), 0);
  assert.equal(
    total,
    7,
    `the day rows must add to seven — got ${rows.map((r) => `${r} ${shown[r]}`).join(" · ")}`,
  );
}

test("the summary states what the calendar cannot show", () => {
  const shown = facts(render());
  assert.equal(shown["Expected hours"], "40h");
  assert.equal(shown["Working days"], "5");
  // A naive `!d.assigned` count treats an unassigned leave day as "off" too,
  // so a raw offDays here would read 2 and the rows would add to eight.
  assert.equal(shown["Days off"], "1");
  assert.equal(shown["Leave"], "1");
  assertDaysPartitionTheWeek(shown);
  assert.match(shown["Assignment"] ?? "", /HR-SSA-00007/, "Shift Schedule Assignment id");
  assert.match(shown["Assignment"] ?? "", /Jan 2025/, "coverage range");
});

test("a scheduled day taken as leave is counted once, not twice", () => {
  // `assigned` and `onLeave` are set independently upstream, so approved leave
  // on a scheduled Monday is both — and lands in Working days *and* Leave
  // unless the component picks one. The retired Gantt picked leave
  // (`day.onLeave ? <LeaveBody/> : day.assigned ? <ShiftBody/> : <OffBody/>`);
  // the definition list has to do the same or it reports eight days in a week.
  const shown = facts(render({ days: week([{ onLeave: true }, {}, {}, {}, {}, "off", "leave"]) }));
  assert.equal(shown["Working days"], "4", "Monday is leave, not work");
  assert.equal(shown["Days off"], "1");
  assert.equal(shown["Leave"], "2");
  assertDaysPartitionTheWeek(shown);
  // Four 8h days, not five. Carrying Monday's hours here would show a 40h
  // expectation against ~32h of punches — a phantom shortfall on a day the
  // employee was legitimately absent, and a 10-hour day implied by the row
  // directly above it.
  assert.equal(shown["Expected hours"], "32h", "a leave day is not expected either");
});

test("the summary renders no shift blocks — the chart lives on the canvas now", () => {
  // The guard against the chart creeping back in. These three patterns are the
  // block treatments used by the canvas and by the two retired strips.
  const html = render();
  // Anchor first: every `doesNotMatch` below also passes against an empty
  // string, so without this the test goes permanently green the moment the
  // body stops rendering.
  assert.match(html, /Expected hours/, "the body must actually be rendering");
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
