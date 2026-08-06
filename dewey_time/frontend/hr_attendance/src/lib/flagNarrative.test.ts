import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFacts,
  evidenceMinute,
  evidenceTimeText,
  flagNarrative,
  isEmittedCode,
  EMPTY_EVIDENCE_NOTE,
  MAX_FACTS,
  NO_DETECTOR_CODES,
  type FlagNarrative,
  type NarrativeDay,
} from "@/lib/flagNarrative";
import { FLAG_LABELS } from "@/lib/flagLabels";
import type { Flag } from "@/types/calendar";

const DATE_KEY = "2026-08-06";
const EMPTY_DAY: NarrativeDay = { checkins: [] };

function flag(over: Partial<Flag> & { flag_code: string }): Flag {
  return { name: "AF-0001", source: "AUTO", day_closed: 1, ...over };
}

/**
 * The exact thirteen-row blob from the design doc's opening screenshot. The
 * engine builds ONE mutable evidence dict per employee-day and stamps
 * `shift_start`, all seven grace keys and `late_threshold` onto it
 * (closeout.py:505-516, :606-611), then merges that same dict into every flag
 * it inserts for the day (`_insert_flags`, closeout.py:732). So a
 * `single_checkin` row — which writes only
 * `reason`, `checkins_count`, `punch_time` (record_issue_flags.py:24-34) —
 * arrives at the panel carrying ten keys it never compared against.
 */
const FULL_DAY_EVIDENCE = {
  first_in: "2026-08-06 14:23:00",
  last_out: "2026-08-06 14:23:00",
  shift_start: "2026-08-06 08:00:00",
  late_threshold: "2026-08-06 08:10:00",
  punch_time: "2026-08-06 14:23:00",
  grace_minutes: 10,
  effective_start_grace_minutes: 10,
  effective_end_grace_minutes: 10,
  effective_lunch_return_grace_minutes: 10,
  custom_grace_minutes: 10,
  late_entry_grace_period: 10,
  early_exit_grace_period: 10,
  reason: "single_checkin",
  checkins_count: 1,
};

const EMITTED = [
  "LATE_START",
  "LEFT_EARLY",
  "LATE_FROM_LUNCH",
  "MISSING_TIME",
  "UNNOTIFIED_ABSENCE",
  "OFF_SHIFT_PUNCH",
  "NON_PRIMARY_SITE_PUNCH",
  "ATTENDANCE_ISSUE",
  // Created on the Bridge delivery path, never by this repo, but real enough
  // that closeout queries for it — so it must not be told it has no detector.
  "DELIVERY_FAILED",
];

/** Everything the reader can actually see, minus the timeline (a spec, not copy). */
function renderedText(narrative: FlagNarrative): string {
  return [
    narrative.headline,
    narrative.subline ?? "",
    ...narrative.facts.map((f) => `${f.label} ${f.value}`),
  ].join(" | ");
}

test("flagNarrative returns a usable narrative for every declared code and for an unknown one", () => {
  for (const code of [...Object.keys(FLAG_LABELS), "SOMETHING_NOBODY_DECLARED"]) {
    const narrative = flagNarrative(
      flag({ flag_code: code, evidence: FULL_DAY_EVIDENCE }),
      EMPTY_DAY,
      DATE_KEY,
    );
    assert.ok(narrative.headline.length > 0, `${code} produced an empty headline`);
    assert.ok(Array.isArray(narrative.facts), `${code} produced no fact array`);
    assert.ok(
      narrative.facts.length <= MAX_FACTS,
      `${code} produced ${narrative.facts.length} facts, over the cap of ${MAX_FACTS}`,
    );
  }
});

// The defect this module exists to fix is EXTRA rows, so the load-bearing
// assertions are absences. `single_checkin` is the design doc's own example:
// seven grace rows and two boundary times for a finding that is "one punch,
// then nothing".
test("a single_checkin ATTENDANCE_ISSUE render contains no grace string at all", () => {
  const text = renderedText(
    flagNarrative(
      flag({ flag_code: "ATTENDANCE_ISSUE", evidence: FULL_DAY_EVIDENCE }),
      EMPTY_DAY,
      DATE_KEY,
    ),
  );
  assert.doesNotMatch(text, /grace/i, "a grace row reached the narrative");
  assert.doesNotMatch(text, /10m/, "a grace duration reached the narrative");
  // `late_threshold` is a comparison this flag never made, and `shift_start` is
  // inherited from the shared per-day dict — neither caused this flag.
  assert.doesNotMatch(text, /8:10 AM/, "late_threshold reached the narrative");
  assert.doesNotMatch(text, /8:00 AM/, "shift_start reached the narrative");
});

test("the three no-detector codes get the generic treatment, not a confident finding", () => {
  assert.deepEqual(
    [...NO_DETECTOR_CODES].sort(),
    ["MISSING_IN_OR_OUT", "MISSING_LUNCH", "NO_CHECKIN_YET"],
  );
  for (const code of NO_DETECTOR_CODES) {
    assert.equal(isEmittedCode(code), false, `${code} must not be treated as emitted`);
    const narrative = flagNarrative(flag({ flag_code: code }), EMPTY_DAY, DATE_KEY);
    assert.match(narrative.headline, /isn't a rule this engine currently checks automatically\./);
    assert.equal(narrative.timeline, null, `${code} must not draw a timeline`);
  }
  assert.equal(
    flagNarrative(flag({ flag_code: "MISSING_IN_OR_OUT" }), EMPTY_DAY, DATE_KEY).headline,
    `"Missing in or out" isn't a rule this engine currently checks automatically.`,
  );
});

// Rule 11's specific trap: TIME_EVIDENCE_KEYS / GRACE_EVIDENCE_KEYS
// (flagDetails.ts:65-94) are keyed by string NAME across all codes, so a
// hand-typed key that happens to be called `shift_start` would be formatted as
// a clock time and promoted as the cause of a finding no detector ever made.
test("an unknown code never promotes a key merely because it is named shift_start", () => {
  const narrative = flagNarrative(
    flag({
      flag_code: "SOMETHING_NOBODY_DECLARED",
      evidence: {
        shift_start: "2026-08-06 08:00:00",
        late_threshold: "2026-08-06 08:10:00",
        effective_start_grace_minutes: 15,
        reason: "typed by hand",
      },
    }),
    EMPTY_DAY,
    DATE_KEY,
  );
  const text = renderedText(narrative);
  assert.doesNotMatch(text, /Shift start/i);
  assert.doesNotMatch(text, /Late threshold/i);
  assert.doesNotMatch(text, /8:00 AM/);
  assert.doesNotMatch(text, /8:10 AM/);
  assert.doesNotMatch(text, /grace/i);
  assert.doesNotMatch(text, /15m/);
  // The reason IS promoted — it is the one self-describing field.
  assert.match(text, /typed by hand/);
});

test("the no-detector fallback promotes evidence.reason verbatim and unmapped", () => {
  const narrative = flagNarrative(
    flag({ flag_code: "MISSING_LUNCH", source: "HR", evidence: { reason: "single_checkin" } }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.deepEqual(narrative.facts, [
    { label: "Raised by", value: "HR" },
    { label: "Recorded reason", value: "single_checkin" },
  ]);
  // REASON_LABELS (flagDetails.ts:26-35) would render this as "Single punch
  // only" — a mapped label asserting a finding the engine never made, on a row
  // a human typed.
  assert.doesNotMatch(renderedText(narrative), /Single punch only/);
});

test("empty evidence still names who raised the flag, and says the blob was empty", () => {
  const narrative = flagNarrative(
    flag({ flag_code: "NO_CHECKIN_YET", source: "EMPLOYEE", evidence: null }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.deepEqual(narrative.facts, [{ label: "Raised by", value: "The employee" }]);
  assert.ok(narrative.subline != null, "an empty blob still needs a sub-line");
  assert.ok(
    narrative.subline.includes(EMPTY_EVIDENCE_NOTE),
    "an empty blob must say so rather than render a blank card",
  );
});

test("malformed evidence degrades instead of throwing", () => {
  const narrative = flagNarrative(
    flag({ flag_code: "MISSING_IN_OR_OUT", evidence: "{not json" }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.match(narrative.headline, /isn't a rule this engine currently checks automatically\./);
  assert.ok(narrative.subline != null && narrative.subline.includes(EMPTY_EVIDENCE_NOTE));
});

test("isEmittedCode is true exactly for the codes a detector produces", () => {
  for (const code of EMITTED) {
    assert.equal(isEmittedCode(code), true, `${code} has a detector and must be emitted`);
  }
  // Declared in AUTO_FLAG_CODES but never written as a flag_code by any
  // detector: unknown branches fold into ATTENDANCE_ISSUE reason
  // `unknown_device_branch`. Takes the no-detector path without being named in
  // NO_DETECTOR_CODES.
  for (const code of ["UNKNOWN_DEVICE_BRANCH", "WHATEVER"]) {
    assert.equal(isEmittedCode(code), false, `${code} has no detector and must not be emitted`);
  }
});

// DELIVERY_FAILED is the awkward one and the reason `isEmittedCode` is not
// simply "has a builder". No code in this repo inserts one, so it is tempting to
// group it with the hand-created codes — but closeout.py:386-395 queries for
// existing DELIVERY_FAILED rows with source "AUTO", which only makes sense
// because the Bridge delivery path writes them. Telling HR that a real
// machine-written flag "isn't a rule this engine currently checks
// automatically" would be a false statement about their own data.
test("DELIVERY_FAILED is treated as emitted even though no builder handles it", () => {
  assert.equal(isEmittedCode("DELIVERY_FAILED"), true);
  const narrative = flagNarrative(
    flag({ flag_code: "DELIVERY_FAILED", evidence: { reason: "delivery_failed" } }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.doesNotMatch(narrative.headline, /isn't a rule this engine currently checks automatically/);
  // No builder, so no invented finding: the label, and the blob in the disclosure.
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

test("an emitted code never gets the no-detector copy", () => {
  for (const code of EMITTED) {
    const narrative = flagNarrative(
      flag({ flag_code: code, evidence: FULL_DAY_EVIDENCE }),
      EMPTY_DAY,
      DATE_KEY,
    );
    assert.doesNotMatch(
      narrative.headline,
      /isn't a rule this engine currently checks automatically/,
      `${code} has a detector — telling HR otherwise is false`,
    );
  }
});

// A reason string no builder recognises must still land on a narrative —
// otherwise the panel loses its entire primary zone the first time the engine
// adds a reason.
test("an emitted code with an unrecognised reason falls back without throwing", () => {
  const narrative = flagNarrative(
    flag({ flag_code: "OFF_SHIFT_PUNCH", evidence: { reason: "a_reason_nobody_built_yet" } }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.ok(narrative.headline.length > 0);
  assert.doesNotMatch(narrative.headline, /isn't a rule this engine currently checks automatically/);
});

test("evidenceMinute converts a Frappe timestamp to minutes from local midnight", () => {
  assert.equal(evidenceMinute("2026-08-06 14:23:00"), 14 * 60 + 23);
  assert.equal(evidenceMinute("2026-08-06T08:00:00"), 8 * 60);
});

test("evidenceMinute rejects everything that is not a parsable timestamp", () => {
  // null rather than 0: a missing cutoff must never be drawn at midnight.
  assert.equal(evidenceMinute(null), null);
  assert.equal(evidenceMinute(undefined), null);
  assert.equal(evidenceMinute(""), null);
  assert.equal(evidenceMinute("   "), null);
  assert.equal(evidenceMinute(10), null);
  assert.equal(evidenceMinute("not a date"), null);
  assert.equal(evidenceMinute({ time: "2026-08-06 08:00:00" }), null);
});

test("evidenceTimeText formats through the shared formatter and returns null, never an em dash", () => {
  assert.equal(evidenceTimeText("2026-08-06 14:23:00"), "2:23 PM");
  assert.equal(evidenceTimeText(null), null);
  assert.equal(evidenceTimeText(undefined), null);
  assert.equal(evidenceTimeText("not a date"), null);
  assert.equal(evidenceTimeText(0), null);
  // formatCheckinTime returns "—" for a missing value; a fact whose value is a
  // dash is worse than no fact, so the null has to survive as far as buildFacts.
  assert.notEqual(evidenceTimeText(undefined), "—");
});

test("buildFacts drops the entries that had nothing to say and caps the list at four", () => {
  assert.equal(MAX_FACTS, 4);
  assert.deepEqual(
    buildFacts([
      { label: "Only punch", value: "2:23 PM" },
      null,
      undefined,
      { label: "From", value: "ZK-A4-014" },
    ]),
    [
      { label: "Only punch", value: "2:23 PM" },
      { label: "From", value: "ZK-A4-014" },
    ],
  );
  const many = buildFacts(Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, value: `V${i}` })));
  assert.equal(many.length, MAX_FACTS);
  assert.deepEqual(
    many.map((f) => f.label),
    ["L0", "L1", "L2", "L3"],
  );
});
