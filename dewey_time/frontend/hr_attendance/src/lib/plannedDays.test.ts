import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";

import { plannedDaysFromSchedule, plannedDaysFromWeekPattern, resolveWeekPatternWindow } from "./plannedDays";
import type { Day } from "@/types/calendar";
import type { WeekPattern, WeekPatternDay } from "../types/schedule";

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

const H = (h: number) => h * 60;

function pattern(...days: Partial<WeekPatternDay>[]): WeekPattern {
  return {
    frequency: "Weekly",
    days: days.map((d, i) => ({
      weekday: (["Monday", "Tuesday", "Wednesday"] as const)[i]!,
      works: true,
      ...d,
    })) as WeekPatternDay[],
  };
}

test("a working weekday carries its minute bounds", () => {
  const [day] = plannedDaysFromWeekPattern(
    pattern({
      start_time: "08:00:00",
      end_time: "17:00:00",
      lunch_start: "12:00:00",
      lunch_end: "13:00:00",
    }),
  );
  assert.equal(day!.works, true);
  assert.equal(day!.startMin, H(8));
  assert.equal(day!.endMin, H(17));
  assert.equal(day!.lunchStartMin, H(12));
  assert.equal(day!.lunchEndMin, H(13));
  assert.equal(day!.label, "Mon", "three-letter label for an undated pattern");
  assert.equal(day!.sublabel, undefined, "an undated pattern has no day number");
});

test("a non-working weekday has no bounds", () => {
  const [day] = plannedDaysFromWeekPattern(pattern({ works: false, start_time: "08:00:00" }));
  assert.equal(day!.works, false);
  assert.equal(day!.startMin, undefined);
});

test("unparseable or absent times degrade to no bounds rather than throwing", () => {
  const [a, b] = plannedDaysFromWeekPattern(
    pattern({ start_time: "not a time", end_time: null }, { start_time: null, end_time: null }),
  );
  assert.equal(a!.works, true);
  assert.equal(a!.startMin, undefined);
  assert.equal(b!.startMin, undefined);
});

test("every weekday in the pattern produces exactly one day, in order", () => {
  const days = plannedDaysFromWeekPattern(pattern({}, {}, {}));
  assert.equal(days.length, 3);
  assert.deepEqual(days.map((d) => d.label), ["Mon", "Tue", "Wed"]);
});

test("resolveWeekPatternWindow falls back to 06:00-20:00 with no working days", () => {
  const w = resolveWeekPatternWindow(pattern({ works: false }));
  assert.equal(w.startMin, H(6));
  assert.equal(w.endMin, H(20));
});

test("resolveWeekPatternWindow pads and hour-quantizes a single working day, matching resolveWeekTimelineWindow", () => {
  const w = resolveWeekPatternWindow(
    pattern({ start_time: "08:00:00", end_time: "17:00:00" }),
  );
  assert.equal(w.startMin, H(7));
  assert.equal(w.endMin, H(18));
});

test("resolveWeekPatternWindow spans every working day in the pattern", () => {
  const w = resolveWeekPatternWindow(
    pattern(
      { start_time: "06:00:00", end_time: "14:00:00" },
      { start_time: "12:00:00", end_time: "20:00:00" },
    ),
  );
  assert.equal(w.startMin, H(5));
  assert.equal(w.endMin, H(21));
});

test("resolveWeekPatternWindow excludes an overnight day (end <= start) from its bounds", () => {
  const w = resolveWeekPatternWindow(
    pattern({ start_time: "22:00:00", end_time: "06:00:00" }),
  );
  assert.equal(w.startMin, H(6), "falls back — no valid same-day bound to derive from");
  assert.equal(w.endMin, H(20));
});
