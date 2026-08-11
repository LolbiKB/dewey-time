import assert from "node:assert/strict";
import test from "node:test";

import { rolloutBannerMessage } from "./rolloutBanner";
import type { RolloutBlock, RolloutWindow } from "@/types/flags";

function block(over: Partial<RolloutBlock> = {}): RolloutBlock {
  return {
    phases_configured: true,
    range_phase: "TESTING",
    testing_flag_count: 0,
    total_flag_count: 0,
    windows: [],
    ...over,
  };
}

const win = (over: Partial<RolloutWindow> = {}): RolloutWindow => ({
  branch: "Northgate",
  testing_start: "2026-08-15",
  go_live: "2026-09-01",
  ...over,
});

test("no rollout block at all is silent", () => {
  assert.equal(rolloutBannerMessage(undefined), null);
});

test("unconfigured phases say nothing", () => {
  // The safe upgrade default: no dates set anywhere means the system behaves
  // exactly as it did before rollout phases existed, and a banner would be
  // announcing a pilot nobody started.
  assert.equal(rolloutBannerMessage(block({ phases_configured: false })), null);
});

test("an all-live range says nothing", () => {
  assert.equal(rolloutBannerMessage(block({ range_phase: "LIVE" })), null);
});

test("a single named-branch window names the branch and both dates", () => {
  const msg = rolloutBannerMessage(block({ windows: [win()] }));
  assert.equal(
    msg,
    "Aug 15 – Sep 1 is the pilot period for Northgate — calibration data, not the official record.",
  );
});

test("a branchless window drops the branch clause and keeps the dates", () => {
  // The likeliest real rollout: global dates over a roster where most
  // employees have no branch set. Naming no branch is the honest form.
  const msg = rolloutBannerMessage(block({ windows: [win({ branch: null })] }));
  assert.equal(
    msg,
    "Aug 15 – Sep 1 is the pilot period — calibration data, not the official record.",
  );
});

test("no go-live yet reads as open-ended, not as a broken range", () => {
  // rollout.phase_for: `go_live is None` means TESTING indefinitely. This is
  // the state between setting a testing start and choosing a go-live date, so
  // it is probably the first banner ever rendered -- and the spec's table
  // would have printed "Aug 15 – null is the pilot period" here.
  const msg = rolloutBannerMessage(block({ windows: [win({ go_live: null })] }));
  assert.equal(
    msg,
    "Aug 15 onward is the pilot period for Northgate — calibration data, not the official record.",
  );
});

test("a window whose dates were cleared still announces the pilot", () => {
  // _rollout_window hands over nulls rather than fabricating a range. The
  // flags ARE pilot flags -- that is why range_phase is TESTING -- so dropping
  // the banner would hide real information. Only the dates go.
  const msg = rolloutBannerMessage(
    block({ windows: [win({ testing_start: null, go_live: null })] }),
  );
  assert.equal(
    msg,
    "This range falls in the pilot period for Northgate — calibration data, not the official record.",
  );
});

test("several windows give the branch count instead of a list of ranges", () => {
  // Branches roll out on different timetables by design; naming four date
  // ranges in one banner would be worse than naming none.
  const msg = rolloutBannerMessage(
    block({ windows: [win(), win({ branch: "Southgate" }), win({ branch: "Eastgate" })] }),
  );
  assert.equal(
    msg,
    "This range falls in the pilot period for 3 branches — calibration data, not the official record.",
  );
});

test("a null window alongside named ones counts toward the total", () => {
  // Per spec: those are people in the pilot on the global timetable, so 2 is
  // the correct count, not 1.
  const msg = rolloutBannerMessage(block({ windows: [win(), win({ branch: null })] }));
  assert.match(msg ?? "", /for 2 branches/);
});

test("a mixed range reports how much of the VISIBLE list is pilot data", () => {
  const msg = rolloutBannerMessage(
    block({ range_phase: "MIXED", testing_flag_count: 34, total_flag_count: 91 }),
  );
  assert.equal(msg, "This range spans go-live. 34 of 91 flags are from the pilot period.");
});

test("a mixed range with everything filtered out of view still reads correctly", () => {
  // testing_flag_count/total_flag_count are post-filter by design, so "0 of 0"
  // is legal. The banner must not divide, pluralise wrongly, or go blank.
  const msg = rolloutBannerMessage(
    block({ range_phase: "MIXED", testing_flag_count: 0, total_flag_count: 0 }),
  );
  assert.equal(msg, "This range spans go-live. 0 of 0 flags are from the pilot period.");
});

test("a testing range with no windows still says something", () => {
  // Phase A appends a null window precisely so this cannot happen, but the
  // banner should degrade to the truth rather than to silence if it ever does.
  const msg = rolloutBannerMessage(block({ windows: [] }));
  assert.equal(
    msg,
    "This range falls in the pilot period — calibration data, not the official record.",
  );
});

test("an unparseable date degrades to the dateless form", () => {
  const msg = rolloutBannerMessage(block({ windows: [win({ testing_start: "not-a-date" })] }));
  assert.equal(
    msg,
    "This range falls in the pilot period for Northgate — calibration data, not the official record.",
  );
});
