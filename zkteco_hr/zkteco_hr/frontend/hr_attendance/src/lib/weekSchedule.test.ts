import { describe, expect, it } from "vitest";

import type { ShiftContext } from "@/types/calendar";

import {
  computeWeekGanttWindow,
  describeWeekSchedulePattern,
  formatDayShiftHeaderLabel,
  shortShiftTypeCode,
  type WeekDaySchedule,
} from "@/lib/weekSchedule";

describe("formatDayShiftHeaderLabel", () => {
  it("shows Off when shift is not assigned", () => {
    expect(formatDayShiftHeaderLabel({ shift_assigned: false })).toEqual({
      assigned: false,
      primary: "Off",
    });
    expect(formatDayShiftHeaderLabel(undefined)).toEqual({
      assigned: false,
      primary: "Off",
    });
  });

  it("shows shift type and expected window from Shift Assignment", () => {
    const shift: ShiftContext = {
      shift_assigned: true,
      shift_type: "FT_Standard",
      start_time: "08:00:00",
      end_time: "17:00:00",
    };
    expect(formatDayShiftHeaderLabel(shift)).toEqual({
      assigned: true,
      primary: "Standard",
      time: "8:00 AM – 5:00 PM",
    });
  });

  it("does not invent a shift when assignment flag is false", () => {
    const shift: ShiftContext = {
      shift_assigned: false,
      shift_type: "FT_Standard",
      start_time: "08:00:00",
      end_time: "17:00:00",
    };
    expect(formatDayShiftHeaderLabel(shift).primary).toBe("Off");
  });
});

describe("shortShiftTypeCode", () => {
  it("strips FT_ prefix and underscores", () => {
    expect(shortShiftTypeCode("FT_Early_Bird")).toBe("Early Bird");
  });
});

describe("describeWeekSchedulePattern", () => {
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

  it("returns null when shifts differ", () => {
    const week: WeekDaySchedule[] = [
      base,
      { ...base, date: "2026-05-27", weekday: "Tue", timeLabel: "9:00 AM – 6:00 PM" },
    ];
    expect(describeWeekSchedulePattern(week)).toBeNull();
  });

  it("summarizes a uniform Mon–Fri pattern", () => {
    const week = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((weekday, i) => ({
      ...base,
      date: `2026-05-${26 + i}`,
      weekday,
    }));
    expect(describeWeekSchedulePattern(week)).toBe(
      "Mon–Fri · Standard · 8:00 AM – 5:00 PM"
    );
  });
});

describe("computeWeekGanttWindow", () => {
  it("pads around earliest and latest shift", () => {
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
    expect(w.startMin).toBeLessThanOrEqual(7 * 60);
    expect(w.endMin).toBeGreaterThanOrEqual(15 * 60);
    expect(w.span).toBe(w.endMin - w.startMin);
  });
});
