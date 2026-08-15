import assert from "node:assert/strict";
import test from "node:test";

import { dayLine, weekDatesFor } from "@/miniapp/MyWeekPage";
import type { Day } from "@/types/calendar";

const MON = new Date(2026, 7, 10);
const WED = new Date(2026, 7, 12);
const FRI = new Date(2026, 7, 14);

function worked(date: string): Day {
  return {
    date,
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    first_in: `${date} 07:58:00`,
    last_out: `${date} 17:06:00`,
    checkins: [
      { time: `${date} 07:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${date} 17:06:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;
}

test("the week is Monday-first and seven days long", () => {
  const week = weekDatesFor(WED);
  assert.equal(week.length, 7);
  assert.equal(week[0]!.getDay(), 1);
  assert.equal(week[6]!.getDay(), 0);
});

test("a worked day shows its punch span and net total", () => {
  const line = dayLine(worked("2026-08-10"), MON, FRI);
  assert.match(line.range!, /7:58/);
  assert.match(line.range!, /5:06/);
  assert.ok(line.worked);
  assert.equal(line.note, null);
});

test("leave is named, and shows no invented hours", () => {
  const day = { date: "2026-08-12", leave: { on_leave: true, leave_type: "Annual Leave" } } as Day;
  const line = dayLine(day, WED, FRI);
  assert.equal(line.note, "Annual Leave");
  assert.equal(line.range, null);
  assert.equal(line.worked, null);
});

test("a scheduled day with no punches is stated, never judged", () => {
  // "absent" would be the app taking a position it has no standing to take:
  // the engine's verdict is provisional at this point and HR has reviewed
  // nothing. This assertion is the guard on that.
  const day = { date: "2026-08-10", shift: { shift_assigned: true }, checkins: [] } as unknown as Day;
  const line = dayLine(day, MON, FRI);
  assert.equal(line.note, "No punches recorded");
  for (const judgment of ["absent", "late", "missing", "violation", "failed"]) {
    assert.doesNotMatch(line.note!.toLowerCase(), new RegExp(judgment));
  }
});

test("a future scheduled day reads as not-yet rather than as a gap", () => {
  const day = { date: "2026-08-14", shift: { shift_assigned: true }, checkins: [] } as unknown as Day;
  assert.equal(dayLine(day, FRI, MON).note, "Scheduled");
});

test("an unrostered day is a day off, not a missing shift", () => {
  const day = { date: "2026-08-15", shift: { shift_assigned: false }, checkins: [] } as unknown as Day;
  assert.equal(dayLine(day, new Date(2026, 7, 15), FRI).note, "Day off");
});

test("a day the payload has nothing for does not crash the row", () => {
  assert.equal(dayLine(undefined, MON, FRI).note, "Day off");
});
