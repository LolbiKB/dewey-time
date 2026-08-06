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
