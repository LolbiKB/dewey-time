import assert from "node:assert/strict";
import test from "node:test";

import type { Checkin } from "@/types/calendar";

import {
  deriveSegments,
  deriveTimelineGaps,
  deriveUnpairedPunches,
  directionForCheckin,
  groupCheckinsByBranchRuns,
} from "./attendancePunches";

const parseTime = (value: string) => new Date(value.replace(" ", "T"));
const minutesFromDateTime = (value: string | null | undefined) => {
  if (!value) return null;
  const d = parseTime(value);
  return d.getHours() * 60 + d.getMinutes();
};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function punch(time: string, branch: string | null): Checkin {
  return { time, custom_device_branch: branch };
}

test("does not pair punches across different branches", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 12:00:00", "BRANCH-B"),
    punch("2026-05-28 17:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins, { parseTime, minutesFromDateTime, clamp });
  assert.equal(segments.length, 0);

  const unpaired = deriveUnpairedPunches(checkins, parseTime);
  assert.equal(unpaired.length, 3);
});

test("pairs within a single branch run", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 17:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins, { parseTime, minutesFromDateTime, clamp });
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.branch, "BRANCH-A");
  assert.equal(segments[0]!.minutes, 9 * 60);
});

test("multiple segments at same branch when four punches", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 12:00:00", "BRANCH-A"),
    punch("2026-05-28 13:00:00", "BRANCH-A"),
    punch("2026-05-28 17:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins, { parseTime, minutesFromDateTime, clamp });
  assert.equal(segments.length, 2);
  assert.ok(segments.every((s) => s.branch === "BRANCH-A"));
});

test("direction is computed per branch run", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 12:00:00", "BRANCH-B"),
  ];

  assert.equal(directionForCheckin(checkins, checkins[0]!), "IN");
  assert.equal(directionForCheckin(checkins, checkins[1]!), "IN");
});

test("groupCheckinsByBranchRuns splits on branch change", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 09:00:00", "BRANCH-A"),
    punch("2026-05-28 12:00:00", "BRANCH-B"),
  ];

  const runs = groupCheckinsByBranchRuns(checkins);
  assert.equal(runs.length, 2);
  assert.equal(runs[0]!.length, 2);
  assert.equal(runs[1]!.length, 1);
});

test("timeline gap between segment end and unpaired punch", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 12:00:00", "BRANCH-A"),
    punch("2026-05-28 15:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins, { parseTime, minutesFromDateTime, clamp });
  const unpaired = deriveUnpairedPunches(checkins, parseTime);
  const gaps = deriveTimelineGaps(segments, unpaired, minutesFromDateTime);

  assert.equal(segments.length, 1);
  assert.equal(unpaired.length, 1);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.startMin, 12 * 60);
  assert.equal(gaps[0]!.endMin, 15 * 60);
  assert.equal(gaps[0]!.minutes, 3 * 60);
});

test("missing branch punches never pair with each other", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", null),
    punch("2026-05-28 09:00:00", null),
    punch("2026-05-28 10:00:00", "BRANCH-A"),
    punch("2026-05-28 17:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins, { parseTime, minutesFromDateTime, clamp });
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.branch, "BRANCH-A");

  const unpaired = deriveUnpairedPunches(checkins, parseTime);
  assert.equal(unpaired.length, 2);
  assert.ok(unpaired.every((c) => !c.custom_device_branch));
});
