import assert from "node:assert/strict";
import test from "node:test";

import type { Checkin } from "@/types/calendar";

import { detectObservedLunch } from "./lunchDetection";

function punch(time: string): Checkin {
  return { time };
}

const shift = {
  shift_assigned: true,
  lunch_start: "12:00",
  lunch_end: "13:00",
  grace_minutes: 15,
};

test("detectObservedLunch finds first plausible OUT→IN in lunch window", () => {
  const checkins = [
    punch("2026-05-28 08:00:00"),
    punch("2026-05-28 12:05:00"),
    punch("2026-05-28 12:50:00"),
    punch("2026-05-28 17:00:00"),
  ];

  const observed = detectObservedLunch(checkins, shift, "2026-05-28");
  assert.ok(observed);
  assert.equal(observed!.minutes, 45);
  assert.equal(observed!.late_return, false);
});

test("detectObservedLunch returns null when no pair in window", () => {
  const checkins = [
    punch("2026-05-28 08:00:00"),
    punch("2026-05-28 11:45:00"),
    punch("2026-05-28 13:20:00"),
    punch("2026-05-28 17:00:00"),
  ];

  const observed = detectObservedLunch(checkins, shift, "2026-05-28");
  assert.equal(observed, null);
});

test("detectObservedLunch marks late return after lunch end + grace", () => {
  const checkins = [
    punch("2026-05-28 08:00:00"),
    punch("2026-05-28 12:05:00"),
    punch("2026-05-28 13:20:00"),
    punch("2026-05-28 17:00:00"),
  ];

  const observed = detectObservedLunch(checkins, shift, "2026-05-28");
  assert.ok(observed);
  assert.equal(observed!.late_return, true);
});
