import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { queryKeys } from "@/lib/queryKeys";

const service = readFileSync(new URL("../services/enrollment.ts", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useEnrollmentReport.ts", import.meta.url), "utf8");

// The dotted path is a string handed to the server. A typo does not fail to
// compile -- it 404s at runtime. This system lost two bridge feeds for eleven
// days to exactly that, so the literal is pinned here rather than derived.
test("the service calls the exact whitelisted method path", () => {
  assert.match(
    service,
    /"dewey_time\.attendance_engine\.enrollment_api\.get_enrollment_report"/,
  );
});

test("the enrollment query key is its own family", () => {
  assert.deepEqual(queryKeys.enrollment.all, ["enrollment"]);
});

test("the enrollment key does not collide with the coverage key", () => {
  // Two queries sharing one key share one cache entry, and whichever mounted
  // first would hand the other its payload.
  assert.notDeepEqual(queryKeys.enrollment.all, queryKeys.coverage.all);
});

test("the hook returns the payload undefined rather than defaulting it", () => {
  // An empty payload would render as "nobody is enrolled" -- the exact
  // misreading isFeedConnected exists to prevent. There is no DOM in this
  // suite, so the contract is pinned in source instead of by rendering.
  assert.doesNotMatch(hook, /payload:\s*data\s*\?\?/);
  assert.match(hook, /payload:\s*data\b/);
});
