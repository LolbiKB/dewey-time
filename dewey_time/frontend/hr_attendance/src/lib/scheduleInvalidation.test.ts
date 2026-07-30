import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HOOKS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "hooks");

// Lives in src/lib/, not src/hooks/, deliberately: test:web globs
// src/lib/*.test.ts and src/ui/*.test.tsx and NOTHING else — a test placed
// beside the hooks it covers silently never runs while the suite reports green.

/** Every mutation that changes an employee's schedule. */
const SCHEDULE_MUTATIONS = [
  "useWeeklySchedule.ts",
  "useClearEmployeeSchedule.ts",
  "useClearAllSchedules.ts",
  "useClearSitePatterns.ts",
  "useScheduleImport.ts",
];

test("every schedule mutation invalidates the employees list", () => {
  // list_calendar_employees carries has_shift_assignment, schedule_min/max_date
  // and shift_schedule_assignment — all changed by these mutations. staleTime:0
  // masks it across a route change but not within a mount, and the schedule and
  // import pages keep the picker mounted across apply/clear/import, so a
  // just-cleared employee kept sorting under "assigned" and kept reporting a
  // schedule on file for the life of the mount.
  for (const file of SCHEDULE_MUTATIONS) {
    const src = readFileSync(resolve(HOOKS, file), "utf8");
    assert.match(
      src,
      /invalidateQueries\(\{ queryKey: queryKeys\.employees\.all \}\)/,
      `${file} must invalidate queryKeys.employees.all`,
    );
  }
});

test("they also invalidate the calendar, which renders the flags they change", () => {
  for (const file of SCHEDULE_MUTATIONS) {
    const src = readFileSync(resolve(HOOKS, file), "utf8");
    assert.match(src, /queryKeys\.calendar\.all/, `${file} must invalidate the calendar`);
  }
});
