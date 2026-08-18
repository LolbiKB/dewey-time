import assert from "node:assert/strict";
import test from "node:test";

import {
  accountedFingers, applyFilterChange, columnIdForSort, composeRegister, describeRegisterFilters,
  feedHealth, filterRegisterRows, isFragileEnrollment, isNotReady, joinRegisterRows,
  paginateRegisterRows, registerAlert, registerCsvColumns, registerFacets, registerFeedState,
  REGISTER_PAGE_SIZE, sortFromColumnId, SORT_COLUMN_IDS, sortRegisterRows, suppressUnusableFacts,
  visibleColumnIds, type RegisterFilters, type RegisterRow,
} from "@/lib/coverageRegister";
import { toRegisterCsv } from "@/lib/registerCsv";
import type { ScheduleCoveragePayload } from "@/lib/scheduleCoverage";
import { STALE_AFTER_MINUTES, type EnrollmentPayload } from "@/lib/enrollmentReport";

/**
 * Formats a local Date offset from `nowMs` as a Frappe datetime string
 * ("YYYY-MM-DD HH:MM:SS"). Deliberately local (getFullYear/getMonth/etc, not
 * the UTC variants) so it lands in the same frame `parseFrappeDatetime` reads
 * it back in, whatever timezone the test runs under — see enrollmentReport
 * .test.ts's NOW comment for the measured consequence of mixing frames.
 */
function minutesBefore(nowMs: number, minutes: number): string {
  const d = new Date(nowMs - minutes * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

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

test("the photo comes from the coverage feed, and only from there", () => {
  // `image` is on CoverageEmployee and was being dropped on the floor by the
  // join. The enrolment payload has no image field at all, so a row only the
  // bridge vouches for has no photo to show — null, not a borrowed one.
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Sok Dara", department: "Finance", branch: "DIU",
                   image: "/files/sok.jpg", weekly_minutes: 2400 }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment({
      rows: [
        { id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
          status: "Active", bucket: "OK", is_registered: true,
          fingerprint_count: 2, face_count: 0, days_since_relieving: null },
        { id: "E9", employee_name: "Ly Vanna", branch: "PM", department: "Teaching",
          status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
          fingerprint_count: 1, face_count: 0, days_since_relieving: 12 },
      ],
    }),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("E1")?.image, "/files/sok.jpg", "the join must stop dropping it");
  assert.equal(
    byId.get("E9")?.image,
    null,
    "an enrolment-only row has no photo — that feed does not carry one",
  );
});

test("an employee coverage returned with no photo gets null, not undefined", () => {
  // `image` is optional on the wire and absent for most of the roster. The row
  // type is `string | null`, and EmployeeAvatar branches on falsiness — but a
  // row carrying `undefined` where every other absent fact is `null` is the
  // kind of inconsistency the CSV and JSON.stringify checks read differently.
  const rows = joinRegisterRows(
    coverage({
      unassigned: [{ id: "E2", employee_name: "Chan Sophea", department: "Ops", branch: "DIU" }],
      counts: { active: 1, unassigned: 1, assigned: 0, truncated: false },
    }),
    enrollment(),
  );
  assert.equal(rows[0].image, null);
  assert.ok("image" in rows[0], "the field must exist on every row, not only on photographed ones");
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

test("the finger slugs and the face flag ride the join", () => {
  const rows = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
               status: "Active", bucket: "OK", is_registered: true,
               fingerprint_count: 2, fingers: ["right_thumb", "right_index"],
               face_count: 1, days_since_relieving: null }],
    }),
  );
  assert.deepEqual(rows[0].fingers, ["right_thumb", "right_index"]);
  assert.equal(rows[0].face, true, "face is derived from face_count once, at the join");
});

test("a payload that predates the fingers field yields null, not an empty list", () => {
  // An old cached body did not say "no names" — it said nothing. A site
  // without the column sends a real [] and keeps it: the two shapes are
  // different statements and only one of them is silence.
  const legacy = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
               status: "Active", bucket: "OK", is_registered: true,
               fingerprint_count: 2, face_count: 0, days_since_relieving: null }],
    }),
  );
  assert.equal(legacy[0].fingers, null);
  assert.equal(legacy[0].face, false, "face_count 0 IS a report — no face");

  const noColumn = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
               status: "Active", bucket: "OK", is_registered: true,
               fingerprint_count: 2, fingers: [], face_count: 0, days_since_relieving: null }],
    }),
  );
  assert.deepEqual(noColumn[0].fingers, []);
});

test("accountedFingers names fingers only when they account for every template", () => {
  // The Mini App's honesty guard (miniProfile.fingerKeys), applied to a
  // register row. Null is the fall-back-to-the-count answer everywhere the
  // bridge sends counts without ids.
  assert.deepEqual(
    accountedFingers(row({ fingerprint_count: 2, fingers: ["right_thumb", "right_index"] })),
    ["right_thumb", "right_index"],
  );
  assert.equal(accountedFingers(row({ fingerprint_count: 2, fingers: ["right_thumb"] })), null);
  assert.equal(accountedFingers(row({ fingerprint_count: 2, fingers: [] })), null);
  assert.equal(accountedFingers(row({ fingerprint_count: 2, fingers: null })), null);
});

test("fragile means a single template on someone expected to punch", () => {
  assert.equal(isFragileEnrollment(row({ biometric: "enrolled", fingerprint_count: 1 })), true);
  assert.equal(
    isFragileEnrollment(row({ biometric: "enrolled_not_punching", fingerprint_count: 1 })),
    true,
  );
  assert.equal(isFragileEnrollment(row({ biometric: "enrolled", fingerprint_count: 2 })), false);
  // Leavers are excluded: the remedy for still_enrolled is revocation, not a
  // second finger.
  assert.equal(
    isFragileEnrollment(row({ biometric: "still_enrolled", fingerprint_count: 1 })),
    false,
  );
  assert.equal(isFragileEnrollment(row({ biometric: null, fingerprint_count: 1 })), false);
});

test("fragility never joins the attention count", () => {
  // The scope decision this feature shipped under: a quality nudge, not a
  // coverage failure. Production sits ~100 rows deep in single fingers, and
  // folding them in would drown the two findings the alert exists for.
  assert.equal(isNotReady(row({ biometric: "enrolled", fingerprint_count: 1 })), false);
});

test("the single-finger filter narrows to the fragile enrollments across both enrolled buckets", () => {
  const rows = [
    row({ id: "FRAGILE", biometric: "enrolled", fingerprint_count: 1 }),
    row({ id: "FRAGILE-NP", biometric: "enrolled_not_punching", fingerprint_count: 1 }),
    row({ id: "FINE", biometric: "enrolled", fingerprint_count: 2 }),
    row({ id: "LEAVER", biometric: "still_enrolled", fingerprint_count: 1 }),
    row({ id: "UNKNOWN", biometric: null, fingerprint_count: null }),
  ];
  assert.deepEqual(
    filterRegisterRows(rows, { biometric: "single_finger" }).map((r) => r.id),
    ["FRAGILE", "FRAGILE-NP"],
  );
});

test("the single-finger narrowing is described in its option's words", () => {
  assert.deepEqual(describeRegisterFilters({ biometric: "single_finger" }), [
    { label: "Biometric", value: "Only one finger" },
  ]);
});

const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
  id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
  // No Khmer name is the common case for these fixtures — only the tests
  // dedicated to khmer_name itself override it.
  khmer_name: null,
  // No photo is the common case, and the one the row has to stay readable in.
  image: null,
  // Unlinked is the ordinary row during the rollout; the Telegram tests
  // override it.
  telegram: "none",
  status: "Active", schedule: "assigned", weekly_minutes: 2400,
  biometric: "enrolled", fingerprint_count: 2, days_since_relieving: null,
  // No names and no face is the ordinary row wherever the bridge sends counts
  // without ids — the finger tests override these.
  fingers: null, face: null,
  // Both feeds know this employee — the ordinary row. Override it to build the
  // one-witness rows suppressUnusableFacts has to drop.
  sources: { schedule: true, biometric: true }, ...over,
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

test("the register's search matches a Khmer name", () => {
  const rows = [
    row({ id: "E1", employee_name: "Sophea Chan", khmer_name: "ចាន់ សុភា" }),
    row({ id: "E2", employee_name: "Dara Sok", khmer_name: "សុខ ដារា" }),
  ];
  assert.deepEqual(filterRegisterRows(rows, { search: "សុភា" }).map((r) => r.id), ["E1"]);
  // And the English path is untouched.
  assert.deepEqual(filterRegisterRows(rows, { search: "dara" }).map((r) => r.id), ["E2"]);
  // The `?? ""` guard: a row with no Khmer name (row()'s default) must not
  // match the literal string "null" a regression to `${row.khmer_name}`
  // would coerce it into.
  assert.deepEqual(filterRegisterRows([row({ id: "E3" })], { search: "null" }), []);
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

// ---------------------------------------------------------------------------
// registerFacets — the filter bar's options
// ---------------------------------------------------------------------------

test("facet options are derived from the rows, de-duplicated and alphabetical", () => {
  // Input order is deliberately not alphabetical, and every value repeats, so
  // a version that just collected values in encounter order fails.
  const rows = [
    row({ id: "1", branch: "PM", department: "Ops" }),
    row({ id: "2", branch: "ACES", department: "Finance" }),
    row({ id: "3", branch: "PM", department: "Ops" }),
    row({ id: "4", branch: "DIU", department: "Finance" }),
  ];
  assert.deepEqual(registerFacets(rows), {
    branch: ["ACES", "DIU", "PM"],
    department: ["Finance", "Ops"],
  });
});

test("a facet offers nothing the rows do not contain", () => {
  // The whole point of deriving them. A hardcoded list would offer branches
  // this roster has never heard of — every one of which filters to nobody —
  // while silently omitting any branch the list's author did not know about.
  assert.deepEqual(registerFacets([row({ branch: "ACES", department: "Ops" })]), {
    branch: ["ACES"],
    department: ["Ops"],
  });
  assert.deepEqual(registerFacets([]), { branch: [], department: [] });
});

test("a row with no branch or department contributes no option", () => {
  // There would be nothing for such an option to select: filterRegisterRows
  // reads `row.branch ?? ""`, so a row with no branch fact is excluded by any
  // branch filter. An "Unassigned" option here would return nobody, every time.
  assert.deepEqual(registerFacets([row({ branch: null, department: null })]), {
    branch: [],
    department: [],
  });
  // An empty string is the same absence wearing a different type.
  assert.deepEqual(registerFacets([row({ branch: "", department: "" })]), {
    branch: [],
    department: [],
  });
});

test("the two facets are independent — a row can contribute to one and not the other", () => {
  assert.deepEqual(registerFacets([row({ branch: "DIU", department: null })]), {
    branch: ["DIU"],
    department: [],
  });
});

// ---------------------------------------------------------------------------
// sortFromColumnId / columnIdForSort — the boundary with the table
// ---------------------------------------------------------------------------

test("each sortable column id maps to its own sort key", () => {
  // Pinned against literals, not against SORT_COLUMN_IDS: checking the two
  // directions agree with each other cannot catch them agreeing on the wrong
  // answer, which is exactly what swapping two entries looks like.
  assert.deepEqual(sortFromColumnId("employee", false), { sort: "name", order: "asc" });
  assert.deepEqual(sortFromColumnId("weekly_minutes", false), { sort: "hours", order: "asc" });
  // "prints" belongs to the FUSED biometric column now. The print count is
  // evidence for the biometric state rather than a fact of its own, so it lost
  // its column and kept its sort.
  assert.deepEqual(sortFromColumnId("biometric", false), { sort: "prints", order: "asc" });
});

test("desc carries through to order, and only to order", () => {
  assert.deepEqual(sortFromColumnId("weekly_minutes", true), { sort: "hours", order: "desc" });
  assert.deepEqual(sortFromColumnId("employee", true), { sort: "name", order: "desc" });
});

test("a column id nothing sorts by yields null, never a wrong sort", () => {
  // The display columns, plus a typo and the empty string. A guess here would
  // silently reorder the register AND — since severity ordering is gated on
  // `!filters.sort` — retire "worst first" for the not-ready view at the same
  // time, from a click on a header that is not supposed to sort at all.
  // "fingerprint_count" is in this list deliberately: it used to BE a column
  // and used to resolve to `prints`. A stale sort in a bookmarked URL, or a
  // half-finished rename, must leave the register unsorted rather than sorting
  // by a column that no longer exists.
  for (const id of ["branch", "department", "status", "schedule", "fingerprint_count", "action", "hours", ""]) {
    assert.equal(sortFromColumnId(id, false), null, `${id} must not resolve to a sort`);
  }
});

test("columnIdForSort names the column the table should show as sorted", () => {
  assert.equal(columnIdForSort("name"), "employee");
  assert.equal(columnIdForSort("hours"), "weekly_minutes");
  assert.equal(columnIdForSort("prints"), "biometric", "the fused column carries the prints sort");
});

test("columnIdForSort translates, rather than passing the sort key through", () => {
  // The defect this function exists to fix. GenericDataTable reads
  // `filters.sort` as a COLUMN ID when it builds its own sorting state, so
  // handing it "hours" leaves getIsSorted() false on every column: the header
  // shows no direction, every press repeats the first direction, and the sort
  // can never be cleared. Returning the key unchanged compiles and typechecks.
  for (const sort of ["name", "hours", "prints"] as const) {
    assert.notEqual(columnIdForSort(sort), sort, `${sort} is not a column id`);
  }
});

test("no sort round-trips as no sort, not as a default column", () => {
  // An unsorted register is a real state — the one where severity ordering
  // runs. Defaulting to a column here would put an arrow on a header the
  // reader never pressed and quietly retire "worst first".
  assert.equal(columnIdForSort(undefined), undefined);
});

test("every sort key round-trips through its column id", () => {
  // Iterates the mapping itself rather than a hand-written list, and
  // SORT_COLUMN_IDS is exhaustive over the sort union by type — so a fourth
  // sort key cannot be added without a column id (compile error) nor without
  // teaching sortFromColumnId about it (this test).
  const keys = Object.keys(SORT_COLUMN_IDS) as NonNullable<RegisterFilters["sort"]>[];
  assert.ok(keys.length >= 3, "the mapping must not have been emptied");
  for (const sort of keys) {
    const id = columnIdForSort(sort);
    assert.ok(id, `${sort} has no column id`);
    assert.deepEqual(
      sortFromColumnId(id, false),
      { sort, order: "asc" },
      `${sort} -> ${id} -> ? did not come back`,
    );
  }
});

test("every sortable column id is a column that actually exists", () => {
  // A mapping to a column id nothing renders would put the table's sorting
  // state on a phantom column: getIsSorted() false everywhere, same defect as
  // passing the sort key through.
  const known = visibleColumnIds({ schedule: true, biometric: true });
  for (const id of Object.values(SORT_COLUMN_IDS)) {
    assert.ok(known.includes(id), `${id} is not a register column`);
  }
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

test("an explicit sort wins over severity order, even while filtered to not-ready", () => {
  // Severity ordering is gated on `!filters.sort`, so it only runs while the
  // reader has expressed no preference of their own. That makes the page's
  // INITIAL filter state load-bearing: seeding it with `sort: "name"` rather
  // than leaving `sort` undefined would retire severity ordering altogether
  // and nothing above would notice, because every case there passes no sort.
  // Pin the other half of the gate so the two cannot drift apart.
  const rows = [
    row({ id: "WORST", employee_name: "Ana", biometric: "still_enrolled", weekly_minutes: 2400 }),
    row({ id: "MILDER", employee_name: "Ben", schedule: "missing", weekly_minutes: 600 }),
  ];
  assert.deepEqual(
    sortRegisterRows(rows, { readiness: "not-ready" }).map((r) => r.id),
    ["WORST", "MILDER"],
    "no explicit sort — severity decides, worst first",
  );
  assert.deepEqual(
    sortRegisterRows(rows, { readiness: "not-ready", sort: "hours" }).map((r) => r.id),
    ["MILDER", "WORST"],
    "an explicit sort must beat severity order, or the column headers lie",
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

// ---------------------------------------------------------------------------
// paginateRegisterRows — the slice, and the pager's reading of it
// ---------------------------------------------------------------------------

/** `n` rows, ids E001.. in order, so a slice can be named rather than counted. */
function roster(n: number): RegisterRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({ id: `E${String(i + 1).padStart(3, "0")}`, employee_name: `Person ${i + 1}` }),
  );
}

test("a page is the slice the reader is on, never the whole list", () => {
  // GenericDataTable sets `manualPagination` and never slices `data` — it
  // renders exactly the array it is handed. Returning everything here is what
  // shipped, and it put all 503 rows in one scrolling frame.
  const { rows: got, meta } = paginateRegisterRows(roster(7), { page: 2, limit: 3 });
  assert.deepEqual(got.map((r) => r.id), ["E004", "E005", "E006"]);
  assert.deepEqual(meta, {
    // The FILTERED count, not the roster: the footer reads "Showing
    // {data.length} of {meta.total}", so the second number has to be the size
    // of the set the first is a page of.
    total: 7,
    page: 2,
    limit: 3,
    totalPages: 3,
    hasNext: true,
    hasPrev: true,
  });
});

test("the last page is the remainder, and nothing claims to follow it", () => {
  const { rows: got, meta } = paginateRegisterRows(roster(7), { page: 3, limit: 3 });
  assert.deepEqual(got.map((r) => r.id), ["E007"], "one row, not a padded page of three");
  assert.equal(meta.hasNext, false, "there is no page 4");
  assert.equal(meta.hasPrev, true);
});

test("the page is clamped to the last one that exists, and meta reports the clamp", () => {
  // Narrow 503 rows down to 3 while sitting on page 8 and page 8 has stopped
  // existing. Unclamped, the slice starts past the end and the table renders
  // empty under a pager still reading "Page 8" — so the reader cannot tell
  // their filter from a broken register. The clamp has to reach `meta.page`
  // too, or the number under the table disagrees with the rows in it.
  const { rows: got, meta } = paginateRegisterRows(roster(3), { page: 8, limit: 2 });
  assert.deepEqual(got.map((r) => r.id), ["E003"], "the last page, not an empty one");
  assert.equal(meta.page, 2, "the pager is told where it actually landed");
  assert.equal(meta.totalPages, 2);
  assert.equal(meta.hasNext, false, "nothing follows the last page, however it was reached");
  assert.equal(meta.hasPrev, true);
});

test("a page below the first is the first, not a negative slice", () => {
  // `rows.slice(-4, ...)` counts from the END of the array, so an unclamped
  // page 0 would quietly serve the last rows of the roster as the first page.
  const { rows: got, meta } = paginateRegisterRows(roster(5), { page: 0, limit: 2 });
  assert.deepEqual(got.map((r) => r.id), ["E001", "E002"]);
  assert.equal(meta.page, 1);
  assert.equal(meta.hasPrev, false);
});

test("an empty result is page 1 of 1, never page 0 of 0", () => {
  const { rows: got, meta } = paginateRegisterRows([], { page: 4, limit: 10 });
  assert.deepEqual(got, []);
  assert.equal(meta.total, 0);
  assert.equal(meta.page, 1, "\"Page 0\" is not a place the reader can be");
  assert.equal(meta.totalPages, 1, "nor is \"of 0\"");
  assert.equal(meta.hasNext, false);
  assert.equal(meta.hasPrev, false);
});

test("asking for no page is the first page, at the default size", () => {
  const { rows: got, meta } = paginateRegisterRows(roster(120), {});
  assert.equal(meta.page, 1);
  assert.equal(meta.limit, REGISTER_PAGE_SIZE);
  assert.equal(got.length, REGISTER_PAGE_SIZE, "a default that does not slice is not a default");
  assert.equal(meta.totalPages, Math.ceil(120 / REGISTER_PAGE_SIZE));
  assert.equal(meta.hasNext, true);
});

test("the default page size is one the page-size control can actually display", () => {
  // GenericDataTable's "Rows per page" is a raw `<select value={filters.limit
  // || 10}>` whose only options are these five. A default outside the list
  // either leaves the control reading 10 beside a table showing something else
  // (with `limit` unset) or, written into `limit`, matches no option at all —
  // `selectedIndex: -1`, and the select renders blank. 25 was the first choice
  // for this register and is unreachable for precisely that reason.
  assert.ok(
    [10, 20, 30, 40, 50].includes(REGISTER_PAGE_SIZE),
    `${REGISTER_PAGE_SIZE} is not one of the sizes the control can show`,
  );
});

test("a page size that is not a size falls back to the default, not to an infinite pager", () => {
  // Unreachable through the control, which offers five fixed sizes — but
  // `limit` is a plain number on a plain filters object, and `ceil(n / 0)` is
  // Infinity, which the pager would render as "Page 1 of Infinity" above a
  // permanently empty slice.
  for (const limit of [0, -5]) {
    const { rows: got, meta } = paginateRegisterRows(roster(3), { limit });
    assert.equal(meta.limit, REGISTER_PAGE_SIZE, `limit: ${limit} must not be taken literally`);
    assert.equal(meta.totalPages, 1);
    assert.equal(got.length, 3);
  }
});

test("a page that is not a number is the first page, not an empty one", () => {
  // The other end of the guard above. `Math.max(1, NaN)` is NaN, so a NaN page
  // would pass straight through into `meta.page`, empty the slice, and leave
  // the footer reading "Page NaN of 2" with both arrows dead — `NaN < 2` and
  // `NaN > 1` are both false, so hasNext and hasPrev would BOTH be false and
  // the reader would have no way off the page at all.
  const { rows: got, meta } = paginateRegisterRows(roster(3), { page: Number.NaN, limit: 2 });
  assert.equal(meta.page, 1);
  assert.deepEqual(got.map((r) => r.id), ["E001", "E002"]);
  assert.equal(meta.hasNext, true, "and the way forward is still open");
  assert.equal(meta.hasPrev, false);
});

test("paginateRegisterRows does not mutate the array it was given", () => {
  const rows = roster(5);
  const before = rows.map((r) => r.id);
  paginateRegisterRows(rows, { page: 2, limit: 2 });
  assert.deepEqual(rows.map((r) => r.id), before);
  assert.equal(rows.length, 5, "the caller still holds every filtered row — the CSV reads them");
});

// ---------------------------------------------------------------------------
// applyFilterChange — narrowing starts over
// ---------------------------------------------------------------------------

test("a filter change returns to page 1 and leaves every other filter standing", () => {
  // Dropping the reset leaves the reader on page 8 of a set that may now have
  // two pages; dropping the spread wipes the search, sort and facets the way
  // `onFiltersChange({ branch })` would.
  assert.deepEqual(
    applyFilterChange(
      { search: "ada", branch: ["DIU"], sort: "hours", order: "desc", page: 8, limit: 20 },
      { status: "Left" },
    ),
    {
      search: "ada", branch: ["DIU"], sort: "hours", order: "desc",
      status: "Left", page: 1, limit: 20,
    },
  );
});

test("the page size survives a filter change — it is a preference, not a filter", () => {
  assert.equal(applyFilterChange({ limit: 10, page: 3 }, { search: "ada" }).limit, 10);
});

test("clearing a filter starts over too, and the cleared field goes out as undefined", () => {
  // `[]` and `undefined` are both "no filter"; neither may be mistaken for a
  // change too small to reset the page.
  assert.deepEqual(
    applyFilterChange({ status: "Left", page: 5 }, { status: undefined }),
    { status: undefined, page: 1 },
  );
  assert.deepEqual(
    applyFilterChange({ branch: ["DIU"], page: 5 }, { branch: [] }),
    { branch: [], page: 1 },
  );
});

test("applyFilterChange does not mutate the filters it was given", () => {
  // The page holds these in useState and INITIAL_REGISTER_FILTERS is frozen —
  // an in-place write would throw there and silently corrupt state everywhere
  // else.
  const held: RegisterFilters = { search: "ada", page: 4 };
  applyFilterChange(held, { status: "Left" });
  assert.deepEqual(held, { search: "ada", page: 4 });
});

const HEALTHY = { schedule: true, biometric: true };

test("the alert counts problems and reads as a problem", () => {
  const got = registerAlert([row(), row({ id: "X", schedule: "missing" })], HEALTHY);
  assert.equal(got.tone, "problem");
  assert.equal(got.count, 1);
  assert.equal(got.knowable, true);
  assert.match(got.label, /1 needs attention/i);
});

test("the problem alert pluralizes and offers a call to action for multiple problems", () => {
  // "the alert counts problems..." above only ever exercises count === 1, so
  // it cannot tell "needs"/"it" from "need"/"them", nor notice the
  // "— show ..." call to action being deleted outright.
  const got = registerAlert(
    [row({ schedule: "missing" }), row({ id: "B", schedule: "missing" })],
    HEALTHY,
  );
  assert.equal(got.tone, "problem");
  assert.equal(got.count, 2);
  assert.match(got.label, /2 need attention — show them/i);
});

test("a biometric-only problem still reaches the count", () => {
  // Every other fixture in this file that feeds registerAlert derives its
  // problem from schedule: "missing" — a count that silently switched to
  // counting only that would still pass them all.
  const got = registerAlert(
    [row({ biometric: "none" }), row({ id: "B", biometric: "still_enrolled" }), row({ id: "C" })],
    HEALTHY,
  );
  assert.equal(got.count, 2);
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
  // Two problem rows, not one — pins that the degraded label pluralizes
  // ("2 need", not "2 needs") the same way the problem-tone label does; the
  // single-row version of this fixture could not have caught that.
  const got = registerAlert(
    [row({ biometric: null, schedule: "missing" }), row({ id: "B", biometric: null, schedule: "missing" })],
    { schedule: true, biometric: false },
  );
  assert.equal(got.tone, "degraded");
  assert.equal(got.knowable, false);
  assert.equal(got.count, 2);
  assert.match(got.label, /2 need attention/i);
  assert.match(got.label, /biometrics unavailable/i);
  assert.doesNotMatch(got.label, /schedules/i, "the schedule feed is healthy here; it must not be named");
});

test("a degraded alert still reports the problems it CAN see", () => {
  const got = registerAlert(
    [row({ biometric: null, schedule: "missing" }), row({ id: "B", biometric: null })],
    { schedule: true, biometric: false },
  );
  assert.equal(got.count, 1);
});

test("a dead schedule feed degrades the alert and names schedules, not biometrics", () => {
  // No test previously called registerAlert with { schedule: false,
  // biometric: true } at all — the schedule-down half of the branch was
  // reachable but entirely unexercised.
  const got = registerAlert([row({ schedule: "missing" })], { schedule: false, biometric: true });
  assert.equal(got.tone, "degraded");
  assert.equal(got.knowable, false);
  assert.match(got.label, /schedules unavailable/i);
  assert.doesNotMatch(got.label, /biometrics/i, "the biometric feed is healthy here; it must not be named");
});

test("both feeds down names both, rather than reassuring about the one it omits", () => {
  // Naming only one down feed asserts by omission that the other is fine —
  // over-reassurance at exactly the moment the page knows least.
  const got = registerAlert([row()], { schedule: false, biometric: false });
  assert.equal(got.tone, "degraded");
  assert.equal(got.knowable, false);
  assert.match(got.label, /schedules.*unavailable/i);
  assert.match(got.label, /biometrics.*unavailable/i);
});

test("a dead biometric feed hides the biometric columns AND status", () => {
  // Status is a biometric-feed fact: coverage filters status:Active, so every
  // row it returns is Active by construction and leavers never appear there.
  // Showing "Active" for all 241 would assert what the data cannot support.
  const hidden = visibleColumnIds({ schedule: true, biometric: false });
  assert.ok(!hidden.includes("biometric"));
  assert.ok(!hidden.includes("status"));
  assert.ok(hidden.includes("branch"), "branch is an always-on column and survives even when biometric is down");
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

test("visibleColumnIds returns the full column set when both feeds are healthy", () => {
  // Pins ALWAYS in full — reducing it to e.g. ["employee", "branch"] would
  // permanently hide "department" and "action" with a green suite, since
  // every other test here only ever checks for a column's presence, never
  // the complete list.
  assert.deepEqual(
    visibleColumnIds({ schedule: true, biometric: true }),
    [
      "employee", "branch", "department", "action",
      // "telegram" rides with the SCHEDULE feed, not the biometric one: the
      // coverage endpoint resolves it, so a coverage outage takes it away.
      "schedule", "weekly_minutes", "telegram",
      // No "fingerprint_count": the print count was fused into the biometric
      // cell and has no column of its own. It is STILL exported — the CSV is
      // keyed off feed health, not off this list, which is the whole reason
      // that indirection exists.
      "biometric", "status",
    ],
  );
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
  // LOCAL, deliberately — no trailing Z. feedHealth reads Frappe datetimes
  // through parseFrappeDatetime, which treats them as site-local, so `now`
  // must be anchored the same way or the boundary shifts with the runner's
  // timezone. Fixtures are computed FROM STALE_AFTER_MINUTES, not
  // hardcoded — a fixture picked to merely straddle 24h (e.g. 1h vs. 3
  // days) cannot tell a correct 1440-minute threshold from a mutated one
  // (doubled, halved, off by a day); only a fixture one minute either side
  // of the real threshold can.
  const now = new Date("2026-08-13T09:00:00").getTime();
  const justInside = {
    rows: [], counts: {} as never,
    last_snapshot_at: minutesBefore(now, STALE_AFTER_MINUTES - 1), window_days: 30,
  };
  const justOutside = {
    rows: [], counts: {} as never,
    last_snapshot_at: minutesBefore(now, STALE_AFTER_MINUTES + 1), window_days: 30,
  };
  assert.equal(feedHealth(undefined, justInside, now).biometric, true);
  assert.equal(feedHealth(undefined, justOutside, now).biometric, false);
});

test("feed health treats an unparseable snapshot timestamp as stale, not fresh", () => {
  // The Infinity fail-closed fallback: a garbage value must read as maximally
  // old, not as `0` (which would read as "just reported" and pass every
  // staleness check it should fail).
  const now = new Date("2026-08-13T09:00:00").getTime();
  const garbage = { rows: [], counts: {} as never, last_snapshot_at: "not a date", window_days: 30 };
  assert.equal(feedHealth(undefined, garbage, now).biometric, false);
});

test("feed health reflects the schedule feed independently of biometric health", () => {
  // Every other feedHealth test passes `coverage: undefined` and only reads
  // `.biometric` — a hardcoded `schedule: true` would pass all of them and
  // keep schedule columns rendered through a total coverage outage.
  const now = new Date("2026-08-13T09:00:00").getTime();
  const fresh = {
    rows: [], counts: {} as never,
    last_snapshot_at: minutesBefore(now, 5), window_days: 30,
  };
  assert.deepEqual(feedHealth(undefined, fresh, now), { schedule: false, biometric: true });
  assert.deepEqual(feedHealth(coverage(), fresh, now), { schedule: true, biometric: true });
});

test("suppressUnusableFacts nulls exactly the biometric fields when that feed is unhealthy", () => {
  const input = [row({ biometric: "none", fingerprint_count: 3, status: "Active",
                       fingers: ["right_thumb"], face: true,
                       days_since_relieving: 5, image: "/files/sok.jpg" })];
  const [got] = suppressUnusableFacts(input, { schedule: true, biometric: false });
  assert.equal(got.biometric, null);
  assert.equal(got.fingerprint_count, null);
  assert.equal(got.fingers, null, "finger names are biometric facts and go with the feed");
  assert.equal(got.face, null, "so is the face flag");
  assert.equal(got.status, null);
  assert.equal(got.days_since_relieving, null);
  assert.equal(got.schedule, "assigned", "schedule facts survive a biometric-only outage");
  assert.equal(got.weekly_minutes, 2400, "schedule facts survive a biometric-only outage");
  assert.equal(got.image, "/files/sok.jpg", "and so does the photo — it is a schedule fact");
});

test("suppressUnusableFacts nulls exactly the schedule fields when that feed is unhealthy", () => {
  const input = [row({ schedule: "missing", weekly_minutes: 1800, image: "/files/sok.jpg" })];
  const [got] = suppressUnusableFacts(input, { schedule: false, biometric: true });
  assert.equal(got.schedule, null);
  assert.equal(got.weekly_minutes, null);
  // The photo is a schedule-feed fact like the other two: coverage is the only
  // feed that carries one, so a downed coverage service cannot vouch for it
  // either. Leaving it would put a face beside a row of em dashes.
  assert.equal(got.image, null);
  assert.equal(got.biometric, "enrolled", "biometric facts survive a schedule-only outage");
  assert.equal(got.status, "Active", "biometric facts survive a schedule-only outage");
});

test("suppressUnusableFacts is a no-op when both feeds are healthy", () => {
  const input = [row()];
  assert.deepEqual(suppressUnusableFacts(input, { schedule: true, biometric: true }), input);
});

test("suppressUnusableFacts does not mutate its input array or row objects", () => {
  const input = [row({ biometric: "none" })];
  const snapshot = { ...input[0] };
  suppressUnusableFacts(input, { schedule: true, biometric: false });
  assert.deepEqual(input[0], snapshot);
  assert.equal(input.length, 1);
});

test("suppressUnusableFacts composed with registerAlert stops counting a fact the reader cannot see", () => {
  // The whole point: without suppression, a stale-biometric row with
  // biometric: "none" still increments the count even though the biometric
  // column is hidden — a number the reader cannot verify, and a
  // readiness:"not-ready" filter that would surface a row that looks ready.
  const feeds = { schedule: true, biometric: false };
  const suppressed = suppressUnusableFacts([row({ biometric: "none" })], feeds);
  assert.equal(registerAlert(suppressed, feeds).count, 0);
});

/**
 * Coverage returns Active employees only, so a leaver still holding a template
 * exists in the enrolment feed ALONE. Two employees: one both feeds know, one
 * only the bridge does.
 */
function twoFeedRoster(lastSnapshotAt: string | null) {
  return {
    coverage: coverage({
      assigned: [{ id: "E1", employee_name: "Sok Dara", department: "Finance",
                   branch: "DIU", weekly_minutes: 2400 }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment: enrollment({
      rows: [
        { id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
          status: "Active", bucket: "OK", is_registered: true,
          fingerprint_count: 2, face_count: 0, days_since_relieving: null },
        { id: "E9", employee_name: "Leaver Lee", branch: "PM", department: "Ops",
          status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
          fingerprint_count: 2, face_count: 0, days_since_relieving: 42 },
      ],
      last_snapshot_at: lastSnapshotAt,
    }),
  };
}

test("a stale bridge drops the rows only it knew about, exactly as a never-reported one does", () => {
  // MEMBERSHIP, not field nulling — the seam nothing reached. Blanking a row's
  // fields leaves the row, and a row whose only witness is the stale feed then
  // sits in the table as em dashes still carrying the name, branch and
  // department that only that feed ever supplied: counted in the header's
  // roster size, written into the CSV, under a banner saying leaver detection
  // is hidden. The failure table has always said stale behaves as
  // never-reported; this is the assertion that makes that true.
  const now = new Date("2026-08-13T09:00:00").getTime();

  const neverReported = twoFeedRoster(null);
  const wentStale = twoFeedRoster(minutesBefore(now, STALE_AFTER_MINUTES + 60));

  const never = composeRegister(neverReported.coverage, neverReported.enrollment, now);
  const stale = composeRegister(wentStale.coverage, wentStale.enrollment, now);

  assert.deepEqual(never.rows.map((r) => r.id), ["E1"], "a never-reported bridge contributes no rows");
  assert.deepEqual(
    stale.rows.map((r) => r.id),
    ["E1"],
    "and neither may a stale one — E9 exists in the stale feed alone",
  );
  // Not just the id list: the facts that came with her must be gone too. Her
  // name is the thing a reader would have seen and believed.
  assert.doesNotMatch(JSON.stringify(stale.rows), /Leaver Lee|"PM"/);
});

test("everything downstream of the drop follows: the roster size and the export", () => {
  // The header counts `rows.length` and the CSV is built from the same rows,
  // so a ghost row would have been counted aloud and mailed out as a
  // near-blank line. Both are checked here rather than assumed to follow.
  const now = new Date("2026-08-13T09:00:00").getTime();
  const { coverage: cov, enrollment: enr } = twoFeedRoster(
    minutesBefore(now, STALE_AFTER_MINUTES + 60),
  );
  const got = composeRegister(cov, enr, now);

  assert.equal(got.rows.length, 1, "the roster size the header reads");
  const csv = toRegisterCsv(got.rows, got.feeds);
  assert.equal(csv.split("\n").length, 2, "one header row and one employee, with no blank line");
  assert.doesNotMatch(csv, /Leaver Lee/);
});

test("a row a HEALTHY feed still vouches for is never dropped", () => {
  // The inverse guard. Dropping on "any unhealthy source" rather than "no
  // healthy source" would empty the table of every ordinary employee the
  // moment either feed went quiet — a far louder bug than the one being
  // fixed, and one the membership test above would not notice.
  const bothKnow = row({ id: "BOTH", sources: { schedule: true, biometric: true } });
  const scheduleOnly = row({ id: "SCHED", sources: { schedule: true, biometric: false } });
  const biometricOnly = row({ id: "BIO", sources: { schedule: false, biometric: true } });
  const input = [bothKnow, scheduleOnly, biometricOnly];

  assert.deepEqual(
    suppressUnusableFacts(input, { schedule: true, biometric: false }).map((r) => r.id),
    ["BOTH", "SCHED"],
    "a stale bridge keeps everyone coverage still vouches for",
  );
  assert.deepEqual(
    suppressUnusableFacts(input, { schedule: false, biometric: true }).map((r) => r.id),
    ["BOTH", "BIO"],
    "and a downed coverage service keeps everyone the bridge still vouches for",
  );
  assert.deepEqual(
    suppressUnusableFacts(input, { schedule: false, biometric: false }).map((r) => r.id),
    [],
    "with neither feed usable there is nobody the page can name at all",
  );
});

test("the join records which feeds vouched for each row", () => {
  // `sources` is what suppressUnusableFacts drops on, so a join that recorded
  // it wrongly would drop the wrong rows — and every assertion above would
  // still pass if it were hardcoded to {true, true}.
  const { coverage: cov, enrollment: enr } = twoFeedRoster("2026-08-12 09:00:00");
  const byId = new Map(joinRegisterRows(cov, enr).map((r) => [r.id, r]));

  assert.deepEqual(byId.get("E1")?.sources, { schedule: true, biometric: true });
  assert.deepEqual(byId.get("E9")?.sources, { schedule: false, biometric: true });
  assert.deepEqual(
    joinRegisterRows(cov, undefined)[0].sources,
    { schedule: true, biometric: false },
    "coverage alone vouches for the schedule half only",
  );
});

test("composeRegister suppresses a stale-but-once-seen bridge's facts before the alert counts them", () => {
  // A bridge that reported and then went stale passes isFeedConnected (it HAS
  // a last_snapshot_at), so joinRegisterRows merges the real-but-old facts —
  // unlike a bridge that has never reported, which joinRegisterRows already
  // guards against on its own. Only composeRegister's ordering (feedHealth,
  // then suppress, then alert on the SUPPRESSED rows) can catch this case.
  const now = new Date("2026-08-13T09:00:00").getTime();
  const staleSnapshot = minutesBefore(now, STALE_AFTER_MINUTES + 60);
  const got = composeRegister(
    // Assigned, deliberately — schedule: "assigned" contributes nothing to
    // isNotReady, so the row's only possible not-ready cause is the biometric
    // "none" fact this fixture is testing the suppression of.
    coverage({
      assigned: [{ id: "E1", employee_name: "Sok Dara", department: "Finance",
                   branch: "DIU", weekly_minutes: 2400 }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
               status: "Active", bucket: "NEEDS_ENROLLMENT", is_registered: false,
               fingerprint_count: 0, face_count: 0, days_since_relieving: null }],
      last_snapshot_at: staleSnapshot,
    }),
    now,
  );
  assert.equal(got.feeds.biometric, false, "a snapshot this old must read as an unhealthy feed");
  assert.equal(
    got.rows[0].biometric, null,
    "the returned rows must be the SUPPRESSED rows, not the raw join — a stale feed cannot vouch for this fact",
  );
  assert.equal(
    got.alert.count, 0,
    "the alert must count only what the suppressed rows still carry, not what the raw join produced",
  );
  // Suppressing the rows alone is not enough: rows already carry biometric:
  // null, so count reads 0 either way. What proves the ALERT itself saw the
  // real (unhealthy) feed state, and not a hardcoded healthy one, is
  // knowable/tone/label — a knowable:true "All ready" here would be a false
  // all-clear synthesised from a feed that is actually down.
  assert.equal(
    got.alert.knowable, false,
    "the alert must reflect the real feedHealth reading, not an assumed-healthy one",
  );
  assert.equal(got.alert.tone, "degraded");
  assert.match(got.alert.label, /biometrics unavailable/i);
});

const HEALTHY_QUERY_STATE = { data: undefined, error: undefined, isLoading: false };

/**
 * A payload as it actually arrived, not as the type claims it must have.
 *
 * The cast is the subject of the test rather than a shortcut around it:
 * `frappeCall<EnrollmentPayload>` performs this exact cast on every response,
 * so the declared shape is a claim ABOUT the server, never a guarantee FROM
 * it. This helper reproduces the one thing TypeScript cannot: a body that
 * omits a required field.
 */
function asWireResponse<T>(body: object): T {
  return body as T;
}

test("registerFeedState tolerates a payload that arrived without counts", () => {
  // `counts` is required on both payload types, so `data?.counts.truncated`
  // typechecks — and throws the moment a server answers `{}` or any other
  // partial body. The optional chain on `counts` is therefore DELIBERATE and
  // must not be deleted as dead code on the strength of the type: the type is
  // a compile-time claim about a server response and constrains nothing at
  // runtime.
  //
  // The cost of getting this wrong is not a blank column. An exception here
  // escapes to the ErrorBoundary and takes the entire register down —
  // including the schedule half, which may have answered perfectly — which
  // destroys the "the two feeds fail independently" property that the whole
  // two-query split and per-column suppression exist to provide. A partial
  // payload must degrade, never crash.
  const partialEnrollment = registerFeedState(
    { data: coverage(), error: undefined, isLoading: false },
    { data: asWireResponse<EnrollmentPayload>({}), error: undefined, isLoading: false },
  );
  assert.equal(partialEnrollment.truncated, false, "a countless enrollment body is not a truncation");

  // Both sides need their own case: `||` short-circuits, so a coverage payload
  // that is missing `counts` is the only thing that reaches the LEFT operand's
  // optional chain. With one test only, dropping the other `?.` stays green.
  const partialCoverage = registerFeedState(
    { data: asWireResponse<ScheduleCoveragePayload>({}), error: undefined, isLoading: false },
    { data: enrollment(), error: undefined, isLoading: false },
  );
  assert.equal(partialCoverage.truncated, false, "a countless coverage body is not a truncation");

  // A partial body still carries the facts the rest of the state reads off the
  // query, so the degradation has to stop at `truncated`.
  assert.equal(partialEnrollment.bothFailed, false);
  assert.equal(partialEnrollment.isLoading, false);
});

test("registerFeedState: bothFailed requires no leftover data, not just both feeds erroring", () => {
  // react-query's "error" reducer case spreads ...state and only overwrites
  // error/status, so `data` survives a failed refetch. A refresh() that fails
  // on both feeds after a prior successful load must not read as bothFailed:
  // rows are still fully joined and there is something to render.
  const withLeftoverData = registerFeedState(
    { data: coverage(), error: new Error("boom"), isLoading: false },
    { data: enrollment(), error: new Error("boom"), isLoading: false },
  );
  assert.equal(withLeftoverData.bothFailed, false, "leftover data from a prior load must suppress bothFailed");

  const withNoDataAtAll = registerFeedState(
    { data: undefined, error: new Error("boom"), isLoading: false },
    { data: undefined, error: new Error("boom"), isLoading: false },
  );
  assert.equal(withNoDataAtAll.bothFailed, true, "no data anywhere and both feeds erroring IS bothFailed");
});

test("registerFeedState: bothFailed needs BOTH feeds erroring, not just one", () => {
  const oneDown = registerFeedState(
    { data: undefined, error: new Error("boom"), isLoading: false },
    { data: undefined, error: undefined, isLoading: false },
  );
  assert.equal(oneDown.bothFailed, false, "only one feed failing must not read as bothFailed");
});

test("registerFeedState: no data yet and no errors (the very first load) is not bothFailed", () => {
  const initial = registerFeedState(
    { data: undefined, error: undefined, isLoading: true },
    { data: undefined, error: undefined, isLoading: true },
  );
  assert.equal(initial.bothFailed, false);
});

test("registerFeedState: truncated is true when either feed's counts say so", () => {
  const coverageTruncated = registerFeedState(
    { data: coverage({ counts: { active: 1, unassigned: 1, assigned: 0, truncated: true } }), error: undefined, isLoading: false },
    HEALTHY_QUERY_STATE,
  );
  assert.equal(coverageTruncated.truncated, true);

  const enrollmentTruncated = registerFeedState(
    HEALTHY_QUERY_STATE,
    {
      data: enrollment({
        counts: { reported: 1, needs_enrollment: 0, enrolled_not_punching: 0, ok: 1,
                  leaver_still_enrolled: 0, excluded_status: 0, truncated: true },
      }),
      error: undefined, isLoading: false,
    },
  );
  assert.equal(enrollmentTruncated.truncated, true);

  const neitherTruncated = registerFeedState(
    { data: coverage(), error: undefined, isLoading: false },
    { data: enrollment(), error: undefined, isLoading: false },
  );
  assert.equal(neitherTruncated.truncated, false);
});

test("registerFeedState: isLoading is true while either feed is loading, false only when both are done", () => {
  const coverageLoading = registerFeedState(
    { data: undefined, error: undefined, isLoading: true },
    HEALTHY_QUERY_STATE,
  );
  assert.equal(coverageLoading.isLoading, true);

  const enrollmentLoading = registerFeedState(
    HEALTHY_QUERY_STATE,
    { data: undefined, error: undefined, isLoading: true },
  );
  assert.equal(enrollmentLoading.isLoading, true);

  const neitherLoading = registerFeedState(HEALTHY_QUERY_STATE, HEALTHY_QUERY_STATE);
  assert.equal(neitherLoading.isLoading, false);
});

// ---------------------------------------------------------------------------
// describeRegisterFilters / registerCsvColumns — what the export confirmation
// is built from.
// ---------------------------------------------------------------------------

test("describeRegisterFilters covers every clause filterRegisterRows acts on", () => {
  // A clause the filter applies but this does not name is a narrowing that
  // travels into the file invisibly — which is the exact failure the
  // confirmation exists to stop. Pinned as a set, so a seventh filter added to
  // filterRegisterRows without a clause here fails rather than being missed.
  const labels = describeRegisterFilters({
    readiness: "not-ready",
    search: "nair",
    branch: ["A"],
    department: ["Ops"],
    status: "Left",
    schedule: "missing",
    biometric: "none",
  }).map((n) => n.label);

  assert.deepEqual(labels, [
    "Needs attention", "Search", "Branch", "Department", "Status", "Schedule", "Biometric",
  ]);
});

test("describeRegisterFilters is silent about sort, page and size", () => {
  // None of them changes WHO is in the file: the export takes every matching
  // row, not the page on screen. Listing them would make the reader doubt a
  // file that is complete.
  assert.deepEqual(
    describeRegisterFilters({ sort: "hours", order: "desc", page: 3, limit: 10 }),
    [],
  );
});

test("describeRegisterFilters trims the search, and drops one that is only spaces", () => {
  assert.deepEqual(describeRegisterFilters({ search: "  nair  " }), [
    { label: "Search", value: "“nair”" },
  ]);
  assert.deepEqual(describeRegisterFilters({ search: "   " }), []);
});

test("registerCsvColumns.included IS the file's header row", () => {
  // Two readings of one list, and the whole value of the omitted half rests on
  // them agreeing: a column named as missing while it is still being written
  // is a worse lie than saying nothing at all.
  for (const feeds of [
    HEALTHY,
    { schedule: true, biometric: false },
    { schedule: false, biometric: true },
    { schedule: false, biometric: false },
  ]) {
    const { included, omitted } = registerCsvColumns(feeds);
    const header = toRegisterCsv([], feeds).split("\n")[0].split(",");
    assert.deepEqual(included, header, `included must equal the header at ${JSON.stringify(feeds)}`);
    for (const column of omitted) {
      assert.ok(!header.includes(column), `${column} is named as omitted but is in the file`);
    }
  }
});

test("registerCsvColumns names what each downed feed takes away", () => {
  assert.deepEqual(registerCsvColumns(HEALTHY).omitted, [], "nothing is lost while both are up");
  assert.deepEqual(registerCsvColumns({ schedule: true, biometric: false }).omitted, [
    "Employment status", "Biometric", "Fingerprints", "Fingers", "Face", "Days since leaving",
  ]);
  assert.deepEqual(registerCsvColumns({ schedule: false, biometric: true }).omitted, [
    "Schedule", "Weekly minutes", "Telegram",
  ]);
});

// ---------------------------------------------------------------------------
// khmer_name — composed once at the join
// ---------------------------------------------------------------------------

test("the join composes the Khmer name once, family name first", () => {
  // Composed at the join rather than at each cell: the register, the CSV and
  // the search all read one row, and three call sites composing separately is
  // how the surfaces drifted the first time.
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Sophea Chan", department: "Retail",
                   branch: "DIU", weekly_minutes: 2400,
                   custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា" }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment(),
  );
  assert.equal(rows[0].khmer_name, "ចាន់ សុភា");
});

test("an employee with no Khmer name gets null, not an empty string", () => {
  // Empty string is truthy enough to render a bare separator; null is the one
  // value every consumer here already treats as "no fact".
  const rows = joinRegisterRows(
    coverage({
      unassigned: [{ id: "E2", employee_name: "Derek Hale", department: "Ops", branch: "DIU" }],
      counts: { active: 1, unassigned: 1, assigned: 0, truncated: false },
    }),
    enrollment(),
  );
  assert.equal(rows[0].khmer_name, null);
});

test("the enrolment feed can supply a Khmer name for a row coverage never returned", () => {
  // A leaver still holding a template exists in the enrolment feed alone --
  // the security finding the register exists for. Their Khmer name has to come
  // from that side or the row shows less than the roster knows.
  const rows = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [{ id: "E9", employee_name: "Vanna Ly", branch: "PM", department: "Teaching",
               status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
               fingerprint_count: 1, face_count: 0, days_since_relieving: 12,
               custom_khmer_last_name: "លី", custom_khmer_first_name: null }],
    }),
  );
  assert.equal(rows[0].khmer_name, "លី");
});

test("khmer_name precedence: coverage wins when both feeds report the same employee with different Khmer names", () => {
  // A different name, not a blank one -- a blank enrolment record would pass
  // this test even with the precedence guard deleted outright. Only a second,
  // DIFFERENT name fails loudly if coverage's is overwritten rather than kept.
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Sok Dara", department: "Finance",
                   branch: "DIU", weekly_minutes: 2400,
                   custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា" }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
               status: "Active", bucket: "OK", is_registered: true,
               fingerprint_count: 2, face_count: 0, days_since_relieving: null,
               custom_khmer_last_name: "សុខ", custom_khmer_first_name: "ដារា" }],
    }),
  );
  assert.equal(rows[0].khmer_name, "ចាន់ សុភា");
});

test("the enrolment feed fills khmer_name for a row coverage DID return but had no Khmer name for", () => {
  // The fill branch, distinct from the leaver test above: that row takes the
  // CREATE path (coverage never returned E9 at all), so it cannot tell the
  // create line and the fill line apart. Here coverage seeds the row -- with
  // neither Khmer field -- so the merge has to run the fill branch to pick up
  // the enrolment feed's name.
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Sok Dara", department: "Finance",
                   branch: "DIU", weekly_minutes: 2400 }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment({
      rows: [{ id: "E1", employee_name: "Sok Dara", branch: "DIU", department: "Finance",
               status: "Active", bucket: "OK", is_registered: true,
               fingerprint_count: 2, face_count: 0, days_since_relieving: null,
               custom_khmer_last_name: "លី", custom_khmer_first_name: null }],
    }),
  );
  assert.equal(rows[0].khmer_name, "លី");
});

// ---------------------------------------------------------------------------
// telegram — the rollout column
// ---------------------------------------------------------------------------

test("the join carries the Telegram state through both halves of the coverage feed", () => {
  // Assigned and unassigned are seeded by the same helper but reached by two
  // loops, and the register shows them in one table: a field wired into only
  // one path renders as a blank column for half the roster.
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Ana", weekly_minutes: 2400, telegram: "linked" }],
      unassigned: [{ id: "E2", employee_name: "Ben", telegram: "id_on_file" }],
      counts: { active: 2, unassigned: 1, assigned: 1, truncated: false },
    }),
    enrollment(),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("E1")?.telegram, "linked");
  assert.equal(byId.get("E2")?.telegram, "id_on_file");
});

test("a coverage row with no Telegram state is null, never \"none\"", () => {
  // The backend omits the field for the WHOLE roster when its lookup fails.
  // Defaulting to "none" here would turn one failed query into a few hundred
  // people apparently needing a link — the register's central rule, that
  // silence is not a finding, applied to a new column.
  const rows = joinRegisterRows(
    coverage({
      assigned: [{ id: "E1", employee_name: "Ana", weekly_minutes: 2400 }],
      counts: { active: 1, unassigned: 0, assigned: 1, truncated: false },
    }),
    enrollment(),
  );
  assert.equal(rows[0].telegram, null);
});

test("a row only the enrolment feed knows about has no Telegram state", () => {
  // The bridge knows nothing about Telegram. The leaver-still-enrolled row —
  // the security finding this page exists for — reaches the table from that
  // feed alone and must not claim a rollout state nobody reported.
  const rows = joinRegisterRows(
    coverage(),
    enrollment({
      rows: [{ id: "GONE", employee_name: "Left Person", branch: "DIU", department: "Ops",
               status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
               fingerprint_count: 1, face_count: 0, days_since_relieving: 12 }],
    }),
  );
  assert.equal(rows[0].telegram, null);
});

test("the Telegram filter narrows to one state", () => {
  const rows = [
    row({ id: "A", telegram: "none" }),
    row({ id: "B", telegram: "linked" }),
    row({ id: "C", telegram: "id_on_file" }),
  ];
  assert.deepEqual(
    filterRegisterRows(rows, { telegram: "none" }).map((r) => r.id),
    ["A"],
  );
  assert.deepEqual(
    filterRegisterRows(rows, { telegram: "id_on_file" }).map((r) => r.id),
    ["C"],
  );
});

test("no Telegram filter admits every state, including a null one", () => {
  // The direction the test above cannot check: a filter that always compared
  // would drop every row whose state is unknown.
  const rows = [row({ id: "A", telegram: "none" }), row({ id: "B", telegram: null })];
  assert.deepEqual(filterRegisterRows(rows, {}).map((r) => r.id), ["A", "B"]);
});

test("being unlinked is NOT a readiness problem", () => {
  // The whole reason the alert survived this column. Telegram starts at ~90%
  // unlinked, so folding it into isNotReady would have turned "4 need
  // attention" into the roster size on the day it shipped, burying the two
  // findings the page exists for. An unlinked employee is still tracked by
  // the same device and schedule as everyone else.
  assert.equal(isNotReady(row({ telegram: "none", schedule: "assigned", biometric: "enrolled" })), false);
  assert.equal(isNotReady(row({ telegram: "id_on_file", schedule: "assigned", biometric: "enrolled" })), false);
});

test("the attention count ignores the Telegram column entirely", () => {
  // isNotReady is one function but two consumers, and the alert is the one a
  // reader actually sees. Pinned separately so a future change that routes the
  // count through anything else still has to keep this true.
  const rows = [
    row({ id: "A", telegram: "none" }),
    row({ id: "B", telegram: "none" }),
    row({ id: "C", telegram: "none" }),
  ];
  const alert = registerAlert(rows, { schedule: true, biometric: true });
  assert.equal(alert.count, 0);
  assert.equal(alert.tone, "clear");
});

test("a downed schedule feed takes the Telegram state with it", () => {
  // The coverage endpoint resolves it, so a coverage outage cannot leave "Not
  // linked" on screen for a roster the page has stopped hearing about.
  const [suppressed] = suppressUnusableFacts(
    [row({ telegram: "linked", sources: { schedule: true, biometric: true } })],
    { schedule: false, biometric: true },
  );
  assert.equal(suppressed.telegram, null);
});

test("a downed biometric feed leaves the Telegram state alone", () => {
  // The other direction: the two feeds fail independently, and the bridge has
  // no say over this column.
  const [suppressed] = suppressUnusableFacts(
    [row({ telegram: "linked", sources: { schedule: true, biometric: true } })],
    { schedule: true, biometric: false },
  );
  assert.equal(suppressed.telegram, "linked");
});

test("a Telegram filter is named in the export confirmation", () => {
  // The file holds the FILTERED rows. A reader who narrowed to "Not linked"
  // and forgot would otherwise ship a spreadsheet that looks like the whole
  // roster, in the words of the control they used.
  assert.deepEqual(
    describeRegisterFilters({ telegram: "none" }),
    [{ label: "Telegram", value: "Not linked" }],
  );
});

test("the CSV writes the same words the badge does", () => {
  // Not the wire value. A reader who filtered to "ID on file" must find that
  // phrase in the file, not `id_on_file`.
  const csv = toRegisterCsv([row({ telegram: "id_on_file" })], { schedule: true, biometric: true });
  assert.match(csv, /ID on file/);
  assert.doesNotMatch(csv, /id_on_file/);
});
