import assert from "node:assert/strict";
import test from "node:test";

import { isLive, miniStatus, minuteOfDay, statusKey } from "@/miniapp/miniStatus";
import type { Day } from "@/types/calendar";

const KEY = "2026-08-17";
const DAY = new Date(2026, 7, 17);
/** Same clock time on a different date, for the "not today" cases. */
const OTHER_DAY = new Date(2026, 7, 10);

function at(hh: number, mm = 0): Date {
  return new Date(2026, 7, 17, hh, mm, 0, 0);
}

type Punch = [string, "IN" | "OUT", string?];

function day(punches: Punch[], extra: Partial<Day> = {}): Day {
  return {
    date: KEY,
    shift: {
      shift_assigned: true,
      start_time: "08:00:00",
      end_time: "17:00:00",
      lunch_start: "12:00:00",
      lunch_end: "13:00:00",
    },
    holiday: null,
    leave: { on_leave: false },
    checkins: punches.map(([time, log_type, branch]) => ({
      time: `${KEY} ${time}`,
      log_type,
      custom_device_branch: branch ?? "DIS Iconic",
    })),
    ...extra,
  } as unknown as Day;
}

test("nobody has clocked in yet", () => {
  const status = miniStatus(day([]), DAY, at(7, 30));
  assert.equal(status.kind, "notIn");
  assert.equal(statusKey(status), "statusNotIn");
  assert.equal(isLive(status), false);
});

test("clocked in names the branch the punch was taken at", () => {
  const status = miniStatus(day([["07:58:00", "IN", "DIS Iconic"]]), DAY, at(9));
  assert.equal(status.kind, "in");
  assert.equal(status.kind === "in" && status.branch, "DIS Iconic");
  // The only state that earns colour and a dot: it is the one happening now.
  assert.equal(isLive(status), true);
});

test("out inside the rostered lunch window reads as lunch, not as gone", () => {
  const punches: Punch[] = [["07:58:00", "IN"], ["12:01:00", "OUT"]];
  assert.equal(miniStatus(day(punches), DAY, at(12, 30)).kind, "lunch");
});

test("out during the shift but outside lunch is reported as such, not as done", () => {
  // 2pm, back from lunch, punched out again. The distinction matters: "Checked
  // out" at 2pm would tell someone their day is finished when it is not.
  const punches: Punch[] = [
    ["07:58:00", "IN"], ["12:01:00", "OUT"], ["12:58:00", "IN"], ["14:00:00", "OUT"],
  ];
  assert.equal(miniStatus(day(punches), DAY, at(14, 30)).kind, "outDuringShift");
});

test("out after the shift has ended is simply out", () => {
  const punches: Punch[] = [["07:58:00", "IN"], ["17:06:00", "OUT"]];
  assert.equal(miniStatus(day(punches), DAY, at(17, 30)).kind, "out");
});

test("out before the shift opens is not 'during' it", () => {
  // A punch pair before 08:00 -- the rostered window has not started, so
  // calling it "out during shift" would name a window nobody is inside.
  const punches: Punch[] = [["06:00:00", "IN"], ["06:30:00", "OUT"]];
  assert.equal(miniStatus(day(punches), DAY, at(7)).kind, "out");
});

test("an unlabelled punch stream is paired, not assumed to be an arrival", () => {
  // Employee Checkin's `log_type` is an OPTIONAL Select, and a device that
  // reports only a timestamp leaves it empty on every row. The rule here used
  // to be "the last punch is not an OUT", which claims someone is at work on
  // any evidence short of an explicit departure -- so an unlabelled stream
  // read "In" forever, including after they had gone home.
  //
  // Paired instead, the way deriveSegments pairs them to draw the timeline
  // directly below this chip, so the two surfaces cannot disagree.
  const blank = (time: string): Punch => [time, "" as never];
  const home = day([blank("07:58:00"), blank("12:01:00"), blank("12:58:00"), blank("17:06:00")]);
  assert.notEqual(miniStatus(home, DAY, at(17, 30)).kind, "in", "four punches is two closed runs");

  const working = day([blank("07:58:00"), blank("12:01:00"), blank("12:58:00")]);
  assert.equal(miniStatus(working, DAY, at(14)).kind, "in", "three punches leaves one open");

  assert.equal(miniStatus(day([blank("07:58:00")]), DAY, at(9)).kind, "in");
});

test("an explicit label always wins over the pairing", () => {
  // Pairing is the fallback, not the rule. A single punch explicitly marked
  // OUT is someone who left, however odd the count.
  assert.notEqual(miniStatus(day([["17:06:00", "OUT"]]), DAY, at(17, 30)).kind, "in");
});

test("the LAST punch decides, whatever order the payload arrived in", () => {
  // The basis of in-versus-out. One out-of-order row would invert the answer,
  // and the payload's order is the query's order, not a guarantee.
  const scrambled = day([["12:01:00", "OUT"], ["07:58:00", "IN"], ["12:58:00", "IN"]]);
  assert.equal(miniStatus(scrambled, DAY, at(14)).kind, "in");
});

test("leave is named, in the data's own words, on any day", () => {
  const onLeave = day([], { leave: { on_leave: true, leave_type: "Annual Leave" } } as Partial<Day>);
  const status = miniStatus(onLeave, DAY, at(10));
  assert.equal(status.kind, "named");
  assert.equal(status.kind === "named" && status.text, "Annual Leave");
  // And on a day that is not today: DayCell never reads `leave`, so without
  // this a leave day is a blank dashed band with nothing to explain it.
  assert.equal(miniStatus(onLeave, OTHER_DAY, at(10)).kind, "named");
});

test("a holiday outranks punches, because it is still a holiday", () => {
  const boxing = day([["07:58:00", "IN"]], { holiday: { description: "Pchum Ben" } } as Partial<Day>);
  const status = miniStatus(boxing, DAY, at(9));
  assert.equal(status.kind === "named" && status.text, "Pchum Ben");
});

test("a day with no shift and no punches is a day off, and says so on any day", () => {
  const off = day([], { shift: { shift_assigned: false } } as Partial<Day>);
  assert.equal(statusKey(miniStatus(off, DAY, at(10))), "stateDayOff");
  assert.equal(statusKey(miniStatus(off, OTHER_DAY, at(10))), "stateDayOff");
});

test("a past day has no present tense", () => {
  // "Not checked in" on a Tuesday three weeks ago would be a status about a
  // moment that is over. The canvas already carries that day's shape.
  const status = miniStatus(day([]), OTHER_DAY, at(10));
  assert.equal(status.kind, "none");
  assert.equal(statusKey(status), null);
});

test("a day with no rostered lunch never reports one", () => {
  const noLunch = day([["07:58:00", "IN"], ["12:01:00", "OUT"]], {
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
  } as Partial<Day>);
  assert.equal(miniStatus(noLunch, DAY, at(12, 30)).kind, "outDuringShift");
});

test("an overnight shift is not treated as an all-day window", () => {
  // 22:00-06:00 ends "before" it starts on the clock. Read as a plain range it
  // would make every daylight hour "during the shift".
  const night = day([["22:05:00", "IN"], ["23:00:00", "OUT"]], {
    shift: { shift_assigned: true, start_time: "22:00:00", end_time: "06:00:00" },
  } as Partial<Day>);
  assert.equal(miniStatus(night, DAY, at(14)).kind, "out");
});

test("minuteOfDay reads the wall clock", () => {
  assert.equal(minuteOfDay(at(0, 0)), 0);
  assert.equal(minuteOfDay(at(8, 30)), 510);
  assert.equal(minuteOfDay(at(23, 59)), 1439);
});
