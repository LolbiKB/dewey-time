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

test("toEnrollmentCsv: the header line is pinned whole, so no column can be mislabelled", () => {
  // Every other assertion here matches a fragment, which passes happily while
  // HEADERS drifts out of step with the row array below it -- shipping a file
  // whose column titles say one thing and whose cells contain another. Both
  // lines are therefore pinned entire, and in order.
  const csv = toEnrollmentCsv(ROWS, {
    snapshotAt: "2026-08-11 09:14:03",
    filterLabel: "All employees",
  });
  assert.equal(
    csv.split("\n")[3],
    "Employee ID,Name,Branch,Department,Employment status,Enrollment state,Fingerprints,Days since leaving",
  );
});

test("toEnrollmentCsv: a data row is pinned whole, in the header's order", () => {
  const csv = toEnrollmentCsv(ROWS, {
    snapshotAt: "2026-08-11 09:14:03",
    filterLabel: "All employees",
  });
  assert.equal(csv.split("\n")[4], "E1,Ana Reyes,ACES,Ops,Active,Needs enrolling,0,");
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

test("toEnrollmentCsv: quotes a field containing a newline", () => {
  // Unquoted, the cell ends the record early and every column after it in the
  // file shifts up a row.
  const csv = toEnrollmentCsv([{ ...ROWS[0], department: "Ops\nNight" }], {
    snapshotAt: null,
    filterLabel: "All",
  });
  assert.ok(csv.includes('"Ops\nNight"'));
});

test("toEnrollmentCsv: quotes a field containing a lone carriage return", () => {
  // A bare \r is a record separator to any parser that still honours classic
  // Mac line endings -- Excel among them -- so it needs quoting exactly as \n
  // does, even though it never arrives from a well-behaved source.
  const csv = toEnrollmentCsv([{ ...ROWS[0], department: "Ops\rNight" }], {
    snapshotAt: null,
    filterLabel: "All",
  });
  assert.ok(csv.includes('"Ops\rNight"'));
});

test("toEnrollmentCsv: emits an empty cell for an unknown leaving date rather than 0", () => {
  const csv = toEnrollmentCsv(ROWS, { snapshotAt: null, filterLabel: "All" });
  assert.match(csv.trimEnd().split("\n").at(-1) ?? "", /,$/);
});
