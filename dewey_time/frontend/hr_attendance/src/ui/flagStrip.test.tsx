import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { buildOutageSet, buildStrip } from "@/lib/flagStrip";
import type { FlagOut } from "@/types/flags";
import { FlagStrip } from "@/ui/FlagStrip";

const NONE: ReadonlySet<string> = new Set();

function flag(date: string, tier: FlagOut["tier"]): FlagOut {
  return {
    flag_identity: `AUTO-${date}-${tier}`,
    flag_code: "LATE_START",
    attendance_date: date,
    day_closed: 1,
    evidence: {},
    rank: 20,
    tier,
    decision_state: "undecided",
    decision: null,
  };
}

/** A fortnight: 2026-07-25 … 2026-08-07 inclusive is exactly 14 days. */
const FORTNIGHT = { startDate: "2026-07-25", endDate: "2026-08-07" } as const;

test("the strip states its flagged-day count and hides its cells from assistive tech", () => {
  const strip = buildStrip({
    flags: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"].map((d) => flag(d, "routine")),
    branch: "HQ",
    ...FORTNIGHT,
    outage: NONE,
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.match(html, /aria-label="4 flagged days in the last 14"/);
  // Every cell is hidden — the strip is decorative reinforcement of a sub-line
  // the reader has already been given.
  assert.equal(html.split("aria-hidden").length - 1, strip.cells.length);
});

test("severity is height as well as colour", () => {
  const strip = buildStrip({
    flags: [flag("2026-08-05", "act"), flag("2026-08-06", "review"), flag("2026-08-07", "routine")],
    branch: "HQ",
    ...FORTNIGHT,
    outage: NONE,
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.match(html, /h-3\.5 bg-destructive/); // act
  assert.match(html, /h-2\.5 bg-amber-500/); // review
  assert.match(html, /h-1\.5 bg-sky-500/); // routine
});

test("a clean day and a no-data day are different cells", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    ...FORTNIGHT,
    outage: buildOutageSet([{ branch: "HQ", date: "2026-08-04" }]),
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.match(html, /bg-emerald-500\/70/); // clean
  assert.match(html, /bg-muted-foreground\/30/); // no data
});

test("flags older than the window carry a +N earlier marker", () => {
  const strip = buildStrip({
    flags: [flag("2026-07-16", "routine"), flag("2026-07-17", "routine"), flag("2026-07-18", "act")],
    branch: "HQ",
    ...FORTNIGHT,
    outage: NONE,
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.match(html, /\+3 earlier/);
});

test("no marker when nothing is older than the window", () => {
  const strip = buildStrip({ flags: [], branch: "HQ", ...FORTNIGHT, outage: NONE });
  assert.equal(renderToStaticMarkup(<FlagStrip strip={strip} />).includes("earlier"), false);
});

// At 6px a cell is not a click target, so it must not pretend to be one: the
// row around it is what HR clicks. The whole strip takes ONE accessible name
// and offers nothing to tab to.
test("the strip is a picture, not a set of controls", () => {
  const strip = buildStrip({
    flags: [flag("2026-08-05", "act")],
    branch: "HQ",
    ...FORTNIGHT,
    outage: NONE,
  });
  const html = renderToStaticMarkup(<FlagStrip strip={strip} />);
  assert.equal(html.includes("<button"), false);
  assert.equal(html.includes("tabindex"), false);
  assert.equal(html.split('role="').length - 1, 1, "one role for the whole strip");
  assert.match(html, /role="img"/);
});
