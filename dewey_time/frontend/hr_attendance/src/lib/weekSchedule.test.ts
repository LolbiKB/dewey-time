import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeekSchedule,
  describeWeekSchedulePattern,
  shortShiftTypeCode,
  type WeekDaySchedule,
} from "@/lib/weekSchedule";
import type { Day } from "@/types/calendar";

test("shortShiftTypeCode strips FT_ prefix and underscores", () => {
  assert.equal(shortShiftTypeCode("FT_Early_Bird"), "Early Bird");
});

test("describeWeekSchedulePattern returns null when shifts differ", () => {
  const base: WeekDaySchedule = {
    date: "2026-05-26",
    weekday: "Mon",
    weekdayLong: "Monday",
    dayNum: "26",
    monthLabel: "May",
    shift: { shift_assigned: true, shift_type: "FT_Standard" },
    assigned: true,
    shiftType: "FT_Standard",
    startMin: 480,
    endMin: 1020,
    timeLabel: "8:00 AM – 5:00 PM",
    durationMin: 480,
  };
  const week: WeekDaySchedule[] = [
    base,
    { ...base, date: "2026-05-27", weekday: "Tue", timeLabel: "9:00 AM – 6:00 PM" },
  ];
  assert.equal(describeWeekSchedulePattern(week), null);
});

test("describeWeekSchedulePattern summarizes uniform Mon–Fri pattern", () => {
  const base: WeekDaySchedule = {
    date: "2026-05-26",
    weekday: "Mon",
    weekdayLong: "Monday",
    dayNum: "26",
    monthLabel: "May",
    shift: { shift_assigned: true, shift_type: "FT_Standard" },
    assigned: true,
    shiftType: "FT_Standard",
    startMin: 480,
    endMin: 1020,
    timeLabel: "8:00 AM – 5:00 PM",
    durationMin: 480,
  };
  const week = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((weekday, i) => ({
    ...base,
    date: `2026-05-${26 + i}`,
    weekday,
  }));
  assert.equal(
    describeWeekSchedulePattern(week),
    "Mon–Fri · Standard · 8:00 AM – 5:00 PM"
  );
});

const AUG19 = new Date(2026, 7, 19);

function rostered(shift: Record<string, unknown>): Map<string, Day> {
  return new Map([
    ["2026-08-19", { date: "2026-08-19", shift: { shift_assigned: true, ...shift } }],
  ]) as unknown as Map<string, Day>;
}

test("an overnight shift is worth its real hours, not nothing", () => {
  // THE DEFECT: `endMin > startMin` guarded the duration, so a 22:00-06:00
  // roster (1320 -> 360) computed none at all. The row printed
  // "10:00 PM – 6:00 AM" correctly beside a blank hours column, and the week
  // total read "—" because every night was dropped from the sum.
  const [day] = buildWeekSchedule(
    [AUG19],
    rostered({
      start_time: "22:00:00",
      end_time: "06:00:00",
      lunch_start: "02:00:00",
      lunch_end: "03:00:00",
    }),
  );
  // Eight hours, less the break taken in the middle of the night.
  assert.equal(day!.durationMin, 7 * 60);
});

test("an ordinary daytime shift is unchanged by the wrap arithmetic", () => {
  const [day] = buildWeekSchedule(
    [AUG19],
    rostered({
      start_time: "08:00:00",
      end_time: "17:00:00",
      lunch_start: "12:00:00",
      lunch_end: "13:00:00",
    }),
  );
  assert.equal(day!.durationMin, 8 * 60);
});

test("a roster with two identical times is a fault, not a 24-hour shift", () => {
  const [day] = buildWeekSchedule(
    [AUG19],
    rostered({ start_time: "08:00:00", end_time: "08:00:00" }),
  );
  assert.equal(day!.durationMin, undefined);
});

test("a lunch that crosses midnight is subtracted too", () => {
  const [day] = buildWeekSchedule(
    [AUG19],
    rostered({
      start_time: "20:00:00",
      end_time: "04:00:00",
      lunch_start: "23:30:00",
      lunch_end: "00:30:00",
    }),
  );
  assert.equal(day!.durationMin, 7 * 60);
});
