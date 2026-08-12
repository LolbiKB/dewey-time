import assert from "node:assert/strict";
import test from "node:test";

import { joinRegisterRows } from "@/lib/coverageRegister";
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
