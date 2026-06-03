import assert from "node:assert/strict";
import test from "node:test";

import type { Checkin } from "@/types/calendar";

import {
  buildShiftExemptIntervals,
  classifyUnpairedPresentations,
  computeWeekTimelineWindow,
  deriveSegments,
  deriveTimelineGaps,
  deriveUnpairedPunches,
  directionForCheckin,
  groupCheckinsByBranchRuns,
  hasTimelineErrorPunches,
  shiftTimelinePolicyFromShift,
  subtractExemptFromGap,
  TIMELINE_VIEWPORT_MINUTES,
  weekTimelineCanvasHeightPct,
  weekTimelineNeedsScroll,
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

test("no away gap between segment end and unpaired punch", () => {
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
  assert.equal(gaps.length, 0);
});

test("away only between consecutive paired segments", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 11:00:00", "BRANCH-A"),
    punch("2026-05-28 14:00:00", "BRANCH-A"),
    punch("2026-05-28 17:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins, { parseTime, minutesFromDateTime, clamp });
  const unpaired = deriveUnpairedPunches(checkins, parseTime);
  const gaps = deriveTimelineGaps(segments, unpaired, minutesFromDateTime);

  assert.equal(segments.length, 2);
  assert.equal(unpaired.length, 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.kind, "away");
  assert.equal(gaps[0]!.startMin, 11 * 60);
  assert.equal(gaps[0]!.endMin, 14 * 60);
});

test("away gaps exclude scheduled lunch and lunch-end grace", () => {
  const policy = shiftTimelinePolicyFromShift({
    shift_assigned: true,
    start_time: "08:00",
    end_time: "17:00",
    grace_minutes: 15,
    lunch_start: "12:00",
    lunch_end: "13:00",
  });
  assert.ok(policy);

  const exempt = buildShiftExemptIntervals(policy!);
  const parts = subtractExemptFromGap({ startMin: 11 * 60 + 45, endMin: 13 * 60 + 20 }, exempt);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.startMin, 11 * 60 + 45);
  assert.equal(parts[0]!.endMin, 12 * 60);
  assert.equal(parts[1]!.startMin, 13 * 60 + 15);
  assert.equal(parts[1]!.endMin, 13 * 60 + 20);
});

test("deriveTimelineGaps applies shift policy for lunch", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 11:45:00", "BRANCH-A"),
    punch("2026-05-28 13:20:00", "BRANCH-A"),
    punch("2026-05-28 17:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins, { parseTime, minutesFromDateTime, clamp });
  const unpaired = deriveUnpairedPunches(checkins, parseTime);
  const policy = shiftTimelinePolicyFromShift({
    shift_assigned: true,
    lunch_start: "12:00",
    lunch_end: "13:00",
    grace_minutes: 15,
  });

  const gaps = deriveTimelineGaps(segments, unpaired, minutesFromDateTime, policy);
  assert.equal(gaps.length, 3);
  const away = gaps.filter((g) => g.kind === "away");
  const lunch = gaps.filter((g) => g.kind === "lunch");
  assert.equal(away.length, 2);
  assert.equal(lunch.length, 1);
  assert.equal(
    away.reduce((sum, gap) => sum + gap.minutes, 0),
    15 + 5
  );
  assert.equal(lunch[0]!.minutes, 75);
  assert.equal(lunch[0]!.source, "scheduled");
});

test("deriveTimelineGaps prefers observed lunch over away", () => {
  const checkins = [
    punch("2026-05-28 08:00:00", "BRANCH-A"),
    punch("2026-05-28 12:05:00", "BRANCH-A"),
    punch("2026-05-28 12:50:00", "BRANCH-A"),
    punch("2026-05-28 17:00:00", "BRANCH-A"),
  ];

  const segments = deriveSegments(checkins, { parseTime, minutesFromDateTime, clamp });
  const unpaired = deriveUnpairedPunches(checkins, parseTime);
  const policy = shiftTimelinePolicyFromShift({
    shift_assigned: true,
    lunch_start: "12:00",
    lunch_end: "13:00",
    grace_minutes: 15,
  });

  const gaps = deriveTimelineGaps(segments, unpaired, minutesFromDateTime, {
    shiftPolicy: policy,
    observedLunchRange: { startMin: 12 * 60 + 5, endMin: 12 * 60 + 50 },
    scheduledLunchRange: { startMin: 12 * 60, endMin: 13 * 60 + 15 },
  });

  const lunch = gaps.filter((g) => g.kind === "lunch");
  const away = gaps.filter((g) => g.kind === "away");
  assert.equal(lunch.length, 1);
  assert.equal(lunch[0]!.source, "observed");
  assert.equal(lunch[0]!.minutes, 45);
  assert.equal(away.length, 0);
});

test("week timeline canvas is 100% when span is at most 10 hours", () => {
  const window = computeWeekTimelineWindow([9 * 60, 17 * 60]);
  assert.equal(window.spanMinutes, 8 * 60 + 60);
  assert.equal(weekTimelineCanvasHeightPct(window.spanMinutes), 100);
  assert.equal(weekTimelineNeedsScroll(window.spanMinutes), false);
});

test("week timeline scrolls when span exceeds 10 hours", () => {
  const window = computeWeekTimelineWindow([6 * 60, 20 * 60]);
  assert.ok(window.spanMinutes > TIMELINE_VIEWPORT_MINUTES);
  assert.equal(weekTimelineCanvasHeightPct(window.spanMinutes), (window.spanMinutes / TIMELINE_VIEWPORT_MINUTES) * 100);
  assert.equal(weekTimelineNeedsScroll(window.spanMinutes), true);
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

test("classify trailing punch on today as open session", () => {
  const checkins = [
    punch("2026-06-03 08:00:00", "BRANCH-A"),
    punch("2026-06-03 12:00:00", "BRANCH-A"),
    punch("2026-06-03 13:00:00", "BRANCH-A"),
  ];
  const now = new Date("2026-06-03T15:30:00");
  const helpers = { parseTime, minutesFromDateTime, clamp };
  const rows = classifyUnpairedPresentations(
    checkins,
    { dateKey: "2026-06-03", now, shiftEndMin: 17 * 60 },
    helpers
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, "openSession");
  assert.equal(hasTimelineErrorPunches(checkins, { dateKey: "2026-06-03", now }, helpers), false);
});

test("classify same punches on past day as unpaired error", () => {
  const checkins = [
    punch("2026-06-02 08:00:00", "BRANCH-A"),
    punch("2026-06-02 12:00:00", "BRANCH-A"),
    punch("2026-06-02 13:00:00", "BRANCH-A"),
  ];
  const now = new Date("2026-06-03T15:30:00");
  const rows = classifyUnpairedPresentations(
    checkins,
    { dateKey: "2026-06-02", now },
    { parseTime, minutesFromDateTime, clamp }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, "unpairedError");
});

test("sync horizon caps open session confirmed end", () => {
  const checkins = [punch("2026-06-03 08:00:00", "BRANCH-A")];
  const now = new Date("2026-06-03T15:30:00");
  const rows = classifyUnpairedPresentations(
    checkins,
    {
      dateKey: "2026-06-03",
      now,
      deviceSync: [
        {
          device_sn: "DEV1",
          local_date: "2026-06-03",
          last_device_log_at: "2026-06-03 15:00:00",
          last_delivered_at: "2026-06-03 14:00:00",
          pending_count: 1,
        },
      ],
    },
    { parseTime, minutesFromDateTime, clamp }
  );

  assert.equal(rows[0]!.kind, "openSession");
  assert.equal(rows[0]!.confirmedEndMin, 14 * 60);
  assert.equal(rows[0]!.uncertainEndMin, 15 * 60 + 30);
  assert.equal(rows[0]!.syncLagging, true);
});
