import assert from "node:assert/strict";
import test from "node:test";

import { dayFacts } from "@/miniapp/miniDay";
import { dayMark, type DayMark } from "@/miniapp/miniDayMark";
import type { Day } from "@/types/calendar";

/**
 * The mark is what an employee reads about their own day at a glance, so every
 * case here is written as the sentence it has to survive being read as.
 *
 * Fixed dates, never `new Date()`: half of these turn on where `now` sits
 * inside a shift, and a suite that passes in the morning and accuses somebody
 * in the evening is worse than no suite.
 */
const AUG = (day: number, hour = 9, min = 0) => new Date(2026, 7, day, hour, min);
const KEY = (day: number) => `2026-08-${String(day).padStart(2, "0")}`;

const SHIFT = {
  shift_assigned: true,
  start_time: "08:00:00",
  end_time: "17:00:00",
  lunch_start: "12:00:00",
  lunch_end: "13:00:00",
};

/** `count` punches out of a normal 4-punch day. 3 is the forgotten clock-out. */
function day(dayNum: number, count: number, extra: Partial<Day> = {}): Day {
  const k = KEY(dayNum);
  const all = [
    { time: `${k} 07:58:00`, log_type: "IN" },
    { time: `${k} 12:01:00`, log_type: "OUT" },
    { time: `${k} 12:58:00`, log_type: "IN" },
    { time: `${k} 17:06:00`, log_type: "OUT" },
  ].slice(0, count);
  const outs = all.filter((c) => c.log_type === "OUT");
  return {
    date: k,
    shift: SHIFT,
    holiday: null,
    leave: { on_leave: false },
    first_in: all.length ? all[0]!.time : null,
    last_out: outs.length ? outs[outs.length - 1]!.time : null,
    checkins: all,
    ...extra,
  } as unknown as Day;
}

/** Run the real pair, the way the sheet does. */
function mark(d: Day | undefined, date: Date, now: Date): DayMark {
  return dayMark(dayFacts(d, date, now), d, date, now);
}

// ---------------------------------------------------------------------------
// The present tense
// ---------------------------------------------------------------------------

test("today's open run is not an accusation", () => {
  // THE ONE THAT MATTERS MOST. At 09:00 on a rostered day there is one punch
  // and no matching out, because the person is at work. An earlier draft
  // marked that `incomplete` — an amber ring on a morning going perfectly
  // well, on the phone of the person it is about.
  assert.equal(mark(day(17, 1), AUG(17), AUG(17, 9, 0)), "none");
  assert.equal(mark(day(17, 3), AUG(17), AUG(17, 13, 30)), "none");
});

test("today with nothing recorded yet is not a missing day", () => {
  // 07:30 on an 08:00 shift. Nobody has arrived because it is not eight
  // o'clock.
  assert.equal(mark(day(17, 0), AUG(17), AUG(17, 7, 30)), "none");
});

test("today becomes judgeable once the rostered end has passed", () => {
  // 17:00 is the end. After it, the day is over and its record is final.
  assert.equal(mark(day(17, 0), AUG(17), AUG(17, 17, 30)), "missing");
  assert.equal(mark(day(17, 3), AUG(17), AUG(17, 17, 30)), "incomplete");
  assert.equal(mark(day(17, 4), AUG(17), AUG(17, 17, 30)), "complete");
});

test("a completed day today reads complete even mid-shift", () => {
  // Punched out at 17:06 but read at 13:00 — an odd fixture, but the record
  // IS whole, and withholding the reassuring mark would be the wrong caution.
  assert.equal(mark(day(17, 4), AUG(17), AUG(17, 13, 0)), "complete");
});

test("nothing is marked in the future — not even a day off", () => {
  // These showed hollow rings on next week's weekends: a row of noise
  // standing exactly where the eye scans for days that need attention.
  // Caught in a screenshot, not by a test, which is why this one exists.
  assert.equal(mark(day(20, 0), AUG(20), AUG(17, 12, 0)), "none");
  const futureOff = day(22, 0, { shift: { shift_assigned: false } } as Partial<Day>);
  assert.equal(mark(futureOff, AUG(22), AUG(17, 12, 0)), "none");
  const futureHoliday = day(21, 0, { holiday: { description: "Constitution Day" } } as Partial<Day>);
  assert.equal(mark(futureHoliday, AUG(21), AUG(17, 12, 0)), "none");
});

// ---------------------------------------------------------------------------
// Past days
// ---------------------------------------------------------------------------

test("pairing is by parity, the same rule the timeline and the bot use", () => {
  assert.equal(mark(day(10, 4), AUG(10), AUG(17, 12, 0)), "complete");
  assert.equal(mark(day(10, 2), AUG(10), AUG(17, 12, 0)), "complete");
  assert.equal(mark(day(10, 3), AUG(10), AUG(17, 12, 0)), "incomplete");
  assert.equal(mark(day(10, 1), AUG(10), AUG(17, 12, 0)), "incomplete");
});

test("one lone punch is incomplete, not missing", () => {
  // These are opposite problems and dayFacts cannot tell them apart: a single
  // IN with no OUT has no range, so its tone is "nothing" — the same tone a
  // day nobody came to gets. Keying the mark on tone called a forgotten
  // clock-out an absence. The count is the only thing that separates them.
  assert.equal(mark(day(10, 1), AUG(10), AUG(17, 12, 0)), "incomplete");
});

test("a rostered day with no punches at all is missing, not incomplete", () => {
  // Different things to go and fix: one is a forgotten tap, the other is a
  // day with no evidence anybody was there.
  assert.equal(mark(day(13, 0), AUG(13), AUG(17, 12, 0)), "missing");
});

test("an unrostered day with no punches is off, never missing", () => {
  // A Saturday is not an absence. Without this the grid accuses everybody of
  // two missing days a week, every week.
  const off = day(15, 0, { shift: { shift_assigned: false } } as Partial<Day>);
  assert.equal(mark(off, AUG(15), AUG(17, 12, 0)), "off");
});

test("a day the payload has nothing for is off, and does not crash", () => {
  assert.equal(mark(undefined, AUG(9), AUG(17, 12, 0)), "off");
});

// ---------------------------------------------------------------------------
// Leave and holidays outrank punches
// ---------------------------------------------------------------------------

test("leave and holidays outrank punches, matching dayFacts", () => {
  // Somebody who came in for an hour on a public holiday is still on a
  // holiday. The grid must not disagree with the heading the same day shows
  // when it is opened.
  const onLeave = day(11, 2, { leave: { on_leave: true, leave_type: "Annual Leave" } } as Partial<Day>);
  assert.equal(mark(onLeave, AUG(11), AUG(17, 12, 0)), "off");

  const holiday = day(12, 2, { holiday: { description: "Constitution Day" } } as Partial<Day>);
  assert.equal(mark(holiday, AUG(12), AUG(17, 12, 0)), "off");
});

test("a leave day with an odd punch count is still off, not incomplete", () => {
  const onLeave = day(11, 1, { leave: { on_leave: true, leave_type: "Sick Leave" } } as Partial<Day>);
  assert.equal(mark(onLeave, AUG(11), AUG(17, 12, 0)), "off");
});

// ---------------------------------------------------------------------------
// The union is closed
// ---------------------------------------------------------------------------

test("every mark this app can produce is one of the five", () => {
  // A sixth would render as an unstyled cell rather than fail, because the
  // class lookup in Mark is indexed by the union.
  const seen = new Set<DayMark>([
    mark(day(10, 4), AUG(10), AUG(17, 12, 0)),
    mark(day(10, 3), AUG(10), AUG(17, 12, 0)),
    mark(day(13, 0), AUG(13), AUG(17, 12, 0)),
    mark(day(15, 0, { shift: { shift_assigned: false } } as Partial<Day>), AUG(15), AUG(17, 12, 0)),
    mark(day(20, 0), AUG(20), AUG(17, 12, 0)),
  ]);
  assert.deepEqual(
    [...seen].sort(),
    ["complete", "incomplete", "missing", "none", "off"],
  );
});
