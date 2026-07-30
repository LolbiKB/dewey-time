import assert from "node:assert/strict";
import test from "node:test";

import {
  describeWeekSchedulePattern,
  shortShiftTypeCode,
  type WeekDaySchedule,
} from "@/lib/weekSchedule";

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
