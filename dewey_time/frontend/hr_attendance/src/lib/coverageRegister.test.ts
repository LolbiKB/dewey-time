import assert from "node:assert/strict";
import test from "node:test";

import {
  feedHealth, filterRegisterRows, isNotReady, joinRegisterRows, registerAlert, sortRegisterRows,
  visibleColumnIds, type RegisterFilters, type RegisterRow,
} from "@/lib/coverageRegister";
import type { ScheduleCoveragePayload } from "@/lib/scheduleCoverage";
import type { EnrollmentPayload } from "@/lib/enrollmentReport";

function coverage(over: Partial<ScheduleCoveragePayload> = {}): ScheduleCoveragePayload {
  return {
    unassigned: [],
    assigned: [],
    counts: { active: 0, unassigned: 0, assigned: 0, truncated: false },
    ...over,
  };
}

function enrollment(over: Partial<EnrollmentPayload> = {}): EnrollmentPayload {
  return {
    rows: [],
    counts: {
      reported: 0, needs_enrollment: 0, enrolled_not_punching: 0, ok: 0,
      leaver_still_enrolled: 0, excluded_status: 0, truncated: false,
    },
    last_snapshot_at: "2026-08-12 09:00:00",
    window_days: 30,
    ...over,
  };
}

test("an employee in both feeds becomes one row carrying both halves", () => {
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Sok Dara", department: "Finance",
                   branch: "DIU", weekly_minutes: 2400 }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
               status: "Active", bucket: "OK", is_registered: true,
               fingerprint_count: 2, face_count: 0, days_since_relieving: null }],
    }),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { schedule: rows[0].schedule, biometric: rows[0].biometric, weekly_minutes: rows[0].weekly_minutes },
    { schedule: "assigned", biometric: "enrolled", weekly_minutes: 2400 },
  );
});

test("a leaver present only in the enrollment feed is KEPT", () => {
  // Coverage filters status:Active server-side, so a leaver never appears
  // there. Dropping rows missing from coverage would delete the security
  // finding this page exists to surface.
  const rows = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [{ id: "E9", employee_name: "Ly Vanna", branch: "PM Primary", department: "Teaching",
               status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
               fingerprint_count: 1, face_count: 0, days_since_relieving: 12 }],
    }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].biometric, "still_enrolled");
  assert.equal(rows[0].days_since_relieving, 12);
  assert.equal(rows[0].schedule, null, "no schedule fact is known for someone coverage never returned");
});

test("an employee only in the coverage feed keeps null biometric, never 'none'", () => {
  // "none" means the bridge told us there is no template. Absence of a row is
  // not that statement, and rendering it as one invents a finding.
  const rows = joinRegisterRows(
    coverage({
      unassigned: [{ id: "E2", employee_name: "Chan Sophea", department: "Ops", branch: "DIU" }],
      counts: { active: 1, unassigned: 1, assigned: 0, truncated: false },
    }),
    enrollment(),
  );
  assert.equal(rows[0].biometric, null);
  assert.equal(rows[0].schedule, "missing");
  // Moved here from the "branch comes from coverage" test below: this test's
  // enrollment feed is present (not undefined) and reporting (last_snapshot_at
  // set), so the merge loop actually runs — it just has no row for E2. That
  // makes this a live check on the seeded default rather than an assertion
  // that passes only because the merge loop never executes at all.
  assert.equal(rows[0].status, null, "status is a biometric-feed fact; never defaulted to Active");
});

test("branch comes from coverage so it survives a missing biometric feed", () => {
  const rows = joinRegisterRows(
    coverage({
      unassigned: [{ id: "E2", employee_name: "Chan Sophea", department: "Ops", branch: "DIU" }],
      counts: { active: 1, unassigned: 1, assigned: 0, truncated: false },
    }),
    undefined,
  );
  assert.equal(rows[0].branch, "DIU");
});

test("branch precedence: coverage wins when both feeds report the same employee with different branches", () => {
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Sok Dara", department: "Finance",
                   branch: "DIU", weekly_minutes: 2400 }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "PM Primary", department: "Finance",
               status: "Active", bucket: "OK", is_registered: true,
               fingerprint_count: 2, face_count: 0, days_since_relieving: null }],
    }),
  );
  assert.equal(rows[0].branch, "DIU");
});

test("rows are returned in employee-name order", () => {
  const rows = joinRegisterRows(
    coverage({
      unassigned: [
        { id: "E2", employee_name: "Zara", department: null, branch: null },
        { id: "E1", employee_name: "Alice", department: null, branch: null },
      ],
      counts: { active: 2, unassigned: 2, assigned: 0, truncated: false },
    }),
    enrollment(),
  );
  assert.deepEqual(rows.map((r) => r.employee_name), ["Alice", "Zara"]);
});

test("a bridge that has never reported contributes no biometric facts and no enrollment-only rows", () => {
  // last_snapshot_at: null means the bridge has never spoken at all. With no
  // guard, every enrollment row — including one that exists only in this feed
  // — would compute a bucket and be treated as a fact. That is not a fact we
  // have: we cannot know about a leaver still holding a template when the
  // bridge that reports templates has never reported anything.
  const rows = joinRegisterRows(
    coverage({
      unassigned: [{ id: "E2", employee_name: "Chan Sophea", department: "Ops", branch: "DIU" }],
      counts: { active: 1, unassigned: 1, assigned: 0, truncated: false },
    }),
    enrollment({
      rows: [{ id: "E9", employee_name: "Ly Vanna", branch: "PM Primary", department: "Teaching",
               status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
               fingerprint_count: 1, face_count: 0, days_since_relieving: 12 }],
      last_snapshot_at: null,
    }),
  );
  assert.equal(rows.length, 1, "the never-reported leaver row must not be introduced");
  assert.equal(rows[0].id, "E2");
  assert.equal(rows[0].biometric, null);
  assert.equal(rows[0].status, null);
  assert.equal(rows[0].fingerprint_count, null);
  assert.equal(rows[0].days_since_relieving, null);
});

test("ENROLLED_NOT_PUNCHING stays distinct from OK", () => {
  const rows = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [
        { id: "E3", employee_name: "Pich Ratana", branch: "DIU", department: "Ops",
          status: "Active", bucket: "ENROLLED_NOT_PUNCHING", is_registered: true,
          fingerprint_count: 1, face_count: 0, days_since_relieving: null },
        { id: "E4", employee_name: "Chea Sopheak", branch: "DIU", department: "Ops",
          status: "Active", bucket: "OK", is_registered: true,
          fingerprint_count: 1, face_count: 0, days_since_relieving: null },
      ],
    }),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("E3")?.biometric, "enrolled_not_punching");
  assert.equal(byId.get("E4")?.biometric, "enrolled");
});

const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
  id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
  status: "Active", schedule: "assigned", weekly_minutes: 2400,
  biometric: "enrolled", fingerprint_count: 2, days_since_relieving: null, ...over,
});

test("not-ready covers missing schedule, missing template, and live leavers", () => {
  assert.equal(isNotReady(row({ schedule: "missing" })), true);
  assert.equal(isNotReady(row({ biometric: "none" })), true);
  assert.equal(isNotReady(row({ biometric: "still_enrolled" })), true);
  assert.equal(isNotReady(row()), false);
});

test("an unknown fact is not a problem", () => {
  // A null biometric means the feed is down, not that someone is unenrolled.
  // Counting it as not-ready would report 241 findings during an outage.
  assert.equal(isNotReady(row({ biometric: null })), false);
  assert.equal(isNotReady(row({ schedule: null, biometric: "enrolled" })), false);
});

test("enrolled-but-not-punching is not a readiness problem", () => {
  // They can clock in; they simply have not. That is an attendance question,
  // not a coverage one, and putting it here floods the list.
  assert.equal(isNotReady(row({ biometric: "enrolled", fingerprint_count: 1 })), false);
});

test("search matches name and employee id, case-insensitively", () => {
  const rows = [row({ id: "HR-EMP-0042", employee_name: "Sok Dara" }),
                row({ id: "HR-EMP-0117", employee_name: "Chan Sophea" })];
  assert.equal(filterRegisterRows(rows, { search: "sok" }).length, 1);
  assert.equal(filterRegisterRows(rows, { search: "0117" })[0].employee_name, "Chan Sophea");
  assert.equal(filterRegisterRows(rows, { search: "   " }).length, 2);
});

test("filters compose — problems AND one branch", () => {
  const rows = [
    row({ id: "A", employee_name: "A", branch: "DIU", schedule: "missing" }),
    row({ id: "B", employee_name: "B", branch: "PM", schedule: "missing" }),
    row({ id: "C", employee_name: "C", branch: "DIU" }),
  ];
  const got = filterRegisterRows(rows, { readiness: "not-ready", branch: ["DIU"] });
  assert.deepEqual(got.map((r) => r.id), ["A"]);
});

test("department, status, schedule, and biometric filters each exclude the non-matching row", () => {
  // Table-driven so each of the four equality predicates gets its own
  // matched/unmatched pair — the brief's own test list never exercised any
  // of these individually, and deleting any one line left the suite green.
  const cases: { name: string; filters: RegisterFilters; keep: Partial<RegisterRow>; drop: Partial<RegisterRow> }[] = [
    { name: "department", filters: { department: ["Finance"] },
      keep: { department: "Finance" }, drop: { department: "Ops" } },
    { name: "status", filters: { status: "Active" },
      keep: { status: "Active" }, drop: { status: "Left" } },
    { name: "schedule", filters: { schedule: "assigned" },
      keep: { schedule: "assigned" }, drop: { schedule: "missing" } },
    { name: "biometric", filters: { biometric: "enrolled" },
      keep: { biometric: "enrolled" }, drop: { biometric: "none" } },
  ];

  for (const { name, filters, keep, drop } of cases) {
    const rows = [row({ id: "KEEP", ...keep }), row({ id: "DROP", ...drop })];
    assert.deepEqual(
      filterRegisterRows(rows, filters).map((r) => r.id),
      ["KEEP"],
      `the ${name} filter must drop the non-matching row`,
    );
  }
});

test("a branch filter excludes a row with no branch fact; an empty branch list filters nothing", () => {
  const rows = [row({ id: "DIU", branch: "DIU" }), row({ id: "UNKNOWN", branch: null })];
  // Absent data is never rendered as a fact: a row with no branch fact cannot
  // satisfy "is in this branch", so `?? ""` must exclude it, not default it in.
  assert.deepEqual(
    filterRegisterRows(rows, { branch: ["DIU"] }).map((r) => r.id),
    ["DIU"],
  );
  // An empty selection is "no branch filter applied", not "match nothing" —
  // the `?.length` guard is what tells the two apart.
  assert.deepEqual(
    filterRegisterRows(rows, { branch: [] }).map((r) => r.id),
    ["DIU", "UNKNOWN"],
  );
});

test("severity order when filtered to problems, name order otherwise", () => {
  // Four ranks, four rows, names deliberately NOT in severity order (nor even
  // close to it) so alphabetical sort and severity sort cannot coincide by
  // luck — a fixture where they coincide can't tell the two code paths apart.
  // The fourth row's biometric is `enrolled_not_punching` specifically:
  // severity() must fall through to the same "no finding" rank as a fully
  // ready row for it, and nothing else in this file pins that fall-through.
  const rows = [
    row({ id: "L", employee_name: "Nora", biometric: "still_enrolled", status: "Left" }),
    row({ id: "N", employee_name: "Wendy", biometric: "none" }),
    row({ id: "S", employee_name: "Zed", schedule: "missing", biometric: "enrolled" }),
    row({ id: "P", employee_name: "Amy", biometric: "enrolled_not_punching" }),
  ];
  assert.deepEqual(
    sortRegisterRows(rows, { readiness: "not-ready" }).map((r) => r.id),
    ["L", "N", "S", "P"],
    "leaver, then no-template, then no-schedule, then not-a-finding — not alphabetical order",
  );
  assert.deepEqual(
    sortRegisterRows(rows, {}).map((r) => r.employee_name),
    ["Amy", "Nora", "Wendy", "Zed"],
  );
});

test("sorting by hours puts unknown minutes last in both directions", () => {
  // Three rows, input order B, A, C (known-high, unknown, known-low), is
  // deliberate — brute-forced against all six permutations. This is the only
  // order that exercises BOTH null guards: dropping `if (av === null)
  // return 1` and flipping `if (bv === null) return -1` to `return 1` each
  // turn this test red only with this ordering, not e.g. C, A, B.
  const rows = [
    row({ id: "B", weekly_minutes: 2400 }),
    row({ id: "A", weekly_minutes: null }),
    row({ id: "C", weekly_minutes: 1200 }),
  ];
  assert.deepEqual(
    sortRegisterRows(rows, { sort: "hours", order: "asc" }).map((r) => r.id),
    ["C", "B", "A"],
  );
  assert.deepEqual(
    sortRegisterRows(rows, { sort: "hours", order: "desc" }).map((r) => r.id),
    ["B", "C", "A"],
  );
});

test("sorting by prints uses fingerprint_count, not weekly_minutes", () => {
  // weekly_minutes and fingerprint_count are inversely ordered on purpose: if
  // the "prints" branch ever read the wrong key, this fixture flips the
  // result instead of leaving it coincidentally correct.
  const rows = [
    row({ id: "X", weekly_minutes: 100, fingerprint_count: 5 }),
    row({ id: "Y", weekly_minutes: 900, fingerprint_count: 1 }),
  ];
  assert.deepEqual(
    sortRegisterRows(rows, { sort: "prints", order: "asc" }).map((r) => r.id),
    ["Y", "X"],
  );
});

test("sorting by name honors order: desc", () => {
  const rows = [row({ id: "A", employee_name: "Amy" }), row({ id: "Z", employee_name: "Zed" })];
  assert.deepEqual(
    sortRegisterRows(rows, { sort: "name", order: "desc" }).map((r) => r.id),
    ["Z", "A"],
  );
});

test("sortRegisterRows does not mutate the caller's array", () => {
  const rows = [row({ id: "Z", employee_name: "Zed" }), row({ id: "A", employee_name: "Amy" })];
  const originalOrder = rows.map((r) => r.id);
  sortRegisterRows(rows, {});
  assert.deepEqual(rows.map((r) => r.id), originalOrder);
});

const HEALTHY = { schedule: true, biometric: true };

test("the alert counts problems and reads as a problem", () => {
  const got = registerAlert([row(), row({ id: "X", schedule: "missing" })], HEALTHY);
  assert.equal(got.tone, "problem");
  assert.equal(got.count, 1);
  assert.equal(got.knowable, true);
  assert.match(got.label, /1 needs attention/i);
});

test("all clear is a rendered state, never an absence", () => {
  // A missing indicator cannot distinguish "nothing wrong" from "failed to
  // load", so the clear state has to be something you can see.
  const got = registerAlert([row(), row({ id: "B", employee_name: "B" })], HEALTHY);
  assert.equal(got.tone, "clear");
  assert.equal(got.count, 0);
  assert.match(got.label, /all 2 ready/i);
});

test("a dead biometric feed degrades the alert and says what it cannot see", () => {
  const got = registerAlert(
    [row({ biometric: null, schedule: "missing" })],
    { schedule: true, biometric: false },
  );
  assert.equal(got.tone, "degraded");
  assert.equal(got.knowable, false);
  assert.match(got.label, /biometrics unavailable/i);
});

test("a degraded alert still reports the problems it CAN see", () => {
  const got = registerAlert(
    [row({ biometric: null, schedule: "missing" }), row({ id: "B", biometric: null })],
    { schedule: true, biometric: false },
  );
  assert.equal(got.count, 1);
});

test("a dead biometric feed hides the biometric columns AND status", () => {
  // Status is a biometric-feed fact: coverage filters status:Active, so every
  // row it returns is Active by construction and leavers never appear there.
  // Showing "Active" for all 241 would assert what the data cannot support.
  const hidden = visibleColumnIds({ schedule: true, biometric: false });
  assert.ok(!hidden.includes("biometric"));
  assert.ok(!hidden.includes("fingerprint_count"));
  assert.ok(!hidden.includes("status"));
  assert.ok(hidden.includes("branch"), "branch comes from the schedule feed and survives");
  assert.ok(hidden.includes("schedule"));
});

test("a dead schedule feed hides only its own columns", () => {
  const shown = visibleColumnIds({ schedule: false, biometric: true });
  assert.ok(!shown.includes("schedule"));
  assert.ok(!shown.includes("weekly_minutes"));
  assert.ok(shown.includes("biometric"));
  // Added by mutation testing (Task 4): moving "branch" from ALWAYS into
  // SCHEDULE_COLUMNS left the suite green because neither existing test
  // checked branch's fate when the schedule feed specifically is down.
  assert.ok(shown.includes("branch"), "branch is an always-on column, not a schedule fact");
});

test("feed health treats a never-reported snapshot as down", () => {
  const now = Date.parse("2026-08-12T09:00:00Z");
  assert.equal(feedHealth(undefined, undefined, now).biometric, false);
  assert.equal(
    feedHealth(undefined, { rows: [], counts: {} as never, last_snapshot_at: null, window_days: 30 }, now).biometric,
    false,
  );
});

test("feed health treats a snapshot older than the shared stale threshold as down", () => {
  const now = Date.parse("2026-08-12T09:00:00Z");
  const fresh = { rows: [], counts: {} as never, last_snapshot_at: "2026-08-12 08:00:00", window_days: 30 };
  const old = { rows: [], counts: {} as never, last_snapshot_at: "2026-08-09 08:00:00", window_days: 30 };
  assert.equal(feedHealth(undefined, fresh, now).biometric, true);
  assert.equal(feedHealth(undefined, old, now).biometric, false);
});
