import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";

import { plannedDaysFromSchedule } from "./plannedDays";
import type { Day } from "@/types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** All seven days off unless overridden by index (0 = Monday). */
function week(overrides: Partial<Record<number, Day>>): Map<string, Day> {
  return new Map(
    WEEK.map((d, i) => {
      const date = format(d, "yyyy-MM-dd");
      return [date, overrides[i] ?? ({ date, shift: { shift_assigned: false } } as Day)];
    }),
  );
}

test("a working day maps its four minute fields and durationMin", () => {
  const date = format(WEEK[0]!, "yyyy-MM-dd");
  const days = plannedDaysFromSchedule(
    WEEK,
    week({
      0: {
        date,
        shift: {
          shift_assigned: true,
          shift_type: "FT",
          start_time: "08:00:00",
          end_time: "17:00:00",
          lunch_start: "12:00:00",
          lunch_end: "13:00:00",
        },
      } as Day,
    }),
  );
  const mon = days[0]!;
  assert.equal(mon.works, true);
  assert.equal(mon.startMin, 8 * 60);
  assert.equal(mon.endMin, 17 * 60);
  assert.equal(mon.lunchStartMin, 12 * 60);
  assert.equal(mon.lunchEndMin, 13 * 60);
  assert.equal(mon.durationMin, 8 * 60, "9h shift minus a 1h lunch is 8h net");
});

test("an unassigned day gives works: false with no bounds", () => {
  const days = plannedDaysFromSchedule(WEEK, week({}));
  const mon = days[0]!;
  assert.equal(mon.works, false);
  assert.equal(mon.startMin, undefined);
  assert.equal(mon.endMin, undefined);
});

test("a leave day sets onLeave and leaveType", () => {
  const date = format(WEEK[0]!, "yyyy-MM-dd");
  const days = plannedDaysFromSchedule(
    WEEK,
    week({
      0: {
        date,
        shift: { shift_assigned: false },
        leave: { on_leave: true, leave_type: "Annual Leave" },
      } as Day,
    }),
  );
  const mon = days[0]!;
  assert.equal(mon.onLeave, true);
  assert.equal(mon.leaveType, "Annual Leave");
});

test("sublabel carries the day number for a dated week", () => {
  const days = plannedDaysFromSchedule(WEEK, week({}));
  assert.equal(days[0]!.sublabel, format(WEEK[0]!, "d"));
});
