import assert from "node:assert/strict";
import test from "node:test";

import type { ShiftContext } from "@/types/calendar";

import {
  clipScheduledBandToFuture,
  deriveMissingExpectedIntervals,
  deriveScheduledFutureIntervals,
  missingExpectedMaxEndMin,
  presentHourStartMin,
} from "./shiftTimeline";

const shift: ShiftContext = {
  shift_assigned: true,
  start_time: "08:00:00",
  end_time: "17:00:00",
  lunch_start: "12:00:00",
  lunch_end: "13:00:00",
};

test("missing expected covers shift start before first segment and end after last", () => {
  const missing = deriveMissingExpectedIntervals(shift, [
    { startMin: 9 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 16 * 60 },
  ]);

  assert.equal(missing.length, 2);
  assert.deepEqual(
    missing.map((part) => [part.startMin, part.endMin]),
    [
      [8 * 60, 9 * 60],
      [16 * 60, 17 * 60],
    ]
  );
});

test("missing expected excludes mid-day away between segments", () => {
  const missing = deriveMissingExpectedIntervals(
    shift,
    [
      { startMin: 8 * 60, endMin: 11 * 60 },
      { startMin: 13 * 60, endMin: 17 * 60 },
    ],
    { excludeIntervals: [{ startMin: 11 * 60, endMin: 12 * 60 }] }
  );

  assert.equal(missing.length, 0);
});

test("missing expected excludes scheduled lunch window", () => {
  const missing = deriveMissingExpectedIntervals(shift, [
    { startMin: 8 * 60, endMin: 11 * 60 },
    { startMin: 13 * 60, endMin: 17 * 60 },
  ]);

  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0], {
    startMin: 11 * 60,
    endMin: 12 * 60,
    minutes: 60,
  });
});

test("no missing expected when segments cover full shift blocks", () => {
  const missing = deriveMissingExpectedIntervals(shift, [
    { startMin: 8 * 60, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 17 * 60 },
  ]);

  assert.equal(missing.length, 0);
});

test("missing expected is full obligation when no segments", () => {
  const missing = deriveMissingExpectedIntervals(shift, []);

  assert.equal(missing.length, 2);
  assert.deepEqual(
    missing.map((part) => [part.startMin, part.endMin]),
    [
      [8 * 60, 12 * 60],
      [13 * 60, 17 * 60],
    ]
  );
});

test("missing expected skipped when shift not assigned", () => {
  assert.equal(deriveMissingExpectedIntervals({ shift_assigned: false }, []).length, 0);
});

test("missing expected clips to maxEndMin on today", () => {
  const missing = deriveMissingExpectedIntervals(
    shift,
    [{ startMin: 8 * 60, endMin: 9 * 60 }],
    { maxEndMin: 10 * 60 }
  );

  assert.deepEqual(missing, [{ startMin: 9 * 60, endMin: 10 * 60, minutes: 60 }]);
});

test("missing expected clips morning gap to present hour", () => {
  const missing = deriveMissingExpectedIntervals(shift, [], { maxEndMin: 10 * 60 });

  assert.deepEqual(
    missing.map((part) => [part.startMin, part.endMin]),
    [
      [8 * 60, 10 * 60],
    ]
  );
});

test("missingExpectedMaxEndMin returns null for past days", () => {
  assert.equal(missingExpectedMaxEndMin("2026-05-01", new Date("2026-05-28T10:00:00")), null);
});

test("missingExpectedMaxEndMin returns present hour start for today", () => {
  const now = new Date("2026-05-28T10:30:00");
  assert.equal(missingExpectedMaxEndMin("2026-05-28", now), 10 * 60);
});

test("missingExpectedMaxEndMin returns 0 for future days", () => {
  assert.equal(missingExpectedMaxEndMin("2026-05-29", new Date("2026-05-28T10:00:00")), 0);
});

test("clipScheduledBandToFuture returns full band on future days", () => {
  const band = clipScheduledBandToFuture(
    "2026-05-29",
    8 * 60,
    17 * 60,
    new Date("2026-05-28T10:30:00")
  );
  assert.deepEqual(band, { startMin: 8 * 60, endMin: 17 * 60 });
});

test("clipScheduledBandToFuture hides past days", () => {
  assert.equal(
    clipScheduledBandToFuture("2026-05-27", 8 * 60, 17 * 60, new Date("2026-05-28T10:30:00")),
    null
  );
});

test("clipScheduledBandToFuture on today starts at present hour through shift end", () => {
  const now = new Date("2026-05-28T10:37:00");
  assert.equal(presentHourStartMin(now), 10 * 60);
  const band = clipScheduledBandToFuture("2026-05-28", 8 * 60, 17 * 60, now);
  assert.deepEqual(band, { startMin: 10 * 60, endMin: 17 * 60 });
});

test("clipScheduledBandToFuture on today is null after shift ends", () => {
  assert.equal(
    clipScheduledBandToFuture(
      "2026-05-28",
      8 * 60,
      17 * 60,
      new Date("2026-05-28T18:00:00")
    ),
    null
  );
});

test("missing expected and scheduled future do not overlap on today", () => {
  const now = new Date("2026-05-28T10:37:00");
  const dateKey = "2026-05-28";
  const maxEndMin = missingExpectedMaxEndMin(dateKey, now);
  const scheduled = deriveScheduledFutureIntervals(shift, dateKey, now);
  assert.ok(maxEndMin != null && scheduled.length > 0);

  const missing = deriveMissingExpectedIntervals(shift, [], {
    maxEndMin,
    excludeIntervals: scheduled.map((part) => ({
      startMin: part.startMin,
      endMin: part.endMin,
    })),
  });

  for (const part of missing) {
    for (const future of scheduled) {
      assert.ok(part.endMin <= future.startMin || part.startMin >= future.endMin);
    }
  }
});

test("scheduled future excludes lunch and splits around it on today", () => {
  const now = new Date("2026-05-28T10:37:00");
  const scheduled = deriveScheduledFutureIntervals(shift, "2026-05-28", now);

  assert.deepEqual(
    scheduled.map((part) => [part.startMin, part.endMin]),
    [
      [10 * 60, 12 * 60],
      [13 * 60, 17 * 60],
    ]
  );
});

test("scheduled future is full work blocks on future days", () => {
  const scheduled = deriveScheduledFutureIntervals(
    shift,
    "2026-05-29",
    new Date("2026-05-28T10:30:00")
  );

  assert.deepEqual(
    scheduled.map((part) => [part.startMin, part.endMin]),
    [
      [8 * 60, 12 * 60],
      [13 * 60, 17 * 60],
    ]
  );
});
