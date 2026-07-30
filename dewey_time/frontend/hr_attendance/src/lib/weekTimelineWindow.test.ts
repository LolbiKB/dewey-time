import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectShiftBounds,
  collectWideningMinutes,
  resolveWeekTimelineWindow,
} from "./weekTimelineWindow";
import type { Day } from "../types/calendar";

const D = (iso: string) => new Date(`${iso}T00:00:00`);
const WEEK = [D("2026-07-13")];

/** One day, with an optional assigned shift and optional bare punches. */
function day(
  date: string,
  shift: { start: string; end: string } | null,
  punches: string[] = [],
): Day {
  return {
    date,
    shift: shift
      ? { shift_assigned: true, start_time: shift.start, end_time: shift.end }
      : { shift_assigned: false },
    checkins: punches.map((t) => ({ time: `${date} ${t}` })),
  } as unknown as Day;
}

function windowOf(
  shift: { start: string; end: string } | null,
  punches: string[] = [],
): { startMin: number; endMin: number; spanMinutes: number } {
  const date = "2026-07-13";
  return resolveWeekTimelineWindow(WEEK, new Map([[date, day(date, shift, punches)]]));
}

const H = (h: number) => h * 60;

test("collectShiftBounds takes shift start/end only, and skips overnight", () => {
  const date = "2026-07-13";
  const normal = new Map([[date, day(date, { start: "08:00:00", end: "17:00:00" }, ["09:15:00"])]]);
  assert.deepEqual(collectShiftBounds(WEEK, normal), [H(8), H(17)], "no punch minutes here");

  const overnight = new Map([[date, day(date, { start: "22:00:00", end: "06:00:00" })]]);
  assert.deepEqual(collectShiftBounds(WEEK, overnight), [], "end <= start is excluded");
});

test("collectWideningMinutes takes observed minutes only, never shift bounds", () => {
  const date = "2026-07-13";
  const days = new Map([[date, day(date, { start: "08:00:00", end: "17:00:00" }, ["09:15:00"])]]);
  const mins = collectWideningMinutes(WEEK, days);
  assert.ok(mins.includes(H(9) + 15), "includes the checkin");
  assert.ok(!mins.includes(H(8)), "must NOT include shift start — that is collectShiftBounds' job");
  assert.ok(!mins.includes(H(17)), "must NOT include shift end");
});

test("an 08:00-17:00 week yields 07:00-18:00", () => {
  const w = windowOf({ start: "08:00:00", end: "17:00:00" });
  assert.equal(w.startMin, H(7));
  assert.equal(w.endMin, H(18));
  assert.equal(w.spanMinutes, H(11));
});

test("no shift assigned falls back to 06:00-20:00", () => {
  const w = windowOf(null);
  assert.equal(w.startMin, H(6));
  assert.equal(w.endMin, H(20));
  assert.equal(w.spanMinutes, H(14));
  assert.equal(
    (w as Record<string, unknown>).canvasHeightPct,
    undefined,
    "no canvas height: the axis is scaled to fit, never scrolled",
  );
});

test("punches inside the fallback do not move it", () => {
  const w = windowOf(null, ["09:15:00", "16:40:00"]);
  assert.equal(w.startMin, H(6));
  assert.equal(w.endMin, H(20));
});

test("an early punch widens the axis by whole hours, it does not re-derive it", () => {
  const w = windowOf({ start: "08:00:00", end: "17:00:00" }, ["05:20:00"]);
  assert.equal(w.startMin, H(5), "05:20 floors to 05:00");
  assert.equal(w.endMin, H(18), "the other end is untouched");
});

test("a late punch widens to midnight and never past it", () => {
  const w = windowOf({ start: "08:00:00", end: "17:00:00" }, ["23:30:00"]);
  assert.equal(w.startMin, H(7));
  assert.equal(w.endMin, H(24));
});

test("a just-after-midnight punch clamps at 00:00, never negative", () => {
  const w = windowOf({ start: "08:00:00", end: "17:00:00" }, ["00:05:00"]);
  assert.equal(w.startMin, 0);
});

test("an overnight shift falls back rather than stretching the axis to 06:00-22:00", () => {
  // The whole reason collectShiftBounds and collectWideningMinutes are separate:
  // fold the bounds back into the widening pass and this returns 06:00-22:00.
  const w = windowOf({ start: "22:00:00", end: "06:00:00" });
  assert.equal(w.startMin, H(6));
  assert.equal(w.endMin, H(20));
});

test("a mixed week spans every assigned shift", () => {
  const days = new Map([
    ["2026-07-13", day("2026-07-13", { start: "06:00:00", end: "14:00:00" })],
    ["2026-07-14", day("2026-07-14", { start: "12:00:00", end: "20:00:00" })],
  ]);
  const w = resolveWeekTimelineWindow([D("2026-07-13"), D("2026-07-14")], days);
  assert.equal(w.startMin, H(5));
  assert.equal(w.endMin, H(21));
});
