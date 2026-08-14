import { test } from "node:test";
import assert from "node:assert/strict";

import { attendanceHealth, flagQueueHealth } from "@/lib/dataHealth";

test("a healthy page produces no conditions at all", () => {
  // This is what makes the chip absent rather than present-and-empty. A chip
  // reading "0 problems" is a permanent fixture that teaches people to ignore
  // the spot it occupies.
  assert.deepEqual(flagQueueHealth({ outageBranches: 0, closeoutAlerts: 0 }), []);
  assert.deepEqual(attendanceHealth({ staleSyncMinutes: null, closeoutAlerts: 0 }), []);
});

test("the flag queue leads with outages and counts closeouts behind them", () => {
  const both = flagQueueHealth({ outageBranches: 13, closeoutAlerts: 2 });
  assert.equal(both.length, 2);
  assert.equal(both[0]!.key, "outage");
  assert.equal(both[0]!.summary, "13 branches offline");
  assert.equal(both[0]!.short, "13");
  assert.equal(both[1]!.key, "closeout");
  assert.equal(both[1]!.summary, "2 device closeouts pending");
});

test("each condition appears only when its own count is non-zero", () => {
  const outageOnly = flagQueueHealth({ outageBranches: 4, closeoutAlerts: 0 });
  assert.deepEqual(outageOnly.map((c) => c.key), ["outage"]);

  const closeoutOnly = flagQueueHealth({ outageBranches: 0, closeoutAlerts: 3 });
  assert.deepEqual(closeoutOnly.map((c) => c.key), ["closeout"]);
});

test("one of a thing reads as one of a thing", () => {
  const [outage] = flagQueueHealth({ outageBranches: 1, closeoutAlerts: 0 });
  assert.equal(outage!.summary, "1 branch offline");

  const [closeout] = flagQueueHealth({ outageBranches: 0, closeoutAlerts: 1 });
  assert.equal(closeout!.summary, "1 device closeout pending");
});

test("four-figure counts are grouped, because these are read at a glance", () => {
  const [outage] = flagQueueHealth({ outageBranches: 1005, closeoutAlerts: 0 });
  assert.equal(outage!.summary, "1,005 branches offline");
  assert.equal(outage!.short, "1,005");
});

test("stale sync says the full age, and the short form keeps only its leading unit", () => {
  // 22h 3m — the real figure from the page this replaces. The short form is
  // what a 375px row gets, where the label is the first thing to go.
  const [stale] = attendanceHealth({ staleSyncMinutes: 1323, closeoutAlerts: 0 });
  assert.equal(stale!.key, "stale-sync");
  assert.equal(stale!.summary, "Last sync 22h 3m ago");
  assert.equal(stale!.short, "22h");
});

test("the short age never loses its unit, whatever the magnitude", () => {
  // Derived from formatDurationMinutes rather than re-deriving days/hours, so
  // the two can never disagree about a boundary.
  assert.equal(attendanceHealth({ staleSyncMinutes: 45, closeoutAlerts: 0 })[0]!.short, "45m");
  assert.equal(attendanceHealth({ staleSyncMinutes: 4560, closeoutAlerts: 0 })[0]!.short, "3d");
  assert.equal(attendanceHealth({ staleSyncMinutes: 120, closeoutAlerts: 0 })[0]!.short, "2h");
});

test("zero minutes since sync is still a condition, not a missing one", () => {
  // `null` means "no sync timestamp to judge"; 0 means "synced this minute",
  // which the caller only passes when it has already decided the page is
  // stale. A falsy check here would silently drop it.
  const conditions = attendanceHealth({ staleSyncMinutes: 0, closeoutAlerts: 0 });
  assert.equal(conditions.length, 1);
  assert.equal(conditions[0]!.summary, "Last sync 0m ago");
});
