import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Sheet } from "@/components/ui/sheet";
import { DayInspectorHeader, narrativeDayFrom } from "@/ui/DayInspectorSheet";
import type { Day, Flag } from "@/types/calendar";

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

const REVIEWING_FLAG: Flag = {
  name: "FLAG-0001",
  flag_code: "LATE_START",
  status: "OPEN",
  severity: "WARNING",
  day_closed: 1,
  is_provisional: false,
  evidence: {},
};

/**
 * The header is rendered on its own, inside a bare `<Sheet open>`, because
 * `SheetContent` is a portal and a portal renders nothing on the server —
 * mounting the whole sheet would assert against an empty string. Radix's Title
 * and Description read the dialog context from the ROOT, so this is all they
 * need.
 */
function headerHtml(inspectingDate: string | null): string {
  return renderToStaticMarkup(
    <Sheet open>
      <DayInspectorHeader
        inspectingDate={inspectingDate}
        employeeId="EMP-0001"
        employeeLabel="Jane Doe"
        reviewingFlag={REVIEWING_FLAG}
        onBack={() => {}}
      />
    </Sheet>
  );
}

test("the flag-review header names the day being reviewed", () => {
  assert.match(headerHtml("2026-08-04"), />Attendance flag review · Tue, Aug 4, 2026</);
});

// `formatFlagContextDate("")` throws `RangeError: Invalid time value`, so the
// header's old `?? ""` read like a guard and was the opposite — it handed the
// formatter the one string guaranteed to take the render down. Nothing reaches
// this state today (the sheet is closed while `inspectingDate` is null, so its
// content is unmounted), which is precisely why it needs pinning: the crash
// would arrive with whatever change first mounts this header without a date.
test("the flag-review header drops the date clause rather than formatting an empty one", () => {
  const html = headerHtml(null);
  assert.match(html, />Attendance flag review</, "the clause is dropped, not left dangling");
});
