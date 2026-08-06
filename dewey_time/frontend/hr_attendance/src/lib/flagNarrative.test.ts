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
import type { Checkin, Flag, ObservedLunch, ShiftContext } from "@/types/calendar";

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

// Renamed from the brief's `flag()` to `boundaryFlag()` — this file already
// declares a `flag()` helper (line 22) with a different, single-arg signature
// for the earlier no-detector/fallback tests, and a module can't redeclare it.
function boundaryFlag(flagCode: string, evidence: Record<string, unknown>): Flag {
  return {
    name: "AFD-test",
    flag_code: flagCode,
    severity: "WARNING",
    status: "OPEN",
    source: "AUTO",
    day_closed: 1,
    evidence,
  };
}

function checkin(time: string): Checkin {
  return { time };
}

const FULL_SHIFT: ShiftContext = {
  shift_assigned: true,
  start_time: "08:00",
  end_time: "17:00",
  grace_minutes: 10,
  lunch_start: "12:00",
  lunch_end: "13:00",
};

function day(over: Partial<NarrativeDay>): NarrativeDay {
  return { checkins: [], shift: FULL_SHIFT, ...over };
}

test("flagNarrative: LATE_START with grace states the cutoff, not the raw grace_minutes alias", () => {
  const late = boundaryFlag("LATE_START", {
    employee: "HR-EMP-00001",
    date: DATE_KEY,
    first_in: "2026-08-03T08:23:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:10:00",
    effective_start_grace_minutes: 10,
    effective_end_grace_minutes: 0,
    effective_lunch_return_grace_minutes: 10,
    custom_grace_minutes: 10,
    late_entry_grace_period: 0,
    early_exit_grace_period: 0,
    // Deliberately wrong for the generic `grace_minutes` alias. shift_grace.py's
    // grace_evidence() (shift_grace.py:80-95) can leave this holding a different
    // flag's effective grace for the same employee-day (rule 3 —
    // docs/superpowers/specs/2026-08-06-flag-evidence-panel-design.md). If
    // flagNarrative ever reads it directly, this wrong number leaks into the
    // headline instead of the correct effective_start_grace_minutes (10).
    grace_minutes: 999,
  });
  const d = day({
    checkins: [checkin("2026-08-03T08:23:00"), checkin("2026-08-03T12:00:00")],
  });

  const narrative = flagNarrative(late, d, DATE_KEY);

  assert.equal(
    narrative.headline,
    "Clocked in at 8:23 AM — 13 minutes late, even after a 10-minute grace period."
  );
  assert.equal(narrative.subline, null);
  // Exactly three facts — not the thirteen-row evidence dump this replaces — and
  // no separate "grace" row, since the cutoff already has grace baked in (rule 4).
  assert.deepEqual(narrative.facts, [
    { label: "Clocked in", value: "8:23 AM" },
    { label: "Cutoff", value: "8:10 AM" },
    { label: "Past cutoff", value: "13m" },
  ]);
});

test("flagNarrative: LATE_START with zero grace names the shift start instead of a redundant cutoff, and draws no threshold line", () => {
  const late = boundaryFlag("LATE_START", {
    first_in: "2026-08-03T08:15:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:00:00",
    effective_start_grace_minutes: 0,
    grace_minutes: 0,
  });
  const d = day({ checkins: [checkin("2026-08-03T08:15:00")] });

  const narrative = flagNarrative(late, d, DATE_KEY);

  assert.equal(
    narrative.headline,
    "Clocked in at 8:15 AM — 15 minutes after the 8:00 AM shift start."
  );
  // The grace=0 variant swaps "Cutoff" for "Shift start" — the two coincide, so a
  // separate cutoff row would just repeat the shift-start row under a new name.
  assert.deepEqual(narrative.facts, [
    { label: "Clocked in", value: "8:15 AM" },
    { label: "Shift start", value: "8:00 AM" },
    { label: "Late by", value: "15m" },
  ]);
  assert.ok(!narrative.facts.some((f) => f.label === "Cutoff"));

  assert.ok(narrative.timeline);
  assert.equal(narrative.timeline!.threshold, null);
  assert.equal(narrative.timeline!.lunch, null);
  assert.deepEqual(narrative.timeline!.spans, [{ startMin: 480, endMin: 495, tone: "gap" }]);
  assert.deepEqual(narrative.timeline!.marks, [
    { atMin: 495, tone: "alert", label: "Clocked in" },
  ]);
});

test("flagNarrative: LATE_START timeline covers only the start boundary and first segment — shift end never enters the visible window", () => {
  const late = boundaryFlag("LATE_START", {
    first_in: "2026-08-03T08:23:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:10:00",
    effective_start_grace_minutes: 10,
  });
  const d = day({
    checkins: [checkin("2026-08-03T08:23:00"), checkin("2026-08-03T12:00:00")],
  });

  const timeline = flagNarrative(late, d, DATE_KEY).timeline!;

  assert.deepEqual(timeline.window, { startMin: 435, endMin: 765 });
  // `band` still carries the full scheduled shift (rule 10 is enforced by keeping
  // it out of the window, not by hiding the field) — 1020 (5pm) is shift end.
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  assert.equal(timeline.lunch, null);
  assert.equal(timeline.threshold, 490);
  assert.deepEqual(timeline.spans, [
    { startMin: 480, endMin: 503, tone: "gap" },
    { startMin: 503, endMin: 720, tone: "worked" },
  ]);
  assert.deepEqual(timeline.marks, [{ atMin: 503, tone: "alert", label: "Clocked in" }]);
  assert.ok(timeline.window.endMin < timeline.band!.endMin);
});

test("flagNarrative: LEFT_EARLY states the raw shift end and folds grace into the magnitude, not a headline clause", () => {
  const leftEarly = boundaryFlag("LEFT_EARLY", {
    last_out: "2026-08-03T16:37:00",
    shift_end: "2026-08-03T17:00:00",
    early_threshold: "2026-08-03T16:50:00",
    effective_end_grace_minutes: 10,
    grace_minutes: 10,
  });
  const d = day({
    checkins: [checkin("2026-08-03T08:05:00"), checkin("2026-08-03T16:37:00")],
  });

  const narrative = flagNarrative(leftEarly, d, DATE_KEY);

  // Unlike LATE_START, the design gives LEFT_EARLY a single headline shape — the
  // grace figure never appears as a clause here, only folded into "Early by".
  assert.equal(
    narrative.headline,
    "Clocked out at 4:37 PM, 13 minutes before their shift was scheduled to end."
  );
  assert.equal(narrative.subline, null);
  assert.deepEqual(narrative.facts, [
    { label: "Clocked out", value: "4:37 PM" },
    { label: "Shift end", value: "5:00 PM" },
    { label: "Early by", value: "13m" },
  ]);
  assert.ok(!narrative.facts.some((f) => /grace/i.test(f.label)));

  const timeline = narrative.timeline!;
  assert.deepEqual(timeline.window, { startMin: 952, endMin: 1065 });
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  assert.equal(timeline.lunch, null);
  assert.equal(timeline.threshold, 1010);
  assert.deepEqual(timeline.spans, [{ startMin: 997, endMin: 1020, tone: "gap" }]);
  assert.deepEqual(timeline.marks, [{ atMin: 997, tone: "alert", label: "Clocked out" }]);
});

test("flagNarrative: LATE_FROM_LUNCH draws both the scheduled band and the observed overshoot", () => {
  const observedLunch: ObservedLunch = {
    lunch_out: "2026-08-03T12:05:00",
    lunch_in: "2026-08-03T13:23:00",
    minutes: 78,
    lunch_start: "2026-08-03T12:00:00",
    lunch_end: "2026-08-03T13:00:00",
    return_threshold: "2026-08-03T13:10:00",
    late_return: true,
  };
  const lateLunch = boundaryFlag("LATE_FROM_LUNCH", {
    lunch_out: "2026-08-03T12:05:00",
    lunch_in: "2026-08-03T13:23:00",
    lunch_start: "2026-08-03T12:00:00",
    lunch_end: "2026-08-03T13:00:00",
    return_threshold: "2026-08-03T13:10:00",
    grace_minutes: 10,
  });
  const d = day({
    checkins: [
      checkin("2026-08-03T08:00:00"),
      checkin("2026-08-03T12:05:00"),
      checkin("2026-08-03T13:23:00"),
      checkin("2026-08-03T17:00:00"),
    ],
    observedLunch,
  });

  const narrative = flagNarrative(lateLunch, d, DATE_KEY);

  assert.equal(
    narrative.headline,
    "Left for lunch at 12:05 PM, back at 1:23 PM — 13 min past the return deadline."
  );
  assert.deepEqual(narrative.facts, [
    { label: "Actual lunch", value: "12:05 PM – 1:23 PM" },
    { label: "Scheduled", value: "12:00 PM – 1:00 PM" },
    { label: "Deadline", value: "1:10 PM" },
    { label: "Late by", value: "13m" },
  ]);

  const timeline = narrative.timeline!;
  // "Scheduled" (the fact) and `lunch` (the band) both read the raw window — grace
  // only ever shows up baked into `threshold` / "Deadline", never doubled into the
  // band too (rule 4).
  assert.deepEqual(timeline.lunch, { startMin: 720, endMin: 780 });
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  assert.equal(timeline.threshold, 790);
  assert.deepEqual(timeline.spans, [{ startMin: 725, endMin: 803, tone: "gap" }]);
  assert.deepEqual(timeline.marks, [
    { atMin: 725, tone: "normal", label: "Left for lunch" },
    { atMin: 803, tone: "alert", label: "Back" },
  ]);
  assert.deepEqual(timeline.window, { startMin: 675, endMin: 848 });
});
