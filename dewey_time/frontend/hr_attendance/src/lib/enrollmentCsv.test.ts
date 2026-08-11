import assert from "node:assert/strict";
import test from "node:test";

import { toEnrollmentCsv } from "@/lib/enrollmentCsv";
import type { EnrollmentRow } from "@/lib/enrollmentReport";

const ROWS: EnrollmentRow[] = [
  {
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
  },
];

test("toEnrollmentCsv: puts the snapshot time in the file, not only the filename", () => {
  // A CSV outlives its context. Without this row, stale enrollment data
  // looks current three weeks later.
  const csv = toEnrollmentCsv(ROWS, {
    snapshotAt: "2026-08-11 09:14:03",
    filterLabel: "All branches",
  });
  assert.equal(csv.split("\n")[0], "Snapshot taken,2026-08-11 09:14:03");
});

test("toEnrollmentCsv: records the filter so a partial export cannot read as the whole roster", () => {
  const csv = toEnrollmentCsv(ROWS, { snapshotAt: null, filterLabel: "Branch: ACES" });
  assert.ok(csv.includes("Filter,Branch: ACES"));
});

test("toEnrollmentCsv: says so explicitly when no snapshot exists", () => {
  const csv = toEnrollmentCsv(ROWS, { snapshotAt: null, filterLabel: "All" });
  assert.equal(csv.split("\n")[0], "Snapshot taken,never — feed not connected");
});

test("toEnrollmentCsv: quotes fields containing a comma", () => {
  const csv = toEnrollmentCsv([{ ...ROWS[0], employee_name: "Reyes, Ana" }], {
    snapshotAt: null,
    filterLabel: "All",
  });
  assert.ok(csv.includes('"Reyes, Ana"'));
});

test("toEnrollmentCsv: doubles embedded quotes", () => {
  const csv = toEnrollmentCsv([{ ...ROWS[0], employee_name: 'Ana "Nan" Reyes' }], {
    snapshotAt: null,
    filterLabel: "All",
  });
  assert.ok(csv.includes('"Ana ""Nan"" Reyes"'));
});

test("toEnrollmentCsv: emits an empty cell for an unknown leaving date rather than 0", () => {
  const csv = toEnrollmentCsv(ROWS, { snapshotAt: null, filterLabel: "All" });
  assert.match(csv.trimEnd().split("\n").at(-1) ?? "", /,$/);
});
