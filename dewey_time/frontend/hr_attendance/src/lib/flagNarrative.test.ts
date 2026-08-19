import assert from "node:assert/strict";
import test from "node:test";

import { computeDayTimeWindow } from "@/lib/attendancePunches";
import { minutesFromDateTime } from "@/lib/attendanceTime";
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
  const narrative = flagNarrative(
    flag({ flag_code: "ATTENDANCE_ISSUE", evidence: FULL_DAY_EVIDENCE }),
    EMPTY_DAY,
    DATE_KEY,
  );
  // Every assertion below is an absence, so they only mean something once the
  // builder actually promotes facts — while ATTENDANCE_ISSUE returned an empty
  // narrative they could not fail. Pin the presence too.
  assert.ok(narrative.facts.length > 0, "the single_checkin builder promoted no facts at all");
  const text = renderedText(narrative);
  assert.doesNotMatch(text, /grace/i, "a grace row reached the narrative");
  assert.doesNotMatch(text, /10m/, "a grace duration reached the narrative");
  // `late_threshold` is a comparison this flag never made, and `shift_start` is
  // inherited from the shared per-day dict — neither caused this flag.
  assert.doesNotMatch(text, /8:10 AM/, "late_threshold reached the narrative");
  assert.doesNotMatch(text, /8:00 AM/, "shift_start reached the narrative");
});

test("the no-detector codes get the generic treatment, not a confident finding", () => {
  // NO_CHECKIN_YET was the third and has left: intraday raises it now, so the
  // "isn't a rule this engine currently checks" copy would be false about a row
  // the engine had just written.
  assert.deepEqual(
    [...NO_DETECTOR_CODES].sort(),
    ["MISSING_IN_OR_OUT", "MISSING_LUNCH"],
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
    // MISSING_LUNCH rather than NO_CHECKIN_YET: this test needs a code with no
    // detector, and NO_CHECKIN_YET became one the engine writes.
    flag({ flag_code: "MISSING_LUNCH", source: "EMPLOYEE", evidence: null }),
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

test("flagNarrative: a feed-attested single-punch LATE_START says so in the subline — HR must see the no-clock-out basis without opening the raw blob", () => {
  const late = boundaryFlag("LATE_START", {
    first_in: "2026-08-03T09:00:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:00:00",
    effective_start_grace_minutes: 0,
    grace_minutes: 0,
    // The three keys closeout writes when it dared on one punch.
    feed_attested: true,
    single_punch: true,
    arrival_window_end: "2026-08-03T12:30:00",
    attesting_device: "PYA8254100003",
  });
  const d = day({ checkins: [checkin("2026-08-03T09:00:00")] });

  const narrative = flagNarrative(late, d, DATE_KEY);

  // Headline unchanged — the claim is the same claim.
  assert.equal(
    narrative.headline,
    "Clocked in at 9:00 AM — 60 minutes after the 8:00 AM shift start."
  );
  // The subline is the load-bearing part: single check-in, no clock-out, and
  // why the engine dared anyway.
  assert.ok(narrative.subline, "single-punch LATE_START must carry a subline");
  assert.match(narrative.subline!, /single check-in/);
  assert.match(narrative.subline!, /no matching clock-out/);

  // A paired day must NOT inherit the subline: single_punch is the trigger,
  // not the flag code.
  const paired = boundaryFlag("LATE_START", {
    first_in: "2026-08-03T09:00:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:00:00",
    effective_start_grace_minutes: 0,
    grace_minutes: 0,
  });
  assert.equal(flagNarrative(paired, d, DATE_KEY).subline, null);
});

test("flagNarrative: LEFT_EARLY with grace states the cutoff, not the raw shift end, and measures against early_threshold in both the headline and the facts", () => {
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

  // Mirrors buildLateStartNarrative's grace>0 shape: the headline and the
  // "Past cutoff" fact both measure against early_threshold, so the two
  // numbers can never disagree the way "Shift end" + an early_threshold-based
  // magnitude used to.
  assert.equal(
    narrative.headline,
    "Clocked out at 4:37 PM — 13 minutes past the 4:50 PM cutoff, even after a 10-minute grace period."
  );
  assert.equal(narrative.subline, null);
  assert.deepEqual(narrative.facts, [
    { label: "Clocked out", value: "4:37 PM" },
    { label: "Cutoff", value: "4:50 PM" },
    { label: "Past cutoff", value: "13m" },
  ]);
  assert.ok(!narrative.facts.some((f) => f.label === "Shift end"));

  const timeline = narrative.timeline!;
  assert.deepEqual(timeline.window, { startMin: 952, endMin: 1065 });
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  assert.equal(timeline.lunch, null);
  assert.equal(timeline.threshold, 1010);
  assert.deepEqual(timeline.spans, [{ startMin: 997, endMin: 1020, tone: "gap" }]);
  assert.deepEqual(timeline.marks, [{ atMin: 997, tone: "alert", label: "Clocked out" }]);
});

test("flagNarrative: LEFT_EARLY with zero grace names the shift end instead of a redundant cutoff", () => {
  const leftEarly = boundaryFlag("LEFT_EARLY", {
    last_out: "2026-08-03T16:45:00",
    shift_end: "2026-08-03T17:00:00",
    early_threshold: "2026-08-03T17:00:00",
    effective_end_grace_minutes: 0,
    grace_minutes: 0,
  });
  const d = day({
    checkins: [checkin("2026-08-03T08:05:00"), checkin("2026-08-03T16:45:00")],
  });

  const narrative = flagNarrative(leftEarly, d, DATE_KEY);

  assert.equal(
    narrative.headline,
    "Clocked out at 4:45 PM — 15 minutes before the 5:00 PM shift end."
  );
  assert.deepEqual(narrative.facts, [
    { label: "Clocked out", value: "4:45 PM" },
    { label: "Shift end", value: "5:00 PM" },
    { label: "Early by", value: "15m" },
  ]);
  assert.ok(!narrative.facts.some((f) => f.label === "Cutoff"));
});

// Finding 1: a fact built directly from formatCheckinTime(undefined) would
// render {label: "Shift end", value: "—"} — the exact dash row buildFacts/
// fact() exist to suppress. Routing through evidenceTimeText instead means a
// non-essential evidence field missing from an otherwise-complete blob drops
// the row instead of rendering a placeholder dash.
test("flagNarrative: LEFT_EARLY with zero grace and no shift_end in evidence drops the row instead of rendering a dash", () => {
  const leftEarly = boundaryFlag("LEFT_EARLY", {
    last_out: "2026-08-03T16:45:00",
    early_threshold: "2026-08-03T17:00:00",
    effective_end_grace_minutes: 0,
    // shift_end deliberately absent — last_out and early_threshold (the
    // guard's required pair) are still present.
  });
  const d = day({ checkins: [checkin("2026-08-03T16:45:00")] });

  const narrative = flagNarrative(leftEarly, d, DATE_KEY);

  assert.ok(
    !narrative.facts.some((f) => f.value === "—"),
    "a dash reached a fact row instead of being dropped",
  );
  assert.ok(!narrative.facts.some((f) => f.label === "Shift end"));
  assert.deepEqual(
    narrative.facts.map((f) => f.label),
    ["Clocked out", "Early by"],
  );
});

// Finding 5: computeExpectedWindowPct returns null for an overnight shift
// (end < start), so shiftEndMin/thresholdMin fall back to raw minute-of-day
// values that read as "before" a late-evening departure once the shift rolls
// past midnight (06:00 -> 360, below a 23:40 departure at 1420). Left
// unnormalised the gap span is silently dropped and the window spans ~19
// hours instead of the ~90 minutes around the boundary.
test("flagNarrative: LEFT_EARLY normalises an overnight shift's end and threshold past midnight so the gap span survives the rollover", () => {
  const overnightShift: ShiftContext = {
    shift_assigned: true,
    start_time: "22:00",
    end_time: "06:00",
    grace_minutes: 10,
    lunch_start: null,
    lunch_end: null,
  };
  const leftEarly = boundaryFlag("LEFT_EARLY", {
    last_out: "2026-08-03T23:40:00",
    shift_end: "2026-08-04T06:00:00",
    early_threshold: "2026-08-04T05:50:00",
    effective_end_grace_minutes: 10,
  });
  const d = day({
    shift: overnightShift,
    checkins: [checkin("2026-08-03T22:05:00"), checkin("2026-08-03T23:40:00")],
  });

  const timeline = flagNarrative(leftEarly, d, DATE_KEY).timeline!;

  // computeExpectedWindowPct returns null for this shift (end < start), so
  // band stays null — the fix normalises the raw minute-of-day fallbacks
  // instead of relying on a band that cannot exist for an overnight shift.
  assert.equal(timeline.band, null);
  // departureMin (23:40 -> 1420) stays put — it is already on the shift's
  // start-day side of midnight — while shiftEndMin (06:00 next day -> raw 360)
  // and thresholdMin (05:50 next day -> raw 350) roll onto the same frame:
  // 360 + 1440 = 1800, 350 + 1440 = 1790.
  assert.deepEqual(timeline.spans, [{ startMin: 1420, endMin: 1800, tone: "gap" }]);
  assert.deepEqual(timeline.marks, [{ atMin: 1420, tone: "alert", label: "Clocked out" }]);
  assert.equal(timeline.threshold, 1790);
  // Pre-fix this window spanned ~19 hours (305 to the 1440 clamp) because the
  // un-normalised anchors mixed pre- and post-midnight minute-of-day values.
  assert.deepEqual(timeline.window, { startMin: 1375, endMin: 1440 });
});

// buildLateStartTimeline's own overnight counterpart to the LEFT_EARLY test
// above: computeExpectedWindowPct returns null for this shift (end < start),
// so shiftStartMin falls back to evidence.shift_start's raw minute-of-day
// value, and a post-midnight arrival (00:15 -> 15) reads as "before" a
// 22:00 shift start (1320) unless every anchor is rolled onto the same frame.
test("flagNarrative: LATE_START normalises an overnight shift's arrival and threshold past midnight so the gap span survives the rollover", () => {
  const overnightShift: ShiftContext = {
    shift_assigned: true,
    start_time: "22:00",
    end_time: "06:00",
    lunch_start: null,
    lunch_end: null,
  };
  const late = boundaryFlag("LATE_START", {
    first_in: "2026-08-07T00:15:00",
    shift_start: "2026-08-06T22:00:00",
    late_threshold: "2026-08-07T00:10:00",
    effective_start_grace_minutes: 130,
  });
  const d = day({
    shift: overnightShift,
    checkins: [checkin("2026-08-07T00:15:00"), checkin("2026-08-07T01:00:00")],
  });

  const timeline = flagNarrative(late, d, DATE_KEY).timeline!;

  // computeExpectedWindowPct returns null for this shift (end < start), so
  // band stays null — same as the LEFT_EARLY overnight fix above.
  assert.equal(timeline.band, null);
  // arrivalMin (00:15 -> raw 15) and nextMin (01:00 -> raw 60) both roll onto
  // the shift-start frame: 15 + 1440 = 1455, 60 + 1440 = 1500. shiftStartMin
  // (22:00 -> 1320) is already on that frame and is left untouched.
  // late_threshold (00:10 -> raw 10) rolls the same way: 10 + 1440 = 1450.
  assert.deepEqual(timeline.spans, [
    { startMin: 1320, endMin: 1455, tone: "gap" },
    { startMin: 1455, endMin: 1500, tone: "worked" },
  ]);
  assert.deepEqual(timeline.marks, [{ atMin: 1455, tone: "alert", label: "Clocked in" }]);
  assert.equal(timeline.threshold, 1450);
  // Pre-fix, arrivalMin (15) read as "before" shiftStartMin (1320), so the
  // gap span guard (`arrivalMin > shiftStartMin`) silently failed, dropping
  // the whole gap span, and the window ballooned to {startMin: 0, endMin:
  // 1365} — nearly the entire day — instead of the ~90 minutes around the
  // boundary.
  assert.deepEqual(timeline.window, { startMin: 1275, endMin: 1440 });
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
    "Left for lunch at 12:05 PM, back at 1:23 PM — 13 minutes past the return deadline."
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

// buildLateFromLunchTimeline's own overnight counterpart to the LEFT_EARLY
// test above: computeLunchWindowPct has no notion of the overnight shift the
// lunch belongs to, so a lunch scheduled just after midnight (00:00-00:30 for
// a 22:00 shift start) decodes to a raw minute-of-day pair that reads as
// "before" the shift instead of after it, unless every anchor is rolled onto
// the same frame.
test("flagNarrative: LATE_FROM_LUNCH normalises an overnight shift's lunch window past midnight so the gap span survives the rollover", () => {
  const overnightShift: ShiftContext = {
    shift_assigned: true,
    start_time: "22:00",
    end_time: "06:00",
    lunch_start: "00:00",
    lunch_end: "00:30",
  };
  const lateLunch = boundaryFlag("LATE_FROM_LUNCH", {
    lunch_out: "2026-08-07T00:05:00",
    lunch_in: "2026-08-07T00:55:00",
    lunch_start: "2026-08-07T00:00:00",
    lunch_end: "2026-08-07T00:30:00",
    return_threshold: "2026-08-07T00:40:00",
  });
  const d = day({
    shift: overnightShift,
    checkins: [checkin("2026-08-06T22:05:00"), checkin("2026-08-07T00:05:00"), checkin("2026-08-07T00:55:00")],
  });

  const timeline = flagNarrative(lateLunch, d, DATE_KEY).timeline!;

  // computeExpectedWindowPct returns null for this shift (end < start), so
  // band stays null — same as the LEFT_EARLY overnight fix above.
  assert.equal(timeline.band, null);
  // The scheduled lunch window (00:00-00:30 -> raw 0/30) and the actual
  // out/in pair (00:05/00:55 -> raw 5/55) all roll onto the shift-start frame:
  // 0 + 1440 = 1440, 30 + 1440 = 1470, 5 + 1440 = 1445, 55 + 1440 = 1495.
  assert.deepEqual(timeline.lunch, { startMin: 1440, endMin: 1470 });
  assert.deepEqual(timeline.spans, [{ startMin: 1445, endMin: 1495, tone: "gap" }]);
  assert.deepEqual(timeline.marks, [
    { atMin: 1445, tone: "normal", label: "Left for lunch" },
    { atMin: 1495, tone: "alert", label: "Back" },
  ]);
  // return_threshold (00:40 -> raw 40) rolls the same way: 40 + 1440 = 1480.
  assert.equal(timeline.threshold, 1480);
  // Pre-fix, the raw minute-of-day pair (5, 55) read as "before" the shift's
  // 22:00 start and the whole scheduled/actual comparison was on the wrong
  // frame from the raw evidence pair, producing a window nowhere near the
  // real boundary.
  assert.deepEqual(timeline.window, { startMin: 1395, endMin: 1440 });
});

// Finding 2: emittedFallbackNarrative attaches EMPTY_EVIDENCE_NOTE when
// hasEvidence(evidence) is false, but that guard is only reachable through
// flagNarrative()'s existing no-builder path — a boundary builder that pushes
// straight through with an evidence blob missing its essential keys renders a
// confident-looking sentence built entirely from formatCheckinTime/
// formatDurationMinutes's own "—"/"0 minutes" placeholders, with no caveat.
test("flagNarrative: LATE_START with empty evidence falls back with the empty-evidence caveat instead of a confident dash-filled sentence", () => {
  const late = boundaryFlag("LATE_START", {});
  const d = day({ checkins: [checkin("2026-08-03T08:23:00")] });

  const narrative = flagNarrative(late, d, DATE_KEY);

  assert.equal(narrative.headline, "Late start");
  assert.doesNotMatch(narrative.headline, /—/, "the empty blob must not reach the confident sentence");
  assert.ok(narrative.subline != null && narrative.subline.includes(EMPTY_EVIDENCE_NOTE));
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

// Finding 4: every other timeline test's day.checkins are byte-identical to
// the evidence timestamps, so a regression that swaps sorted[0].time for
// evidence.first_in would leave those tests green. Give evidence and the
// punch list different times and assert the timeline follows the punches.
test("flagNarrative: LATE_START timeline follows the day's punch list, not the frozen evidence.first_in", () => {
  const late = boundaryFlag("LATE_START", {
    // Evidence says one thing (frozen at closeout)...
    first_in: "2026-08-03T09:00:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:10:00",
    effective_start_grace_minutes: 10,
  });
  const d = day({
    // ...but the live punch list disagrees (a later correction/backfill).
    checkins: [checkin("2026-08-03T08:23:00"), checkin("2026-08-03T12:00:00")],
  });

  const timeline = flagNarrative(late, d, DATE_KEY).timeline!;

  // arrivalMin must come from day.checkins[0] (8:23 AM -> 503), not
  // evidence.first_in (9:00 AM -> 540).
  assert.deepEqual(timeline.marks, [{ atMin: 503, tone: "alert", label: "Clocked in" }]);
  assert.deepEqual(timeline.spans, [
    { startMin: 480, endMin: 503, tone: "gap" },
    { startMin: 503, endMin: 720, tone: "worked" },
  ]);
});

test("flagNarrative: LATE_FROM_LUNCH timeline follows day.observedLunch, not the frozen evidence lunch pair", () => {
  const observedLunch: ObservedLunch = {
    // Observed (re-run against the live punch list) disagrees with evidence below.
    lunch_out: "2026-08-03T12:10:00",
    lunch_in: "2026-08-03T13:30:00",
    minutes: 80,
    lunch_start: "2026-08-03T12:00:00",
    lunch_end: "2026-08-03T13:00:00",
    return_threshold: "2026-08-03T13:10:00",
    late_return: true,
  };
  const lateLunch = boundaryFlag("LATE_FROM_LUNCH", {
    // Evidence frozen at closeout time — deliberately different from observedLunch.
    lunch_out: "2026-08-03T12:05:00",
    lunch_in: "2026-08-03T13:23:00",
    lunch_start: "2026-08-03T12:00:00",
    lunch_end: "2026-08-03T13:00:00",
    return_threshold: "2026-08-03T13:10:00",
  });
  const d = day({
    checkins: [
      checkin("2026-08-03T08:00:00"),
      checkin("2026-08-03T12:10:00"),
      checkin("2026-08-03T13:30:00"),
      checkin("2026-08-03T17:00:00"),
    ],
    observedLunch,
  });

  const timeline = flagNarrative(lateLunch, d, DATE_KEY).timeline!;

  // outMin/inMin must come from day.observedLunch (12:10 PM -> 730, 1:30 PM ->
  // 810), not evidence.lunch_out/lunch_in (12:05 PM -> 725, 1:23 PM -> 803).
  assert.deepEqual(timeline.spans, [{ startMin: 730, endMin: 810, tone: "gap" }]);
  assert.deepEqual(timeline.marks, [
    { atMin: 730, tone: "normal", label: "Left for lunch" },
    { atMin: 810, tone: "alert", label: "Back" },
  ]);
});

test("MISSING_TIME states the gap's relationship to lunch, not just its duration", () => {
  // absence_flags.py:34-67 (evaluate_missing_time_flags) — evidence is
  // exactly interval_start/interval_end/minutes/kind/threshold_minutes.
  const flag: Flag = {
    name: "AUTO-mt-1",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T10:00:00",
      interval_end: "2026-08-06T10:45:00",
      minutes: 45,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 08:00:00" }, { time: "2026-08-06 17:00:00" }],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: "12:00",
      lunch_end: "12:30",
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Gone from 10:00 AM to 10:45 AM — 45m unaccounted, and it wasn't lunch."
  );
  assert.deepEqual(narrative.facts, [
    { label: "Gap", value: "45m" },
    { label: "Left", value: "10:00 AM" },
    { label: "Back", value: "10:45 AM" },
    { label: "Lunch window", value: "12:00 PM – 12:30 PM" },
  ]);
  // Rule 10's corollary: draw only the boundary the flag is about. This
  // flag's boundary is the lunch comparison, not shift start/end, so the
  // shift band must stay off the timeline entirely (band: null) — asserted
  // by absence, since the defect this task fixes is extra rows/marks, not
  // just wrong ones.
  assert.deepEqual(narrative.timeline, {
    window: { startMin: 450, endMin: 1050 },
    band: null,
    lunch: { startMin: 720, endMin: 750 },
    threshold: null,
    spans: [{ startMin: 600, endMin: 645, tone: "gap" }],
    marks: [],
  });
});

test("MISSING_TIME flips the relationship when the gap overlaps the scheduled lunch window", () => {
  const flag: Flag = {
    name: "AUTO-mt-2",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T12:00:00",
      interval_end: "2026-08-06T13:15:00",
      minutes: 75,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 08:00:00" }, { time: "2026-08-06 17:00:00" }],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: "12:00",
      lunch_end: "12:30",
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Gone from 12:00 PM to 1:15 PM — 1h 15m unaccounted, overlapping the scheduled lunch window."
  );
  assert.equal(narrative.facts.find((f) => f.label === "Gap")?.value, "1h 15m");
  assert.deepEqual(narrative.timeline?.lunch, { startMin: 720, endMin: 750 });
});

test("MISSING_TIME names the lunch it excluded, so the gap reconciles with its own endpoints", () => {
  // The bridged row from _bridge_scheduled_lunch: one interval spanning a day
  // nobody punched for, carrying the SUM of its two halves rather than its
  // span, because the unpaid hour between them is not owed time. 17:00 − 08:05
  // is 8h 55m; the flag says 7h 55m. Without naming the excluded hour the row
  // reads as an arithmetic bug — which is precisely the mitigation the spec's
  // Risks table promised and the implementation had not yet delivered.
  const flag: Flag = {
    name: "AUTO-mt-bridged",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T08:05:00",
      interval_end: "2026-08-06T17:00:00",
      minutes: 475,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: "12:00",
      lunch_end: "13:00",
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Gone from 8:05 AM to 5:00 PM — 7h 55m unaccounted, excluding the 1h scheduled lunch."
  );
  assert.equal(narrative.facts.find((f) => f.label === "Gap")?.value, "7h 55m");
  assert.equal(narrative.facts.find((f) => f.label === "Lunch excluded")?.value, "1h");
});

test("MISSING_TIME leaves out the exclusion line when the gap spans exactly what it claims", () => {
  // The unbridged overlapping row: minutes already equals end − start, so a
  // "Lunch excluded" fact would assert a subtraction that never happened.
  const flag: Flag = {
    name: "AUTO-mt-unbridged",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T12:00:00",
      interval_end: "2026-08-06T13:15:00",
      minutes: 75,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 08:00:00" }],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: "12:00",
      lunch_end: "12:30",
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.match(narrative.headline, /overlapping the scheduled lunch window/);
  assert.equal(
    narrative.facts.find((f) => f.label === "Lunch excluded"),
    undefined
  );
});

test("MISSING_TIME degrades to 'wasn't lunch' when the day has no scheduled lunch window", () => {
  const flag: Flag = {
    name: "AUTO-mt-3",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T10:00:00",
      interval_end: "2026-08-06T10:30:00",
      minutes: 30,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 08:00:00" }, { time: "2026-08-06 17:00:00" }],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: null,
      lunch_end: null,
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.match(narrative.headline, /and it wasn't lunch\.$/);
  assert.deepEqual(narrative.facts.find((f) => f.label === "Lunch window"), {
    label: "Lunch window",
    value: "No scheduled lunch",
  });
  assert.equal(narrative.timeline?.lunch, null);
});

test("UNNOTIFIED_ABSENCE (device closeout) takes its shift label from the live calendar, not evidence.shift_type", () => {
  // closeout.py:505-516 + :588-590 — the device-closeout producer's evidence
  // carries shift_type, employee_branch and device_sn (frozen at emission
  // time), merged with {reason: "on_shift_no_checkins"}.
  const flag: Flag = {
    name: "AUTO-ua-1",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00001",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins",
      shift_type: "Night Shift", // frozen at emission — deliberately NOT "Morning"
      employee_branch: "BRANCH-1",
      checkins_count: 0,
      first_in: null,
      last_out: null,
      device_sn: "ZK-EAST-01",
      holiday: null,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: true, shift_type: "Morning", start_time: "09:00", end_time: "17:00" },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  // If this read evidence.shift_type it would say "Night Shift" — reading
  // "Morning" instead proves the headline is sourced from the live
  // calendar (rule 10), which is the only source the company-fallback
  // producer below can supply at all.
  assert.equal(
    narrative.headline,
    "Scheduled for the Morning shift, but never checked in — zero punches all day."
  );
  assert.deepEqual(narrative.facts, [
    { label: "Shift", value: "Morning" },
    { label: "Punches", value: "0" },
    { label: "Caught by", value: "Confirmed at end-of-day device closeout" },
  ]);
  // device_sn is buried provenance here, not a fact (rule 8 — no device
  // serial in user-facing copy outside delivery_failed's "Reported by").
  assert.ok(!narrative.facts.some((f) => f.value.includes("ZK-EAST-01")));
  assert.ok(!narrative.headline.includes("ZK-EAST-01"));
  assert.deepEqual(narrative.timeline, {
    window: { startMin: 510, endMin: 1050 },
    band: { startMin: 540, endMin: 1020 },
    lunch: null,
    threshold: null,
    spans: [{ startMin: 540, endMin: 1020, tone: "gap" }],
    marks: [],
  });
});

test("UNNOTIFIED_ABSENCE (company fallback) resolves the same way even though its evidence carries no shift_type at all", () => {
  // closeout.py:301-313 — the ~3am company-fallback producer's evidence is
  // exactly {employee, date, on_shift, reason, checkins_count}. No
  // shift_type, no employee_branch, no device_sn, no first_in/last_out/holiday.
  const flag: Flag = {
    name: "AUTO-ua-2",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00002",
      date: "2026-08-06",
      on_shift: true,
      reason: "company_fallback_no_checkins",
      checkins_count: 0,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: true, shift_type: "Evening", start_time: "14:00", end_time: "22:00" },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Scheduled for the Evening shift, but never checked in — zero punches all day."
  );
  assert.equal(
    narrative.facts.find((f) => f.label === "Caught by")?.value,
    "Confirmed by the overnight company-wide check"
  );
  // Headline voice rule 3: HR should never read the engine's internal name
  // for this producer.
  assert.ok(!narrative.headline.toLowerCase().includes("fallback"));
  assert.ok(!narrative.facts.some((f) => f.value.toLowerCase().includes("fallback")));
});

test("UNNOTIFIED_ABSENCE degrades to the generic headline and drops its timeline when the calendar can't resolve a shift", () => {
  const flag: Flag = {
    name: "AUTO-ua-3",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00003",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins",
      shift_type: "Morning", // present on evidence — must still be ignored
      checkins_count: 0,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: false }, // assignment was edited away after the flag was raised
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Scheduled to work, but never checked in — zero punches all day."
  );
  assert.equal(
    narrative.facts.find((f) => f.label === "Shift")?.value,
    "Not resolved on this calendar"
  );
  // Rule 9's second clause: no trustworthy timestamp for the thing being
  // flagged (no shift band to size the hatched absence against) — the
  // timeline does not earn its place rather than fabricating a full-day axis.
  assert.equal(narrative.timeline, null);
});

test("UNNOTIFIED_ABSENCE falls back to a start–end time range in the Shift fact when the calendar has a shift but no named shift_type", () => {
  const flag: Flag = {
    name: "AUTO-ua-4",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00004",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins",
      checkins_count: 0,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: true, start_time: "09:00", end_time: "13:00" }, // no shift_type
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  // The headline stays generic — "Scheduled for the 9:00 AM – 1:00 PM
  // shift" reads like a typo, not a schedule. The extra detail belongs in
  // the more-verbose facts row instead.
  assert.equal(
    narrative.headline,
    "Scheduled to work, but never checked in — zero punches all day."
  );
  assert.equal(
    narrative.facts.find((f) => f.label === "Shift")?.value,
    "9:00 AM – 1:00 PM"
  );
  assert.deepEqual(narrative.timeline?.band, { startMin: 540, endMin: 780 });
});

// --- Task 3 review follow-ups --------------------------------------------

test("flagNarrative: MISSING_TIME with empty evidence falls back with the empty-evidence caveat instead of a confident dash-filled sentence", () => {
  const mt = boundaryFlag("MISSING_TIME", {});
  const d = day({ checkins: [] });

  const narrative = flagNarrative(mt, d, DATE_KEY);

  assert.equal(narrative.headline, "Missing time");
  assert.doesNotMatch(narrative.headline, /—/, "the empty blob must not reach the confident sentence");
  assert.ok(narrative.subline != null && narrative.subline.includes(EMPTY_EVIDENCE_NOTE));
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

test("flagNarrative: UNNOTIFIED_ABSENCE with empty evidence falls back instead of fabricating Punches/Caught-by off nothing", () => {
  const ua = boundaryFlag("UNNOTIFIED_ABSENCE", {});
  const d = day({ checkins: [] });

  const narrative = flagNarrative(ua, d, DATE_KEY);

  assert.equal(narrative.headline, "Did not show up");
  assert.ok(narrative.subline != null && narrative.subline.includes(EMPTY_EVIDENCE_NOTE));
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

test("flagNarrative: MISSING_TIME normalises an overnight shift's gap across midnight instead of inverting it to zero", () => {
  // absence_intervals.py:318-319 rolls shift_end_min +1440 for an overnight
  // shift before absence_flags.py:51-60 converts the interval back to
  // datetimes, so interval_end legitimately lands on the calendar day AFTER
  // interval_start.
  const overnightShift: ShiftContext = {
    shift_assigned: true,
    start_time: "22:00",
    end_time: "06:00",
    lunch_start: null,
    lunch_end: null,
  };
  const flag: Flag = {
    name: "AUTO-mt-overnight",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T23:30:00",
      interval_end: "2026-08-07T00:15:00",
      minutes: 45,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 22:05:00" }, { time: "2026-08-07 05:55:00" }],
    shift: overnightShift,
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Gone from 11:30 PM to 12:15 AM — 45m unaccounted, and it wasn't lunch."
  );
  assert.equal(narrative.facts.find((f) => f.label === "Gap")?.value, "45m");
  // Pre-fix, a raw minute-of-day reading of interval_end (00:15 -> 15) sat
  // below interval_start (23:30 -> 1410), so Math.max(0, ...) collapsed the
  // gap span to 0 instead of the real 45-minute span.
  assert.deepEqual(narrative.timeline?.spans, [{ startMin: 1410, endMin: 1455, tone: "gap" }]);
});

test("flagNarrative: UNNOTIFIED_ABSENCE keeps its band and Shift fact for an overnight shift instead of losing the timeline at the midnight rollover", () => {
  const flag: Flag = {
    name: "AUTO-ua-overnight",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00005",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins",
      checkins_count: 0,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: true, start_time: "22:00", end_time: "06:00" }, // no shift_type, overnight
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  // Pre-fix, unnotifiedAbsenceBand rejected `endMin <= startMin` outright for
  // any overnight shift, so this absence lost BOTH its timeline (band: null)
  // and its Shift fact fell through to the wrong "Not resolved on this
  // calendar" even though the calendar plainly has a shift.
  assert.equal(
    narrative.facts.find((f) => f.label === "Shift")?.value,
    "10:00 PM – 6:00 AM"
  );
  assert.deepEqual(narrative.timeline?.band, { startMin: 1320, endMin: 1800 });
  assert.deepEqual(narrative.timeline?.spans, [{ startMin: 1320, endMin: 1800, tone: "gap" }]);
});

test("flagNarrative: UNNOTIFIED_ABSENCE's Punches fact reads evidence.checkins_count, not day.checkins.length — the zero IS the finding", () => {
  const flag: Flag = {
    name: "AUTO-ua-punches-pin",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00006",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins",
      checkins_count: 0,
    },
  };
  const day: NarrativeDay = {
    // A later correction/backfill added punches to the live calendar after
    // the flag was raised — if this fact ever switches to day.checkins.length
    // it would print "Punches: 2" on a flag whose headline says nobody came
    // in, so pin it to the frozen evidence value instead.
    checkins: [{ time: "2026-08-06 09:05:00" }, { time: "2026-08-06 17:10:00" }],
    shift: { shift_assigned: true, shift_type: "Morning", start_time: "09:00", end_time: "17:00" },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(narrative.facts.find((f) => f.label === "Punches")?.value, "0");
});

test("flagNarrative: MISSING_TIME's Lunch window fact comes from day.shift, not decoy lunch keys on the evidence blob", () => {
  // absence_flags.py never writes a lunch pair onto MISSING_TIME's evidence
  // dict (it is exactly interval_start/interval_end/minutes/kind/
  // threshold_minutes) — these decoy keys are deliberately WRONG relative to
  // day.shift below, to prove the panel never reads them.
  const flag: Flag = {
    name: "AUTO-mt-decoy",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T10:00:00",
      interval_end: "2026-08-06T10:45:00",
      minutes: 45,
      kind: "away",
      threshold_minutes: 30,
      lunch_start: "09:30",
      lunch_end: "11:00",
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 08:00:00" }, { time: "2026-08-06 17:00:00" }],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: "12:00",
      lunch_end: "12:30",
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  // If this read evidence.lunch_start/lunch_end it would say "9:30 AM –
  // 11:00 AM" and the gap (10:00-10:45) would overlap that decoy window,
  // flipping the headline's relationship clause.
  assert.equal(
    narrative.facts.find((f) => f.label === "Lunch window")?.value,
    "12:00 PM – 12:30 PM"
  );
  assert.match(narrative.headline, /and it wasn't lunch\.$/);
});

// --- Task 4: OFF_SHIFT_PUNCH ----------------------------------------------
// Evidence shape mirrors the shared per-employee-day dict (closeout.py:505-516)
// merged with the holiday branch's extra_evidence (closeout.py:524): every key
// below except `reason` and `holiday` is either constraint-6 noise (employee,
// date, on_shift, shift_type) or constraint-8 provenance (device_sn) that must
// never surface in the narrative, on either scenario in this file.
const holidayEvidence = {
  employee: "HR-EMP-00007",
  date: "2026-08-06",
  on_shift: false,
  shift_type: null,
  employee_branch: "Riverside",
  checkins_count: 2,
  first_in: "2026-08-06T10:15:00",
  last_out: "2026-08-06T14:40:00",
  device_sn: "ZK-A4-014",
  holiday: { description: "Founders' Day", weekly_off: false },
  reason: "holiday_has_checkins",
};

const holidayFlag: Flag = {
  name: "AF-HOLIDAY-1",
  flag_code: "OFF_SHIFT_PUNCH",
  day_closed: 1,
  evidence: holidayEvidence,
};

const holidayCheckins: Checkin[] = [
  { time: "2026-08-06 10:15:00", custom_device_branch: "Riverside" },
  { time: "2026-08-06 14:40:00", custom_device_branch: "Riverside" },
];

const holidayDay: NarrativeDay = { checkins: holidayCheckins };

test("OFF_SHIFT_PUNCH (holiday_has_checkins) promotes the holiday name to a fact instead of losing it to the disclosure", () => {
  const narrative = flagNarrative(holidayFlag, holidayDay, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Punched 2 times on Founders' Day, a public holiday — nobody was scheduled."
  );
  assert.equal(narrative.subline, null);

  // This is the fix for the design doc's counter-example: formatEvidenceValue
  // (flagDetails.ts:187-219) returns null for the holiday object so it never
  // reached a row, while employee_branch got a first-class one. Assert both
  // halves of the inversion are gone: the holiday IS a fact, employee_branch
  // is NOT.
  assert.deepEqual(narrative.facts, [
    { label: "Day", value: "Founders' Day" },
    { label: "Punch times", value: "10:15 AM, 2:40 PM" },
  ]);
  assert.ok(!narrative.facts.some((f) => f.label === "Employee branch"));
  assert.ok(narrative.facts.length <= 4);

  // Constraint 8: no device serial anywhere in user-facing copy, even though
  // evidence.device_sn is present on this flag.
  assert.ok(!narrative.headline.includes("ZK-A4-014"));
  assert.ok(!narrative.facts.some((f) => f.value.includes("ZK-A4-014")));

  // No shift exists for either OFF_SHIFT_PUNCH reason, so there is no shift
  // band to draw — but the axis must still auto-scale to the punches
  // (design rule 6), never a blank 24-hour axis.
  assert.ok(narrative.timeline);
  const expectedWindow = computeDayTimeWindow(holidayCheckins, minutesFromDateTime)!;
  assert.deepEqual(narrative.timeline!.window, {
    startMin: expectedWindow.startMin,
    endMin: expectedWindow.endMin,
  });
  assert.equal(narrative.timeline!.band, null);
  assert.equal(narrative.timeline!.lunch, null);
  assert.equal(narrative.timeline!.threshold, null);
  assert.deepEqual(narrative.timeline!.spans, []);
  assert.deepEqual(narrative.timeline!.marks, [
    { atMin: minutesFromDateTime("2026-08-06 10:15:00"), tone: "alert" },
    { atMin: minutesFromDateTime("2026-08-06 14:40:00"), tone: "alert" },
  ]);
});

// Same shared dict shape, holiday is null (closeout.py:559's branch is only
// reached once the holiday branch at :520 has already returned).
const noShiftEvidence = {
  employee: "HR-EMP-00009",
  date: "2026-08-06",
  on_shift: false,
  shift_type: null,
  employee_branch: null,
  checkins_count: 1,
  first_in: "2026-08-06T09:05:00",
  last_out: "2026-08-06T09:05:00",
  device_sn: "ZK-B1-002",
  holiday: null,
  reason: "off_shift_has_checkins",
};

const noShiftFlag: Flag = {
  name: "AF-NOSHIFT-1",
  flag_code: "OFF_SHIFT_PUNCH",
  day_closed: 1,
  evidence: noShiftEvidence,
};

const noShiftCheckins: Checkin[] = [
  { time: "2026-08-06 09:05:00", custom_device_branch: null },
];

const noShiftDay: NarrativeDay = { checkins: noShiftCheckins };

test("OFF_SHIFT_PUNCH (off_shift_has_checkins) gets its own headline, no Day fact, and no grace anywhere", () => {
  const narrative = flagNarrative(noShiftFlag, noShiftDay, "2026-08-06");

  // Different reason, different story — a day with literally no shift
  // assigned is not the same finding as a public holiday, so this must not
  // reuse the holiday headline template.
  assert.equal(
    narrative.headline,
    "Punched 1 time — no shift was scheduled for this employee that day."
  );
  assert.equal(narrative.subline, null);
  assert.deepEqual(narrative.facts, [{ label: "Punch times", value: "9:05 AM" }]);
  assert.ok(!narrative.facts.some((f) => f.label === "Day"));

  // Neither OFF_SHIFT_PUNCH reason writes a grace-bearing extra_evidence key
  // (closeout.py:524 and :559 both write only `reason`), so nothing here
  // should ever mention grace — the defect this whole plan exists to remove.
  assert.ok(!narrative.headline.toLowerCase().includes("grace"));
  assert.ok(!narrative.facts.some((f) => f.value.toLowerCase().includes("grace")));

  assert.ok(narrative.timeline);
  const expectedWindow = computeDayTimeWindow(noShiftCheckins, minutesFromDateTime)!;
  assert.deepEqual(narrative.timeline!.window, {
    startMin: expectedWindow.startMin,
    endMin: expectedWindow.endMin,
  });
  assert.equal(narrative.timeline!.band, null);
  assert.deepEqual(narrative.timeline!.marks, [
    { atMin: minutesFromDateTime("2026-08-06 09:05:00"), tone: "alert" },
  ]);
});

// Conventions rule 2: an evidence blob missing the one key this builder
// cannot work without (checkins_count — the number the whole sentence is
// built around) must fall back honestly, even when the live calendar has
// real punches sitting right there. Without this guard, `n` would silently
// read `checkins.length` instead of the frozen finding.
test("OFF_SHIFT_PUNCH falls back with the empty-evidence caveat when checkins_count is absent, even though the live calendar has real punches", () => {
  const flag: Flag = {
    name: "AF-OFFSHIFT-EMPTY",
    flag_code: "OFF_SHIFT_PUNCH",
    day_closed: 1,
    evidence: {},
  };
  const dayWithPunches: NarrativeDay = {
    checkins: [{ time: "2026-08-06 09:00:00" }],
  };

  const narrative = flagNarrative(flag, dayWithPunches, DATE_KEY);

  assert.equal(narrative.headline, "Punched on day off");
  assert.doesNotMatch(
    narrative.headline,
    /—/,
    "the empty blob must not reach the confident sentence"
  );
  assert.ok(narrative.subline != null && narrative.subline.includes(EMPTY_EVIDENCE_NOTE));
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

// Conventions rule 4: the headline's punch count is pinned to the frozen
// evidence.checkins_count (mirroring UNNOTIFIED_ABSENCE's "Punches" fact —
// the count IS the finding), while "Punch times" and the timeline follow the
// live day.checkins. Evidence's own first_in/last_out are decoys this
// builder must never read at all. Give every one of these three sources a
// different value so a regression toward any of the wrong ones can fail.
test("OFF_SHIFT_PUNCH pins its headline count to evidence.checkins_count while Punch times and the timeline follow the live day.checkins, never evidence.first_in/last_out", () => {
  const flag: Flag = {
    name: "AF-OFFSHIFT-DECOY",
    flag_code: "OFF_SHIFT_PUNCH",
    day_closed: 1,
    evidence: {
      reason: "off_shift_has_checkins",
      checkins_count: 1, // frozen at emission — deliberately stale
      first_in: "2026-08-06T05:00:00", // decoy: never read by this builder
      last_out: "2026-08-06T23:59:00", // decoy: never read by this builder
    },
  };
  const dayLater: NarrativeDay = {
    // A later correction/backfill added a second punch after the flag fired.
    checkins: [{ time: "2026-08-06 09:05:00" }, { time: "2026-08-06 09:40:00" }],
  };

  const narrative = flagNarrative(flag, dayLater, DATE_KEY);

  assert.equal(
    narrative.headline,
    "Punched 1 time — no shift was scheduled for this employee that day."
  );
  assert.deepEqual(narrative.facts, [{ label: "Punch times", value: "9:05 AM, 9:40 AM" }]);
  assert.ok(narrative.timeline);
  assert.deepEqual(narrative.timeline!.marks, [
    { atMin: minutesFromDateTime("2026-08-06 09:05:00"), tone: "alert" },
    { atMin: minutesFromDateTime("2026-08-06 09:40:00"), tone: "alert" },
  ]);
});

// --- Task 4: NON_PRIMARY_SITE_PUNCH ---------------------------------------
// Evidence shape mirrors _non_primary_site_punch_flag (closeout.py:413-436),
// merged into either producer's shared dict — closeout.py:732 (inside
// `_insert_flags`) or intraday.py:137-141 — both of which carry checkins_count. Only the
// closeout path also carries device_sn (closeout.py:514); this fixture
// includes it to prove it is read nowhere near this flag.
const nonPrimaryEvidence = {
  employee: "HR-EMP-00003",
  date: "2026-08-06",
  on_shift: true,
  shift_type: "Day Shift",
  employee_branch: "Riverside",
  checkins_count: 5,
  first_in: "2026-08-06T08:02:00",
  last_out: "2026-08-06T16:58:00",
  device_sn: "ZK-A4-014",
  non_primary_checkins: 3,
};

const nonPrimaryFlag: Flag = {
  name: "AF-NONPRIMARY-1",
  flag_code: "NON_PRIMARY_SITE_PUNCH",
  day_closed: 1,
  evidence: nonPrimaryEvidence,
};

const nonPrimaryCheckins: Checkin[] = [
  { time: "2026-08-06 08:02:00", custom_device_branch: "Riverside" },
  { time: "2026-08-06 10:30:00", custom_device_branch: "Elm Street" },
  { time: "2026-08-06 12:00:00", custom_device_branch: "Elm Street" },
  { time: "2026-08-06 13:15:00", custom_device_branch: "Elm Street" },
  { time: "2026-08-06 16:58:00", custom_device_branch: "Riverside" },
];

const nonPrimaryDay: NarrativeDay = { checkins: nonPrimaryCheckins };

test("NON_PRIMARY_SITE_PUNCH states WHERE, drops the timeline entirely, and never names a device", () => {
  const narrative = flagNarrative(nonPrimaryFlag, nonPrimaryDay, "2026-08-06");

  assert.equal(
    narrative.headline,
    "3 of 5 punches today were at a site other than Riverside, this employee's home branch."
  );
  assert.equal(narrative.subline, null);
  assert.deepEqual(narrative.facts, [
    { label: "Home branch", value: "Riverside" },
    { label: "Punches elsewhere", value: "3 of 5" },
  ]);
  assert.ok(narrative.facts.length <= 4);

  // This is the first flag in the plan where the timeline is honestly
  // dropped (design rule 5 / row "NON_PRIMARY_SITE_PUNCH ... No"). The
  // finding is WHICH branch, not WHEN — a timeline would render five
  // evenly-spaced marks and say nothing a clock face can answer.
  assert.equal(narrative.timeline, null);

  // Constraint 8: evidence.device_sn is present on this fixture (inherited
  // from the shared closeout evidence dict) but must never be named — there
  // is no device↔branch registry to resolve it against the punch that was
  // actually off-site.
  assert.ok(!narrative.headline.includes("ZK-A4-014"));
  assert.ok(!narrative.facts.some((f) => f.value.includes("ZK-A4-014")));
  assert.ok(!/device/i.test(narrative.headline));
  assert.ok(!narrative.facts.some((f) => /device/i.test(f.label)));
});

// Conventions rule 2: an empty blob must fall back honestly rather than
// rendering a fabricated "0 of 0" sentence.
test("NON_PRIMARY_SITE_PUNCH falls back with the empty-evidence caveat when its counts are absent", () => {
  const flag: Flag = {
    name: "AF-NONPRIMARY-EMPTY",
    flag_code: "NON_PRIMARY_SITE_PUNCH",
    day_closed: 1,
    evidence: {},
  };

  const narrative = flagNarrative(flag, EMPTY_DAY, DATE_KEY);

  assert.equal(narrative.headline, "Other site");
  assert.doesNotMatch(
    narrative.headline,
    /—/,
    "the empty blob must not reach the confident sentence"
  );
  assert.ok(narrative.subline != null && narrative.subline.includes(EMPTY_EVIDENCE_NOTE));
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

// The guard must require BOTH counts, not just one — a lone checkins_count
// with non_primary_checkins missing would otherwise fabricate "0 of 5"
// instead of admitting there is no finding to state.
test("NON_PRIMARY_SITE_PUNCH falls back when only one of its two counts is present", () => {
  const flag: Flag = {
    name: "AF-NONPRIMARY-PARTIAL",
    flag_code: "NON_PRIMARY_SITE_PUNCH",
    day_closed: 1,
    evidence: { employee_branch: "Riverside", checkins_count: 5 },
  };

  const narrative = flagNarrative(flag, EMPTY_DAY, DATE_KEY);

  // The blob isn't empty (employee_branch/checkins_count are present), so
  // this takes the boundary fallback's "no caveat needed" branch rather than
  // the EMPTY_EVIDENCE_NOTE one — but it must still land on the generic
  // label rather than fabricating a "0 of 5" sentence off a missing count.
  assert.equal(narrative.headline, "Other site");
  assert.equal(narrative.subline, null);
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

// --- Task 5: ATTENDANCE_ISSUE + the no-detector fallback -------------------

const RECORD_ISSUE_SHIFT: ShiftContext = {
  shift_assigned: true,
  shift_type: "Day Shift",
  start_time: "08:00:00",
  end_time: "17:00:00",
  grace_minutes: 10,
  lunch_start: "12:00:00",
  lunch_end: "12:30:00",
};

/**
 * The thirteen-row blob from the spec's opening screenshot, verbatim: every key
 * `_generate_for_employee_date` stamps onto the shared evidence dict
 * (closeout.py:505-516, :606-611, :662-663) and then merges into EVERY flag it
 * inserts for that employee-day. A record-issue flag never asked for any of it.
 */
const SHARED_CLOSEOUT_EVIDENCE = {
  employee: "HR-EMP-00001",
  date: "2026-08-03",
  on_shift: true,
  shift_type: "Day Shift",
  employee_branch: "BRANCH-Downtown",
  checkins_count: 1,
  first_in: "2026-08-03T14:23:00",
  last_out: "2026-08-03T14:23:00",
  device_sn: "ZK-A4-014",
  holiday: null,
  shift_start: "2026-08-03T08:00:00",
  late_threshold: "2026-08-03T08:10:00",
  shift_end: "2026-08-03T17:00:00",
  early_threshold: "2026-08-03T16:50:00",
  grace_minutes: 10,
  effective_start_grace_minutes: 10,
  effective_end_grace_minutes: 10,
  effective_lunch_return_grace_minutes: 10,
  custom_grace_minutes: 10,
  late_entry_grace_period: 10,
  early_exit_grace_period: 10,
};

function recordIssueFlag(over: Partial<Flag> & { evidence: unknown }): Flag {
  return {
    name: "AF-record-issue-1",
    flag_code: "ATTENDANCE_ISSUE",
    severity: "WARNING",
    status: "OPEN",
    source: "AUTO",
    day_closed: 1,
    ...over,
  } as Flag;
}

function punch(time: string, branch: string | null = "BRANCH-Downtown"): Checkin {
  return { name: `EC-${time}`, time: `2026-08-03 ${time}:00`, custom_device_branch: branch };
}

function recordIssueDay(over: Partial<NarrativeDay> = {}): NarrativeDay {
  return { checkins: [], shift: RECORD_ISSUE_SHIFT, holiday: null, observedLunch: null, ...over };
}

/**
 * Everything a human actually reads, and nothing else. Asserting on
 * JSON.stringify(narrative) would be useless here: FlagTimelineSpec has a key
 * literally named `threshold`, so /threshold/ matches the serialised shape of a
 * narrative that shows no threshold at all.
 */
function visibleCopy(narrative: FlagNarrative): string {
  return [
    narrative.headline,
    narrative.subline ?? "",
    ...narrative.facts.flatMap((fact) => [fact.label, fact.value]),
    ...(narrative.timeline?.marks ?? []).map((mark) => mark.label ?? ""),
  ].join(" | ");
}

const SINGLE_CHECKIN = recordIssueFlag({
  evidence: {
    ...SHARED_CLOSEOUT_EVIDENCE,
    reason: "single_checkin",
    checkins_count: 1,
    punch_time: "2026-08-03T14:23:00",
  },
});

test("single_checkin headline states the finding, not the fields", () => {
  const narrative = flagNarrative(
    SINGLE_CHECKIN,
    recordIssueDay({ checkins: [punch("14:23")] }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Punched once at 2:23 PM, then never again that day.");
});

// THE regression test for this whole redesign. The live panel renders thirteen
// rows for this exact flag; seven are grace values that have nothing to do with
// whether there was one punch or two. One fact, and no grace string anywhere.
test("single_checkin renders exactly one fact and no grace, threshold or shift-start copy", () => {
  const narrative = flagNarrative(
    SINGLE_CHECKIN,
    recordIssueDay({ checkins: [punch("14:23")] }),
    "2026-08-03",
  );

  assert.deepEqual(narrative.facts, [{ label: "Only punch", value: "2:23 PM" }]);

  const copy = visibleCopy(narrative);
  assert.doesNotMatch(copy, /grace/i);
  assert.doesNotMatch(copy, /10m/);
  assert.doesNotMatch(copy, /threshold/i);
  assert.doesNotMatch(copy, /8:00 AM/);
  assert.doesNotMatch(copy, /8:10 AM/);
  assert.doesNotMatch(copy, /4:50 PM/);
  // "First check-in 2:23 PM / Last check-out 2:23 PM / Punch time 2:23 PM" is one
  // timestamp under three labels; only one of them survives, and it is not these.
  assert.doesNotMatch(copy, /First check-in/i);
  assert.doesNotMatch(copy, /Last check-out/i);
  assert.doesNotMatch(copy, /Punch time/i);
  assert.doesNotMatch(copy, /Shift start/i);
});

test("single_checkin draws a lone alert mark in an otherwise empty shift band", () => {
  const narrative = flagNarrative(
    SINGLE_CHECKIN,
    recordIssueDay({ checkins: [punch("14:23")] }),
    "2026-08-03",
  );

  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(timeline.window, { startMin: 480, endMin: 1020 });
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  // Only the boundary the flag is about: no lunch band, no late threshold.
  assert.equal(timeline.lunch, null);
  assert.equal(timeline.threshold, null);
  // "Otherwise empty" is the point — one punch pairs with nothing.
  assert.deepEqual(timeline.spans, []);
  assert.equal(timeline.marks.length, 1);
  assert.equal(timeline.marks[0].atMin, 863);
  assert.equal(timeline.marks[0].tone, "alert");
});

// Conventions rule 4: the shift band must come from the live calendar, so the
// fixture's shift (9-3) is deliberately NOT the evidence's frozen
// shift_start/shift_end (8-5). A builder that read the blob would draw 480-1020.
test("single_checkin's band follows the live calendar's shift, not evidence.shift_start/shift_end", () => {
  const narrative = flagNarrative(
    SINGLE_CHECKIN,
    recordIssueDay({
      checkins: [punch("14:23")],
      shift: { ...RECORD_ISSUE_SHIFT, start_time: "09:00:00", end_time: "15:00:00" },
    }),
    "2026-08-03",
  );

  assert.deepEqual(narrative.timeline?.band, { startMin: 540, endMin: 900 });
  assert.deepEqual(narrative.timeline?.window, { startMin: 540, endMin: 900 });
});

// The mirror image of the band test above, and the one place in this scenario
// where the frozen blob wins: the punch being marked is the punch the flag was
// raised about. Same pin as UNNOTIFIED_ABSENCE's "Punches: 0" fact (:1122) — if
// the mark were re-derived from a calendar that has since been corrected, the
// tick would contradict the headline sitting directly above it.
test("single_checkin marks the punch the flag was raised about, not a later correction", () => {
  const narrative = flagNarrative(
    SINGLE_CHECKIN,
    // The live calendar's one punch has since been corrected to 3:10 PM.
    recordIssueDay({ checkins: [punch("15:10")] }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Punched once at 2:23 PM, then never again that day.");
  assert.deepEqual(
    narrative.timeline?.marks.map((mark) => [mark.atMin, mark.label]),
    [[863, "2:23 PM"]],
  );
});

// Conventions rule 2: without punch_time there is no finding to state — the
// whole sentence is built around that one timestamp, and formatCheckinTime
// would render it as "Punched once at —".
test("single_checkin falls back with the empty-evidence caveat when punch_time is absent", () => {
  const narrative = flagNarrative(
    recordIssueFlag({ evidence: {} }),
    recordIssueDay({ checkins: [punch("14:23")] }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Attendance record issue");
  assert.doesNotMatch(narrative.headline, /—/);
  assert.ok(narrative.subline != null && narrative.subline.includes(EMPTY_EVIDENCE_NOTE));
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

test("single_checkin with a reason but no punch_time falls back without inventing a time", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: { ...SHARED_CLOSEOUT_EVIDENCE, reason: "single_checkin", punch_time: null },
    }),
    recordIssueDay({ checkins: [punch("14:23")] }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Attendance record issue · Single punch only");
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
  assert.doesNotMatch(visibleCopy(narrative), /—/);
});

// Conventions rule 3: a punch after midnight on an overnight shift decodes to a
// small minute-of-day (01:30 -> 90) that sorts BELOW the 22:00 shift start, so
// an un-normalised mark lands hours before the band and the window balloons to
// most of the day instead of hugging the shift.
test("single_checkin rolls an after-midnight punch onto the overnight shift's frame", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: {
        reason: "single_checkin",
        checkins_count: 1,
        punch_time: "2026-08-04T01:30:00",
      },
    }),
    recordIssueDay({
      checkins: [{ time: "2026-08-04 01:30:00", custom_device_branch: "BRANCH-Downtown" }],
      shift: { shift_assigned: true, start_time: "22:00:00", end_time: "06:00:00" },
    }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Punched once at 1:30 AM, then never again that day.");
  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(timeline.band, { startMin: 1320, endMin: 1800 });
  // 90 + 1440 — on the same frame as the band, not 90 minutes past midnight.
  assert.deepEqual(
    timeline.marks.map((mark) => [mark.atMin, mark.tone]),
    [[1530, "alert"]],
  );
  assert.deepEqual(timeline.window, { startMin: 1320, endMin: 1800 });
});

// A rogue punch: no device branch, so it is its own run and pairs with nothing,
// sitting between two healthy paired spans.
const ROGUE_DAY_CHECKINS = [
  punch("08:00"),
  punch("12:00"),
  punch("13:07", null),
  punch("13:30"),
  punch("17:00"),
];

const UNPAIRED_ROGUE = recordIssueFlag({
  evidence: {
    ...SHARED_CLOSEOUT_EVIDENCE,
    checkins_count: 5,
    reason: "unpaired_punch",
    punch_time: "2026-08-03T13:07:00",
    custom_device_branch: null,
  },
});

test("unpaired_punch headline names the punch and says the rest of the day paired up", () => {
  const narrative = flagNarrative(
    UNPAIRED_ROGUE,
    recordIssueDay({ checkins: ROGUE_DAY_CHECKINS }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "Punched at 1:07 PM, but it never got matched to a clock-out — the day's other punches paired up fine.",
  );
});

test("unpaired_punch omits the From fact when the odd punch carried no device branch", () => {
  const narrative = flagNarrative(
    UNPAIRED_ROGUE,
    recordIssueDay({ checkins: ROGUE_DAY_CHECKINS }),
    "2026-08-03",
  );

  assert.deepEqual(narrative.facts, [{ label: "Odd punch", value: "1:07 PM" }]);
  assert.doesNotMatch(visibleCopy(narrative), /\bFrom\b/);
});

// The spans can only come from the day's checkin list — evidence carries a
// single punch_time and a first_in/last_out pair (2:23 PM) that matches none of
// these punches, so a builder reading the blob could not produce them.
test("unpaired_punch marks the rogue tick between the day's two healthy spans", () => {
  const narrative = flagNarrative(
    UNPAIRED_ROGUE,
    recordIssueDay({ checkins: ROGUE_DAY_CHECKINS }),
    "2026-08-03",
  );

  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(timeline.window, { startMin: 450, endMin: 1050 });
  assert.deepEqual(timeline.spans, [
    { startMin: 480, endMin: 720, tone: "worked" },
    { startMin: 810, endMin: 1020, tone: "worked" },
  ]);
  assert.deepEqual(
    timeline.marks.map((mark) => [mark.atMin, mark.tone]),
    [[787, "alert"]],
  );
});

test("unpaired_punch promotes the punch's device branch as From", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: {
        ...SHARED_CLOSEOUT_EVIDENCE,
        checkins_count: 3,
        reason: "unpaired_punch",
        punch_time: "2026-08-03T17:00:00",
        custom_device_branch: "BRANCH-Downtown",
      },
    }),
    recordIssueDay({ checkins: [punch("08:00"), punch("12:00"), punch("17:00")] }),
    "2026-08-03",
  );

  assert.deepEqual(narrative.facts, [
    { label: "Odd punch", value: "5:00 PM" },
    { label: "From", value: "Downtown" },
  ]);
  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(
    timeline.marks.map((mark) => [mark.atMin, mark.tone]),
    [[1020, "alert"]],
  );
});

test("unpaired_punch falls back with the empty-evidence caveat when punch_time is absent", () => {
  const narrative = flagNarrative(
    recordIssueFlag({ evidence: { reason: "unpaired_punch" } }),
    recordIssueDay({ checkins: ROGUE_DAY_CHECKINS }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Attendance record issue · Unpaired punch");
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
  assert.doesNotMatch(visibleCopy(narrative), /—/);
});

const UNKNOWN_BRANCH_CHECKINS = [
  punch("08:00"),
  punch("12:03", null),
  punch("12:35", null),
  punch("17:00"),
];

const UNKNOWN_BRANCH = recordIssueFlag({
  evidence: {
    ...SHARED_CLOSEOUT_EVIDENCE,
    checkins_count: 4,
    reason: "unknown_device_branch",
    unknown_branch_checkins: 2,
  },
});

test("unknown_device_branch counts the punches and says whose problem it is", () => {
  const narrative = flagNarrative(
    UNKNOWN_BRANCH,
    recordIssueDay({ checkins: UNKNOWN_BRANCH_CHECKINS }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "2 punches today came from a device that didn't report which site it's at.",
  );
  assert.equal(
    narrative.subline,
    "This is a device or config problem, not necessarily an employee problem.",
  );
  assert.deepEqual(narrative.facts, [{ label: "Unlabelled punches", value: "2 punches" }]);
});

// Evidence carries only a count, so WHICH punches were unlabelled can come from
// exactly one place: the day's checkin list. (The blob's own first_in/last_out
// both say 2:23 PM — 863 — which appears in none of these marks.)
test("unknown_device_branch marks the unlabelled punches from the day's checkin list", () => {
  const narrative = flagNarrative(
    UNKNOWN_BRANCH,
    recordIssueDay({ checkins: UNKNOWN_BRANCH_CHECKINS }),
    "2026-08-03",
  );

  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(timeline.window, { startMin: 450, endMin: 1050 });
  assert.deepEqual(timeline.spans, []);
  assert.deepEqual(
    timeline.marks.map((mark) => [mark.atMin, mark.tone]),
    [
      [480, "normal"],
      [723, "alert"],
      [755, "alert"],
      [1020, "normal"],
    ],
  );
});

test("unknown_device_branch says '1 punch' for a single unlabelled punch", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: {
        ...SHARED_CLOSEOUT_EVIDENCE,
        checkins_count: 2,
        reason: "unknown_device_branch",
        unknown_branch_checkins: 1,
      },
    }),
    recordIssueDay({ checkins: [punch("08:00"), punch("17:00", null)] }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "1 punch today came from a device that didn't report which site it's at.",
  );
  assert.deepEqual(narrative.facts, [{ label: "Unlabelled punches", value: "1 punch" }]);
});

// Conventions rule 2: the count IS the finding here, and the live checkin list
// cannot stand in for it — those punches are the day's, not the unlabelled ones.
test("unknown_device_branch falls back when the blob carries no count, even with punches on the calendar", () => {
  const narrative = flagNarrative(
    recordIssueFlag({ evidence: { reason: "unknown_device_branch" } }),
    recordIssueDay({ checkins: UNKNOWN_BRANCH_CHECKINS }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Attendance record issue · Unknown device location");
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

const DELIVERY_FAILED = recordIssueFlag({
  evidence: {
    ...SHARED_CLOSEOUT_EVIDENCE,
    checkins_count: 0,
    reason: "delivery_failed",
    undelivered: { pin: "42", frappe_employee_id: "HR-EMP-00001" },
  },
});

test("delivery_failed promotes the device serial and badge, and draws no timeline", () => {
  const narrative = flagNarrative(DELIVERY_FAILED, recordIssueDay(), "2026-08-03");

  assert.equal(
    narrative.headline,
    "Device ZK-A4-014 recorded a punch that never reached HR's records.",
  );
  assert.deepEqual(narrative.facts, [
    { label: "Reported by", value: "ZK-A4-014" },
    { label: "Badge", value: "42" },
  ]);
  // There is no trustworthy timestamp for this punch — that IS the finding.
  assert.equal(narrative.timeline, null);
});

// The most important copy in the redesign: this is a data-integrity flag that
// currently wears the same clothes as a behaviour flag.
test("delivery_failed says a lost record is not the employee's fault", () => {
  const narrative = flagNarrative(DELIVERY_FAILED, recordIssueDay(), "2026-08-03");

  assert.equal(
    narrative.subline,
    "A lost record, not a missed check-in — nothing to hold against the employee.",
  );
});

test("delivery_failed degrades when the producer passed no device serial", () => {
  // The company-fallback producer never has a device_sn (it is a keyword arg that
  // defaults to None), so the headline must not read "Device null ...".
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: {
        ...SHARED_CLOSEOUT_EVIDENCE,
        device_sn: null,
        reason: "delivery_failed",
        undelivered: { pin: "42" },
      },
    }),
    recordIssueDay(),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "A punch was recorded on a device but never reached HR's records.",
  );
  assert.deepEqual(narrative.facts, [{ label: "Badge", value: "42" }]);
});

// attendance_flag.py:90-103 and flag_identity.py:113-128 both read the nested
// `undelivered` dict FIRST and then the same keys flat on evidence, so rows
// written either way must resolve here too.
test("delivery_failed reads the badge flat off evidence when there is no undelivered object", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: { reason: "delivery_failed", device_sn: "ZK-A4-014", user_id: 42 },
    }),
    recordIssueDay(),
    "2026-08-03",
  );

  assert.deepEqual(narrative.facts, [
    { label: "Reported by", value: "ZK-A4-014" },
    { label: "Badge", value: "42" },
  ]);
});

test("an ATTENDANCE_ISSUE with an unrecognised reason echoes it verbatim and draws nothing", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: { ...SHARED_CLOSEOUT_EVIDENCE, reason: "missing_lunch_pair" },
    }),
    recordIssueDay({ checkins: [punch("08:00"), punch("17:00")] }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "This day's punch data could not be reconciled into complete in/out pairs.",
  );
  assert.deepEqual(narrative.facts, [{ label: "Recorded reason", value: "missing_lunch_pair" }]);
  assert.equal(narrative.timeline, null);
  assert.doesNotMatch(visibleCopy(narrative), /grace/i);
});

// Conventions rule 2 for the dispatcher itself: with no reason at all there is
// no scenario to narrate, so the honest generic treatment wins over the
// unrecognised-reason sentence, which would assert a reconciliation failure
// nothing recorded.
test("an ATTENDANCE_ISSUE with no reason at all takes the empty-evidence fallback", () => {
  const narrative = flagNarrative(
    recordIssueFlag({ evidence: { employee: "HR-EMP-00001", date: "2026-08-03" } }),
    recordIssueDay({ checkins: [punch("08:00"), punch("17:00")] }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Attendance record issue");
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

test("a no-detector code renders the generic treatment and never promotes shift_start", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      name: "AF-manual-1",
      flag_code: "MISSING_IN_OR_OUT",
      source: "HR",
      // A hand-created row whose evidence happens to use the name `shift_start`.
      // Running an unknown code's keys through the shared TIME_EVIDENCE_KEYS map
      // would silently format and promote it as a cause of the flag.
      evidence: { shift_start: "2026-08-03T08:00:00", reason: "spot_check" },
    }),
    recordIssueDay({ checkins: [punch("08:04")] }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    '"Missing in or out" isn\'t a rule this engine currently checks automatically.',
  );
  assert.deepEqual(narrative.facts, [
    // The plan's Task 5 block spells this "HR, by hand", but Task 1 shipped
    // FLAG_SOURCE_LABELS with "HR" and pinned it in a test above (:167) for the
    // same input. Two contradictory plan texts for one string; the conventions
    // rule ("match what is already there") settles it in favour of the shipped
    // copy rather than re-litigating a prior task's reviewed assertion.
    { label: "Raised by", value: "HR" },
    { label: "Recorded reason", value: "spot_check" },
  ]);
  assert.equal(narrative.timeline, null);

  const copy = visibleCopy(narrative);
  assert.doesNotMatch(copy, /Shift start/i);
  assert.doesNotMatch(copy, /8:00 AM/);
});

test("an entirely unrecognised flag code falls back to formatFlagLabel's own label", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      name: "AF-manual-2",
      flag_code: "SOME_MANUAL_CODE",
      source: undefined,
      evidence: {},
    }),
    recordIssueDay(),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    '"some manual code" isn\'t a rule this engine currently checks automatically.',
  );
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

test("UNNOTIFIED_ABSENCE raised intraday does not tell HR a running day is confirmed", () => {
  // intraday.py raises this while the day is still going, in place of the
  // MISSING_TIME rows it suppresses. Every other reason in
  // UNNOTIFIED_ABSENCE_CAUGHT_BY is a confirmation, and so is the fallback, so
  // an unmapped reason renders "Confirmed automatically" — on a day that is
  // not over and a row that is withdrawn the moment the person badges in.
  const flag: Flag = {
    name: "AUTO-ua-3",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00003",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins_intraday",
      checkins_count: 0,
      provisional: true,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: true, shift_type: "Evening", start_time: "14:00", end_time: "22:00" },
  };

  const caughtBy = flagNarrative(flag, day, "2026-08-06").facts.find(
    (f) => f.label === "Caught by",
  )?.value;

  assert.equal(caughtBy, "No punches yet today — not yet confirmed");
  assert.ok(
    !/confirmed at|confirmed by|confirmed automatically/i.test(caughtBy ?? ""),
    `a provisional row must not read as settled: ${caughtBy}`,
  );
});

// --- NO_CHECKIN_YET --------------------------------------------------------
//
// The intraday tense of UNNOTIFIED_ABSENCE, sharing its builder. These pin the
// one thing that must differ.

const NO_CHECKIN_YET_FLAG: Flag = {
  name: "AUTO-ncy-1",
  flag_code: "NO_CHECKIN_YET",
  evidence: {
    employee: "HR-EMP-00003",
    date: "2026-08-06",
    on_shift: true,
    reason: "on_shift_no_checkins_intraday",
    checkins_count: 0,
    provisional: true,
    minutes: 31,
  },
};

const NO_CHECKIN_YET_DAY: NarrativeDay = {
  checkins: [],
  shift: { shift_assigned: true, shift_type: "Morning", start_time: "08:00", end_time: "17:00" },
};

test("NO_CHECKIN_YET never claims a running day had zero punches ALL day", () => {
  // THE REASON THIS CODE EXISTS. The shared builder's headline is written for a
  // finished day — "never checked in — zero punches all day" — and intraday
  // raises this row about half an hour after shift start. At 08:31 that
  // sentence is a claim HR can disprove by looking out of the window, and the
  // person it describes may be in the car park.
  const narrative = flagNarrative(NO_CHECKIN_YET_FLAG, NO_CHECKIN_YET_DAY, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Scheduled for the Morning shift, and no check-in has been recorded yet.",
  );
  assert.doesNotMatch(narrative.headline, /all day/);
  assert.doesNotMatch(narrative.headline, /never checked in/);
});

test("NO_CHECKIN_YET is treated as emitted, not as a rule the engine skips", () => {
  // It sat in NO_DETECTOR_CODES for as long as nothing wrote it. Leaving it
  // there would have HR reading "isn't a rule this engine currently checks
  // automatically" underneath a row the engine had just raised.
  assert.equal(isEmittedCode("NO_CHECKIN_YET"), true);
  const narrative = flagNarrative(NO_CHECKIN_YET_FLAG, NO_CHECKIN_YET_DAY, "2026-08-06");
  assert.doesNotMatch(narrative.headline, /isn't a rule this engine/);
});

test("NO_CHECKIN_YET keeps the absence panel's facts and its empty timeline", () => {
  // It shares narrateUnnotifiedAbsence deliberately: the situation, the
  // evidence and the drawing are identical. Only the tense differs. If routing
  // ever drops back to the generic fallback, HR loses the zero-punch fact and
  // the hatched shift band with it.
  const narrative = flagNarrative(NO_CHECKIN_YET_FLAG, NO_CHECKIN_YET_DAY, "2026-08-06");

  assert.equal(narrative.facts.find((f) => f.label === "Punches")?.value, "0");
  assert.equal(
    narrative.facts.find((f) => f.label === "Caught by")?.value,
    "No punches yet today — not yet confirmed",
  );
  assert.ok(narrative.timeline, "the hatched shift band must still be drawn");
});

test("a shiftless day still gets the running-tense headline", () => {
  // The builder has two headline shapes per tense; the no-shift one is reached
  // when the calendar cannot resolve a shift name.
  const narrative = flagNarrative(
    NO_CHECKIN_YET_FLAG,
    { checkins: [], shift: { shift_assigned: true } },
    "2026-08-06",
  );
  assert.equal(narrative.headline, "Scheduled to work, and no check-in has been recorded yet.");
});
