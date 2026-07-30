import { test } from "node:test";
import assert from "node:assert/strict";

import { plannedBlocks } from "./plannedBlocks";
import type { WeekDaySchedule } from "./weekSchedule";

const H = (h: number) => h * 60;

function day(over: Partial<WeekDaySchedule>): WeekDaySchedule {
  return {
    date: "2026-07-27",
    weekday: "Mon",
    weekdayLong: "Monday",
    dayNum: "27",
    monthLabel: "Jul",
    shift: { shift_assigned: true },
    assigned: true,
    ...over,
  } as WeekDaySchedule;
}

test("an interior lunch splits the shift into two blocks", () => {
  assert.deepEqual(
    plannedBlocks(day({ startMin: H(8), endMin: H(17), lunchStartMin: H(12), lunchEndMin: H(13) })),
    [
      { startMin: H(8), endMin: H(12) },
      { startMin: H(13), endMin: H(17) },
    ],
  );
});

test("no lunch means one block", () => {
  assert.deepEqual(plannedBlocks(day({ startMin: H(8), endMin: H(12) })), [
    { startMin: H(8), endMin: H(12) },
  ]);
});

test("a lunch touching either edge does not create a zero-width fragment", () => {
  const atStart = plannedBlocks(
    day({ startMin: H(8), endMin: H(17), lunchStartMin: H(8), lunchEndMin: H(9) }),
  );
  assert.deepEqual(atStart, [{ startMin: H(8), endMin: H(17) }]);

  const atEnd = plannedBlocks(
    day({ startMin: H(8), endMin: H(17), lunchStartMin: H(16), lunchEndMin: H(17) }),
  );
  assert.deepEqual(atEnd, [{ startMin: H(8), endMin: H(17) }]);
});

test("an inverted or zero-length lunch is ignored", () => {
  assert.deepEqual(
    plannedBlocks(day({ startMin: H(8), endMin: H(17), lunchStartMin: H(13), lunchEndMin: H(12) })),
    [{ startMin: H(8), endMin: H(17) }],
  );
  assert.deepEqual(
    plannedBlocks(day({ startMin: H(8), endMin: H(17), lunchStartMin: H(12), lunchEndMin: H(12) })),
    [{ startMin: H(8), endMin: H(17) }],
  );
});

test("a lunch that fully engulfs the shift is ignored, not clipped to nothing", () => {
  assert.deepEqual(
    plannedBlocks(day({ startMin: H(8), endMin: H(17), lunchStartMin: H(7), lunchEndMin: H(18) })),
    [{ startMin: H(8), endMin: H(17) }],
  );
});

test("a lunch entirely outside the shift is ignored", () => {
  assert.deepEqual(
    plannedBlocks(day({ startMin: H(8), endMin: H(17), lunchStartMin: H(18), lunchEndMin: H(19) })),
    [{ startMin: H(8), endMin: H(17) }],
  );
});

test("an unassigned day has no blocks", () => {
  assert.deepEqual(plannedBlocks(day({ assigned: false })), []);
});

test("a day missing its bounds has no blocks", () => {
  assert.deepEqual(plannedBlocks(day({ startMin: undefined, endMin: undefined })), []);
});

test("an overnight-style inverted shift has no blocks", () => {
  // Minute-of-day cannot express 22:00->06:00 as a range; parseShiftTimeToMinutes
  // (weekSchedule.ts) has no midnight wrap, so this is a real, reachable input —
  // not a theoretical one. Same overnight exclusion as weekTimelineWindow.ts's
  // collectShiftBounds (end <= start), which drops rather than clips it.
  assert.deepEqual(plannedBlocks(day({ startMin: H(22), endMin: H(6) })), []);
});

test("a zero-length shift has no blocks", () => {
  assert.deepEqual(plannedBlocks(day({ startMin: H(9), endMin: H(9) })), []);
});
