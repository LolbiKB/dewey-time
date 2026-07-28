import assert from "node:assert/strict";
import test from "node:test";

import { clockDayMinutes, formatClockDayTotal, isClockDay, netWorkedMinutes } from "./clockDay";

const scheduled = { shift: { shift_assigned: true } } as never;
const unscheduled = { shift: { shift_assigned: false } } as never;

test("isClockDay requires both clock-based employee and no shift", () => {
  assert.equal(isClockDay(true, unscheduled), true);
  assert.equal(isClockDay(true, scheduled), false);
  assert.equal(isClockDay(false, unscheduled), false);
  assert.equal(isClockDay(undefined, unscheduled), false);
});

test("isClockDay treats a missing day as unscheduled", () => {
  assert.equal(isClockDay(true, undefined), true);
});

test("netWorkedMinutes sums segments and ignores nulls", () => {
  assert.equal(netWorkedMinutes([{ minutes: 120 }, { minutes: 180 }]), 300);
  assert.equal(netWorkedMinutes([{ minutes: 120 }, { minutes: null }]), 120);
});

test("netWorkedMinutes returns null when there are no segments", () => {
  assert.equal(netWorkedMinutes([]), null);
});

test("clockDayMinutes prefers net worked", () => {
  assert.deepEqual(clockDayMinutes([{ minutes: 120 }], 480), {
    minutes: 120,
    unverified: false,
  });
});

test("clockDayMinutes falls back to gross when segments are empty", () => {
  // deriveSegments drops runs with no device branch — never render 0h there.
  assert.deepEqual(clockDayMinutes([], 480), { minutes: 480, unverified: true });
});

test("clockDayMinutes returns null when there is nothing at all", () => {
  assert.deepEqual(clockDayMinutes([], null), { minutes: null, unverified: false });
});

test("formatClockDayTotal renders hours and minutes", () => {
  assert.equal(formatClockDayTotal({ minutes: 462, unverified: false }), "7h 42m");
  assert.equal(formatClockDayTotal({ minutes: 120, unverified: false }), "2h");
  assert.equal(formatClockDayTotal({ minutes: 45, unverified: false }), "45m");
});

test("formatClockDayTotal marks an unverified fallback", () => {
  assert.equal(formatClockDayTotal({ minutes: 480, unverified: true }), "~8h");
});

test("formatClockDayTotal renders nothing when there is no figure", () => {
  assert.equal(formatClockDayTotal({ minutes: null, unverified: false }), null);
});
