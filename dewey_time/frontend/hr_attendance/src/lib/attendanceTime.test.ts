import { test } from "node:test";
import assert from "node:assert/strict";

import { isOffSiteSegment } from "./attendanceTime";

test("off-site: a different branch is off-site", () => {
  assert.equal(isOffSiteSegment("BRANCH-B", "BRANCH-A"), true);
});

test("off-site: the same branch is not", () => {
  assert.equal(isOffSiteSegment("BRANCH-A", "BRANCH-A"), false);
});

test("off-site: an unknown punch branch is never off-site", () => {
  // A punch with no device branch is UNKNOWN_DEVICE_BRANCH / ATTENDANCE_ISSUE's
  // problem. Claiming it is off-site would assert a location we do not have.
  assert.equal(isOffSiteSegment(null, "BRANCH-A"), false);
  assert.equal(isOffSiteSegment(undefined, "BRANCH-A"), false);
  assert.equal(isOffSiteSegment("", "BRANCH-A"), false);
});

test("off-site: nothing is off-site when the employee has no primary branch", () => {
  // THE case to get right. Many employees have a blank Employee.branch; a naive
  // `a !== b` marks every segment off-site for all of them, hatching the whole
  // screen. Matches the backend, which no-ops on a falsy employee_branch.
  assert.equal(isOffSiteSegment("BRANCH-B", null), false);
  assert.equal(isOffSiteSegment("BRANCH-B", undefined), false);
  assert.equal(isOffSiteSegment("BRANCH-B", ""), false);
  assert.equal(isOffSiteSegment("BRANCH-B", "   "), false);
});

test("off-site: comparison ignores surrounding whitespace", () => {
  assert.equal(isOffSiteSegment(" BRANCH-A ", "BRANCH-A"), false);
});
