import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  flagCount, flagStatusKey, flagText, KNOWN_FLAG_CODES, visibleFlags,
} from "@/miniapp/miniFlags";
import type { Day, Flag } from "@/types/calendar";

/** The server's half of the allowlist, read out of the Python it lives in. */
function serverFlagCodes(): string[] {
  const src = readFileSync(
    new URL("../../../../telegram/miniapp_api.py", import.meta.url),
    "utf8",
  );
  const block = /EMPLOYEE_FLAG_CODES\s*=\s*frozenset\(\{([\s\S]*?)\}\)/.exec(src);
  assert.ok(block, "EMPLOYEE_FLAG_CODES not found — has miniapp_api.py moved?");
  return [...block[1]!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
}

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

test("the client and server halves of the allowlist are the same list", () => {
  // READ OUT OF THE PYTHON, not copied from it. The first version of this test
  // hard-coded the nine codes and carried a comment asking the next editor to
  // keep them in step — which is not a guard: the server list could gain a code
  // and this would still pass, and that code would arrive on a phone as a flag
  // the sheet silently drops.
  assert.deepEqual(
    [...KNOWN_FLAG_CODES].sort(),
    serverFlagCodes().sort(),
    "miniapp_api.EMPLOYEE_FLAG_CODES and miniFlags.FLAG_TEXT have drifted",
  );
});

test("every allowlisted code has both a title and a body", () => {
  for (const code of serverFlagCodes()) {
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
