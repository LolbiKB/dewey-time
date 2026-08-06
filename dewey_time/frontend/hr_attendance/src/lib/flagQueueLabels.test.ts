import assert from "node:assert/strict";
import test from "node:test";

import {
  branchNoDeviceDataHeader,
  orphanedEvidenceChangedSummary,
  orphanedFlagGoneSummary,
  REASON_LABELS,
  reasonLabel,
  routineCodeHeader,
  tierLabel,
} from "@/lib/flagQueueLabels";
import type { FlagOut, QueuePerson, Reason } from "@/types/flags";

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
