import assert from "node:assert/strict";
import test from "node:test";

import { formatFlagLabel, formatMissingDuration } from "@/lib/flagLabels";
import {
  appliedDecisionLabel,
  branchNoDeviceDataHeader,
  CAPPED_EXPLAINER,
  cappedHeadline,
  crossReferenceLabel,
  DECIDE_ONE_LABEL,
  DECIDED_TOGGLE_LABEL,
  DECIDING_PREFIX,
  decidingLabel,
  DECISION_STATE_LABELS,
  decisionStateLabel,
  decisionSurfaceTitle,
  DEVICE_HEALTH_LABEL,
  deviceAlertHeadline,
  earlierMarkerLabel,
  groupHeadline,
  groupSubline,
  hiddenMemberLabel,
  narrowRangeLabel,
  NOTHING_WAITING_TITLE,
  nothingWaitingDetail,
  openCountAria,
  openCountLabel,
  orphanedEvidenceChangedSummary,
  orphanedFlagGoneSummary,
  OUTAGE_BAND_LABEL,
  OUTAGE_CEILING_NOTE,
  OUTAGE_EXCUSING_LABEL,
  OUTAGE_NOT_A_JUDGMENT,
  outageBandHeadline,
  outageBandSubline,
  outageBranchCheckboxLabel,
  outageBranchDays,
  outageBranchSummary,
  outageExcuseLabel,
  OUTCOME_ACTION_LABELS,
  OUTCOME_LABELS,
  OUTCOME_OPTIONS,
  outcomeActionLabel,
  outcomeLabel,
  partialFailureMessage,
  personDayLabel,
  personHeadline,
  personSubline,
  priorDecisionLabel,
  queueHeaderDescription,
  queueSplitDescription,
  QUEUE_LOADING_LABEL,
  REASON_LABELS,
  REASON_OPTIONS,
  reasonLabel,
  restHeading,
  routineCodeHeader,
  sameReasonWithDecision,
  showDecidedLabel,
  stripAriaLabel,
  TIER_FILTER_ALL_LABEL,
  tierLabel,
  UNKNOWN_BRANCH_LABEL,
} from "@/lib/flagQueueLabels";
import type { Strip } from "@/lib/flagStrip";
import type {
  DecisionState,
  FlagDecision,
  FlagOut,
  Outcome,
  QueueEntry,
  QueuePerson,
  Reason,
} from "@/types/flags";

/**
 * Fixture builders for the nesting-and-cross-reference copy below. `person`
 * layers named overrides on a fully-formed lone-row default, so a test naming
 * only the field it cares about — e.g.
 * `person({ also_count: 1, also_outlier_count: 1 })` — cannot accidentally
 * leave any other required field unset.
 */
function lateStart(minutes: number): FlagOut {
  return {
    flag_identity: `AUTO-LATE_START-${minutes}`,
    flag_code: "LATE_START",
    attendance_date: "2026-08-03",
    severity: "INFO",
    day_closed: 1,
    evidence: { minutes },
    rank: 20,
    tier: "routine",
    decision_state: "undecided",
    decision: null,
  };
}

function missingTime(minutes: number): FlagOut {
  return {
    flag_identity: `AUTO-MISSING_TIME-${minutes}`,
    flag_code: "MISSING_TIME",
    attendance_date: "2026-08-03",
    severity: "INFO",
    day_closed: 1,
    evidence: { minutes },
    rank: 50,
    tier: "review",
    decision_state: "undecided",
    decision: null,
  };
}

function person(overrides: Partial<QueuePerson> = {}): QueuePerson {
  return {
    entry_key: "p:HR-EMP-1",
    employee: "HR-EMP-1",
    employee_name: "HR-EMP-1",
    employee_branch: "Phnom Penh HQ",
    employee_image: null,
    attendance_date: "2026-08-03",
    dates: ["2026-08-03"],
    rank: 20,
    tier: "routine",
    flags: [lateStart(12)],
    undecided_count: 1,
    also_count: 0,
    also_outlier_count: 0,
    ...overrides,
  };
}

function patternDate(offset: number): string {
  return `2026-08-${String(3 + offset).padStart(2, "0")}`;
}

function patternMember(employee: string, flagCode: string, occurrences: number): QueuePerson {
  const flags: FlagOut[] = Array.from({ length: occurrences }, (_, i) => ({
    flag_identity: `AUTO-${flagCode}-${employee}-${i}`,
    flag_code: flagCode,
    attendance_date: patternDate(i),
    severity: "INFO",
    day_closed: 1,
    evidence: { minutes: 10 + i },
    rank: 50,
    tier: "review",
    decision_state: "undecided",
    decision: null,
  }));
  return {
    entry_key: `REPEAT_PATTERN:${flagCode}|p:${employee}`,
    employee,
    employee_name: employee,
    employee_branch: "Phnom Penh HQ",
    employee_image: null,
    attendance_date: flags[flags.length - 1]?.attendance_date ?? patternDate(0),
    dates: flags.map((f) => f.attendance_date),
    rank: 50,
    tier: "review",
    flags,
    undecided_count: flags.length,
    also_count: 0,
    also_outlier_count: 0,
  };
}

/**
 * A REPEAT_PATTERN group of `memberCount` people sharing `occurrences` total
 * flags of `flagCode`, spread as evenly as the numbers allow — the plan's own
 * example ("8 people · 34 mornings") does not divide evenly either.
 */
function patternGroup(
  flagCode: string,
  memberCount: number,
  occurrences: number = memberCount,
): Extract<QueueEntry, { kind: "group" }> {
  const base = Math.floor(occurrences / memberCount);
  const remainder = occurrences - base * memberCount;
  const members = Array.from({ length: memberCount }, (_, i) =>
    patternMember(`HR-EMP-${i}`, flagCode, base + (i < remainder ? 1 : 0)),
  );
  // Derived from the members exactly as flag_grouping's assembly does it, so the
  // fixture cannot claim a span its own flags do not cover.
  const dates = [...new Set(members.flatMap((member) => member.dates))].sort();
  return {
    kind: "group",
    group_type: "REPEAT_PATTERN",
    group_key: `REPEAT_PATTERN:${flagCode}`,
    branch: null,
    flag_code: flagCode,
    attendance_date: null,
    dates,
    day_count: dates.length,
    rank: 50,
    tier: "review",
    members,
  };
}

/** A ROUTINE_CODE group, one member per entry in `minutesList`. */
function routineGroup(
  flagCode: string,
  minutesList: number[],
): Extract<QueueEntry, { kind: "group" }> {
  const members = minutesList.map((m, i) => routinePerson(`HR-EMP-${i}`, flagCode, m));
  return {
    kind: "group",
    group_type: "ROUTINE_CODE",
    group_key: `ROUTINE_CODE:${flagCode}:2026-08-03`,
    branch: null,
    flag_code: flagCode,
    attendance_date: "2026-08-03",
    dates: ["2026-08-03"],
    day_count: 1,
    rank: 20,
    tier: "routine",
    members,
  };
}

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

// `attendance_date` is nullable on every group in the contract, and date-fns
// throws RangeError on a date it cannot parse — so a dateless group would take
// the whole list down, not merely word its header badly. Dropping the clause is
// the only honest degradation: there is no day to name.
test("a dateless outage header drops the day rather than throwing on it", () => {
  assert.equal(branchNoDeviceDataHeader("Phnom Penh HQ", null), "Phnom Penh HQ had no device data");
  assert.equal(branchNoDeviceDataHeader("Phnom Penh HQ", ""), "Phnom Penh HQ had no device data");
});

// A device that stopped reporting is ONE fact spanning however many days it was
// down. Naming only the first day is how eleven rows all read "…on 28 Jul" and
// looked like eleven separate incidents.
test("a multi-day outage headline counts the days instead of naming one", () => {
  assert.equal(
    branchNoDeviceDataHeader("Phnom Penh HQ", null, ["2026-07-26", "2026-07-27", "2026-08-05"]),
    "Phnom Penh HQ had no device data on 3 days",
  );
});

test("a one-day outage still names the day", () => {
  assert.equal(
    branchNoDeviceDataHeader("Phnom Penh HQ", null, ["2026-08-03"]),
    "Phnom Penh HQ had no device data on 3 Aug",
  );
});

test("the outage subline gives the span, so a live fault is distinguishable from a finished one", () => {
  const entry: Extract<QueueEntry, { kind: "group" }> = {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ",
    branch: "Phnom Penh HQ",
    flag_code: null,
    attendance_date: null,
    dates: ["2026-07-26", "2026-07-27", "2026-08-05"],
    day_count: 3,
    rank: 150,
    tier: "act",
    members: [person(), person({ employee: "HR-EMP-2", entry_key: "p:HR-EMP-2" })],
  };
  assert.equal(groupHeadline(entry), "Phnom Penh HQ had no device data on 3 days");
  assert.equal(groupSubline(entry), "2 people · 26 Jul – 5 Aug");
});

test("a one-day outage subline stays just the headcount, with no span to state", () => {
  const entry: Extract<QueueEntry, { kind: "group" }> = {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ",
    branch: "Phnom Penh HQ",
    flag_code: null,
    attendance_date: null,
    dates: ["2026-08-03"],
    day_count: 1,
    rank: 150,
    tier: "act",
    members: [person(), person({ employee: "HR-EMP-2", entry_key: "p:HR-EMP-2" })],
  };
  assert.equal(groupSubline(entry), "2 people");
});

test("a dateless outage group still gets a headline", () => {
  const entry: Extract<QueueEntry, { kind: "group" }> = {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA::",
    branch: null,
    flag_code: null,
    attendance_date: null,
    dates: [],
    day_count: 0,
    rank: 150,
    tier: "act",
    members: [],
  };
  assert.equal(groupHeadline(entry), "Unknown branch had no device data");
});

function routineFlag(flagCode: string, minutes: number): FlagOut {
  return {
    flag_identity: `AUTO-${flagCode}-${minutes}`,
    flag_code: flagCode,
    attendance_date: "2026-08-03",
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
    entry_key: `p:${employee}`,
    employee,
    employee_name: employee,
    employee_branch: "Phnom Penh HQ",
    employee_image: null,
    attendance_date: "2026-08-03",
    dates: ["2026-08-03"],
    rank: 20,
    tier: "routine",
    flags: [routineFlag(flagCode, minutes)],
    undecided_count: 1,
    also_count: 0,
    also_outlier_count: 0,
  };
}

test("routineCodeHeader matches the design doc's example wording exactly", () => {
  const minutes = [6, 20, ...Array.from({ length: 166 }, () => 12)];
  const members = minutes.map((m, i) => routinePerson(`HR-EMP-${i}`, "LATE_START", m));
  assert.equal(members.length, 168);
  assert.equal(
    routineCodeHeader("LATE_START", members),
    "168 one-off late starts, 6–20 min — and nothing else wrong that day",
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
    dates: ["2026-08-03"],
    day_count: 1,
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

// Below lg the panel is a modal, and its title is the only thing naming what
// is being decided — the row it came from is covered by the surface itself.
test("the decision surface is titled by the row it was opened from", () => {
  const person = routinePerson("HR-EMP-1", "LATE_START", 6);
  assert.equal(
    decisionSurfaceTitle({ kind: "person", ...person }),
    person.employee_name,
    "a person's modal is titled with their name, not their finding",
  );

  const group = routineGroup("LATE_START", [9, 20]);
  // Deferring to groupHeadline rather than composing a second sentence: a
  // group's row and the modal it opens must not describe it differently.
  assert.equal(decisionSurfaceTitle(group), groupHeadline(group));
});

test("a repeat pattern is headlined by what it is, not by a count", () => {
  const entry = patternGroup("LATE_START", 8);
  assert.equal(groupHeadline(entry), "Repeatedly late");
});

test("a repeat pattern's subline states people and occurrences", () => {
  const entry = patternGroup("LATE_START", 8, 34);
  assert.equal(groupSubline(entry), "8 people · 34 mornings");
});

// Closes a gap the given fixtures leave open: both examples above use 8
// people, so a bug that always prints "people" (or always prints "person")
// would still pass them both. A single-member pattern is the only fixture
// that can catch that.
test("a repeat pattern's subline is singular for exactly one person", () => {
  const entry = patternGroup("LATE_START", 1, 3);
  assert.equal(groupSubline(entry), "1 person · 3 mornings");
});

test("an unknown pattern code still reads as English", () => {
  const entry = patternGroup("SOME_NEW_CODE", 2, 6);
  assert.equal(groupHeadline(entry), "Repeated some new code");
  assert.equal(groupSubline(entry), "2 people · 6 days");
});

test("routine code groups say one-off, because repeat offenders left by precedence", () => {
  const entry = routineGroup("LATE_START", [9, 20]);
  assert.match(groupHeadline(entry), /one-off late starts/);
});

// groupSubline's early return is what keeps ROUTINE_CODE and
// BRANCH_NO_DEVICE_DATA — the two group types that exist in production
// today — from borrowing the pattern map's occurrence unit. Deleting that
// return line is invisible to every test above: they only exercise
// REPEAT_PATTERN. This is the only assertion in the file that would catch it.
test("groupSubline reports only the people count for the two group types that are not a pattern", () => {
  const routine = routineGroup("LATE_START", [9, 20]);
  assert.equal(groupSubline(routine), "2 people");

  const outage: Extract<QueueEntry, { kind: "group" }> = {
    ...routine,
    group_type: "BRANCH_NO_DEVICE_DATA",
    branch: "Phnom Penh HQ",
    flag_code: null,
  };
  assert.equal(groupSubline(outage), "2 people");
});

test("a person whose other entries are all lone rows is badged as an outlier", () => {
  assert.equal(crossReferenceLabel(person({ also_count: 1, also_outlier_count: 1 })), "also 1 outlier");
  assert.equal(crossReferenceLabel(person({ also_count: 2, also_outlier_count: 2 })), "also 2 outliers");
});

test("a person whose other entries include a group is badged as elsewhere", () => {
  assert.equal(crossReferenceLabel(person({ also_count: 1, also_outlier_count: 0 })), "also 1 elsewhere");
  assert.equal(crossReferenceLabel(person({ also_count: 2, also_outlier_count: 1 })), "also 2 elsewhere");
});

test("a person in one entry carries no badge at all", () => {
  assert.equal(crossReferenceLabel(person({ also_count: 0, also_outlier_count: 0 })), null);
});

test("the header states people and rows, so it cannot contradict the list", () => {
  assert.equal(
    queueHeaderDescription({ open: 0, needs_re_review: 0, open_capped: false, decided: 0, people: 40, rows: 12 }),
    "40 people · 12 rows",
  );
});

test("the header is singular for one", () => {
  assert.equal(
    queueHeaderDescription({ open: 0, needs_re_review: 0, open_capped: false, decided: 0, people: 1, rows: 1 }),
    "1 person · 1 row",
  );
});

// The two tests above are each all-singular or all-plural, so a bug that
// decided BOTH nouns off the same count (e.g. always reading `rows` for both)
// would still pass — 1-and-1 and 40-and-12 never disagree with themselves.
// Only a fixture where the two counts differ can catch that.
test("the header's two counts pluralise independently of each other", () => {
  assert.equal(
    queueHeaderDescription({ open: 0, needs_re_review: 0, open_capped: false, decided: 0, people: 1, rows: 3 }),
    "1 person · 3 rows",
  );
  assert.equal(
    queueHeaderDescription({ open: 0, needs_re_review: 0, open_capped: false, decided: 0, people: 5, rows: 1 }),
    "5 people · 1 row",
  );
});

// `open` is a count of the flags the scan returned, so at the cap it IS the cap.
// Printed bare it is a constant masquerading as a total — 5000 before HR decides a
// thousand and 5000 after. The "+" is the entire difference between reporting a
// floor and claiming a measurement.
test("an uncapped open count prints as the plain number", () => {
  assert.equal(
    openCountLabel({ open: 42, needs_re_review: 0, open_capped: false, decided: 0, people: 9, rows: 9 }),
    "42",
  );
});

test("a capped open count prints as a floor, not a total", () => {
  assert.equal(
    openCountLabel({ open: 5000, needs_re_review: 0, open_capped: true, decided: 0, people: 390, rows: 252 }),
    "5000+",
  );
});

// The "+" is one character at the end of a number, and it is the character a
// screen reader is likeliest to drop — so the fact travels in words too.
test("a capped count says in words that the total is higher", () => {
  const aria = openCountAria({
    open: 5000,
    needs_re_review: 0,
    open_capped: true,
    decided: 0,
    people: 390,
    rows: 252,
  });
  assert.match(String(aria), /at least 5000/);
  assert.match(String(aria), /limit/);
});

test("an uncapped count needs no spoken caveat", () => {
  assert.equal(
    openCountAria({ open: 42, needs_re_review: 0, open_capped: false, decided: 0, people: 9, rows: 9 }),
    undefined,
  );
});

test("a person with several flags of one code is summarised, not headlined by one", () => {
  assert.equal(
    personHeadline(person({ flags: [lateStart(31), lateStart(12), lateStart(9), lateStart(15)] })),
    "4 late starts · worst 31 min",
  );
});

test("a person with a single flag keeps the flag's own label", () => {
  assert.equal(personHeadline(person({ flags: [lateStart(31)] })), formatFlagLabel("LATE_START", { minutes: 31 }));
});

// MISSING_TIME's single-flag path (formatFlagLabel) renders a duration, e.g.
// "Missing 3h 12m" — never raw minutes. The multi-flag "worst" figure has to
// agree, or the same flag reads two different units on two screens: this
// fixture's worst occurrence is 192 minutes, and a raw-minutes bug would print
// "worst 192 min" where the correct output reads "worst 3h 12m".
test("a person with several MISSING_TIME flags renders the worst as a duration, not raw minutes", () => {
  const headline = personHeadline(
    person({ flags: [missingTime(192), missingTime(45), missingTime(130)] }),
  );
  assert.equal(headline, `3 gaps in the day · worst ${formatMissingDuration(192).replace(/^Missing /, "")}`);
  assert.equal(headline, "3 gaps in the day · worst 3h 12m");
  assert.doesNotMatch(headline, /192 min\b/);
});

/** A strip of `cellCount` cells of which `flaggedCount` are flagged. The cells'
 *  own states do not reach the label, which reports only the two counts. */
function strip(flaggedCount: number, cellCount = 14, earlierCount = 0): Strip {
  return {
    cells: Array.from({ length: cellCount }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      state: i < flaggedCount ? "flagged" : "clean",
      tier: i < flaggedCount ? "routine" : null,
    })),
    flaggedCount,
    earlierCount,
  };
}

test("the strip's accessible name is one summary of the fortnight", () => {
  assert.equal(stripAriaLabel(strip(4)), "4 flagged days in the last 14");
});

test("the strip's summary is singular for a single flagged day", () => {
  assert.equal(stripAriaLabel(strip(1)), "1 flagged day in the last 14");
  assert.equal(stripAriaLabel(strip(0)), "0 flagged days in the last 14");
});

// The window is cut from the range, so a week-long range gives seven cells —
// and the label has to say seven. Hard-coding "14" would make the summary
// disagree with the picture beside it the first time HR narrows the dates.
test("the strip's summary counts the cells it actually has, not a fixed fortnight", () => {
  assert.equal(stripAriaLabel(strip(2, 7)), "2 flagged days in the last 7");
});

// A widened range can leave a row whose sub-line names a serious flag while its
// strip is all green, because the flag is older than the window. This marker is
// what keeps that honest.
test("flags older than the window are marked, and a clean window says nothing", () => {
  assert.equal(earlierMarkerLabel(3), "+3 earlier");
  assert.equal(earlierMarkerLabel(1), "+1 earlier");
  assert.equal(earlierMarkerLabel(0), null);
});

// The queue's other "+N": faces a group row had no room for. Same file and the
// same null-at-zero rule as the marker above, so the row does not set two
// precedents for the same affix.
test("a group row's overflow count says nothing when every face fits", () => {
  assert.equal(hiddenMemberLabel(2), "+2");
  assert.equal(hiddenMemberLabel(164), "+164");
  assert.equal(hiddenMemberLabel(0), null);
});

/** The same flag, moved to another day — `lateStart` fixes one date of its own. */
function on(flag: FlagOut, date: string): FlagOut {
  return { ...flag, flag_identity: `${flag.flag_identity}-${date}`, attendance_date: date };
}

test("a person's sub-line names the day when the entry holds exactly one", () => {
  const subline = personSubline(person({ dates: ["2026-08-06"], flags: [on(lateStart(31), "2026-08-06")] }));
  assert.equal(subline, `${formatFlagLabel("LATE_START", { minutes: 31 })} · Thu 6 Aug`);
});

// Naming one of four mornings would be wrong for the other three, so a
// multi-day entry gets the summary and no date at all.
test("a person's sub-line names no day when the entry spans several", () => {
  const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"];
  const spanning = person({
    dates,
    flags: [31, 12, 9, 15].map((minutes, i) => on(lateStart(minutes), dates[i])),
  });
  assert.equal(personSubline(spanning), "4 late starts · worst 31 min");
});

// `dates` is the honest test for which case this is, and `flags.length` is not:
// a person can hold two flags on a single day, and that day is still nameable.
// The empty-headline case has no sub-line to date either — appending
// " · Thu 6 Aug" to an empty string would render a bare dangling date.
test("a person's sub-line dates by the entry's days, and stays empty when there is nothing to say", () => {
  const oneDayTwoFlags = person({
    dates: ["2026-08-06"],
    flags: [on(lateStart(31), "2026-08-06"), on(lateStart(12), "2026-08-06")],
  });
  assert.equal(personSubline(oneDayTwoFlags), "2 late starts · worst 31 min · Thu 6 Aug");
  assert.equal(personSubline(person({ dates: ["2026-08-06"], flags: [] })), "");
});

// The queue's row DRAWS these two halves as two facts, so the identity block's
// ladder can drop the day whole on a narrow phone instead of cutting it
// mid-word; the joined string stays for the row's spoken label. Both come out
// of one rule here, so the two can never disagree about whether a day is
// nameable at all.
test("a person's day is the same half of the sub-line, on its own", () => {
  const oneDay = person({ dates: ["2026-08-06"], flags: [on(lateStart(31), "2026-08-06")] });
  assert.equal(personDayLabel(oneDay), "Thu 6 Aug");
  assert.equal(personSubline(oneDay), `${personHeadline(oneDay)} · ${personDayLabel(oneDay)}`);

  const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"];
  const spanning = person({
    dates,
    flags: [31, 12, 9, 15].map((minutes, i) => on(lateStart(minutes), dates[i])),
  });
  assert.equal(personDayLabel(spanning), null, "naming one of four mornings would be wrong");

  // A dateless day rather than an empty fact: with no finding to date, the row
  // would otherwise draw a bare day beside the employee id and read as a
  // person who is in the queue for the sixth of August.
  assert.equal(personDayLabel(person({ dates: ["2026-08-06"], flags: [] })), null);
});

test("the outage band headline names branches and people, never a device", () => {
  const headline = outageBandHeadline(13, 256);
  assert.equal(headline, "13 branches had no device data · 256 people affected");
  assert.ok(!/serial|device [A-Z]{2}-/i.test(headline));
});

test("a single branch and a single person read in the singular", () => {
  assert.equal(outageBandHeadline(1, 1), "1 branch had no device data · 1 person affected");
});

test("the headline says AFFECTED, so it can differ from what the button excuses", () => {
  // The button reads coveredEmployeeCount, which is smaller. Without "affected"
  // an HR reader sees 256 then 157 and concludes the button is broken.
  assert.match(outageBandHeadline(13, 256), /256 people affected$/);
  assert.equal(outageExcuseLabel(157, 2287, 13), "Excuse 157 people · 2,287 flags");
});

test("the band subline carries the range, the flag count, and the disclaimer", () => {
  const subline = outageBandSubline(["2026-07-30", "2026-08-08"], 3277);
  assert.match(subline, /30 Jul/);
  assert.match(subline, /8 Aug/);
  assert.match(subline, /3,277 flags/);
  assert.match(subline, /nobody is being judged here/);
});

test("the excuse label states both dimensions of the write", () => {
  assert.equal(outageExcuseLabel(1, 1, 1), "Excuse 1 person · 1 flag");
});

test("nothing SELECTED and nothing LEFT are different sentences", () => {
  // "Left" is a completion word. Saying it over an empty selection tells the
  // user the outage is handled when they have merely unchecked everything.
  assert.equal(outageExcuseLabel(0, 0, 0), "Select a branch to excuse");
  assert.equal(outageExcuseLabel(0, 0, 3), "Nothing left to excuse");
});

test("the ceiling note refuses to promise device granularity", () => {
  assert.equal(
    OUTAGE_CEILING_NOTE,
    "Branch and days only — nothing here maps a device to a branch.",
  );
});

test("the band's own accessible names are copy, not markup", () => {
  assert.equal(OUTAGE_BAND_LABEL, "Device outages");
  assert.equal(UNKNOWN_BRANCH_LABEL, "Unknown branch");
  assert.equal(outageBranchCheckboxLabel("DIS Iconic"), "Include DIS Iconic");
  assert.equal(OUTAGE_EXCUSING_LABEL, "Excusing…");
});

test("the header splits waiting-on-you from waiting-on-a-device, and keeps rows", () => {
  // `rows` was added in 20c016fc and fixed for tier filters in 38fbea19,
  // because one row can stand for several people. Dropping it here would
  // silently undo both.
  assert.equal(
    queueSplitDescription(134, 92, 256, false),
    "134 people need a decision · 92 rows · 256 waiting on a device fault",
  );
});

test("the header says nothing about device faults when there are none", () => {
  assert.equal(queueSplitDescription(37, 21, 0, false), "37 people need a decision · 21 rows");
});

test("one person left does not read as \"1 need a decision\"", () => {
  // The most common end state of a session, in the page's primary header.
  assert.equal(queueSplitDescription(1, 1, 0, false), "1 person needs a decision · 1 row");
});

test("a queue with nothing waiting still reads as a sentence", () => {
  assert.equal(queueSplitDescription(0, 0, 0, false), "Nothing needs a decision");
  assert.equal(
    queueSplitDescription(0, 0, 256, false),
    "Nothing needs a decision · 256 waiting on a device fault",
  );
});

test("four-figure counts are grouped everywhere, not only in the band", () => {
  assert.match(queueSplitDescription(1234, 900, 0, false), /1,234 people need/);
});

// `Decided` is the one control that changes WHO is counted: with it on,
// `queuePeopleCount(queue)` includes people whose flags are already settled, so
// "N people need a decision" states something false about every one of them.
// SHOWING_DECIDED_MESSAGE sits below the header and mitigates that; it does not
// correct the sentence. These four pin the neutral wording that does.
test("with decided rows included the header counts without claiming they need a decision", () => {
  assert.equal(
    queueSplitDescription(134, 92, 256, true),
    "134 people · 92 rows · 256 waiting on a device fault",
  );
  assert.equal(queueSplitDescription(37, 21, 0, true), "37 people · 21 rows");
});

test("the neutral head is singular for one person and one row too", () => {
  assert.equal(queueSplitDescription(1, 1, 0, true), "1 person · 1 row");
});

test("with decided rows included, an empty queue says nothing is showing", () => {
  // NOT "Nothing needs a decision": with the toggle on, a settled person is a
  // row this list would have shown, so the absence is about the list and not
  // about anyone's workload.
  assert.equal(queueSplitDescription(0, 0, 0, true), "Nothing to show");
  assert.equal(
    queueSplitDescription(0, 0, 256, true),
    "Nothing to show · 256 waiting on a device fault",
  );
});

test("thousands are grouped on the neutral head as well", () => {
  assert.match(queueSplitDescription(1234, 900, 0, true), /^1,234 people · 900 rows$/);
});

test("the narrow-range levers name the window they set", () => {
  assert.equal(narrowRangeLabel(7), "Last 7 days");
  assert.equal(narrowRangeLabel(3), "Last 3 days");
  assert.equal(narrowRangeLabel(1), "Last 1 day");
});

// The capped notice as a control, not the old strip's lecture: it states what
// is shown and lets the four-figure count read like `openCountLabel`'s own
// grouping, rather than a bare "5000" that reads as a measured total.
test("the capped headline reads as a floor, grouped the same way as elsewhere", () => {
  assert.equal(cappedHeadline(5000), "Showing the newest 5,000 flags");
  assert.equal(cappedHeadline(42), "Showing the newest 42 flags");
});

test("the capped explainer names no lever the notice does not itself offer", () => {
  assert.equal(
    CAPPED_EXPLAINER,
    "Older days in this range aren't loaded. Narrow the dates to reach them.",
  );
});

test("the empty-queue state names the range it found nothing in", () => {
  assert.equal(NOTHING_WAITING_TITLE, "Nothing waiting");
  assert.equal(
    nothingWaitingDetail("2026-07-21", "2026-08-03"),
    "Every flag between Tue, Jul 21, 2026 and Mon, Aug 3, 2026 has a decision.",
  );
});

test("the decided-count affordance states what pressing it reveals", () => {
  assert.equal(showDecidedLabel(88), "Show the 88 decided");
  assert.equal(showDecidedLabel(1), "Show the 1 decided");
});

test("control labels live here, not inline in the components", () => {
  // Global Constraint 2. These are the ones that leak, because they read as
  // markup rather than as copy.
  assert.equal(TIER_FILTER_ALL_LABEL, "Any consequence");
  assert.equal(DECIDED_TOGGLE_LABEL, "Decided");
  assert.equal(DECIDE_ONE_LABEL, "decide");
  assert.equal(DECIDING_PREFIX, "Deciding");
  assert.equal(DEVICE_HEALTH_LABEL, "Device health");
  assert.equal(QUEUE_LOADING_LABEL, "Loading flags");
});

test("restHeading names the compressed set by its shared finding", () => {
  assert.equal(
    restHeading([missingTime(60), missingTime(90), missingTime(120)]),
    "The other 3 — Missing time",
  );
});

test("restHeading does not say 'The other 1'", () => {
  assert.equal(restHeading([missingTime(60)]), "One more — Missing time");
});

test("restHeading refuses to name one code as all of them", () => {
  // Naming only the first would be a lie about the rest, so a mixed set gets no
  // finding name at all.
  const heading = restHeading([missingTime(60), lateStart(12)]);
  assert.equal(heading, "The other 2 — Mixed findings");
  assert.doesNotMatch(heading, /Missing time|Late start/);
});

test("decidingLabel names the pinned footer's target by finding AND day", () => {
  // Both halves, joined by " · ". The joined form is also what tells the
  // footer apart from the card above it in flagQueuePage.test.tsx — the card
  // renders the same two facts in two separate spans — so the exact string
  // matters, not just its parts.
  assert.equal(decidingLabel(missingTime(240)), "Missing 4h · 3 Aug");
  // A code whose label ignores its evidence still gets its day.
  assert.equal(decidingLabel(lateStart(12)), "Late start · 3 Aug");
});

test("two identical findings on different days do not get the same label", () => {
  // Why the day is in there at all: three "Missing 4h" cards in one entry are
  // three different mornings, and the finding alone would name all three.
  const first = missingTime(240);
  const second = { ...missingTime(240), attendance_date: "2026-08-04" };
  assert.notEqual(decidingLabel(first), decidingLabel(second));
  assert.equal(decidingLabel(second), "Missing 4h · 4 Aug");
});

test("the repeat states the decision it will write, not just its name", () => {
  // Used by both the person banner and the pinned footer button. The footer's
  // is the sharp case: it never scrolls away, so it is permanently one click
  // from a real write on real employee records and has to say which write.
  assert.equal(
    sameReasonWithDecision({ outcome: "EXCUSED", reason: "DEVICE_OR_DATA_FAULT", note: "" }),
    "Same reason applies — Excused, Device or data fault",
  );
  assert.equal(
    sameReasonWithDecision({ outcome: "UPHELD", reason: "OTHER", note: "spoke to them" }),
    "Same reason applies — Upheld, Other",
  );
});

test("every branch-row string is pinned, not just the ones a component happens to use", () => {
  assert.equal(outageBranchDays(10), "10 days with no sync row");
  assert.equal(outageBranchDays(1), "1 day with no sync row");
  assert.equal(outageBranchSummary(99, 990), "99 people · 990 flags");
  assert.equal(OUTAGE_NOT_A_JUDGMENT, "the machines didn't record — nobody is being judged here");
});

test("an empty date span leaves no dangling separator", () => {
  assert.match(outageBandSubline([], 5), /^5 flags · /);
});
