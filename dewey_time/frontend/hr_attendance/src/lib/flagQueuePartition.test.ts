import assert from "node:assert/strict";
import test from "node:test";

import {
  isOutageGroup,
  outageWrite,
  partitionQueue,
  queuePeopleCount,
  type OutageGroup,
} from "@/lib/flagQueuePartition";
import type { DecisionState, FlagOut, QueueEntry, QueuePerson } from "@/types/flags";

function flag(identity: string, state: DecisionState = "undecided"): FlagOut {
  return {
    flag_identity: identity,
    flag_code: "MISSING_TIME",
    attendance_date: "2026-08-03",
    day_closed: 1,
    evidence: {},
    rank: 134,
    tier: "act",
    decision_state: state,
    decision: null,
  };
}

function person(employee: string, flags: FlagOut[]): QueuePerson {
  return {
    entry_key: `p:${employee}`,
    employee,
    employee_name: employee,
    employee_branch: "DIS Iconic",
    employee_image: null,
    attendance_date: "2026-08-03",
    dates: ["2026-08-03"],
    rank: 134,
    tier: "act",
    flags,
    undecided_count: flags.length,
    also_count: 0,
    also_outlier_count: 0,
  };
}

function outage(branch: string, members: QueuePerson[]): OutageGroup {
  return {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: `BRANCH_NO_DEVICE_DATA:${branch}`,
    branch,
    flag_code: null,
    attendance_date: null,
    dates: ["2026-08-03"],
    day_count: 1,
    rank: 134,
    tier: "act",
    members,
  };
}

function pattern(members: QueuePerson[]): OutageGroup {
  return {
    kind: "group",
    group_type: "REPEAT_PATTERN",
    group_key: "REPEAT_PATTERN:LATE_START",
    branch: null,
    flag_code: "LATE_START",
    attendance_date: null,
    dates: ["2026-08-03"],
    day_count: 1,
    rank: 120,
    tier: "review",
    members,
  };
}

const LONE: QueueEntry = { kind: "person", ...person("DI-0197", [flag("f-lone")]) };

test("only BRANCH_NO_DEVICE_DATA leaves the queue", () => {
  const outageGroup = outage("DIS Iconic", [person("DI-1", [flag("f-1")])]);
  const patternGroup = pattern([person("DI-2", [flag("f-2")])]);

  const { outages, queue } = partitionQueue([outageGroup, LONE, patternGroup]);

  assert.deepEqual(
    outages.map((g) => g.group_key),
    ["BRANCH_NO_DEVICE_DATA:DIS Iconic"],
  );
  assert.equal(queue.length, 2, "the lone person and the pattern group both stay");
  assert.ok(queue.includes(LONE));
  assert.ok(queue.includes(patternGroup));
});

test("a branchless person row is NOT mistaken for an outage", () => {
  // Today's real payload: all 133 person rows have employee_branch null, and
  // they are in the same situation as the grouped 256. They are still
  // judgments as far as this partition is concerned — only group_type decides.
  const branchless: QueueEntry = {
    kind: "person",
    ...person("DI-0197", [flag("f-b")]),
    employee_branch: null,
  };
  const { outages, queue } = partitionQueue([branchless]);
  assert.equal(outages.length, 0);
  assert.deepEqual(queue, [branchless]);
});

test("isOutageGroup is false for a person entry", () => {
  assert.equal(isOutageGroup(LONE), false);
});

test("the write covers every undecided flag of every included branch", () => {
  const groups = [
    outage("A", [person("DI-1", [flag("a1"), flag("a2")]), person("DI-2", [flag("a3")])]),
    outage("B", [person("DI-3", [flag("b1")])]),
  ];

  const write = outageWrite(groups, new Set());

  assert.deepEqual(write.identities, ["a1", "a2", "a3", "b1"]);
  assert.equal(write.branchCount, 2);
  assert.equal(write.employeeCount, 3);
});

test("excluding a branch removes its people and all of their flags", () => {
  const groups = [
    outage("A", [person("DI-1", [flag("a1"), flag("a2")])]),
    outage("B", [person("DI-3", [flag("b1")])]),
  ];

  const write = outageWrite(groups, new Set(["BRANCH_NO_DEVICE_DATA:A"]));

  assert.deepEqual(write.identities, ["b1"]);
  assert.equal(write.branchCount, 1);
  assert.equal(write.employeeCount, 1);
});

test("a decided or needs_re_review flag is never swept into the write", () => {
  const groups = [
    outage("A", [
      person("DI-1", [flag("keep"), flag("done", "matched"), flag("stale", "needs_re_review")]),
    ]),
  ];

  const write = outageWrite(groups, new Set());

  assert.deepEqual(write.identities, ["keep"]);
});

test("a member who contributes no identity is not counted as covered", () => {
  // groupPayload's own rule: checked, so it counts in employeeCount, but it
  // writes nothing — so a label reading from this must not promise it.
  const groups = [
    outage("A", [person("DI-1", [flag("keep")]), person("DI-2", [flag("stale", "needs_re_review")])]),
  ];

  const write = outageWrite(groups, new Set());

  assert.equal(write.employeeCount, 1, "only DI-1 writes anything");
  assert.deepEqual(write.identities, ["keep"]);
});

test("queuePeopleCount counts distinct employees, not rows", () => {
  const shared = person("DI-9", [flag("s1")]);
  const entries: QueueEntry[] = [
    { kind: "person", ...shared },
    pattern([shared, person("DI-8", [flag("s2")])]),
  ];

  assert.equal(queuePeopleCount(entries), 2, "DI-9 appears twice, counts once");
});
