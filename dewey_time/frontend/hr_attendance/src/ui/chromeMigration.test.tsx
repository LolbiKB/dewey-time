import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`./${path}`, import.meta.url), "utf8");
}

const MAIN_URL = new URL("../main.tsx", import.meta.url);

/**
 * The file with its comments removed, so prose ABOUT a class is not read as
 * the class.
 *
 * FlagQueuePage carries two comments recounting the max-w-7xl cap dewey-ui
 * 2.0.0 dropped — the history that makes the rule below make sense. A raw
 * substring scan reads those as the violation they explain, which would leave
 * the only ways to keep this guard green being to delete the explanation or to
 * stop scanning. String and template literals are stepped over intact so a
 * `//` inside one (a URL, say) cannot swallow the rest of a line.
 */
function withoutComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    const quote = src[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      out += src[i++];
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i++] === quote) break;
      }
      continue;
    }
    out += src[i++];
  }
  return out;
}

/**
 * Every component `main.tsx` mounts at a `path`, resolved to the file that
 * defines it.
 *
 * Read out of the router rather than off a filename glob. A glob over
 * `*Page.tsx` is a naming convention, not the class of routed surfaces: it
 * misses `App.tsx` (which serves /hr-attendance) and it would miss the next
 * page whose author picked any other name — which is exactly the escape hatch
 * this guard exists to close.
 *
 * The layout route is skipped because it carries no `path`: `HrAppShell` wraps
 * pages, it is not one. `Navigate` is skipped because a redirect renders no
 * surface of its own.
 */
function routedPages(): { name: string; url: URL }[] {
  const main = readFileSync(MAIN_URL, "utf8");

  const specifiers = new Map<string, string>();
  for (const [, names, from] of main.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    for (const clause of names.split(",")) {
      const local = clause.trim().split(/\s+as\s+/).pop();
      if (local) specifiers.set(local, from);
    }
  }

  const pages: { name: string; url: URL }[] = [];
  for (const [, attrs, name] of main.matchAll(/<Route\b([^>]*?)element=\{<([A-Za-z_$][\w$]*)/g)) {
    if (!attrs.includes("path=")) continue;
    if (name === "Navigate") continue;
    const from = specifiers.get(name);
    // Loud rather than skipped: a routed component this scan cannot resolve is
    // a page silently escaping the guard, which is the whole defect again.
    assert.ok(from, `main.tsx routes <${name} /> but no import in main.tsx names it`);
    pages.push({ name, url: new URL(`${from}.tsx`, MAIN_URL) });
  }
  return pages;
}

// Was "WeeklySchedulePage uses <Page>" — a per-file assertion. The biometrics
// page then shipped as the only routed page WITHOUT <Page>, hand-rolling px-4
// against Page's px-5 sm:px-8, so the nav it shared with its sibling shifted
// 16px between tabs. The guard existed; it just named one page instead of the
// class. This is the generalised form: it reads the router, so a page cannot
// opt out by being new, by being named something else, or by living in a
// subdirectory.
test("every routed page uses dewey-ui's Page rather than a hand-rolled container", () => {
  const routed = routedPages();

  // A precondition, not a claim: with a broken scan the loop below would pass
  // over an empty list, and a guard that checks nothing is worse than none.
  assert.ok(routed.length >= 5, `expected to find the routed pages, saw ${routed.length}`);

  for (const { name, url } of routed) {
    const src = withoutComments(readFileSync(url, "utf8"));
    // The import too, not just the tag: a locally defined `Page` would satisfy
    // the tag while hand-rolling exactly the container this forbids.
    assert.match(
      src,
      /import\s*\{[^}]*\bPage\b[^}]*\}\s*from\s*"@lolbikb\/dewey-ui"/,
      `${name} must import Page from @lolbikb/dewey-ui`,
    );
    assert.match(src, /<Page[\s>]/, `${name} must render dewey-ui's <Page>`);
    assert.ok(!src.includes("max-w-7xl"), `${name} must not hand-roll a container`);
  }
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

// The per-page "ScheduleImportPage uses <Page>" and "CoverageRegisterPage uses
// <Page>" tests that stood here are gone: the routed-page test above makes the
// same two assertions about the same two files, and about every other routed
// page as well. Keeping them would restate the naming habit the generalisation
// exists to stop relying on.

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
