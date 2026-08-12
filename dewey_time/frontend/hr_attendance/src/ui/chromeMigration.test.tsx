import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`./${path}`, import.meta.url), "utf8");
}

test("WeeklySchedulePage uses dewey-ui's Page rather than a hand-rolled container", () => {
  const src = source("WeeklySchedulePage.tsx");
  assert.ok(src.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(
    !src.includes("max-w-7xl"),
    "hand-rolled max-w-7xl container should be gone — Page owns page insets",
  );
});

// savedNonce was a counter that faked a refetch because the mutation had no
// relationship to the read cache. invalidateQueries replaced it. If a counter
// like this reappears, the cache wiring has regressed.
test("WeeklySchedulePage has no manual-refetch counter", () => {
  const src = source("WeeklySchedulePage.tsx");
  assert.ok(!src.includes("savedNonce"), "savedNonce should be gone");
  assert.ok(!src.includes("refreshContext()"), "manual refreshContext() calls should be gone");
});

const SCHEDULE_MAINTENANCE_HOOK_FILES = [
  "../hooks/useWeeklySchedule.ts",
  "../hooks/useClearEmployeeSchedule.ts",
  "../hooks/useClearAllSchedules.ts",
  "../hooks/useClearSitePatterns.ts",
  "../hooks/useScheduleImport.ts",
];

// Clearing or (re)applying a schedule changes what the attendance week and
// coverage views show, so every write hook here has to invalidate all three
// families, not just the one it obviously touches — `useClearSitePatterns.ts`
// once invalidated all three, but only on the loop's clean-finish path,
// leaving the wipe's other exits (step-limit, network error) serving stale
// calendar/coverage data after rows were already deleted. Tasks 4-6 copy this
// exact three-line block into more files; pin it here so a future copy can't
// silently drop one of the three.
test("schedule/maintenance write hooks invalidate schedule, calendar, and coverage caches", () => {
  for (const path of SCHEDULE_MAINTENANCE_HOOK_FILES) {
    const src = source(path);
    for (const family of ["queryKeys.schedule.all", "queryKeys.calendar.all", "queryKeys.coverage.all"]) {
      assert.ok(src.includes(family), `${path} is missing an invalidation of ${family}`);
    }
  }
});

test("ScheduleImportPage uses dewey-ui's Page", () => {
  const src = readFileSync(
    new URL("./schedule-import/ScheduleImportPage.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(!src.includes("max-w-7xl"), "hand-rolled container should be gone");
});

test("CoverageRegisterPage uses dewey-ui's Page", () => {
  const src = readFileSync(
    new URL("./schedule-coverage/CoverageRegisterPage.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(!src.includes("max-w-7xl"), "hand-rolled container should be gone");
});

// /hr-attendance is the one route that never had a heading to convert, so —
// unlike the other three — it gets no PageHeader. Its nav tab already reads
// "Attendance" at every viewport, and a title costs ~40px above the week grid
// on the phone. An sr-only heading was considered and declined. Pin both the
// Section adoption and the absence of a title so neither drifts back.
test("App renders Section inside Page and adds no page title of its own", () => {
  const src = source("App.tsx");
  // The name says "inside Page", so assert Page too — the Section check alone
  // would stay green with <Page> deleted, under a name claiming otherwise.
  assert.ok(src.includes("<Page"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(src.includes("<Section"), "expected <Section> from @lolbikb/dewey-ui");
  assert.ok(!src.includes("<PageHeader"), "/hr-attendance must not render a PageHeader");
  assert.ok(!src.includes("<h1"), "/hr-attendance must not hand-roll a page title either");
});
