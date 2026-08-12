import assert from "node:assert/strict";
import test from "node:test";

import {
  isFeedConnected,
  parseFrappeDatetime,
  type EnrollmentPayload,
} from "@/lib/enrollmentReport";

function payload(over: Partial<EnrollmentPayload> = {}): EnrollmentPayload {
  return {
    rows: [],
    counts: {
      reported: 0,
      needs_enrollment: 0,
      enrolled_not_punching: 0,
      ok: 0,
      leaver_still_enrolled: 0,
      excluded_status: 0,
      truncated: false,
    },
    last_snapshot_at: "2026-08-11 09:14:03",
    window_days: 14,
    ...over,
  };
}

test("isFeedConnected: is false when no snapshot has ever arrived", () => {
  // The load-bearing one. Without this the page renders every employee as
  // unenrolled and HR responds to a plumbing failure as though it were data.
  assert.equal(isFeedConnected(payload({ last_snapshot_at: null })), false);
});

test("isFeedConnected: is false while the payload is still undefined", () => {
  assert.equal(isFeedConnected(undefined), false);
});

test("isFeedConnected: is true once a snapshot exists", () => {
  assert.equal(isFeedConnected(payload()), true);
});

test("parseFrappeDatetime reads a site-local Frappe datetime", () => {
  // LOCAL, deliberately — no trailing Z. Frappe datetimes are site-local, so a
  // UTC reading here would compare two different frames. Measured on the page
  // this replaced: that mistake yields 466 minutes at UTC+07 and 46 on a UTC
  // CI runner — a test that passes in CI and fails on a laptop.
  assert.equal(
    parseFrappeDatetime("2026-08-11 09:14:03"),
    new Date("2026-08-11T09:14:03").getTime(),
  );
});

test("parseFrappeDatetime returns null on a timestamp it cannot read, never NaN", () => {
  // feedHealth divides by this. NaN would compare false against the staleness
  // threshold, so an unreadable timestamp would report the bridge as HEALTHY —
  // the one direction that must never happen by accident.
  assert.equal(parseFrappeDatetime("not a date"), null);
  assert.equal(parseFrappeDatetime(""), null);
});
