import assert from "node:assert/strict";
import test from "node:test";

import type { Checkin } from "@/types/calendar";

import { buildSegmentInspectorItems, deriveSegments } from "./segmentInspector";

function punch(time: string, branch: string | null): Checkin {
  return { time, custom_device_branch: branch };
}

test("inspector lists segments and unpaired punches without away near unpaired", () => {
  const checkins = [
    punch("2026-05-28 09:31:00", "DIS Iconic"),
    punch("2026-05-28 09:33:00", "DIU"),
    punch("2026-05-28 09:42:00", "DIS Iconic"),
    punch("2026-05-28 09:44:00", "DIS Iconic"),
    punch("2026-05-28 09:48:00", "DIU"),
  ];

  const segments = deriveSegments(checkins);
  const items = buildSegmentInspectorItems(segments, checkins);

  assert.deepEqual(
    items.map((item) => item.kind),
    ["unpaired", "unpaired", "segment", "unpaired"]
  );

  assert.equal(items.filter((item) => item.kind === "unpaired").length, 3);
  assert.equal(items.filter((item) => item.kind === "segment").length, 1);
  assert.equal(items.filter((item) => item.kind === "away").length, 0);
});

test("inspector shows lunch and away with different kinds", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 11:45:00", "BRANCH-A"),
    punch("2026-05-28 13:20:00", "BRANCH-A"),
    punch("2026-05-28 17:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins);
  const items = buildSegmentInspectorItems(segments, checkins, {
    dateKey: "2026-05-28",
    shift: {
      shift_assigned: true,
      lunch_start: "12:00",
      lunch_end: "13:00",
      grace_minutes: 15,
    },
  });

  const lunch = items.filter((item) => item.kind === "lunch");
  const away = items.filter((item) => item.kind === "away");
  assert.equal(lunch.length, 1);
  assert.equal(away.length, 2);
  assert.equal(lunch[0]!.kind === "lunch" && lunch[0]!.source, "scheduled");
});

test("inspector marks missing branch as rogue unpaired", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 09:00:00", null),
  ];

  const segments = deriveSegments(checkins);
  const items = buildSegmentInspectorItems(segments, checkins);

  const rogue = items.find((item) => item.kind === "unpaired" && item.isRogue);
  assert.ok(rogue);
});
