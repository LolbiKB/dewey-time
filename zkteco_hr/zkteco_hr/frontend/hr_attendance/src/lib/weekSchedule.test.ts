import { describe, expect, it } from "vitest";

import type { ShiftContext } from "@/types/calendar";

import {
  formatDayShiftHeaderLabel,
  shortShiftTypeCode,
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
