import { test } from "node:test";
import assert from "node:assert/strict";

import { FLAG_LABELS, FLAG_FILTER_GROUPS } from "./flagLabels";

test("the off-site flag is worded as a note, not an accusation", () => {
  // HR's framing: "not a major offense, but nice to know and employee can justify".
  assert.equal(FLAG_LABELS.NON_PRIMARY_SITE_PUNCH, "Other site");
});

test("the filter group is renamed to match", () => {
  assert.deepEqual(FLAG_FILTER_GROUPS.otherSite, ["NON_PRIMARY_SITE_PUNCH"]);
  assert.equal("wrongSite" in FLAG_FILTER_GROUPS, false);
});
