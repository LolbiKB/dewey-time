/**
 * Turns one Attendance Flag into the four things the panel shows in its PRIMARY
 * position — a verdict headline, a sub-line, at most four causing facts, and a
 * timeline spec.
 *
 * This replaces `formatFlagEvidenceDetails` (flagDetails.ts:221) as the panel's
 * headline content only. That function is untouched and still renders the
 * complete blob inside the collapsed disclosure, so nothing becomes
 * unreachable — it just stops being the first thing HR reads.
 *
 * Pure: no React, no fetching, no `new Date()`. Same discipline as
 * flagDecisionState.ts.
 *
 * Two hard rules live at this seam rather than inside any one builder:
 *
 *  - **A code with no detector never reaches a per-scenario builder.** Nothing
 *    writes MISSING_IN_OR_OUT, NO_CHECKIN_YET, MISSING_LUNCH or
 *    UNKNOWN_DEVICE_BRANCH as a flag_code, so a row carrying one of those was
 *    created by hand and its keys mean whatever the person meant. Running
 *    them through the shared TIME_EVIDENCE_KEYS / GRACE_EVIDENCE_KEYS maps
 *    (flagDetails.ts:65-94) would be wrong in a specific, silent way: those maps
 *    are keyed by string NAME across all codes, so a manual entry that happens
 *    to use the name `shift_start` would be formatted as a clock time and
 *    promoted as the cause of a finding no rule ever made.
 *    `noDetectorNarrative` therefore reads exactly two things — `flag.source`
 *    off the record, and `evidence.reason` verbatim.
 *
 *  - **Grace is never its own fact.** `_generate_for_employee_date` builds ONE
 *    mutable evidence dict per employee-day, stamps `shift_start`, all seven
 *    `grace_evidence()` keys and `late_threshold` onto it
 *    (closeout.py:505-516, :606-611), and merges that same dict into every flag
 *    it inserts for the day (:531). Every flag therefore inherits comparisons it
 *    never made. Builders state the CUTOFF time — which already has grace baked
 *    in — and mention the grace figure in the headline sentence only when it is
 *    non-zero.
 *
 * Never read `grace_minutes`: it is an alias whose meaning depends on which
 * flag's `extra_evidence` wrote it last (start grace for LATE_START, end grace
 * for LEFT_EARLY at closeout.py:669, lunch-return grace at lunch_flags.py:60).
 * Read the explicit `effective_*` key for the code instead.
 */
import {
  clamp,
  formatCheckinTime,
  formatDurationMinutes,
  minutesFromDateTime,
  parseDateTimeLocal,
} from "@/lib/attendanceTime";
import { sortCheckinsByTime } from "@/lib/attendancePunches";
import { formatFlagLabel, parseFlagEvidence, type FlagEvidence } from "@/lib/flagLabels";
import { computeExpectedWindowPct, computeLunchWindowPct } from "@/lib/shiftTimeline";
import { observedLunchMinuteRange } from "@/lib/lunchDetection";
import type {
  Checkin,
  Flag,
  HolidayContext,
  ObservedLunch,
  ShiftContext,
} from "@/types/calendar";

export type FlagFact = { label: string; value: string };

/** Minutes from local midnight. */
export type Minute = number;

export type TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" };
export type TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string };

export type FlagTimelineSpec = {
  /** Axis bounds. Always present when a spec exists. */
  window: { startMin: Minute; endMin: Minute };
  /** The scheduled shift band, or null when no shift was assigned. */
  band: { startMin: Minute; endMin: Minute } | null;
  /** The scheduled lunch window, drawn only where the flag is about lunch. */
  lunch: { startMin: Minute; endMin: Minute } | null;
  /** A cutoff line — late threshold, return deadline. */
  threshold: Minute | null;
  spans: TimelineSpan[];
  marks: TimelineMark[];
};

export type FlagNarrative = {
  headline: string;
  subline: string | null;
  facts: FlagFact[];
  /** null when a timeline does not earn its place for this scenario. */
  timeline: FlagTimelineSpec | null;
};

export type NarrativeDay = {
  /** The day's checkins, for timelines. Never read evidence for these. */
  checkins: Checkin[];
  shift?: ShiftContext | null;
  holiday?: HolidayContext | null;
  observedLunch?: ObservedLunch | null;
};

/** The parsed evidence blob. Untyped on purpose — the engine's keys vary by code. */
export type NarrativeEvidence = Record<string, unknown>;

export type NarrativeInput = {
  flag: Flag;
  evidence: NarrativeEvidence;
  /** `evidence.reason`, trimmed; null when absent or not a string. */
  reason: string | null;
  day: NarrativeDay;
  dateKey: string;
};

/** At most four causing facts — the design's cap, enforced by `buildFacts`. */
export const MAX_FACTS = 4;

/** Explicit copy for a truly empty blob; an empty card reads as broken. */
export const EMPTY_EVIDENCE_NOTE = "No evidence was recorded on this flag.";

const NO_DETECTOR_SUBLINE = "Nothing here has been machine-verified.";

/**
 * The codes a detector actually produces. Kept as the POSITIVE list because it
 * is both shorter and safer: a code someone adds to `AUTO_FLAG_CODES` without
 * writing a detector defaults to the honest generic treatment instead of
 * inheriting a confident sentence about a comparison nothing performed.
 */
const EMITTED_CODES: ReadonlySet<string> = new Set([
  "LATE_START",
  "LEFT_EARLY",
  "LATE_FROM_LUNCH",
  "MISSING_TIME",
  "UNNOTIFIED_ABSENCE",
  "OFF_SHIFT_PUNCH",
  "NON_PRIMARY_SITE_PUNCH",
  "ATTENDANCE_ISSUE",
  // Real, and deliberately without a builder of its own. Nothing in this repo
  // INSERTS a DELIVERY_FAILED flag — it is created on the Bridge delivery path
  // — but closeout.py:386-395 queries for existing ones and
  // attendance_flag.py:40 has a validate branch for them, so HR can genuinely
  // be looking at one. It is a real detected condition, so it must NOT get the
  // "isn't a rule this engine currently checks automatically" copy. With no arm
  // in the switch it lands on `default:` → `emittedFallbackNarrative`: the
  // formatted label, no invented finding, full evidence in the disclosure.
  // (Distinct from ATTENDANCE_ISSUE reason `delivery_failed`, which Task 5
  // narrates properly — that is the path the engine itself writes.)
  "DELIVERY_FAILED",
]);

/**
 * The three codes the spec's treatment table names under "no detector".
 *
 * This is a NAMED SUBSET for the copy and the tests, not the gate —
 * `isEmittedCode` is the gate. UNKNOWN_DEVICE_BRANCH is declared in
 * `AUTO_FLAG_CODES` but no detector ever writes it as a flag_code (unknown
 * branches fold into ATTENDANCE_ISSUE reason `unknown_device_branch`), so it
 * takes the no-detector path without being listed here.
 */
export const NO_DETECTOR_CODES: readonly string[] = [
  "MISSING_IN_OR_OUT",
  "NO_CHECKIN_YET",
  "MISSING_LUNCH",
];

export function isEmittedCode(flagCode: string): boolean {
  return EMITTED_CODES.has(flagCode);
}

/**
 * The flag's evidence as a plain object, never throwing. `parseFlagEvidence`
 * already try/catches a malformed JSON string (flagLabels.ts:43); an array or a
 * scalar becomes `{}` so callers can always spread and index it.
 */
export function readEvidence(flag: Flag): NarrativeEvidence {
  const parsed = parseFlagEvidence(flag.evidence);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as NarrativeEvidence;
}

/** True when the blob carried at least one value worth showing. */
export function hasEvidence(evidence: NarrativeEvidence): boolean {
  return Object.values(evidence).some((value) => value != null && value !== "");
}

export function evidenceReason(evidence: NarrativeEvidence): string | null {
  const reason = evidence.reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed ? trimmed : null;
}

/**
 * Minutes from local midnight for an evidence timestamp — Frappe's
 * "2026-08-06 14:23:00" or an ISO string.
 *
 * Anything that is not a parsable timestamp (a grace count, an object, a blank)
 * returns null rather than 0, so a cutoff that was never written can never be
 * drawn on the timeline at midnight.
 */
export function evidenceMinute(value: unknown): Minute | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return minutesFromDateTime(value);
}

/**
 * "2:23 PM" for an evidence timestamp, or null.
 *
 * Deliberately not `formatCheckinTime` on its own: that returns "—" for a
 * missing value, and a fact whose value is a dash is worse than no fact at all.
 * The null has to survive as far as `buildFacts`, which drops the row.
 */
export function evidenceTimeText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (Number.isNaN(parseDateTimeLocal(value).getTime())) return null;
  return formatCheckinTime(value);
}

/** A fact, or null when the value was missing — `buildFacts` drops the nulls. */
export function fact(label: string, value: string | null | undefined): FlagFact | null {
  if (value == null || value === "") return null;
  return { label, value };
}

/** Drops the entries that had nothing to say, then enforces the four-fact cap. */
export function buildFacts(entries: Array<FlagFact | null | undefined>): FlagFact[] {
  return entries.filter((entry): entry is FlagFact => entry != null).slice(0, MAX_FACTS);
}

/**
 * `flag.source` translated. HR should never read an engine noun, and this is
 * read off the RECORD rather than the blob so it survives empty evidence.
 */
const FLAG_SOURCE_LABELS: Record<string, string> = {
  AUTO: "The attendance engine",
  EMPLOYEE: "The employee",
  HR: "HR",
};

function sourceText(flag: Flag): string | null {
  const source = typeof flag.source === "string" ? flag.source.trim() : "";
  if (!source) return null;
  return FLAG_SOURCE_LABELS[source] ?? source;
}

/**
 * The whole treatment for a code no detector produces — the three named in
 * NO_DETECTOR_CODES plus UNKNOWN_DEVICE_BRANCH and anything unrecognised.
 * (NOT DELIVERY_FAILED: the Bridge delivery path really does write those, so it
 * counts as emitted and takes the `default:` arm instead.)
 *
 * Exactly two facts, and both come from somewhere a hand-typed key cannot
 * mislead us:
 *   - `flag.source` off the record.
 *   - `evidence.reason` VERBATIM and unmapped. REASON_LABELS
 *     (flagDetails.ts:26-35) would turn a typed "single_checkin" into "Single
 *     punch only", asserting a finding the engine never made on a row a human
 *     created.
 *
 * Nothing else in the blob is touched, which is what keeps the shared key maps
 * (flagDetails.ts:65-94) away from keys whose names collide by accident.
 */
function noDetectorNarrative(input: NarrativeInput): FlagNarrative {
  const label = formatFlagLabel(input.flag.flag_code, input.evidence as FlagEvidence);
  return {
    headline: `"${label}" isn't a rule this engine currently checks automatically.`,
    subline: hasEvidence(input.evidence)
      ? NO_DETECTOR_SUBLINE
      : `${NO_DETECTOR_SUBLINE} ${EMPTY_EVIDENCE_NOTE}`,
    facts: buildFacts([
      fact("Raised by", sourceText(input.flag)),
      fact("Recorded reason", input.reason),
    ]),
    timeline: null,
  };
}

/**
 * The seam's other half: a code a detector DOES produce, whose per-scenario
 * builder is not registered yet (Tasks 2-5 fill these in one scenario at a
 * time).
 *
 * It must not throw — the panel would lose its entire primary zone — and it must
 * not borrow the no-detector copy, which would tell HR that LATE_START is not a
 * rule this engine checks.
 *
 * Zero facts is the correct interim answer, not a stub: every key is still one
 * click away in the disclosure, and promoting anything generically here would
 * re-import exactly the inherited grace and boundary rows this module exists to
 * remove.
 */
function emittedFallbackNarrative(input: NarrativeInput): FlagNarrative {
  return {
    headline: formatFlagLabel(input.flag.flag_code, input.evidence as FlagEvidence),
    subline: hasEvidence(input.evidence) ? null : EMPTY_EVIDENCE_NOTE,
    facts: [],
    timeline: null,
  };
}

/**
 * Evidence keys read for the three boundary flags (LATE_START / LEFT_EARLY /
 * LATE_FROM_LUNCH). closeout.py:606-674 and lunch_flags.py:58-63 write these onto
 * the shared per-employee-day evidence dict. `grace_minutes` is deliberately NOT
 * in this list — rule 3 forbids reading it here because it is an alias whose
 * meaning depends on which flag's extra_evidence wrote it last
 * (shift_grace.py:80-95's grace_evidence()); read the effective_*_grace_minutes
 * key for the flag instead.
 */
type BoundaryEvidence = {
  first_in?: string;
  last_out?: string;
  shift_start?: string;
  shift_end?: string;
  late_threshold?: string;
  early_threshold?: string;
  effective_start_grace_minutes?: number;
  lunch_out?: string;
  lunch_in?: string;
  lunch_start?: string;
  lunch_end?: string;
  return_threshold?: string;
};

/** Boundary-flag timelines stay narrow: the boundary plus ~45min of runway either side. */
const BOUNDARY_WINDOW_MARGIN_MIN = 45;

/**
 * Minutes between two evidence ISO datetimes (later - earlier), floored at 0.
 * Epoch-based, not minute-of-day: LEFT_EARLY's shift_end/early_threshold can roll
 * to the next calendar day for an overnight shift (closeout.py:660), and a
 * minute-of-day subtraction would silently go negative across that rollover.
 */
function minutesBetweenIso(laterIso: string | undefined, earlierIso: string | undefined): number {
  if (!laterIso || !earlierIso) return 0;
  const later = parseDateTimeLocal(laterIso).getTime();
  const earlier = parseDateTimeLocal(earlierIso).getTime();
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return 0;
  return Math.max(0, Math.round((later - earlier) / 60000));
}

/**
 * computeDayTimeWindow (attendancePunches.ts:605) only takes real checkins, but a
 * boundary flag's window also needs the shift boundary and the cutoff line in
 * view even when neither is itself a punch. Same margin-and-clamp shape, built
 * from raw minute anchors instead.
 */
function minuteWindowFromAnchors(
  anchors: Array<number | null | undefined>,
  marginMin: number = BOUNDARY_WINDOW_MARGIN_MIN
): { startMin: Minute; endMin: Minute } {
  const finite = anchors.filter((n): n is number => n != null && Number.isFinite(n));
  if (!finite.length) return { startMin: 0, endMin: 24 * 60 };
  return {
    startMin: clamp(Math.min(...finite) - marginMin, 0, 24 * 60),
    endMin: clamp(Math.max(...finite) + marginMin, 0, 24 * 60),
  };
}

/** Strips computeExpectedWindowPct/computeLunchWindowPct's pct fields down to the contract's {startMin,endMin}. */
function toMinuteRange(
  win: { startMin: number; endMin: number } | null
): { startMin: Minute; endMin: Minute } | null {
  return win ? { startMin: win.startMin, endMin: win.endMin } : null;
}

function pluralMinutes(n: number): string {
  return n === 1 ? "minute" : "minutes";
}

/** flag.evidence is `unknown`; parseFlagEvidence only narrows it to the generic FlagEvidence shape. */
function readBoundaryEvidence(flag: Flag): BoundaryEvidence {
  return (parseFlagEvidence(flag.evidence) ?? {}) as unknown as BoundaryEvidence;
}

function buildLateStartTimeline(
  day: NarrativeDay,
  evidence: BoundaryEvidence,
  grace: number
): FlagTimelineSpec {
  // Rule 11: spans/marks come from the day's real punches, not evidence.first_in.
  const sorted = sortCheckinsByTime(day.checkins, parseDateTimeLocal);
  const arrivalMin = sorted[0]
    ? minutesFromDateTime(sorted[0].time)
    : minutesFromDateTime(evidence.first_in);
  const nextMin = sorted[1] ? minutesFromDateTime(sorted[1].time) : null;

  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  const shiftStartMin = band?.startMin ?? minutesFromDateTime(evidence.shift_start);
  // The threshold line must match the headline's "past cutoff" number exactly
  // (voice rule 2), so both are read from the same frozen evidence field.
  const thresholdMin = minutesFromDateTime(evidence.late_threshold);

  const spans: TimelineSpan[] = [];
  if (shiftStartMin != null && arrivalMin != null && arrivalMin > shiftStartMin) {
    spans.push({ startMin: shiftStartMin, endMin: arrivalMin, tone: "gap" });
  }
  if (arrivalMin != null && nextMin != null && nextMin > arrivalMin) {
    spans.push({ startMin: arrivalMin, endMin: nextMin, tone: "worked" });
  }

  const marks: TimelineMark[] =
    arrivalMin != null ? [{ atMin: arrivalMin, tone: "alert", label: "Clocked in" }] : [];

  return {
    window: minuteWindowFromAnchors([shiftStartMin, arrivalMin, nextMin]),
    band,
    lunch: null,
    // grace=0 makes the cutoff and shift start the same minute — a threshold line
    // on top of the band's own start edge would be a redundant line, not a fact.
    threshold: grace > 0 ? thresholdMin : null,
    spans,
    marks,
  };
}

function buildLateStartNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readBoundaryEvidence(flag);
  const grace = evidence.effective_start_grace_minutes ?? 0;
  const firstInLabel = formatCheckinTime(evidence.first_in);
  const lateMinutes = minutesBetweenIso(evidence.first_in, evidence.late_threshold);

  const headline =
    grace > 0
      ? `Clocked in at ${firstInLabel} — ${lateMinutes} ${pluralMinutes(lateMinutes)} late, even after a ${grace}-minute grace period.`
      : `Clocked in at ${firstInLabel} — ${lateMinutes} ${pluralMinutes(lateMinutes)} after the ${formatCheckinTime(evidence.shift_start)} shift start.`;

  const facts: FlagFact[] =
    grace > 0
      ? [
          { label: "Clocked in", value: firstInLabel },
          { label: "Cutoff", value: formatCheckinTime(evidence.late_threshold) },
          { label: "Past cutoff", value: formatDurationMinutes(lateMinutes) },
        ]
      : [
          { label: "Clocked in", value: firstInLabel },
          { label: "Shift start", value: formatCheckinTime(evidence.shift_start) },
          { label: "Late by", value: formatDurationMinutes(lateMinutes) },
        ];

  return {
    headline,
    subline: null,
    facts,
    timeline: buildLateStartTimeline(day, evidence, grace),
  };
}

function buildLeftEarlyTimeline(day: NarrativeDay, evidence: BoundaryEvidence): FlagTimelineSpec {
  const sorted = sortCheckinsByTime(day.checkins, parseDateTimeLocal);
  const last = sorted[sorted.length - 1];
  const departureMin = last
    ? minutesFromDateTime(last.time)
    : minutesFromDateTime(evidence.last_out);

  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  const shiftEndMin = band?.endMin ?? minutesFromDateTime(evidence.shift_end);
  const thresholdMin = minutesFromDateTime(evidence.early_threshold);

  const spans: TimelineSpan[] = [];
  if (departureMin != null && shiftEndMin != null && shiftEndMin > departureMin) {
    spans.push({ startMin: departureMin, endMin: shiftEndMin, tone: "gap" });
  }

  const marks: TimelineMark[] =
    departureMin != null ? [{ atMin: departureMin, tone: "alert", label: "Clocked out" }] : [];

  return {
    window: minuteWindowFromAnchors([departureMin, thresholdMin, shiftEndMin]),
    band,
    lunch: null,
    threshold: thresholdMin,
    spans,
    marks,
  };
}

function buildLeftEarlyNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readBoundaryEvidence(flag);
  const lastOutLabel = formatCheckinTime(evidence.last_out);
  const earlyMinutes = minutesBetweenIso(evidence.early_threshold, evidence.last_out);

  const headline = `Clocked out at ${lastOutLabel}, ${earlyMinutes} ${pluralMinutes(earlyMinutes)} before their shift was scheduled to end.`;

  const facts: FlagFact[] = [
    { label: "Clocked out", value: lastOutLabel },
    { label: "Shift end", value: formatCheckinTime(evidence.shift_end) },
    { label: "Early by", value: formatDurationMinutes(earlyMinutes) },
  ];

  return {
    headline,
    subline: null,
    facts,
    timeline: buildLeftEarlyTimeline(day, evidence),
  };
}

function buildLateFromLunchTimeline(day: NarrativeDay, evidence: BoundaryEvidence): FlagTimelineSpec {
  // Rule 11: feed spans/marks from the day's real lunch detection, not the frozen
  // evidence pair. day.observedLunch is lunchDetection.ts's detectObservedLunch()
  // re-run against the live punch list; evidence.lunch_out/lunch_in are only the
  // fallback for a caller that has not populated observedLunch.
  const observed = observedLunchMinuteRange(day.observedLunch);
  const outMin = observed?.startMin ?? minutesFromDateTime(evidence.lunch_out);
  const inMin = observed?.endMin ?? minutesFromDateTime(evidence.lunch_in);

  // Raw scheduled window, no grace — grace lives in `threshold` alone (rule 4),
  // so the "Scheduled" fact and this band never disagree with each other.
  const lunch = day.shift ? toMinuteRange(computeLunchWindowPct(day.shift)) : null;
  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  const thresholdMin = minutesFromDateTime(evidence.return_threshold);

  const spans: TimelineSpan[] = [];
  if (outMin != null && inMin != null && inMin > outMin) {
    spans.push({ startMin: outMin, endMin: inMin, tone: "gap" });
  }

  const marks: TimelineMark[] = [];
  if (outMin != null) marks.push({ atMin: outMin, tone: "normal", label: "Left for lunch" });
  if (inMin != null) marks.push({ atMin: inMin, tone: "alert", label: "Back" });

  return {
    window: minuteWindowFromAnchors([outMin, inMin, lunch?.startMin, thresholdMin]),
    band,
    lunch,
    threshold: thresholdMin,
    spans,
    marks,
  };
}

function buildLateFromLunchNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readBoundaryEvidence(flag);
  const outLabel = formatCheckinTime(evidence.lunch_out);
  const inLabel = formatCheckinTime(evidence.lunch_in);
  const lateMinutes = minutesBetweenIso(evidence.lunch_in, evidence.return_threshold);

  const headline = `Left for lunch at ${outLabel}, back at ${inLabel} — ${lateMinutes} min past the return deadline.`;

  const facts: FlagFact[] = [
    { label: "Actual lunch", value: `${outLabel} – ${inLabel}` },
    {
      label: "Scheduled",
      value: `${formatCheckinTime(evidence.lunch_start)} – ${formatCheckinTime(evidence.lunch_end)}`,
    },
    { label: "Deadline", value: formatCheckinTime(evidence.return_threshold) },
    { label: "Late by", value: formatDurationMinutes(lateMinutes) },
  ];

  return {
    headline,
    subline: null,
    facts,
    timeline: buildLateFromLunchTimeline(day, evidence),
  };
}

export function flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readEvidence(flag);
  const input: NarrativeInput = {
    flag,
    evidence,
    reason: evidenceReason(evidence),
    day,
    dateKey,
  };

  // Checked BEFORE the switch, so a hand-created row can never reach a builder
  // that assumes engine-written keys.
  if (!isEmittedCode(flag.flag_code)) return noDetectorNarrative(input);

  // Codes whose treatment splits by evidence.reason branch on it INSIDE their
  // builder (Global Constraint 7: relevance is scoped to (flag_code, reason) —
  // `device_sn` is buried provenance for `single_checkin` and a first-class
  // fact for `delivery_failed`, same code, opposite treatment). Keeping that
  // second level inside the builder leaves this switch one level deep.
  switch (flag.flag_code) {
    case "LATE_START":
      return buildLateStartNarrative(flag, day, dateKey);
    case "LEFT_EARLY":
      return buildLeftEarlyNarrative(flag, day, dateKey);
    case "LATE_FROM_LUNCH":
      return buildLateFromLunchNarrative(flag, day, dateKey);
    default:
      // Emitted codes with no builder yet — Tasks 3-5 add their arms above this.
      return emittedFallbackNarrative(input);
  }
}
