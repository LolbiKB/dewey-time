import assert from "node:assert/strict";
import test from "node:test";

import { FrappeCallError } from "@/lib/frappe";
import { queryClient } from "@/lib/queryClient";

/** Read the policy off the real client, so this tests what the app actually uses. */
const defaults = queryClient.getDefaultOptions();
const shouldRetry = defaults.queries?.retry as (count: number, err: unknown) => boolean;

function frappeError(status: number): FrappeCallError {
  return new FrappeCallError("nope", { status, method: "dewey_time.x.read" });
}

test("queries do not retry a 4xx — that is the server's verdict, not a blip", () => {
  assert.equal(shouldRetry(0, frappeError(403)), false, "403 session-expiry");
  assert.equal(shouldRetry(0, frappeError(417)), false, "417 frappe.throw()");
  assert.equal(shouldRetry(0, frappeError(400)), false, "lower boundary");
  assert.equal(shouldRetry(0, frappeError(499)), false, "upper boundary");
});

test("queries do retry a 5xx and an errorless transport failure", () => {
  assert.equal(shouldRetry(0, frappeError(500)), true, "500 is worth another go");
  // Offline: fetch rejects before any status exists to judge.
  assert.equal(shouldRetry(0, new TypeError("Failed to fetch")), true);
});

test("query retries give up after two attempts", () => {
  assert.equal(shouldRetry(0, frappeError(500)), true);
  assert.equal(shouldRetry(1, frappeError(500)), true);
  assert.equal(shouldRetry(2, frappeError(500)), false);
});

// The regression this guards: restoring ADMS's retry:1 would re-issue
// apply_weekly_schedule after a commit-then-drop, duplicating Shift Assignments.
test("mutations never retry — our writes are not idempotent", () => {
  assert.equal(defaults.mutations?.retry, false);
});
