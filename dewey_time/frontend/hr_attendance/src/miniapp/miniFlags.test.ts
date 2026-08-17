import assert from "node:assert/strict";
import test from "node:test";

import { flagCount, flagStatusKey, flagText, visibleFlags } from "@/miniapp/miniFlags";
import type { Day, Flag } from "@/types/calendar";

const flag = (over: Partial<Flag> = {}): Flag =>
  ({ name: "f", flag_code: "LATE_START", ...over }) as Flag;

const day = (flags: Flag[]): Day => ({ date: "2026-08-14", flags });

test("a day with no flags counts zero rather than throwing", () => {
  assert.equal(flagCount(undefined), 0);
  assert.equal(flagCount({ date: "2026-08-14" }), 0);
  assert.equal(flagCount(day([])), 0);
});

test("the count and the list are the same function", () => {
  // Not two implementations that agree today. The flag-queue header shipped a
  // count that disagreed with the rows below it, from exactly this shape of
  // duplication.
  const d = day([flag(), flag({ flag_code: "LEFT_EARLY" })]);
  assert.equal(flagCount(d), visibleFlags(d).length);
});

test("a code with no employee wording is not rendered as a blank row", () => {
  // The server allowlist should already have removed these, but the client
  // must not render an empty card if one ever arrives — belt and braces across
  // a trust boundary.
  const d = day([flag({ flag_code: "UNKNOWN_DEVICE_BRANCH" }), flag()]);
  assert.deepEqual(visibleFlags(d).map((f) => f.flag_code), ["LATE_START"]);
});

test("every allowlisted code has both a title and a body", () => {
  // The one test that fails when the server list and the client table drift.
  // Keep this array identical to miniapp_api.EMPLOYEE_FLAG_CODES.
  const codes = [
    "LATE_START", "LEFT_EARLY", "LATE_FROM_LUNCH", "MISSING_TIME",
    "MISSING_IN_OR_OUT", "UNNOTIFIED_ABSENCE", "OFF_SHIFT_PUNCH",
    "MISSING_LUNCH", "ATTENDANCE_ISSUE",
  ];
  for (const code of codes) {
    const text = flagText(flag({ flag_code: code }));
    assert.ok(text, `${code} has no wording`);
    assert.ok(text.title && text.body, `${code} is missing a title or body`);
  }
});

test("an absence is worded as a missing record, never as an absence", () => {
  // "Unnotified absence" is a verdict this app has no standing to make.
  assert.equal(
    flagText(flag({ flag_code: "UNNOTIFIED_ABSENCE" }))?.title,
    "flagNoRecord",
  );
});

test("an undecided flag reads as awaiting review", () => {
  assert.equal(flagStatusKey(flag()), "flagStatusAwaiting");
  assert.equal(flagStatusKey(flag({ decision: null })), "flagStatusAwaiting");
});

test("HR's outcomes are both shown", () => {
  assert.equal(
    flagStatusKey(flag({ decision: { outcome: "EXCUSED" } })),
    "flagStatusExcused",
  );
  assert.equal(
    flagStatusKey(flag({ decision: { outcome: "UPHELD" } })),
    "flagStatusUpheld",
  );
});

test("a decision that no longer matches the day loses to re-review", () => {
  // A stale verdict on a day that has since changed is worse than no verdict.
  assert.equal(
    flagStatusKey(flag({
      decision: { outcome: "EXCUSED" },
      decision_state: "needs_re_review",
    })),
    "flagStatusRereview",
  );
});
