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
