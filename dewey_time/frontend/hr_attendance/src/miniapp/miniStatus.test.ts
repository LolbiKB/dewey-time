import assert from "node:assert/strict";
import test from "node:test";

import {
  isLive, miniStatus, minuteOfDay, openRunStartedAt, statusKey,
} from "@/miniapp/miniStatus";
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

test("an unlabelled punch stream follows the receipt's walk, not an assumption", () => {
  // Employee Checkin's `log_type` is an OPTIONAL Select, and in production
  // the bridge writes none at all -- a device that reports only a timestamp
  // leaves it empty on every row. The chip reads the same causal walk as the
  // Telegram receipt (`liveWalk`): first punch is an arrival, a blank punch
  // closes the open arrival, a same-branch return is the lunch-comeback.
  const blank = (time: string): Punch => [time, "" as never];
  const home = day([blank("07:58:00"), blank("12:01:00"), blank("12:58:00"), blank("17:06:00")]);
  assert.notEqual(miniStatus(home, DAY, at(17, 30)).kind, "in", "four punches is two closed pairs");

  assert.equal(miniStatus(day([blank("07:58:00")]), DAY, at(9)).kind, "in");
});

test("back from lunch on a blank feed reads In, like the message that just said so", () => {
  // 07:58 / 12:01 / 12:58, no labels, 14:00. The person is at their desk.
  // The receipt called the 12:58 punch "Checked in" (the lunch-comeback rule)
  // and the canvas below the chip draws a growing on-site band from 12:58 --
  // so a chip reading anything else contradicts both. Retrospective pairRun
  // would close this day at 12:01 (it calls the last punch of a run a
  // departure, which mid-afternoon is a guess about punches that have not
  // happened yet); the chip must read the LIVE walk instead.
  const blank = (time: string): Punch => [time, "" as never];
  const working = day([blank("07:58:00"), blank("12:01:00"), blank("12:58:00")]);
  const status = miniStatus(working, DAY, at(14));
  assert.equal(status.kind, "in");
  assert.equal(isLive(status), true);
});

test("a lone unlabelled punch at a second branch is not a claim either way", () => {
  // THE AUDIT'S COVER-SHIFT SHAPE, as the shared fixture carries it
  // (departure_through_another_campus): a punch alone in a fresh branch run
  // is indistinguishable from a departure through that campus's exit device.
  // The receipt sent a NEUTRAL message for it -- no verb -- so the chip says
  // nothing rather than "In" (the old whole-day-parity answer on any odd
  // count) or "Checked out" (a guess in the other direction).
  const blank = (time: string, branch: string): Punch => [time, "" as never, branch];
  const threePunch = day([
    blank("08:00:00", "DIS Iconic"),
    blank("17:00:00", "DIS Iconic"),
    blank("17:04:00", "DIU"),
  ]);
  assert.equal(miniStatus(threePunch, DAY, at(19)).kind, "none");

  const twoPunch = day([blank("08:00:00", "DIS Iconic"), blank("17:00:00", "DIS Toul Kork")]);
  assert.equal(miniStatus(twoPunch, DAY, at(19)).kind, "none");
});

test("a branchless first punch is a claim without a count", () => {
  // An unmapped device's lone morning punch: the receipt says "Checked in"
  // (the day's first punch is an arrival) but opens nothing for pairing --
  // a branchless punch can never pair. The chip mirrors both halves: it says
  // "in", and openRunStartedAt refuses, so no live figure rides on a punch
  // the timeline will draw as a rogue dot. DELIBERATE split, pinned so a
  // future edit has to face it rather than trip over it.
  const day = {
    date: "2026-08-19",
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    checkins: [{ time: "2026-08-19 08:00:00", log_type: "" }],
  } as unknown as Day;

  assert.equal(miniStatus(day, new Date(2026, 7, 19), new Date(2026, 7, 19, 10, 0)).kind, "in");
  assert.equal(openRunStartedAt(day), null);
});

test("a bounced tap is a non-event, not a departure", () => {
  // Two blank punches five seconds apart at one device: one physical visit,
  // read twice. The receipt drops the bounce; the state stays the 08:00
  // arrival. Whole-day parity saw "two punches, even" and said checked out.
  const punches: Punch[] = [["08:00:00", "" as never], ["08:00:05", "" as never]];
  assert.equal(miniStatus(day(punches), DAY, at(10)).kind, "in");
});

test("a duplicated arrival does not read as having left", () => {
  // Two labelled INs, no OUT: the second is noise, not a departure. The
  // walk keeps the first arrival open and the verb stays IN.
  const punches: Punch[] = [["08:00:00", "IN"], ["09:00:00", "IN"]];
  const status = miniStatus(day(punches), DAY, at(10));
  assert.equal(status.kind, "in");
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

test("a cover shift's closing punch at a second branch is not an arrival", () => {
  // THE DEFECT: the departure is alone in its own branch run, and a one-punch
  // run was inferred to be an arrival by position. At 19:00 the app read
  // "2h so far", live, counting from the moment the person went home -- beside
  // a chip that said "Checked out". The walk refuses that punch a verb, so
  // nothing live rides on it.
  const day = {
    date: "2026-08-19",
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    checkins: [
      { time: "2026-08-19 08:00:00", log_type: "", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 17:00:00", log_type: "", custom_device_branch: "DIS Toul Kork" },
    ],
  } as unknown as Day;

  assert.equal(openRunStartedAt(day), null);
});

test("an unmapped device does not put everyone permanently at work", () => {
  // Punches with no branch are never grouped, so each is its own run.
  const day = {
    date: "2026-08-19",
    checkins: [
      { time: "2026-08-19 08:00:00", log_type: "" },
      { time: "2026-08-19 17:00:00", log_type: "" },
    ],
  } as unknown as Day;

  assert.equal(openRunStartedAt(day), null);
});

test("a punch that says IN is still an open run", () => {
  // The counterweight: the fix must not stop reporting somebody who IS at work.
  const day = {
    date: "2026-08-19",
    checkins: [
      { time: "2026-08-19 08:00:00", log_type: "IN", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;

  assert.equal(openRunStartedAt(day), "2026-08-19 08:00:00");
});

test("a lone unlabelled arrival is still an open run", () => {
  // The case that must keep working: a device that labels nothing, one punch
  // this morning, nobody home yet. The day's FIRST punch is an arrival in the
  // walk's book -- the one blank punch whose direction is honestly callable.
  const day = {
    date: "2026-08-19",
    checkins: [
      { time: "2026-08-19 08:00:00", log_type: "", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;

  assert.equal(openRunStartedAt(day), "2026-08-19 08:00:00");
});

test("the lunch comeback re-opens the run, so the afternoon counts", () => {
  // 07:58 / 12:01 / 12:58 blank. Retrospective pairRun closes this day at
  // 12:01 and calls 12:58 a stray -- which froze the "so far" figure at four
  // hours for the whole afternoon. The walk's lunch-comeback rule re-opens at
  // 12:58, the same moment the canvas starts its on-site band.
  const day = {
    date: "2026-08-19",
    checkins: [
      { time: "2026-08-19 07:58:00", log_type: "", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 12:01:00", log_type: "", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 12:58:00", log_type: "", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;

  assert.equal(openRunStartedAt(day), "2026-08-19 12:58:00");
});

test("an odd day count cannot re-open a fresh-run departure", () => {
  // Four paired punches at the home branch, then one blank punch at a second
  // campus on the way out: FIVE punches. The old gate fell back to WHOLE-DAY
  // parity for the unlabelled opener, so odd meant "open" and the so-far
  // figure climbed all night from the moment the person went home. The walk
  // refuses that punch a verb, so nothing live may ride on it.
  const day = {
    date: "2026-08-19",
    checkins: [
      { time: "2026-08-19 08:00:00", log_type: "", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 12:00:00", log_type: "", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 13:00:00", log_type: "", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 17:00:00", log_type: "", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 17:04:00", log_type: "", custom_device_branch: "DIU" },
    ],
  } as unknown as Day;

  assert.equal(openRunStartedAt(day), null);
});

test("a repeated labelled arrival does not move the open moment", () => {
  // Issue #191: the person got there at 08:00; the 09:00 IN is a duplicate.
  // Counting from the later punch would quietly dock them an hour.
  const day = {
    date: "2026-08-19",
    checkins: [
      { time: "2026-08-19 08:00:00", log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 09:00:00", log_type: "IN", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;

  assert.equal(openRunStartedAt(day), "2026-08-19 08:00:00");
});
