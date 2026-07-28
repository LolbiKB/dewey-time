import assert from "node:assert/strict";
import test from "node:test";

import { queryKeys } from "@/lib/queryKeys";

/** react-query invalidates by prefix — this is the exact match it performs. */
function hasPrefix(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.length <= key.length && prefix.every((part, i) => key[i] === part);
}

// Walks the whole registry rather than naming families, so a key added by a
// later task is covered the moment it is written — no per-family edit needed,
// and no builder can slip through unasserted.
test("every key builder carries its family prefix", () => {
  for (const [family, members] of Object.entries(queryKeys)) {
    const { all, ...builders } = members as { all: readonly unknown[] } & Record<string, unknown>;
    for (const [name, build] of Object.entries(builders)) {
      if (typeof build !== "function") continue;
      const key = (build as (...a: unknown[]) => readonly unknown[])(
        ...Array.from({ length: build.length }, (_, i) => `arg${i}`),
      );
      assert.ok(hasPrefix(key, all), `${family}.${name} escapes its family`);
    }
  }
});

// Without this, the tests above would pass for a registry where every key is
// identical — the prefix property only means something if families are disjoint.
test("families do not invalidate each other", () => {
  assert.ok(!hasPrefix(queryKeys.calendar.employee("EMP-1", "a", "b"), queryKeys.schedule.all));
  assert.ok(!hasPrefix(queryKeys.schedule.context("EMP-1"), queryKeys.calendar.all));
  assert.ok(!hasPrefix(queryKeys.coverage.all, queryKeys.schedule.all));
});
