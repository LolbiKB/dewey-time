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

/** Every key the registry can produce, labelled for the failure message. */
function everyKey(): Array<{ label: string; key: readonly unknown[] }> {
  const keys: Array<{ label: string; key: readonly unknown[] }> = [];
  for (const [family, members] of Object.entries(queryKeys)) {
    const { all, ...builders } = members as { all: readonly unknown[] } & Record<string, unknown>;
    // `.all` is both a family root and, for `session`, a live query key — so it
    // has to be in the comparison set, not just the builders under it.
    keys.push({ label: `${family}.all`, key: all });
    for (const [name, build] of Object.entries(builders)) {
      if (typeof build !== "function") continue;
      keys.push({
        label: `${family}.${name}`,
        key: (build as (...a: unknown[]) => readonly unknown[])(
          ...Array.from({ length: build.length }, (_, i) => `arg${i}`),
        ),
      });
    }
  }
  return keys;
}

// Two queries on one key share one cache entry, and whichever resolves first
// hands the other its payload — silently, with no type error, because
// react-query keys are unknown[]. That very nearly shipped: useSession on
// `session.all` would have been served useCalendarSession's `{hr_staff, …}`
// object, which is truthy and !== "Guest", so the auth gate would have opened
// on it. Only a hand-review caught it. `session.all` doubling as a family root
// *and* get_calendar_session's live key means the registry already contains the
// precedent, so this is a class of bug, not a one-off — assert distinctness
// over the whole registry rather than over hand-picked pairs.
test("no two keys in the registry collide", () => {
  const seen = new Map<string, string>();
  for (const { label, key } of everyKey()) {
    const serialised = JSON.stringify(key);
    const owner = seen.get(serialised);
    assert.equal(owner, undefined, `${label} produces the same key as ${owner}: ${serialised}`);
    seen.set(serialised, label);
  }
});
