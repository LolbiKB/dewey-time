import assert from "node:assert/strict";
import test from "node:test";

import type { ShiftContext } from "@/types/calendar";

import {
  computeWeekGanttWindow,
  describeWeekSchedulePattern,
  formatDayShiftHeaderLabel,
  shortShiftTypeCode,
  type WeekDaySchedule,
} from "@/lib/weekSchedule";

test("formatDayShiftHeaderLabel shows Off when shift is not assigned", () => {
  assert.deepEqual(formatDayShiftHeaderLabel({ shift_assigned: false }), {
    assigned: false,
    primary: "Off",
  });
  assert.deepEqual(formatDayShiftHeaderLabel(undefined), {
    assigned: false,
    primary: "Off",
  });
});

test("formatDayShiftHeaderLabel shows shift type and expected window", () => {
  const shift: ShiftContext = {
    shift_assigned: true,
    shift_type: "FT_Standard",
    start_time: "08:00:00",
    end_time: "17:00:00",
  };
  assert.deepEqual(formatDayShiftHeaderLabel(shift), {
    assigned: true,
    primary: "Standard",
    time: "8:00 AM – 5:00 PM",
  });
});

test("formatDayShiftHeaderLabel does not invent shift when assignment flag is false", () => {
  const shift: ShiftContext = {
    shift_assigned: false,
    shift_type: "FT_Standard",
    start_time: "08:00:00",
    end_time: "17:00:00",
  };
  assert.equal(formatDayShiftHeaderLabel(shift).primary, "Off");
});

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

test("computeWeekGanttWindow pads around earliest and latest shift", () => {
  const week: WeekDaySchedule[] = [
    {
      date: "2026-05-26",
      weekday: "Mon",
      weekdayLong: "Monday",
      dayNum: "26",
      monthLabel: "May",
      shift: { shift_assigned: true },
      assigned: true,
      startMin: 7 * 60,
      endMin: 15 * 60,
    },
  ];
  const w = computeWeekGanttWindow(week);
  assert.ok(w.startMin <= 7 * 60);
  assert.ok(w.endMin >= 15 * 60);
  assert.equal(w.span, w.endMin - w.startMin);
});
