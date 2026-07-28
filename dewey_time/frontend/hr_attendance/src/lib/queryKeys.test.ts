import assert from "node:assert/strict";
import test from "node:test";

import { queryKeys } from "@/lib/queryKeys";

/** react-query invalidates by prefix — this is the exact match it performs. */
function hasPrefix(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.length <= key.length && prefix.every((part, i) => key[i] === part);
}

test("every schedule key is invalidated by the schedule family prefix", () => {
  const all = queryKeys.schedule.all;
  assert.ok(hasPrefix(queryKeys.schedule.context("EMP-1"), all));
  assert.ok(hasPrefix(queryKeys.schedule.resolve("EMP-1", "2026-08-01", "{}"), all));
  assert.ok(hasPrefix(queryKeys.schedule.templates(24), all));
  assert.ok(hasPrefix(queryKeys.schedule.holidays("EMP-1", "2026-08-01", "2026-08-31"), all));
});

test("every calendar key is invalidated by the calendar family prefix", () => {
  assert.ok(
    hasPrefix(queryKeys.calendar.employee("EMP-1", "2026-08-01", "2026-08-31"), queryKeys.calendar.all),
  );
});

// Without this, the tests above would pass for a registry where every key is
// identical — the prefix property only means something if families are disjoint.
test("families do not invalidate each other", () => {
  assert.ok(!hasPrefix(queryKeys.calendar.employee("EMP-1", "a", "b"), queryKeys.schedule.all));
  assert.ok(!hasPrefix(queryKeys.schedule.context("EMP-1"), queryKeys.calendar.all));
  assert.ok(!hasPrefix(queryKeys.coverage.all, queryKeys.schedule.all));
});
