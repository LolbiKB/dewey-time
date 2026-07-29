import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSelectedDate, stepDay, dayPipState } from "./weekDayView";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`)); // Mon 13 … Sun 19

test("initialSelectedDate picks today when in the week, else the first day", () => {
  assert.equal(initialSelectedDate(WEEK, new Date("2026-07-16T09:00:00")), "2026-07-16");
  assert.equal(initialSelectedDate(WEEK, new Date("2026-08-01T09:00:00")), "2026-07-13");
});

test("stepDay clamps at both ends (no wrap)", () => {
  assert.equal(stepDay(WEEK, "2026-07-16", 1), "2026-07-17");
  assert.equal(stepDay(WEEK, "2026-07-16", -1), "2026-07-15");
  assert.equal(stepDay(WEEK, "2026-07-19", 1), "2026-07-19", "clamped at last day");
  assert.equal(stepDay(WEEK, "2026-07-13", -1), "2026-07-13", "clamped at first day");
});

test("dayPipState precedence: today > holiday > off > flagged > normal", () => {
  assert.equal(dayPipState({ holiday: { description: "x" } } as unknown as Day, true), "today");
  assert.equal(dayPipState({ holiday: { description: "x" } } as unknown as Day, false), "holiday");
  assert.equal(dayPipState({ shift: { shift_assigned: false } } as unknown as Day, false), "off");
  assert.equal(
    dayPipState({ shift: { shift_assigned: true }, flags: [{ flag_code: "LATE_START" }] } as unknown as Day, false),
    "flagged",
  );
  assert.equal(dayPipState({ shift: { shift_assigned: true }, flags: [] } as unknown as Day, false), "normal");
});

test("dayPipState returns normal for a clock day, not off", () => {
  const day = { shift: { shift_assigned: false }, flags: [] } as never;
  assert.equal(dayPipState(day, false, true), "normal");
});

test("dayPipState still returns off for an unscheduled non-clock employee", () => {
  const day = { shift: { shift_assigned: false }, flags: [] } as never;
  assert.equal(dayPipState(day, false, false), "off");
});

test("dayPipState still flags a clock day that has flags", () => {
  const day = {
    shift: { shift_assigned: false },
    flags: [{ flag_code: "ATTENDANCE_ISSUE" }],
  } as never;
  assert.equal(dayPipState(day, false, true), "flagged");
});

test("dayPipState reads an INFO-only day as normal", () => {
  const day = {
    shift: { shift_assigned: true },
    flags: [{ flag_code: "NON_PRIMARY_SITE_PUNCH", severity: "INFO" }],
  } as never;
  assert.equal(dayPipState(day, false), "normal");
});

test("dayPipState still flags a day with an INFO flag and a WARNING flag", () => {
  const day = {
    shift: { shift_assigned: true },
    flags: [
      { flag_code: "NON_PRIMARY_SITE_PUNCH", severity: "INFO" },
      { flag_code: "LATE_START", severity: "WARNING" },
    ],
  } as never;
  assert.equal(dayPipState(day, false), "flagged");
});

test("dayPipState treats a flag with no severity as flagged", () => {
  const day = {
    shift: { shift_assigned: true },
    flags: [{ flag_code: "LATE_START" }],
  } as never;
  assert.equal(dayPipState(day, false), "flagged");
});

test("holiday still wins over clock", () => {
  const day = { shift: { shift_assigned: false }, holiday: { description: "X" } } as never;
  assert.equal(dayPipState(day, false, true), "holiday");
});
