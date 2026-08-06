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
