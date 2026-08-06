import assert from "node:assert/strict";
import test from "node:test";

import { decisionIsComplete, groupPayload, remainingIdentities } from "@/lib/flagDecisionState";
import type { FlagOut, QueuePerson } from "@/types/flags";

function flag(over: Partial<FlagOut> & { flag_identity: string }): FlagOut {
  return {
    flag_code: "LATE_START",
    severity: "WARNING",
    day_closed: 1,
    evidence: {},
    rank: 20,
    tier: "routine",
    decision_state: "undecided",
    decision: null,
    ...over,
  } as FlagOut;
}

function person(over: Partial<QueuePerson> & { employee: string; flags: FlagOut[] }): QueuePerson {
  return {
    employee_name: over.employee,
    employee_branch: null,
    attendance_date: "2026-08-03",
    rank: 20,
    tier: "routine",
    undecided_count: over.flags.filter((f) => f.decision_state === "undecided").length,
    ...over,
  } as QueuePerson;
}

test("decisionIsComplete requires a note when the outcome is UPHELD", () => {
  assert.equal(decisionIsComplete({ outcome: "UPHELD", reason: "GENUINE_VIOLATION", note: "" }), false);
  assert.equal(
    decisionIsComplete({
      outcome: "UPHELD",
      reason: "GENUINE_VIOLATION",
      note: "Confirmed with the shift lead.",
    }),
    true,
  );
});

test("decisionIsComplete requires a note when the reason is OTHER", () => {
  assert.equal(decisionIsComplete({ outcome: "EXCUSED", reason: "OTHER", note: "" }), false);
  assert.equal(
    decisionIsComplete({
      outcome: "EXCUSED",
      reason: "OTHER",
      note: "Approved via WhatsApp, see thread.",
    }),
    true,
  );
});

test("decisionIsComplete does not require a note for EXCUSED with a non-OTHER reason", () => {
  assert.equal(decisionIsComplete({ outcome: "EXCUSED", reason: "APPROVED_LEAVE", note: "" }), true);
});

test("groupPayload drops an excluded employee's flags entirely and returns the right employeeCount", () => {
  const members: QueuePerson[] = [
    person({ employee: "HR-EMP-00001", flags: [flag({ flag_identity: "AUTO-1" })] }),
    person({
      employee: "HR-EMP-00002",
      flags: [flag({ flag_identity: "AUTO-2a" }), flag({ flag_identity: "AUTO-2b" })],
    }),
    person({ employee: "HR-EMP-00003", flags: [flag({ flag_identity: "AUTO-3" })] }),
  ];

  const { identities, employeeCount } = groupPayload(members, new Set(["HR-EMP-00002"]));

  assert.deepEqual(identities.sort(), ["AUTO-1", "AUTO-3"]);
  assert.equal(employeeCount, 2);
  // both of the excluded employee's flags are gone, not just their headline one
  assert.ok(!identities.includes("AUTO-2a"));
  assert.ok(!identities.includes("AUTO-2b"));
});

test("groupPayload never includes an already-decided flag", () => {
  const decided = flag({
    flag_identity: "AUTO-decided",
    decision_state: "matched",
    decision: {
      name: "AFD-1",
      outcome: "EXCUSED",
      reason: "DEVICE_OR_DATA_FAULT",
      decided_by: "hr@example.com",
      decided_at: "2026-08-03 09:00:00",
    },
  });
  const undecided = flag({ flag_identity: "AUTO-undecided" });
  const members: QueuePerson[] = [person({ employee: "HR-EMP-00001", flags: [decided, undecided] })];

  const { identities } = groupPayload(members, new Set());

  assert.deepEqual(identities, ["AUTO-undecided"]);
});

test("remainingIdentities is worst-first and omits decided flags", () => {
  const decided = flag({
    flag_identity: "AUTO-already-decided",
    rank: 150,
    tier: "act",
    decision_state: "matched",
    decision: {
      name: "AFD-2",
      outcome: "UPHELD",
      reason: "GENUINE_VIOLATION",
      note: "Confirmed no-show.",
      decided_by: "hr@example.com",
      decided_at: "2026-08-03 09:00:00",
    },
  });
  const worst = flag({ flag_identity: "AUTO-worst", rank: 140, tier: "act" });
  const middle = flag({ flag_identity: "AUTO-middle", rank: 60, tier: "review" });
  // `decided` is placed first even though its rank is highest, to prove the
  // function filters rather than leaning on decided rows always sorting last.
  const p = person({ employee: "HR-EMP-00001", flags: [decided, worst, middle] });

  assert.deepEqual(remainingIdentities(p), ["AUTO-worst", "AUTO-middle"]);
});

test("groupPayload's coveredEmployeeCount excludes a member whose only unresolved flag needs_re_review", () => {
  // A "needs_re_review" flag is unresolved on the backend (flag_grouping.py's
  // UNRESOLVED_STATES includes it, so this member's undecided_count would be
  // 1 and they stay in the queue) but it must never be swept into a bulk
  // write — a stale prior decision needs a human to look again, not a repeat
  // of the old verdict. So this member is checked (counted in employeeCount)
  // but contributes zero identities, and coveredEmployeeCount must say so.
  const staleDecision = flag({
    flag_identity: "AUTO-stale",
    decision_state: "needs_re_review",
    decision: {
      name: "AFD-3",
      outcome: "EXCUSED",
      reason: "DEVICE_OR_DATA_FAULT",
      decided_by: "hr@example.com",
      decided_at: "2026-08-01 09:00:00",
    },
  });
  const members: QueuePerson[] = [
    person({ employee: "HR-EMP-00001", flags: [flag({ flag_identity: "AUTO-1" })] }),
    person({ employee: "HR-EMP-00002", flags: [staleDecision] }),
  ];

  const { identities, employeeCount, coveredEmployeeCount } = groupPayload(members, new Set());

  assert.deepEqual(identities, ["AUTO-1"]);
  assert.equal(employeeCount, 2);
  assert.equal(coveredEmployeeCount, 1);
});

test("remainingIdentities excludes needs_re_review flags even though the backend's undecided_count includes them", () => {
  // Constructed WITHOUT the person() helper above: that helper approximates
  // undecided_count as count-of-strictly-"undecided" flags, which is the
  // frontend's own filter, not the real backend's. The real backend
  // (flag_grouping.py's UNRESOLVED_STATES) counts BOTH "undecided" and
  // "needs_re_review" into undecided_count, so this test sets it that way by
  // hand to pin the exact divergence Finding 2 describes: a caller reading
  // person.undecided_count for a button label ("Apply to remaining 2") would
  // silently promise one more identity than decide_flags will actually
  // receive.
  const staleDecision = flag({
    flag_identity: "AUTO-stale",
    rank: 90,
    decision_state: "needs_re_review",
    decision: {
      name: "AFD-4",
      outcome: "EXCUSED",
      reason: "DEVICE_OR_DATA_FAULT",
      decided_by: "hr@example.com",
      decided_at: "2026-08-01 09:00:00",
    },
  });
  const open = flag({ flag_identity: "AUTO-open", rank: 50 });
  const p: QueuePerson = {
    employee: "HR-EMP-00001",
    employee_name: "HR-EMP-00001",
    employee_branch: null,
    attendance_date: "2026-08-03",
    rank: 90,
    tier: "routine",
    flags: [staleDecision, open],
    undecided_count: 2, // backend counts "undecided" + "needs_re_review"
  };

  const remaining = remainingIdentities(p);

  assert.deepEqual(remaining, ["AUTO-open"]);
  assert.notEqual(remaining.length, p.undecided_count);
});
