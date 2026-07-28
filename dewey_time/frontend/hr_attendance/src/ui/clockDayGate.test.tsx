import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Source assertion: the empty-state gate must not fire for clock-based employees.
// A rendering test would need the whole App data stack; the gate is a single
// condition, so pin it at the source.
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

test("the no-schedule card is skipped for clock-based employees", () => {
  assert.match(
    app,
    /selectedEmployee\?\.has_shift_assignment === false &&\s*!selectedEmployee\?\.is_clock_based/
  );
});

test("WeekView and WeekDayView both receive isClockBased", () => {
  const matches = app.match(/isClockBased=\{/g) ?? [];
  assert.equal(matches.length, 2);
});

// The calendar payload carries is_clock_based too, so a lagging or failed employees
// fetch must not silently downgrade a clock day back to an off-shift day.
test("both call sites prefer the payload over the employees list", () => {
  const matches =
    app.match(/isClockBased=\{payload\.is_clock_based \?\? selectedEmployee\?\.is_clock_based\}/g) ??
    [];
  assert.equal(matches.length, 2);
});
