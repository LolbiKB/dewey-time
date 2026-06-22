import assert from "node:assert/strict";
import test from "node:test";

import { addDays, parseISO, startOfWeek } from "date-fns";

import type { CalendarEmployee } from "@/types/calendar";

import { parseDateKey } from "@/lib/attendanceTime";
import { calendarFetchRange, clampDateToNavBounds, computeWeekNavBounds, pickEarliestDateKey } from "./weekCalendar";

const now = parseISO("2026-05-28");

function employee(overrides: Partial<CalendarEmployee>): CalendarEmployee {
  return {
    id: "EMP-1",
    label: "EMP-1",
    ...overrides,
  };
}

test("backward bound uses first checkin week not assignment start", () => {
  const bounds = computeWeekNavBounds(
    employee({
      has_shift_assignment: true,
      schedule_min_date: "2026-01-01",
      schedule_max_date: "2026-12-31",
      first_checkin_date: "2026-05-07",
    }),
    now
  );

  assert.equal(bounds.minWeekStart.getTime(), startOfWeek(parseISO("2026-05-05"), { weekStartsOn: 1 }).getTime());
});

test("forward bound uses assignment max date", () => {
  const bounds = computeWeekNavBounds(
    employee({
      has_shift_assignment: true,
      schedule_max_date: "2026-08-15",
      first_checkin_date: "2026-05-07",
    }),
    now
  );

  assert.equal(bounds.calendarMaxDate.getTime(), parseDateKey("2026-08-15").getTime());
});

test("calendar payload first_checkin_date overrides missing employee field", () => {
  const bounds = computeWeekNavBounds(employee({ has_shift_assignment: true }), now, {
    firstCheckinDate: "2026-05-16",
  });

  assert.equal(
    bounds.minWeekStart.getTime(),
    startOfWeek(parseISO("2026-05-12"), { weekStartsOn: 1 }).getTime()
  );
});

test("no checkins locks navigation to present week", () => {
  const bounds = computeWeekNavBounds(
    employee({
      has_shift_assignment: true,
      schedule_max_date: "2026-12-31",
    }),
    now
  );

  const todayWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  assert.equal(bounds.minWeekStart.getTime(), todayWeekStart.getTime());
  assert.equal(bounds.maxWeekStart.getTime(), todayWeekStart.getTime());
  assert.equal(bounds.calendarMinDate.getTime(), todayWeekStart.getTime());
  assert.equal(bounds.calendarMaxDate.getTime(), addDays(todayWeekStart, 6).getTime());
});

test("fixes inverted bounds when assignment ends before first punch", () => {
  const bounds = computeWeekNavBounds(employee({ has_shift_assignment: true }), now, {
    firstCheckinDate: "2026-05-16",
    scheduleMaxDate: "2026-05-10",
  });

  assert.ok(bounds.calendarMinDate.getTime() <= bounds.calendarMaxDate.getTime());
});

test("pickEarliestDateKey chooses oldest", () => {
  assert.equal(
    pickEarliestDateKey("2026-05-29", "2026-05-16", "2026-05-20"),
    "2026-05-16"
  );
});

test("calendarFetchRange includes cross-month week days", () => {
  const anchor = parseISO("2026-04-28");
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);
  const { rangeStart, rangeEnd } = calendarFetchRange(anchor);
  assert.ok(rangeStart.getTime() <= weekStart.getTime());
  assert.ok(rangeEnd.getTime() >= weekEnd.getTime());
});

test("clampDateToNavBounds respects min and max", () => {
  const bounds = computeWeekNavBounds(
    employee({
      has_shift_assignment: true,
      schedule_max_date: "2026-06-30",
      first_checkin_date: "2026-05-07",
    }),
    now
  );

  assert.equal(
    clampDateToNavBounds(parseISO("2026-01-01"), bounds).getTime(),
    bounds.calendarMinDate.getTime()
  );
});
