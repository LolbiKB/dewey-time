import assert from "node:assert/strict";
import test from "node:test";

import {
  bucketByWeeklyHours,
  roundMinutesToHalfHour,
  type CoverageAssignedEmployee,
} from "@/lib/scheduleCoverage";

function emp(
  id: string,
  weekly_minutes: number,
  employee_name = id,
): CoverageAssignedEmployee {
  return { id, employee_name, weekly_minutes };
}

test("roundMinutesToHalfHour rounds to the nearest 30", () => {
  assert.equal(roundMinutesToHalfHour(2400), 2400); // exact 40h
  assert.equal(roundMinutesToHalfHour(2410), 2400); // 40h10 -> down
  assert.equal(roundMinutesToHalfHour(2420), 2430); // 40h20 -> up
  assert.equal(roundMinutesToHalfHour(1207), 1200); // 20h07 -> down
});

test("roundMinutesToHalfHour rounds an exact 15-min half up", () => {
  assert.equal(roundMinutesToHalfHour(2415), 2430); // 40h15 -> half rounds up
});

test("roundMinutesToHalfHour guards bad input to 0", () => {
  assert.equal(roundMinutesToHalfHour(0), 0);
  assert.equal(roundMinutesToHalfHour(-30), 0);
  assert.equal(roundMinutesToHalfHour(Number.NaN), 0);
});

test("bucketByWeeklyHours groups employees by rounded weekly hours, desc", () => {
  const buckets = bucketByWeeklyHours([
    emp("a", 2400), // 40h
    emp("b", 2405), // -> 40h
    emp("c", 1200), // 20h
    emp("d", 2250), // 37h30
  ]);

  assert.deepEqual(
    buckets.map((b) => ({ minutes: b.minutes, label: b.label, n: b.employees.length })),
    [
      { minutes: 2400, label: "40h", n: 2 },
      { minutes: 2250, label: "37h 30m", n: 1 },
      { minutes: 1200, label: "20h", n: 1 },
    ],
  );
});

test("bucketByWeeklyHours sorts employees within a bucket by name", () => {
  const [bucket] = bucketByWeeklyHours([emp("z", 2400, "Zoe"), emp("a", 2400, "Ana")]);
  assert.deepEqual(
    bucket.employees.map((e) => e.id),
    ["a", "z"],
  );
});

test("bucketByWeeklyHours puts unresolved (0-min) employees in a trailing bucket", () => {
  const buckets = bucketByWeeklyHours([emp("a", 2400), emp("x", 0)]);
  const last = buckets[buckets.length - 1];
  assert.equal(last.minutes, 0);
  assert.equal(last.label, "No resolved hours");
  assert.deepEqual(last.employees.map((e) => e.id), ["x"]);
});

test("bucketByWeeklyHours returns [] for no employees", () => {
  assert.deepEqual(bucketByWeeklyHours([]), []);
});
