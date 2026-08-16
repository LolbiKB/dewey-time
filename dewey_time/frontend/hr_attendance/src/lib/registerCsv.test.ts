import assert from "node:assert/strict";
import test from "node:test";

import {
  registerCsvRows, visibleColumnIds, type FeedHealth, type RegisterRow,
} from "@/lib/coverageRegister";
import { toRegisterCsv } from "@/lib/registerCsv";

const HEALTHY: FeedHealth = { schedule: true, biometric: true };

const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
  id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
  // No Khmer name is the common case for these fixtures.
  khmer_name: null,
  image: null,
  telegram: "none",
  status: "Active", schedule: "assigned", weekly_minutes: 2400,
  biometric: "enrolled", fingerprint_count: 2, days_since_relieving: null,
  // Both feeds know this employee — the ordinary row. Override it to build the
  // one-witness rows suppressUnusableFacts has to drop.
  sources: { schedule: true, biometric: true }, ...over,
});

/** The file's header line, split back into fields (none of them quoted here). */
function headers(csv: string): string[] {
  return csv.split("\n")[0].split(",");
}

// ---------------------------------------------------------------------------
// Which columns the file carries
// ---------------------------------------------------------------------------

test("the healthy header line is pinned whole, so no field can be mislabelled or reordered", () => {
  assert.deepEqual(headers(toRegisterCsv([row()], HEALTHY)), [
    "Employee ID",
    "Name",
    "Branch",
    "Department",
    "Employment status",
    "Schedule",
    "Weekly minutes",
    "Biometric",
    "Fingerprints",
    "Days since leaving",
    "Telegram",
  ]);
});

test("a data row is pinned whole, in the header's order", () => {
  const csv = toRegisterCsv(
    [row({ biometric: "still_enrolled", status: "Left", days_since_relieving: 42 })],
    HEALTHY,
  );
  assert.equal(
    csv.split("\n")[1],
    "E1,Sok Dara,DIU,Finance,Left,Assigned,2400,Still enrolled,2,42,Not linked",
  );
});

test("the file is keyed off FEED HEALTH, not off the table's visible columns", () => {
  // The two used to be the same list, and are not any more. The print count was
  // fused into the biometric cell to buy back a column, so there is no
  // `fingerprint_count` column to derive a "Fingerprints" field from — a CSV
  // still keyed off `visibleColumnIds` would have dropped the field silently
  // the moment that fusion landed, and nothing in the file would have said so.
  //
  // A spreadsheet has no width pressure and does want a number it can sort and
  // total, so the field stays. Both halves of the claim are pinned here,
  // because either alone is satisfiable by the wrong implementation.
  assert.ok(
    !visibleColumnIds(HEALTHY).includes("fingerprint_count"),
    "there is no prints column — if one comes back, this test has stopped meaning anything",
  );
  assert.ok(
    headers(toRegisterCsv([row()], HEALTHY)).includes("Fingerprints"),
    "and the file exports it anyway, because the biometric FEED is healthy",
  );

  // The other direction: feed health still governs. A hidden feed removes all
  // THREE of its fields, the column-less one included — exporting a fact the
  // page is refusing to show would put it in a document that outlives the
  // outage.
  const hidden = headers(toRegisterCsv([row()], { schedule: true, biometric: false }));
  for (const gone of ["Biometric", "Fingerprints", "Employment status", "Days since leaving"]) {
    assert.ok(!hidden.includes(gone), `${gone} belongs to the biometric feed and must go with it`);
  }
});

test("a downed biometric feed takes its fields out of the file, exactly as it takes its columns", () => {
  // Exporting a column the page refuses to show would write a fact the reader
  // was denied into a file that outlives the outage — and a spreadsheet has no
  // banner to explain why every Biometric cell is empty.
  const csv = toRegisterCsv([row()], { schedule: true, biometric: false });
  const got = headers(csv);
  for (const gone of ["Employment status", "Biometric", "Fingerprints", "Days since leaving"]) {
    assert.ok(!got.includes(gone), `${gone} must be gone, not blank`);
  }
  // The schedule half is unaffected — the two feeds fail independently.
  assert.ok(got.includes("Schedule"));
  assert.ok(got.includes("Weekly minutes"));
  // And the data row must be the same width as the header, or every field
  // after the first gap lands under the wrong name.
  assert.equal(csv.split("\n")[1].split(",").length, got.length);
});

test("a downed schedule feed takes only its own fields", () => {
  const got = headers(toRegisterCsv([row()], { schedule: false, biometric: true }));
  assert.ok(!got.includes("Schedule"));
  assert.ok(!got.includes("Weekly minutes"));
  assert.ok(got.includes("Biometric"));
  assert.ok(got.includes("Employment status"));
});

test("the always-visible fields survive both feeds being down", () => {
  // Without this, the suppression tests above would pass just as well against
  // an export that had collapsed to nothing at all.
  assert.deepEqual(headers(toRegisterCsv([row()], { schedule: false, biometric: false })), [
    "Employee ID",
    "Name",
    "Branch",
    "Department",
  ]);
});

test("the export writes the rows it was given, and only those", () => {
  // The caller hands over the filtered, sorted rows — what the reader is
  // actually looking at. An export that reached past them for the whole roster
  // would hand someone a file that contradicts the screen they exported it
  // from, and there is no way to tell from the file which one it is.
  const csv = toRegisterCsv(
    [row({ id: "KEPT", employee_name: "Kept Person" })],
    HEALTHY,
  );
  assert.match(csv, /KEPT/);
  assert.doesNotMatch(csv, /Dropped/);
  assert.equal(csv.split("\n").length, 2, "one header line and one data line");
});

test("row order is the caller's, not re-sorted on the way out", () => {
  const csv = toRegisterCsv([row({ id: "Z" }), row({ id: "A" })], HEALTHY);
  assert.deepEqual(
    csv.split("\n").slice(1).map((line) => line.split(",")[0]),
    ["Z", "A"],
  );
});

// ---------------------------------------------------------------------------
// Absent facts
// ---------------------------------------------------------------------------

test("a null cell is an empty field, never a zero or a placeholder", () => {
  const csv = toRegisterCsv(
    [row({ branch: null, department: null, weekly_minutes: null, fingerprint_count: null,
           status: null, schedule: null, biometric: null, days_since_relieving: null,
           telegram: null })],
    HEALTHY,
  );
  assert.equal(csv.split("\n")[1], "E1,Sok Dara,,,,,,,,,");
  assert.doesNotMatch(csv.split("\n")[1], /0/, "an absent number must not export as 0");
  assert.doesNotMatch(csv, /—/, "the table's em dash is a rendering, not a value");
});

test("a real zero still exports as 0 — it is a finding, not an absence", () => {
  // The direction the test above cannot check on its own: blanking every
  // falsy value would satisfy it while destroying the one distinction the
  // whole register rests on. Nobody enrolled and no report of enrolment are
  // different facts, and a spreadsheet cannot recover the difference later.
  const line = toRegisterCsv([row({ weekly_minutes: 0, fingerprint_count: 0 })], HEALTHY)
    .split("\n")[1]
    .split(",");
  assert.equal(line[6], "0", "0 weekly minutes is a real, assigned, empty schedule");
  assert.equal(line[8], "0", "0 fingerprints is the enrolment finding itself");
});

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

test("a field containing a comma is quoted", () => {
  // "Reyes, Ana" is an ordinary name here. Unquoted it becomes two fields and
  // shifts every later value on the row one column left — silently.
  const csv = toRegisterCsv([row({ employee_name: "Reyes, Ana" })], HEALTHY);
  assert.match(csv, /"Reyes, Ana"/);
  // The whole line, so the quoting is pinned IN PLACE rather than in
  // isolation. Counting the pieces of a naive split(",") cannot do this: an
  // unquoted "Reyes, Ana" yields the same eleven pieces a quoted one does, so
  // the count holds whichever way the field went out.
  assert.equal(
    csv.split("\n")[1],
    'E1,"Reyes, Ana",DIU,Finance,Active,Assigned,2400,Enrolled,2,,Not linked',
  );
});

test("an embedded quote is doubled, inside a quoted field", () => {
  const csv = toRegisterCsv([row({ employee_name: 'Ana "Nan" Reyes' })], HEALTHY);
  assert.match(csv, /"Ana ""Nan"" Reyes"/);
});

test("a field containing a newline is quoted", () => {
  const csv = toRegisterCsv([row({ department: "Ops\nNight" })], HEALTHY);
  assert.match(csv, /"Ops\nNight"/);
});

test("a field containing a lone carriage return is quoted", () => {
  // Excel and anything honouring classic Mac line endings treat a bare \r as a
  // record separator, so an unquoted one splits the row in half.
  const csv = toRegisterCsv([row({ department: "Ops\rNight" })], HEALTHY);
  assert.match(csv, /"Ops\rNight"/);
});

test("an ordinary field is not quoted", () => {
  // Direction: quoting everything would pass every test above.
  assert.match(toRegisterCsv([row()], HEALTHY), /\nE1,Sok Dara,DIU,/);
});

// ---------------------------------------------------------------------------
// Formula injection
// ---------------------------------------------------------------------------

test("a field a spreadsheet would run as a formula is marked as text", () => {
  // Excel and Sheets evaluate any cell whose text begins = + - or @. A name or
  // a branch carrying one arrives from Frappe as ordinary text and becomes code
  // the moment the file is opened — =HYPERLINK() posting the row somewhere, or
  // a DDE call — and the reader who opened it is HR, on the machine that has
  // the roster on it.
  for (const value of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
    const line = toRegisterCsv([row({ employee_name: value })], HEALTHY).split("\n")[1];
    assert.equal(
      line,
      `E1,'${value},DIU,Finance,Active,Assigned,2400,Enrolled,2,,Not linked`,
      `${value} must go out marked as text`,
    );
  }
  // Direction is held by "a data row is pinned whole" above: marking every
  // field would move that line, so this cannot be satisfied by a blanket
  // prefix.
});

test("a formula field that also needs quoting gets both, in that order", () => {
  // The realistic payload: a hyperlink carries commas and quotes of its own, so
  // the text marker has to sit INSIDE the quoted field, not before it — a
  // leading apostrophe outside the quotes would make the whole field unquoted
  // again and split the row.
  const csv = toRegisterCsv(
    [row({ employee_name: '=HYPERLINK("http://x","click")' })],
    HEALTHY,
  );
  assert.match(csv, /,"'=HYPERLINK\(""http:\/\/x"",""click""\)",/);
});

// ---------------------------------------------------------------------------
// The grid underneath
// ---------------------------------------------------------------------------

test("registerCsvRows returns a header row plus one row per employee, all the same width", () => {
  const grid = registerCsvRows([row({ id: "A" }), row({ id: "B" })], HEALTHY);
  assert.equal(grid.length, 3);
  for (const line of grid) assert.equal(line.length, grid[0].length);
  assert.deepEqual(grid.slice(1).map((line) => line[0]), ["A", "B"]);
});

test("registerCsvRows still emits its header row when there are no employees", () => {
  // An empty export must be an empty table, not an empty file: a reader who
  // opens one needs to see that they exported nothing, not wonder if it broke.
  const grid = registerCsvRows([], HEALTHY);
  assert.equal(grid.length, 1);
  assert.equal(grid[0][0], "Employee ID");
});
