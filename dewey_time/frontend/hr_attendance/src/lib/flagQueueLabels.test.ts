import assert from "node:assert/strict";
import test from "node:test";

import { formatFlagLabel } from "@/lib/flagLabels";
import {
  appliedDecisionLabel,
  branchNoDeviceDataHeader,
  DECISION_STATE_LABELS,
  decisionStateLabel,
  deviceAlertHeadline,
  groupHeadline,
  orphanedEvidenceChangedSummary,
  orphanedFlagGoneSummary,
  OUTCOME_ACTION_LABELS,
  OUTCOME_LABELS,
  OUTCOME_OPTIONS,
  outcomeActionLabel,
  outcomeLabel,
  partialFailureMessage,
  personHeadline,
  priorDecisionLabel,
  REASON_LABELS,
  REASON_OPTIONS,
  reasonLabel,
  routineCodeHeader,
  tierLabel,
} from "@/lib/flagQueueLabels";
import type {
  DecisionState,
  FlagDecision,
  FlagOut,
  Outcome,
  QueueEntry,
  QueuePerson,
  Reason,
} from "@/types/flags";

// Hardcoded independently of REASON_LABELS's own keys — NOT derived by
// iterating `Object.keys(REASON_LABELS)`, which would trivially pass even if
// a Reason added to `types/flags.ts` was never given a label (the map would
// simply lack that key, so `Object.keys` would never produce it to check).
// This list mirrors the closed `REASONS` tuple in `flag_decision_api.py`
// (Interface Contract). On its own, looping this array only proves every
// entry IN IT has a label — it says nothing about a `Reason` value that
// exists in `types/flags.ts` but was left out of both this list and
// `REASON_LABELS` together. Catching that (a future `Reason` added to the
// union but never given a label, so `reasonLabel` silently returns
// `undefined`) needs the set-equality check below the loop: it fails the
// moment `ALL_REASONS` and `REASON_LABELS`'s keys diverge in EITHER
// direction, which is what makes "a future addition has to be added here
// too, or this test fails" actually true rather than aspirational. `tsx`
// strips types without checking them for `test:web`, so the `Record<Reason,
// string>` exhaustiveness TypeScript would otherwise offer never runs here —
// this run-time check is what stands in for it.
const ALL_REASONS: Reason[] = [
  "APPROVED_LEAVE",
  "DEVICE_OR_DATA_FAULT",
  "MANAGER_APPROVED",
  "SCHEDULE_WRONG",
  "COVERING_OTHER_SITE",
  "GENUINE_VIOLATION",
  "OTHER",
];

test("every Reason in the union has a non-empty label", () => {
  for (const reason of ALL_REASONS) {
    const label = reasonLabel(reason);
    assert.ok(typeof label === "string" && label.trim().length > 0, `${reason} has no label`);
    // Guards against a formatFlagLabel-style raw-enum fallback leaking into
    // HR-facing copy, e.g. "GENUINE_VIOLATION" or "genuine violation".
    assert.notEqual(label, reason);
    assert.doesNotMatch(label, /_/);
  }
});

test("REASON_LABELS covers exactly the Reason union, no more and no fewer", () => {
  // Fails the moment either side grows without the other: add an eighth
  // Reason to types/flags.ts and forget REASON_LABELS (or forget to add it
  // here), and this catches it — the loop above cannot, since it only ever
  // walks ALL_REASONS.
  assert.deepEqual(Object.keys(REASON_LABELS).sort(), [...ALL_REASONS].sort());
});

test("tierLabel covers all three tiers", () => {
  assert.equal(tierLabel("act"), "Act");
  assert.equal(tierLabel("review"), "Review");
  assert.equal(tierLabel("routine"), "Routine");
});

test("REASON_LABELS matches the design doc's exact wording", () => {
  assert.equal(REASON_LABELS.APPROVED_LEAVE, "Approved leave or holiday");
  assert.equal(REASON_LABELS.DEVICE_OR_DATA_FAULT, "Device or data fault");
  assert.equal(REASON_LABELS.MANAGER_APPROVED, "Manager pre-approved");
  assert.equal(REASON_LABELS.SCHEDULE_WRONG, "Schedule was wrong");
  assert.equal(REASON_LABELS.COVERING_OTHER_SITE, "Covering another site");
  assert.equal(REASON_LABELS.GENUINE_VIOLATION, "Genuine violation");
  assert.equal(REASON_LABELS.OTHER, "Other");
});

test("branchNoDeviceDataHeader names the branch and date, never a device serial", () => {
  const header = branchNoDeviceDataHeader("Phnom Penh HQ", "2026-08-03");
  assert.equal(header, "Phnom Penh HQ had no device data on 3 Aug");
  // No device serial has ever been passed in for this to leak — this is a
  // sanity check that the format string itself carries no ID-shaped token.
  assert.doesNotMatch(header, /ZK-|SN-|\d{4,}/);
});

function routineFlag(flagCode: string, minutes: number): FlagOut {
  return {
    flag_identity: `AUTO-${flagCode}-${minutes}`,
    flag_code: flagCode,
    severity: "INFO",
    day_closed: 1,
    evidence: { minutes },
    rank: 20,
    tier: "routine",
    decision_state: "undecided",
    decision: null,
  };
}

function routinePerson(employee: string, flagCode: string, minutes: number): QueuePerson {
  return {
    employee,
    employee_name: employee,
    employee_branch: "Phnom Penh HQ",
    attendance_date: "2026-08-03",
    rank: 20,
    tier: "routine",
    flags: [routineFlag(flagCode, minutes)],
    undecided_count: 1,
  };
}

test("routineCodeHeader matches the design doc's example wording exactly", () => {
  const minutes = [6, 20, ...Array.from({ length: 166 }, () => 12)];
  const members = minutes.map((m, i) => routinePerson(`HR-EMP-${i}`, "LATE_START", m));
  assert.equal(members.length, 168);
  assert.equal(
    routineCodeHeader("LATE_START", members),
    "168 late starts, 6–20 min — and nothing else wrong that day",
  );
});

test("orphan summaries pluralise correctly", () => {
  assert.match(orphanedFlagGoneSummary(1), /^1 decision /);
  assert.match(orphanedFlagGoneSummary(3), /^3 decisions /);
  assert.match(orphanedEvidenceChangedSummary(1), /^1 flag /);
  assert.match(orphanedEvidenceChangedSummary(4), /^4 flags /);
});

// Hardcoded for the same reason ALL_REASONS is: derived from the map's own
// keys, these checks would pass trivially. A state or outcome added to
// `types/flags.ts` but never given a label makes its label function return
// `undefined` at render time, and `tsx` strips the `Record<…, string>`
// exhaustiveness that would otherwise catch it.
const ALL_DECISION_STATES: DecisionState[] = ["undecided", "matched", "needs_re_review"];
const ALL_OUTCOMES: Outcome[] = ["EXCUSED", "UPHELD"];

test("DECISION_STATE_LABELS covers exactly the DecisionState union", () => {
  assert.deepEqual(Object.keys(DECISION_STATE_LABELS).sort(), [...ALL_DECISION_STATES].sort());
  for (const state of ALL_DECISION_STATES) {
    const label = decisionStateLabel(state);
    assert.notEqual(label, state);
    assert.doesNotMatch(label, /_/);
  }
  assert.equal(DECISION_STATE_LABELS.undecided, "Awaiting decision");
  assert.equal(DECISION_STATE_LABELS.matched, "Decided");
  assert.equal(DECISION_STATE_LABELS.needs_re_review, "Needs re-review");
});

test("OUTCOME_LABELS and OUTCOME_OPTIONS cover exactly the Outcome union", () => {
  assert.deepEqual(Object.keys(OUTCOME_LABELS).sort(), [...ALL_OUTCOMES].sort());
  assert.deepEqual([...OUTCOME_OPTIONS].sort(), [...ALL_OUTCOMES].sort());
  assert.equal(outcomeLabel("EXCUSED"), "Excused");
  assert.equal(outcomeLabel("UPHELD"), "Upheld");
});

test("OUTCOME_ACTION_LABELS is the imperative voice, and covers the union too", () => {
  assert.deepEqual(Object.keys(OUTCOME_ACTION_LABELS).sort(), [...ALL_OUTCOMES].sort());
  assert.equal(outcomeActionLabel("EXCUSED"), "Excuse");
  assert.equal(outcomeActionLabel("UPHELD"), "Uphold");

  // The whole reason both maps exist. A button labelled from the past-tense map
  // reads "Excused 39" — describing a state that does not exist until it is
  // clicked. Nothing but a reader catches that, so pin it.
  for (const outcome of ALL_OUTCOMES) {
    assert.notEqual(outcomeActionLabel(outcome), outcomeLabel(outcome));
  }
});

test("REASON_OPTIONS offers every Reason, in flag_decision_api's declared order", () => {
  // Exact equality rather than set equality: this array IS the reason picker's
  // option order, and it must also be complete — an eighth Reason that never
  // reaches the picker is a reason HR simply cannot record, silently.
  assert.deepEqual([...REASON_OPTIONS], ALL_REASONS);
});

const DECISION: FlagDecision = {
  name: "afd00000001",
  outcome: "EXCUSED",
  reason: "DEVICE_OR_DATA_FAULT",
  note: "Device was offline all morning.",
  decided_by: "hr@dewey.test",
  decided_at: "2026-08-04 09:12:00",
  group_key: "grp-1",
};

test("priorDecisionLabel reads as history; appliedDecisionLabel reads as in force", () => {
  const prior = priorDecisionLabel(DECISION);
  const applied = appliedDecisionLabel(DECISION);

  assert.equal(prior, "Previously excused — Device or data fault");
  assert.equal(applied, "Excused — Device or data fault");

  // The needs_re_review card renders `prior` beside a state badge. If it ever
  // carried the word that badge uses for a settled flag, HR would read a
  // decision the backend deliberately did NOT apply as a closed one — the day
  // would look handled when it is not.
  assert.ok(!prior.includes(DECISION_STATE_LABELS.matched), "must not read as decided");
  assert.match(prior, /^Previously /);
  assert.ok(!applied.includes("Previously"), "a live decision is not hedged as history");
  assert.notEqual(prior, applied);
});

test("partialFailureMessage matches the design doc's wording, and singularises", () => {
  assert.equal(
    partialFailureMessage(34, 39),
    "34 of 39 saved — 5 flags changed while you were deciding",
  );
  assert.equal(
    partialFailureMessage(38, 39),
    "38 of 39 saved — 1 flag changed while you were deciding",
  );
});

test("deviceAlertHeadline names the branch and date for every status, never a serial", () => {
  const base = { branch: "Phnom Penh HQ", local_date: "2026-08-03" };
  const offline = deviceAlertHeadline({ ...base, status: "deferred_offline" });
  const failed = deviceAlertHeadline({ ...base, status: "closure_failed" });
  // A status this app has not seen before must still say something true rather
  // than nothing at all — silence is the failure mode these cards exist for.
  const unknown = deviceAlertHeadline({ ...base, status: "something_new" });

  assert.equal(offline, "Phnom Penh HQ went offline on 3 Aug — its punches never arrived");
  assert.equal(failed, "Phnom Penh HQ failed to close out on 3 Aug");
  assert.equal(unknown, "Phnom Penh HQ had no device data on 3 Aug");

  for (const headline of [offline, failed, unknown]) {
    assert.match(headline, /^Phnom Penh HQ /);
    assert.match(headline, / 3 Aug/);
    assert.doesNotMatch(headline, /ZK-|SN-|\d{4,}/);
  }

  // `last_error` is the one field that can carry a serial (Constraint 9), and
  // nothing here reads it: the headline is identical with and without it.
  assert.equal(
    deviceAlertHeadline({
      ...base,
      status: "closure_failed",
      last_error: "device ZK-A4-014 timed out after 3 retries",
    }),
    failed,
  );
});

test("personHeadline headlines the worst unresolved flag, reusing the shared flag labels", () => {
  const settled: FlagOut = { ...routineFlag("LATE_START", 12), decision_state: "matched" };
  const unresolved: FlagOut = { ...routineFlag("MISSING_TIME", 192), decision_state: "undecided" };
  const person: QueuePerson = {
    ...routinePerson("HR-EMP-1", "LATE_START", 12),
    flags: [settled, unresolved],
    undecided_count: 1,
  };

  // Not "Late start": the first flag is already decided, so it is not what this
  // person is still in the queue for. And "Missing 3h 12m" rather than "Missing
  // time" is formatFlagLabel's own output — the list must not grow a second,
  // divergent vocabulary for the same flag codes.
  assert.equal(personHeadline(person), "Missing 3h 12m");
  assert.equal(personHeadline(person), formatFlagLabel("MISSING_TIME", { minutes: 192 }));

  // A fully decided person should not be in the queue at all, but if one is,
  // their row still says something rather than rendering blank.
  assert.equal(personHeadline({ ...person, flags: [settled] }), "Late start");
  assert.equal(personHeadline({ ...person, flags: [] }), "");
});

test("groupHeadline dispatches on group_type", () => {
  const members = [
    routinePerson("HR-EMP-1", "LATE_START", 6),
    routinePerson("HR-EMP-2", "LATE_START", 20),
  ];
  const routine: Extract<QueueEntry, { kind: "group" }> = {
    kind: "group",
    group_type: "ROUTINE_CODE",
    group_key: "ROUTINE_CODE:LATE_START:2026-08-03",
    branch: null,
    flag_code: "LATE_START",
    attendance_date: "2026-08-03",
    rank: 20,
    tier: "routine",
    members,
  };
  const outage: Extract<QueueEntry, { kind: "group" }> = {
    ...routine,
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ:2026-08-03",
    branch: "Phnom Penh HQ",
    flag_code: null,
    rank: 150,
    tier: "act",
  };

  assert.equal(groupHeadline(routine), routineCodeHeader("LATE_START", members));
  assert.equal(groupHeadline(outage), branchNoDeviceDataHeader("Phnom Penh HQ", "2026-08-03"));
  // Swapping the two would describe a branch-wide outage as "2 late starts" —
  // exactly the wrong story, and the one a mis-dispatch would tell.
  assert.notEqual(groupHeadline(routine), groupHeadline(outage));
});
