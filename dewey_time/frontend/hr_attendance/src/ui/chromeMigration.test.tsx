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
 *
 * An apostrophe in JSX TEXT (`don't`) is read here as opening a string, so
 * everything up to the next quote is copied through unstripped. That errs in
 * the safe direction — this can only ever preserve MORE source than a real
 * parser would, never hide a class from the assertions below.
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
 * Every `<Route …>` opening tag in the source, attributes and all.
 *
 * Walked rather than matched with `/<Route\b([^>]*?)\/?>/`, because a Route's
 * attributes contain `>` characters of their own: `element={<Navigate … />}`
 * closes a nested tag inside the braces. A `[^>]` scan therefore ends the tag
 * at that nested `/>` and returns only the text BEFORE it — which silently
 * drops any attribute written after `element`, `path` included. JSX prop order
 * is arbitrary, so `<Route element={<NewPage />} path="/new" />` would opt a
 * page out of this guard with nothing going red.
 *
 * So: track brace depth and string literals, and end the tag at the first `>`
 * that is at depth 0 — its own.
 */
function routeTags(src: string): string[] {
  const tags: string[] = [];
  let at = src.indexOf("<Route");

  while (at !== -1) {
    let i = at + "<Route".length;
    let depth = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        i += 1;
        while (i < src.length && src[i] !== ch) i += src[i] === "\\" ? 2 : 1;
      } else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
      i += 1;
    }
    tags.push(src.slice(at, i));
    at = src.indexOf("<Route", i);
  }
  return tags;
}

/**
 * Every component `main.tsx` mounts at a `path`, resolved to the file that
 * defines it, plus the redirects that sit alongside them.
 *
 * Read out of the router rather than off a filename glob. A glob over
 * `*Page.tsx` is a naming convention, not the class of routed surfaces: it
 * misses `App.tsx` (which serves /hr-attendance) and it would miss the next
 * page whose author picked any other name — which is exactly the escape hatch
 * this guard exists to close.
 *
 * The layout route is dropped because it carries no `path`: `HrAppShell` wraps
 * pages, it is not one. `Navigate` is counted but not resolved — a redirect
 * renders no surface of its own — and it is counted rather than ignored so the
 * cross-check below can account for every routed tag in the file.
 */
function routedElements(): { pages: { name: string; url: URL }[]; redirects: number } {
  const main = readFileSync(MAIN_URL, "utf8");

  const specifiers = new Map<string, string>();
  for (const [, names, from] of main.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    for (const clause of names.split(",")) {
      const local = clause.trim().split(/\s+as\s+/).pop();
      if (local) specifiers.set(local, from);
    }
  }

  const pages: { name: string; url: URL }[] = [];
  let redirects = 0;

  for (const tag of routeTags(main)) {
    if (!/\bpath\s*=/.test(tag)) continue;

    // Loud rather than skipped, here and below: a routed tag this scan cannot
    // read is a page silently escaping the guard, which is the whole defect
    // again.
    const element = /element=\{<\s*([A-Za-z_$][\w$]*)/.exec(tag);
    assert.ok(element, `a <Route> with a path has an element this scan cannot read: ${tag.trim()}`);

    const name = element[1];
    if (name === "Navigate") {
      redirects += 1;
      continue;
    }

    const from = specifiers.get(name);
    assert.ok(from, `main.tsx routes <${name} /> but no import in main.tsx names it`);
    assert.match(
      from,
      /^\.{1,2}\//,
      `<${name} /> is routed from the package "${from}" — this guard can only read local files`,
    );
    pages.push({ name, url: new URL(`${from}.tsx`, MAIN_URL) });
  }

  // Counted a SECOND way, straight off the source, and compared. The walker
  // above is the only thing deciding what this guard looks at, so nothing else
  // would notice it quietly returning a smaller world; two independent counts
  // disagreeing is what turns that into a failure instead of a silent pass.
  // This replaces a hardcoded "at least five pages" floor, which would have
  // gone stale the first time a route was added or removed.
  const declaredPaths = (main.match(/\bpath\s*=/g) ?? []).length;
  assert.ok(declaredPaths > 0, "main.tsx declares no routes at all — the scan is broken");
  assert.equal(
    pages.length + redirects,
    declaredPaths,
    `main.tsx declares ${declaredPaths} routed paths but this scan resolved ${pages.length} pages and ${redirects} redirects`,
  );

  return { pages, redirects };
}

// Was "WeeklySchedulePage uses <Page>" — a per-file assertion. The biometrics
// page then shipped as the only routed page WITHOUT <Page>, hand-rolling px-4
// against Page's px-5 sm:px-8, so the nav it shared with its sibling shifted
// 16px between tabs. The guard existed; it just named one page instead of the
// class. This is the generalised form: it reads the router, so a page cannot
// opt out by being new, by being named something else, or by living in a
// subdirectory.
test("every routed page uses dewey-ui's Page rather than a hand-rolled container", () => {
  const { pages } = routedElements();

  for (const { name, url } of pages) {
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
// unlike the other three — it gets no PageHeader: its nav tab already reads
// "Attendance" at every viewport, and a VISIBLE title costs ~40px above the
// week grid on the phone.
//
// This test used to pin `!src.includes("<h1")`, recording that an sr-only
// heading had been "considered and declined". That was wrong, and it is now
// inverted deliberately rather than quietly relaxed. Neither reason survives
// contact with the sr-only form: `sr-only` is absolutely positioned, so it is
// not a flex item and measures zero — the register's identical heading was
// checked in a browser at 0px, with removal moving nothing — and a nav tab is
// not a heading, so it never appears in a screen reader's heading list. A
// reader pressing H on this route got nothing and had no answer to "where am
// I". Every routed page now carries a heading; only this one keeps it silent.
test("App renders Section inside Page, with a heading that costs no pixels", () => {
  const src = source("App.tsx");
  // The name says "inside Page", so assert Page too — the Section check alone
  // would stay green with <Page> deleted, under a name claiming otherwise.
  assert.ok(src.includes("<Page"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(src.includes("<Section"), "expected <Section> from @lolbikb/dewey-ui");
  assert.ok(!src.includes("<PageHeader"), "/hr-attendance must not render a PageHeader");
  // Direction, not presence: an `<h1>` WITHOUT `sr-only` is the ~40px
  // regression the missing PageHeader exists to avoid, so a bare h1 must fail
  // just as surely as no h1 at all — but for its own stated reason, so this
  // one goes first. The other order reports "no heading" for a page that has
  // one, sending the next reader after the wrong thing.
  assert.ok(
    !/<h1(?![^>]*\bsr-only\b)/.test(src),
    "/hr-attendance must not render a VISIBLE h1 — that is the ~40px the week grid cannot spare",
  );
  // assert.ok on a tested regex, not assert.match: match prints its subject,
  // and the subject here is the whole 6KB file.
  assert.ok(
    /<h1 className="sr-only">/.test(src),
    "/hr-attendance must carry an sr-only h1 — a route with no heading has no answer to 'where am I'",
  );
});

// Every routed page carries a heading, visible or silent. Pinned as a CLASS
// rather than per file: asking each page separately is exactly what let
// /hr-attendance sit headingless for as long as it did, because nothing ever
// put the question to all of them at once.
//
// Two legitimate shapes, hence the either/or. dewey-ui's `PageHeader` renders
// the `<h1>` itself, so a page using it has no literal `<h1>` in its own
// source; /hr-attendance has no PageHeader and supplies its own `sr-only` one.
// Matching on source text is the only tool available here — there is no jsdom
// in this app — so this cannot count rendered headings, only prove each page
// takes one of the two routes to having one.
test("every routed page has a heading — via PageHeader, or its own sr-only h1", () => {
  const { pages } = routedElements();
  assert.ok(pages.length >= 4, `expected the router scan to find pages, got ${pages.length}`);

  for (const { name, url } of pages) {
    const src = withoutComments(readFileSync(url, "utf8"));
    // The bare-visible-h1 case is checked FIRST so the message names the real
    // cause. Checked the other way round, a page with a hand-rolled visible
    // <h1> trips the "no heading at all" assertion — which is false, and sends
    // the next reader looking for a missing heading rather than a misplaced
    // one.
    assert.ok(
      !/<h1(?![^>]*\bsr-only\b)/.test(src),
      `${name} hand-rolls a visible <h1> — that belongs to <PageHeader>`,
    );
    const viaPageHeader = src.includes("<PageHeader");
    const viaSrOnly = /<h1 className="sr-only">/.test(src);
    assert.ok(
      viaPageHeader || viaSrOnly,
      `${name} renders no heading at all — a route with none has no answer to "where am I" ` +
        `for anyone navigating by heading. Use <PageHeader>, or an sr-only <h1> if the ` +
        `pixels genuinely cannot be spared.`,
    );
  }
});
