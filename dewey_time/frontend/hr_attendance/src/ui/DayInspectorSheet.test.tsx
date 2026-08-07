import assert from "node:assert/strict";
import test from "node:test";

import { narrativeDayFrom } from "@/ui/DayInspectorSheet";
import type { Day } from "@/types/calendar";

const FULL_DAY: Day = {
  date: "2026-08-04",
  shift: {
    shift_assigned: true,
    shift_type: "General",
    start_time: "08:00:00",
    end_time: "17:00:00",
    grace_minutes: 10,
  },
  holiday: { description: "Founders' Day", weekly_off: false },
  checkins: [{ time: "2026-08-04 08:07:00", log_type: "IN", device_id: "DEV-1" }],
  observed_lunch: {
    lunch_out: "2026-08-04 12:00:00",
    lunch_in: "2026-08-04 13:05:00",
    minutes: 65,
    lunch_start: "12:00:00",
    lunch_end: "13:00:00",
    return_threshold: "13:00:00",
    late_return: true,
  },
};

// The one field flagNarrative()'s NarrativeDay and hr_calendar.py's Day
// disagree on by name: observed_lunch (Day) vs observedLunch (NarrativeDay).
// Everything else threads straight through.
test("narrativeDayFrom maps a loaded Day into a NarrativeDay, including the snake_case->camelCase lunch field", () => {
  const result = narrativeDayFrom(FULL_DAY);
  assert.deepEqual(result, {
    checkins: FULL_DAY.checkins,
    shift: FULL_DAY.shift,
    holiday: FULL_DAY.holiday,
    observedLunch: FULL_DAY.observed_lunch,
  });
});

// inspectingDay is undefined for the gap between a date being picked and its
// week's calendar payload landing — flagNarrative() still needs *a*
// NarrativeDay in that gap, not a crash.
test("narrativeDayFrom returns a safe empty NarrativeDay when no calendar day has loaded yet", () => {
  const result = narrativeDayFrom(undefined);
  assert.deepEqual(result, { checkins: [], shift: null, holiday: null, observedLunch: null });
});
