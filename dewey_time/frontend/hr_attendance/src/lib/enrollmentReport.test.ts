import assert from "node:assert/strict";
import test from "node:test";

import {
  describeFilters,
  filterRows,
  groupRows,
  isFeedConnected,
  snapshotNotice,
  type EnrollmentPayload,
  type EnrollmentRow,
} from "@/lib/enrollmentReport";

// LOCAL, deliberately — no trailing Z. Frappe datetimes are site-local and
// parseFrappeDatetime reads them as local, so a UTC `now` here would compare
// two different frames. Measured: that mistake yields 466 minutes at UTC+07
// and 46 on a UTC CI runner — a test that passes in CI and fails on a laptop.
const NOW = new Date("2026-08-11T10:00:00").getTime();

function row(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "E1",
    employee_name: "Ana Reyes",
    branch: "ACES",
    department: "Ops",
    status: "Active",
    bucket: "NEEDS_ENROLLMENT",
    is_registered: false,
    fingerprint_count: 0,
    face_count: 0,
    days_since_relieving: null,
    ...over,
  };
}

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

test("snapshotNotice: reports a fresh snapshot in minutes without alarming", () => {
  const notice = snapshotNotice(payload(), NOW);
  assert.equal(notice?.stale, false);
  assert.ok(notice?.text.includes("46 minutes ago"));
});

test("snapshotNotice: marks a snapshot older than a day as stale", () => {
  const notice = snapshotNotice(payload({ last_snapshot_at: "2026-08-09 09:00:00" }), NOW);
  assert.equal(notice?.stale, true);
});

test("snapshotNotice: returns null when there is nothing to date", () => {
  assert.equal(snapshotNotice(payload({ last_snapshot_at: null }), NOW), null);
});

test("snapshotNotice: returns null rather than NaN on an unparseable timestamp", () => {
  assert.equal(snapshotNotice(payload({ last_snapshot_at: "not a date" }), NOW), null);
});

const FILTER_ROWS = [
  row({ id: "E1", branch: "ACES", department: "Ops", bucket: "NEEDS_ENROLLMENT" }),
  row({ id: "E2", branch: "DIU", department: "Finance", bucket: "OK" }),
  row({ id: "E3", branch: "ACES", department: "Finance", bucket: "LEAVER_STILL_ENROLLED" }),
];

test("filterRows: returns everything when no filter is set", () => {
  assert.equal(filterRows(FILTER_ROWS, { branches: [], departments: [], buckets: [] }).length, 3);
});

test("filterRows: narrows by branch", () => {
  const out = filterRows(FILTER_ROWS, { branches: ["ACES"], departments: [], buckets: [] });
  assert.deepEqual(out.map((r) => r.id), ["E1", "E3"]);
});

test("filterRows: ANDs across axes and ORs within one", () => {
  const out = filterRows(FILTER_ROWS, {
    branches: ["ACES"],
    departments: ["Finance"],
    buckets: ["LEAVER_STILL_ENROLLED", "OK"],
  });
  assert.deepEqual(out.map((r) => r.id), ["E3"]);
});

const GROUP_ROWS = [
  row({ id: "E1", branch: "DIU" }),
  row({ id: "E2", branch: "ACES" }),
  row({ id: "E3", branch: null }),
];

test("groupRows: groups by branch, alphabetically", () => {
  const groups = groupRows(GROUP_ROWS, "branch");
  assert.deepEqual(
    groups.map((g) => g.key),
    ["ACES", "DIU", "Unassigned"],
  );
});

test("groupRows: collects rows with no value under one explicit group, never dropping them", () => {
  const groups = groupRows(GROUP_ROWS, "branch");
  assert.deepEqual(
    groups.at(-1)?.rows.map((r) => r.id),
    ["E3"],
  );
});

test("describeFilters: reads as 'All employees' with no filters set", () => {
  assert.equal(describeFilters({ branches: [], departments: [], buckets: [] }), "All employees");
});

test("describeFilters: names a single active axis", () => {
  assert.equal(
    describeFilters({ branches: ["ACES"], departments: [], buckets: [] }),
    "Branch: ACES",
  );
});

test("describeFilters: joins two active axes with ' | '", () => {
  assert.equal(
    describeFilters({ branches: ["ACES"], departments: ["Ops"], buckets: [] }),
    "Branch: ACES | Department: Ops",
  );
});

test("describeFilters: renders bucket keys as their BUCKET_LABELS text, not the raw enum", () => {
  const label = describeFilters({
    branches: [],
    departments: [],
    buckets: ["LEAVER_STILL_ENROLLED"],
  });
  assert.equal(label, "State: Left — still enrolled");
  assert.doesNotMatch(label, /LEAVER_STILL_ENROLLED/);
});
