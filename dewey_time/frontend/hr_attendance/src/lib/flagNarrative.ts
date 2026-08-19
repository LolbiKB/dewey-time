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
  formatBranchLabel,
  formatCheckinTime,
  formatDurationMinutes,
  formatMinuteOnDay,
  minutesFromDateTime,
  parseDateTimeLocal,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
import {
  classifyUnpairedPresentations,
  computeDayTimeWindow,
  deriveSegments,
  hasPunchBranch,
  sortCheckinsByTime,
} from "@/lib/attendancePunches";
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
  // The intraday half of the pair above. Emitted since intraday stopped
  // raising a provisional UNNOTIFIED_ABSENCE for a day nobody has finished —
  // same situation, same evidence, different tense.
  "NO_CHECKIN_YET",
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
 * The codes the spec's treatment table names under "no detector".
 *
 * This is a NAMED SUBSET for the copy and the tests, not the gate —
 * `isEmittedCode` is the gate. UNKNOWN_DEVICE_BRANCH is declared in
 * `AUTO_FLAG_CODES` but no detector ever writes it as a flag_code (unknown
 * branches fold into ATTENDANCE_ISSUE reason `unknown_device_branch`), so it
 * takes the no-detector path without being listed here.
 *
 * NO_CHECKIN_YET was the third entry and has left: intraday writes it now, so
 * telling HR it "isn't a rule this engine currently checks automatically"
 * would be false about a row the engine had just raised.
 */
export const NO_DETECTOR_CODES: readonly string[] = [
  "MISSING_IN_OR_OUT",
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
function noDetectorNarrative(flag: Flag, evidence: NarrativeEvidence): FlagNarrative {
  // The blob is deliberately NOT passed to formatFlagLabel. Its special cases are
  // keyed by flag_code + evidence key name (flagLabels.ts:57-79), so a
  // hand-created row is one lucky key name away from being formatted and
  // promoted as if a detector had produced it. No code that reaches HERE hits one
  // of those cases today — all three belong to emitted codes — so this changes
  // nothing observable; it removes the way in.
  const label = formatFlagLabel(flag.flag_code, null);
  return {
    headline: `"${label}" isn't a rule this engine currently checks automatically.`,
    subline: hasEvidence(evidence)
      ? NO_DETECTOR_SUBLINE
      : `${NO_DETECTOR_SUBLINE} ${EMPTY_EVIDENCE_NOTE}`,
    facts: buildFacts([
      fact("Raised by", sourceText(flag)),
      fact("Recorded reason", evidenceReason(evidence)),
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
  effective_end_grace_minutes?: number;
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

/** Narrows an already-parsed generic evidence blob to the boundary-flag shape. */
function readBoundaryEvidence(evidence: NarrativeEvidence): BoundaryEvidence {
  return evidence as unknown as BoundaryEvidence;
}

/**
 * The fallback a boundary builder takes when the evidence keys its own story
 * depends on are absent — e.g. an empty `{}` blob. Without this, a builder that
 * pushes straight through renders a confident-looking sentence built entirely
 * from `formatCheckinTime`/`formatDurationMinutes`'s missing-value placeholders
 * ("Clocked in at — — 0 minutes after the — shift start."), which is worse than
 * `emittedFallbackNarrative`'s honest "no story yet" treatment.
 */
function boundaryFallback(
  flag: Flag,
  evidence: NarrativeEvidence,
  day: NarrativeDay,
  dateKey: string
): FlagNarrative {
  return emittedFallbackNarrative({
    flag,
    evidence,
    reason: evidenceReason(evidence),
    day,
    dateKey,
  });
}

/** True when the shift's scheduled end clock-time is earlier than its start (crosses midnight). */
function isOvernightShift(shift: ShiftContext | null | undefined): boolean {
  if (!shift?.shift_assigned) return false;
  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  const endMin = parseTimeToMinutes(shift.end_time ?? null);
  return startMin != null && endMin != null && endMin < startMin;
}

/**
 * Rolls a minute-of-day anchor onto the following calendar day when it reads
 * earlier than the overnight shift's start.
 *
 * computeExpectedWindowPct returns null for an overnight shift (end < start,
 * shiftTimeline.ts:190), so an evidence-derived boundary like `shift_end` or
 * `early_threshold` decodes through `minutesFromDateTime` to a small
 * minute-of-day (06:00 -> 360) even though it actually falls on the calendar
 * day AFTER the shift started. Left unnormalised, that 360 reads as "before" a
 * late-evening departure (23:40 -> 1420), so the gap-span guard
 * (`shiftEndMin > departureMin`) silently fails and the window's margin math
 * spans nearly the whole day instead of the ~90 minutes around the boundary.
 */
function normalizeOvernightAnchor(
  min: Minute | null,
  shiftStartMin: Minute | null,
  overnight: boolean
): Minute | null {
  if (min == null || !overnight || shiftStartMin == null) return min;
  return min < shiftStartMin ? min + 24 * 60 : min;
}

function buildLateStartTimeline(
  day: NarrativeDay,
  evidence: BoundaryEvidence,
  grace: number
): FlagTimelineSpec {
  // Rule 11: spans/marks come from the day's real punches, not evidence.first_in.
  const sorted = sortCheckinsByTime(day.checkins, parseDateTimeLocal);
  let arrivalMin = sorted[0]
    ? minutesFromDateTime(sorted[0].time)
    : minutesFromDateTime(evidence.first_in);
  let nextMin = sorted[1] ? minutesFromDateTime(sorted[1].time) : null;

  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  let shiftStartMin = band?.startMin ?? minutesFromDateTime(evidence.shift_start);
  // The threshold line must match the headline's "past cutoff" number exactly
  // (voice rule 2), so both are read from the same frozen evidence field.
  let thresholdMin = minutesFromDateTime(evidence.late_threshold);

  // Mirrors buildLeftEarlyTimeline's overnight rollover (:544-548): an
  // overnight shift has no `band` (computeExpectedWindowPct returns null for
  // end < start), so a post-midnight arrival decodes to a small minute-of-day
  // value that reads as "before" a late-evening shift start (22:00 -> 1320)
  // unless every anchor this timeline compares is rolled onto the same
  // overnight frame first.
  const overnight = isOvernightShift(day.shift);
  const rawShiftStartMin = parseTimeToMinutes(day.shift?.start_time ?? null);
  arrivalMin = normalizeOvernightAnchor(arrivalMin, rawShiftStartMin, overnight);
  nextMin = normalizeOvernightAnchor(nextMin, rawShiftStartMin, overnight);
  shiftStartMin = normalizeOvernightAnchor(shiftStartMin, rawShiftStartMin, overnight);
  thresholdMin = normalizeOvernightAnchor(thresholdMin, rawShiftStartMin, overnight);

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
  const genericEvidence = readEvidence(flag);
  const evidence = readBoundaryEvidence(genericEvidence);
  // Finding 2: without this, an evidence blob missing the arrival/cutoff pair
  // (e.g. `{}`) falls through to a confident-looking sentence built from
  // formatCheckinTime/formatDurationMinutes's own "—"/"0 minutes" placeholders.
  if (!evidence.first_in || !evidence.late_threshold) {
    return boundaryFallback(flag, genericEvidence, day, dateKey);
  }

  const grace = evidence.effective_start_grace_minutes ?? 0;
  const firstInLabel = formatCheckinTime(evidence.first_in);
  const lateMinutes = minutesBetweenIso(evidence.first_in, evidence.late_threshold);

  const headline =
    grace > 0
      ? `Clocked in at ${firstInLabel} — ${lateMinutes} ${pluralMinutes(lateMinutes)} late, even after a ${grace}-minute grace period.`
      : `Clocked in at ${firstInLabel} — ${lateMinutes} ${pluralMinutes(lateMinutes)} after the ${formatCheckinTime(evidence.shift_start)} shift start.`;

  // Finding 1: values route through evidenceTimeText (null on a missing/
  // unparsable field) rather than formatCheckinTime ("—" on the same input),
  // so fact()/buildFacts() can actually drop a row with nothing to say instead
  // of rendering a dash. `shift_start` in particular is not covered by the
  // guard above and can still be absent here.
  const facts =
    grace > 0
      ? buildFacts([
          fact("Clocked in", evidenceTimeText(evidence.first_in)),
          fact("Cutoff", evidenceTimeText(evidence.late_threshold)),
          fact("Past cutoff", formatDurationMinutes(lateMinutes)),
        ])
      : buildFacts([
          fact("Clocked in", evidenceTimeText(evidence.first_in)),
          fact("Shift start", evidenceTimeText(evidence.shift_start)),
          fact("Late by", formatDurationMinutes(lateMinutes)),
        ]);

  // The feed-attested single-punch basis is a different evidentiary footing
  // than a paired day, and HR must see that without opening the raw blob:
  // there is no clock-out behind this headline, and the reason the engine
  // dared anyway is that the device countersigned its day complete.
  const singlePunch = (genericEvidence as Record<string, unknown>).single_punch === true;

  return {
    headline,
    subline: singlePunch
      ? "This rests on a single check-in — there is no matching clock-out. The device closed its day with nothing left to deliver, so that punch is read as the arrival."
      : null,
    facts,
    timeline: buildLateStartTimeline(day, evidence, grace),
  };
}

function buildLeftEarlyTimeline(day: NarrativeDay, evidence: BoundaryEvidence): FlagTimelineSpec {
  const sorted = sortCheckinsByTime(day.checkins, parseDateTimeLocal);
  const last = sorted[sorted.length - 1];
  let departureMin = last ? minutesFromDateTime(last.time) : minutesFromDateTime(evidence.last_out);

  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  let shiftEndMin = band?.endMin ?? minutesFromDateTime(evidence.shift_end);
  let thresholdMin = minutesFromDateTime(evidence.early_threshold);

  // Finding 5: an overnight shift has no `band` (computeExpectedWindowPct
  // returns null for end < start), so shiftEndMin/thresholdMin fall back to
  // raw minute-of-day values that read as "before" a late-evening departure
  // once the shift crosses midnight. Roll every anchor that lands before the
  // shift's start clock-time onto the departure's timeline — including
  // departureMin itself, so a departure that is ALSO past midnight (an early
  // 1am walkout, rather than the late-evening case) stays on the same frame
  // as the normalised shiftEndMin/thresholdMin instead of anchoring a bogus
  // multi-day span.
  const overnight = isOvernightShift(day.shift);
  const shiftStartMin = parseTimeToMinutes(day.shift?.start_time ?? null);
  departureMin = normalizeOvernightAnchor(departureMin, shiftStartMin, overnight);
  shiftEndMin = normalizeOvernightAnchor(shiftEndMin, shiftStartMin, overnight);
  thresholdMin = normalizeOvernightAnchor(thresholdMin, shiftStartMin, overnight);

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
  const genericEvidence = readEvidence(flag);
  const evidence = readBoundaryEvidence(genericEvidence);
  // Finding 2: mirrors buildLateStartNarrative's guard — an evidence blob
  // missing the departure/cutoff pair must not reach a confidently-worded
  // sentence built from placeholder "—"/"0 minutes" values.
  if (!evidence.last_out || !evidence.early_threshold) {
    return boundaryFallback(flag, genericEvidence, day, dateKey);
  }

  // Finding 3: mirrors buildLateStartNarrative's two-branch shape exactly —
  // read the grace from the explicit effective_end_grace_minutes key (never
  // the grace_minutes alias, constraint 4), and measure earlyMinutes against
  // early_threshold — the boundary the engine actually flagged against — in
  // BOTH branches, so the headline number and the facts number never disagree
  // the way the previous "Shift end" + early_threshold-derived magnitude did.
  const grace = evidence.effective_end_grace_minutes ?? 0;
  const lastOutLabel = formatCheckinTime(evidence.last_out);
  const earlyMinutes = minutesBetweenIso(evidence.early_threshold, evidence.last_out);

  const headline =
    grace > 0
      ? `Clocked out at ${lastOutLabel} — ${earlyMinutes} ${pluralMinutes(earlyMinutes)} past the ${formatCheckinTime(evidence.early_threshold)} cutoff, even after a ${grace}-minute grace period.`
      : `Clocked out at ${lastOutLabel} — ${earlyMinutes} ${pluralMinutes(earlyMinutes)} before the ${formatCheckinTime(evidence.shift_end)} shift end.`;

  // Finding 1: evidenceTimeText (null on missing/unparsable) feeds fact(), so
  // a missing `shift_end` drops the row instead of rendering "Shift end: —".
  const facts =
    grace > 0
      ? buildFacts([
          fact("Clocked out", evidenceTimeText(evidence.last_out)),
          fact("Cutoff", evidenceTimeText(evidence.early_threshold)),
          fact("Past cutoff", formatDurationMinutes(earlyMinutes)),
        ])
      : buildFacts([
          fact("Clocked out", evidenceTimeText(evidence.last_out)),
          fact("Shift end", evidenceTimeText(evidence.shift_end)),
          fact("Early by", formatDurationMinutes(earlyMinutes)),
        ]);

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
  let outMin = observed?.startMin ?? minutesFromDateTime(evidence.lunch_out);
  let inMin = observed?.endMin ?? minutesFromDateTime(evidence.lunch_in);

  // Raw scheduled window, no grace — grace lives in `threshold` alone (rule 4),
  // so the "Scheduled" fact and this band never disagree with each other.
  const rawLunch = day.shift ? toMinuteRange(computeLunchWindowPct(day.shift)) : null;
  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  let thresholdMin = minutesFromDateTime(evidence.return_threshold);

  // Mirrors buildLeftEarlyTimeline's overnight rollover (:544-548) and
  // narrateMissingTime's lunch-window rollover (:742-751): unlike
  // computeExpectedWindowPct, computeLunchWindowPct has no notion of the
  // overnight shift the lunch belongs to, so a lunch scheduled on the far
  // side of midnight (e.g. 00:00-00:30 for a 22:00 shift start) decodes to a
  // raw minute-of-day pair that reads as "before" the shift instead of after
  // it. Roll every anchor this timeline compares onto the same frame.
  const overnight = isOvernightShift(day.shift);
  const shiftStartMin = parseTimeToMinutes(day.shift?.start_time ?? null);
  outMin = normalizeOvernightAnchor(outMin, shiftStartMin, overnight);
  inMin = normalizeOvernightAnchor(inMin, shiftStartMin, overnight);
  thresholdMin = normalizeOvernightAnchor(thresholdMin, shiftStartMin, overnight);
  const lunch = rawLunch
    ? {
        startMin: normalizeOvernightAnchor(rawLunch.startMin, shiftStartMin, overnight) ?? rawLunch.startMin,
        endMin: normalizeOvernightAnchor(rawLunch.endMin, shiftStartMin, overnight) ?? rawLunch.endMin,
      }
    : null;

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
  const genericEvidence = readEvidence(flag);
  const evidence = readBoundaryEvidence(genericEvidence);
  // Finding 2: mirrors the other two builders' guard — without the out/in/
  // deadline trio, there is no lunch-return story to state confidently.
  if (!evidence.lunch_out || !evidence.lunch_in || !evidence.return_threshold) {
    return boundaryFallback(flag, genericEvidence, day, dateKey);
  }

  const outLabel = formatCheckinTime(evidence.lunch_out);
  const inLabel = formatCheckinTime(evidence.lunch_in);
  const lateMinutes = minutesBetweenIso(evidence.lunch_in, evidence.return_threshold);

  // Copy consistency: spell out "minutes" like the other two headlines rather
  // than abbreviating to "min".
  const headline = `Left for lunch at ${outLabel}, back at ${inLabel} — ${lateMinutes} ${pluralMinutes(lateMinutes)} past the return deadline.`;

  // Finding 1: "Scheduled" reads lunch_start/lunch_end through evidenceTimeText
  // so a missing half of the pair drops the whole fact instead of rendering a
  // dash inside the range string.
  const scheduledStart = evidenceTimeText(evidence.lunch_start);
  const scheduledEnd = evidenceTimeText(evidence.lunch_end);
  const scheduledValue =
    scheduledStart != null && scheduledEnd != null ? `${scheduledStart} – ${scheduledEnd}` : null;

  const facts = buildFacts([
    fact("Actual lunch", `${outLabel} – ${inLabel}`),
    fact("Scheduled", scheduledValue),
    fact("Deadline", evidenceTimeText(evidence.return_threshold)),
    fact("Late by", formatDurationMinutes(lateMinutes)),
  ]);

  return {
    headline,
    subline: null,
    facts,
    timeline: buildLateFromLunchTimeline(day, evidence),
  };
}

// --- MISSING_TIME --------------------------------------------------------
//
// absence_flags.py:34-67 (evaluate_missing_time_flags, called from both
// closeout.py and the 30-min intraday scheduler) writes exactly
// { interval_start, interval_end, minutes, kind, threshold_minutes } — the
// first four already model 1:1 onto flagLabels.ts's FlagEvidence, so no
// local evidence type is needed for this flag.
//
// The decisive question for HR is not "how long" but "was it lunch": the
// same 45 minutes is a fed employee inside the scheduled lunch window and
// unaccounted time everywhere else. Rule 12 draws that comparison from the
// gap (evidence) against the lunch window (the live calendar's day.shift)
// — never from an evidence-side shift_start/shift_type, which this flag's
// evidence dict doesn't carry in the first place.

function missingTimeGapMinutes(evidence: FlagEvidence): { startMin: number; endMin: number } {
  const startMin = minutesFromDateTime(evidence.interval_start) ?? 0;
  const endMin = minutesFromDateTime(evidence.interval_end) ?? startMin;
  return { startMin, endMin };
}

function narrateMissingTime(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const genericEvidence = readEvidence(flag);
  const evidence = genericEvidence as FlagEvidence;
  // Task 3 review, finding 2: mirrors buildLateStartNarrative's guard
  // (:474) — without the interval pair, missingTimeGapMinutes' `?? 0`
  // midnight fallback would otherwise draw a fabricated zero-length span and
  // render a confident "Gone from — to —" sentence off an empty blob.
  if (!evidence.interval_start || !evidence.interval_end) {
    return boundaryFallback(flag, genericEvidence, day, dateKey);
  }

  const overnight = isOvernightShift(day.shift);
  const shiftStartMin = parseTimeToMinutes(day.shift?.start_time ?? null);

  const raw = missingTimeGapMinutes(evidence);
  // Task 3 review, finding 3: absence_flags.py:51-60 can legitimately place
  // interval_end on the calendar day AFTER interval_start for an overnight
  // shift (absence_intervals.py:318-319 rolls shift_end_min +1440 before
  // converting the interval back to datetimes), so a raw minute-of-day
  // reading of interval_end can land below interval_start's. Roll both
  // anchors onto the same overnight frame the way buildLeftEarlyTimeline
  // does (:531-535), so the gap survives the rollover instead of inverting
  // and collapsing to 0 via the Math.max(0, ...) below.
  const gapStartMin = normalizeOvernightAnchor(raw.startMin, shiftStartMin, overnight) ?? raw.startMin;
  const gapEndMin = normalizeOvernightAnchor(raw.endMin, shiftStartMin, overnight) ?? raw.endMin;

  const minutes = evidence.minutes ?? Math.max(0, gapEndMin - gapStartMin);
  const durationLabel = formatDurationMinutes(minutes);
  const startLabel = formatCheckinTime(evidence.interval_start);
  const endLabel = formatCheckinTime(evidence.interval_end);

  // Same overnight rollover applies to the scheduled lunch window when it
  // falls on the far side of midnight from shift start.
  const rawLunchStartMin = parseTimeToMinutes(day.shift?.lunch_start ?? null);
  const rawLunchEndMin = parseTimeToMinutes(day.shift?.lunch_end ?? null);
  const lunchStartMin = normalizeOvernightAnchor(rawLunchStartMin, shiftStartMin, overnight);
  const lunchEndMin = normalizeOvernightAnchor(rawLunchEndMin, shiftStartMin, overnight);
  const hasLunchWindow =
    lunchStartMin != null && lunchEndMin != null && lunchEndMin > lunchStartMin;
  const overlapsLunch =
    hasLunchWindow && gapStartMin < lunchEndMin! && gapEndMin > lunchStartMin!;

  // A bridged row deliberately carries less than its own span.
  // _bridge_scheduled_lunch (absence_intervals.py) joins the two halves of a
  // day nobody punched for into one interval and SUMS their minutes rather
  // than spanning them, because the unpaid lunch sitting between them is not
  // owed time. So 08:05→17:00 arrives carrying 475 minutes, not 535.
  //
  // Left unsaid, that reads as an arithmetic bug — and this codebase has
  // already paid for numbers HR could not reconcile: derive_presence_intervals'
  // own docstring records absence being billed twice as the thing that made
  // them distrust the figures. Name the excluded hour and the subtraction
  // becomes visible instead of suspicious.
  //
  // Guarded on evidence.minutes being present, since the fallback above
  // derives minutes FROM the span and would otherwise always find no gap.
  const spanMinutes = Math.max(0, gapEndMin - gapStartMin);
  const excludedMinutes =
    overlapsLunch && evidence.minutes != null
      ? Math.max(0, spanMinutes - evidence.minutes)
      : 0;
  const excludesLunch = excludedMinutes >= 1;

  const lunchRelationship = excludesLunch
    ? `excluding the ${formatDurationMinutes(excludedMinutes)} scheduled lunch`
    : overlapsLunch
      ? "overlapping the scheduled lunch window"
      : "and it wasn't lunch";

  // Feed the axis from the day's real checkin list (rule 11), then widen it
  // to guarantee the gap itself is never clipped — a "trailing" gap (left
  // early) can run past shift end well beyond the checkins-derived margin.
  const punchWindow = computeDayTimeWindow(day.checkins, minutesFromDateTime);

  // Task 3 review, finding 1: every value routes through fact()/buildFacts()
  // — "Left"/"Back" specifically through evidenceTimeText (null on a
  // missing/unparsable timestamp) rather than formatCheckinTime ("—" on the
  // same input) — mirroring the three Task-2 builders (:494-502, :584-592,
  // :662-666) exactly, so a malformed interval drops the row instead of
  // rendering a dash.
  const facts = buildFacts([
    fact("Gap", formatDurationMinutes(minutes)),
    // Sits directly under Gap, because Gap is the number Left and Back
    // appear to contradict. Dropped entirely on an unbridged row, where
    // Back − Left already equals Gap and the line would only add noise.
    fact("Lunch excluded", excludesLunch ? formatDurationMinutes(excludedMinutes) : null),
    fact("Left", evidenceTimeText(evidence.interval_start)),
    fact("Back", evidenceTimeText(evidence.interval_end)),
    fact(
      "Lunch window",
      hasLunchWindow
        ? `${formatMinuteOnDay(dateKey, lunchStartMin!)} – ${formatMinuteOnDay(dateKey, lunchEndMin!)}`
        : "No scheduled lunch"
    ),
  ]);

  return {
    headline: `Gone from ${startLabel} to ${endLabel} — ${durationLabel} unaccounted, ${lunchRelationship}.`,
    subline: null,
    facts,
    timeline: {
      window: {
        startMin: Math.min(punchWindow?.startMin ?? gapStartMin, gapStartMin),
        endMin: Math.max(punchWindow?.endMin ?? gapEndMin, gapEndMin),
      },
      // No shift band: this flag's finding is the lunch comparison, not the
      // shift boundary — rule 10's corollary (draw only the boundary the
      // flag is about; LATE_START gets the start boundary, this gets lunch).
      band: null,
      lunch: hasLunchWindow ? { startMin: lunchStartMin!, endMin: lunchEndMin! } : null,
      threshold: null,
      spans: [{ startMin: gapStartMin, endMin: gapEndMin, tone: "gap" }],
      marks: [],
    },
  };
}

// --- UNNOTIFIED_ABSENCE ---------------------------------------------------
//
// Two producers write this code with different evidence:
//  - device closeout, reason "on_shift_no_checkins" (closeout.py:505-516 +
//    :588-590): evidence includes shift_type, employee_branch, device_sn,
//    first_in: null, last_out: null, holiday — merged with {reason}.
//  - the ~3am company fallback, reason "company_fallback_no_checkins"
//    (closeout.py:301-313): evidence is exactly {employee, date, on_shift,
//    reason, checkins_count} — no shift_type, no employee_branch, no
//    device_sn.
//
// Rule 10: never source the "Shift" fact or the headline's shift name from
// evidence.shift_type — read the live calendar (day.shift) instead, so both
// producers describe the same situation identically. device_sn is buried
// provenance here (rule 8: no device serial in user-facing copy outside
// delivery_failed's "Reported by"), so it is read nowhere below.

type UnnotifiedAbsenceEvidence = FlagEvidence & { checkins_count?: number };

const UNNOTIFIED_ABSENCE_CAUGHT_BY: Record<string, string> = {
  on_shift_no_checkins: "Confirmed at end-of-day device closeout",
  company_fallback_no_checkins: "Confirmed by the overnight company-wide check",
  // The intraday pass raises this one while the day is still running, so it is
  // the one reason here that is NOT a confirmation. Every other entry, and the
  // fallback below, says "Confirmed"; letting this fall through to that told HR
  // a day still in progress had been settled — on the row this whole change
  // exists to make readable. The wording has to survive the person walking in
  // ten minutes later, at which point the row is withdrawn.
  on_shift_no_checkins_intraday: "No punches yet today — not yet confirmed",
};

function unnotifiedAbsenceCaughtBy(reason: string | undefined): string {
  return (reason && UNNOTIFIED_ABSENCE_CAUGHT_BY[reason]) ?? "Confirmed automatically";
}

/**
 * The scheduled shift as a minute band, or null when the calendar has no shift
 * to draw. Shared by UNNOTIFIED_ABSENCE (which sizes its hatched band from it)
 * and the ATTENDANCE_ISSUE builders below (which draw punches against it) —
 * every scenario that needs the shift band needs the same overnight rollover,
 * so there is one of these rather than one per flag.
 */
function narrativeShiftBand(
  shift: NarrativeDay["shift"]
): { startMin: number; endMin: number } | null {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  let endMin = parseTimeToMinutes(shift.end_time ?? null);
  if (startMin == null || endMin == null) return null;
  // Task 3 review, finding 3: unlike shiftTimeline.ts's
  // computeExpectedWindowPct (which returns null for an overnight shift
  // because its %-based day axis has nowhere to put the rolled-over
  // portion), this band drives its own axis — roll the end past midnight the
  // way buildLeftEarlyTimeline's anchors do (:531-535), instead of dropping
  // the shift (and with it unnotifiedAbsenceShiftFactLabel's start–end
  // fallback and the whole timeline) for every overnight absence.
  endMin = normalizeOvernightAnchor(endMin, startMin, isOvernightShift(shift)) ?? endMin;
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

/** Named shift only, for the headline sentence. A synthesized time range
 * read as "the 9:00 AM – 1:00 PM shift" scans like a typo, not a schedule —
 * the headline degrades straight to the generic sentence instead. */
function unnotifiedAbsenceHeadlineShiftLabel(shift: NarrativeDay["shift"]): string | null {
  if (!shift?.shift_assigned) return null;
  const type = shift.shift_type?.trim();
  return type || null;
}

/** Shift fact value: same named-shift-first source as the headline, but
 * falls back to a start–end time range — more detail than the headline
 * needs — before giving up. Never evidence.shift_type (rule 10). */
function unnotifiedAbsenceShiftFactLabel(shift: NarrativeDay["shift"], dateKey: string): string {
  const named = unnotifiedAbsenceHeadlineShiftLabel(shift);
  if (named) return named;
  const band = narrativeShiftBand(shift);
  if (!band) return "Not resolved on this calendar";
  return `${formatMinuteOnDay(dateKey, band.startMin)} – ${formatMinuteOnDay(dateKey, band.endMin)}`;
}

/** Rule 7: UNNOTIFIED_ABSENCE keeps its empty timeline — hatched so it reads
 * as absence, not a chart. Width is the point (a 4h shift reads differently
 * from a 10h shift), so band and window both come from the shift; nothing
 * else is drawn — "zero marks, band only": no lunch subdivision, no cutoff
 * line, the whole band is uniformly "gone". */
function unnotifiedAbsenceTimeline(band: { startMin: number; endMin: number }): FlagTimelineSpec {
  const ABSENCE_TIMELINE_MARGIN_MIN = 30; // matches computeDayTimeWindow's own default margin
  return {
    window: {
      startMin: clamp(band.startMin - ABSENCE_TIMELINE_MARGIN_MIN, 0, 24 * 60),
      endMin: clamp(band.endMin + ABSENCE_TIMELINE_MARGIN_MIN, 0, 24 * 60),
    },
    band,
    lunch: null,
    threshold: null,
    spans: [{ startMin: band.startMin, endMin: band.endMin, tone: "gap" }],
    marks: [],
  };
}

function narrateUnnotifiedAbsence(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const genericEvidence = readEvidence(flag);
  const evidence = genericEvidence as UnnotifiedAbsenceEvidence;
  // Task 3 review, finding 2: mirrors narrateMissingTime's guard — without
  // `reason` (drives "Caught by") and `checkins_count` (drives "Punches" —
  // see the comment on that fact below), there is no finding to narrate
  // confidently; an empty `{}` blob would otherwise fabricate "Punches: 0"
  // and "Caught by: Confirmed automatically" off nothing.
  if (!evidence.reason || evidence.checkins_count == null) {
    return boundaryFallback(flag, genericEvidence, day, dateKey);
  }

  // NO_CHECKIN_YET is the same situation on a day that is STILL RUNNING, so it
  // shares this builder and must not share this sentence. "Never checked in —
  // zero punches all day" is a claim about a finished day, and the intraday
  // pass raises its row from about half an hour after shift start: at 08:31 the
  // headline was a statement HR could disprove by looking out of the window.
  //
  // Keyed on the flag_code rather than the reason now that the code itself
  // carries running-versus-finished — the "Caught by" line below still keys on
  // the reason because it distinguishes three producers, not two states.
  const running = flag.flag_code === "NO_CHECKIN_YET";
  const shiftName = unnotifiedAbsenceHeadlineShiftLabel(day.shift);
  const headline = running
    ? shiftName
      ? `Scheduled for the ${shiftName} shift, and no check-in has been recorded yet.`
      : "Scheduled to work, and no check-in has been recorded yet."
    : shiftName
      ? `Scheduled for the ${shiftName} shift, but never checked in — zero punches all day.`
      : "Scheduled to work, but never checked in — zero punches all day.";

  const band = narrativeShiftBand(day.shift);

  return {
    headline,
    subline: null,
    // Task 3 review, finding 1: routed through fact()/buildFacts() for the
    // same cap-enforcement and consistency as every other builder, even
    // though none of these three values is ever null today.
    facts: buildFacts([
      fact("Shift", unnotifiedAbsenceShiftFactLabel(day.shift, dateKey)),
      // Task 3 review, finding 4: the zero count IS this flag's finding, not
      // surrounding context — if punches existed, the flag would not exist —
      // so this deliberately reads evidence.checkins_count (frozen at
      // emission), NOT day.checkins.length, even though day.checkins is the
      // live-calendar source everywhere else in this file.
      fact("Punches", String(evidence.checkins_count ?? 0)),
      fact("Caught by", unnotifiedAbsenceCaughtBy(evidence.reason)),
    ]),
    // Rule 9's second clause: no trustworthy timestamp for the thing being
    // flagged when the calendar can't resolve a shift band — the timeline
    // does not earn its place rather than fabricating a full-day axis.
    timeline: band ? unnotifiedAbsenceTimeline(band) : null,
  };
}

// --- OFF_SHIFT_PUNCH -------------------------------------------------------
//
// Two producers write this code, both from the shared per-employee-day
// evidence dict (closeout.py:505-516) merged with one of two extra_evidence
// branches: holiday_has_checkins (closeout.py:524, only reached once a
// holiday has already been resolved for the day) and off_shift_has_checkins
// (closeout.py:559, only reached once `on_shift` is false). Neither branch
// runs against a resolved shift, so there is never a band to draw — only the
// punches themselves earn a place on the axis (rule 6: auto-scale to the
// punches rather than falling back to a blank 24-hour axis).
//
// employee, date, on_shift, shift_type, first_in, last_out and device_sn all
// ride along on the shared dict but are exactly the constraint-6/constraint-8
// fields this scenario must never promote to a fact or name in copy.

type OffShiftPunchEvidence = {
  reason?: "holiday_has_checkins" | "off_shift_has_checkins";
  checkins_count?: number;
  holiday?: { description: string; weekly_off: boolean } | null;
};

/**
 * "10:15 AM, 2:40 PM", or null when there is nothing to list. Routed through
 * fact() rather than a hand-built row, so an evidence/calendar mismatch (a
 * frozen count with no matching live punches) drops the row instead of
 * rendering an empty string.
 */
function punchTimesValue(checkins: Checkin[]): string | null {
  const sorted = sortCheckinsByTime(checkins, parseDateTimeLocal);
  if (!sorted.length) return null;
  return sorted.map((c) => formatCheckinTime(c.time)).join(", ");
}

/**
 * Punch marks only, no band, no threshold — the shift half of a
 * FlagTimelineSpec never applies to OFF_SHIFT_PUNCH because neither reason
 * runs against a resolved shift. The axis still auto-scales to the punches
 * themselves (rule 6) via computeDayTimeWindow rather than falling back to a
 * blank 24-hour axis; when there are no punches to scale to, no timeline is
 * drawn at all.
 */
function punchMarksTimeline(checkins: Checkin[]): FlagTimelineSpec | null {
  const window = computeDayTimeWindow(checkins, minutesFromDateTime);
  if (!window) return null;

  const sorted = sortCheckinsByTime(checkins, parseDateTimeLocal);
  const marks: TimelineMark[] = sorted
    .map((c) => minutesFromDateTime(c.time))
    .filter((atMin): atMin is number => atMin != null)
    .map((atMin) => ({ atMin, tone: "alert" as const }));

  return {
    window: { startMin: window.startMin, endMin: window.endMin },
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    marks,
  };
}

/**
 * OFF_SHIFT_PUNCH carries two reasons that are unrelated stories to a human —
 * a public holiday nobody was scheduled to work, versus simply having no
 * shift assignment at all — so each gets its own headline.
 *
 * The holiday name is read from evidence.holiday, not day.holiday: it is the
 * frozen finding the engine judged, and it is the exact value the current
 * evidence-dump panel loses today (an object value never resolves to a
 * displayable row there, while employee_branch — pure disclosure noise for
 * this scenario — gets a first-class one). Promoting it to a fact here is
 * that fix.
 */
function buildOffShiftPunchNarrative(
  flag: Flag,
  day: NarrativeDay,
  dateKey: string
): FlagNarrative {
  const genericEvidence = readEvidence(flag);
  const evidence = genericEvidence as OffShiftPunchEvidence;
  // Without checkins_count there is no finding to state confidently — it is
  // the number this whole sentence is built around, and falling back to
  // day.checkins.length would fabricate a count from data this flag never
  // actually compared against.
  if (evidence.checkins_count == null) {
    return boundaryFallback(flag, genericEvidence, day, dateKey);
  }

  const checkins = day.checkins ?? [];
  const n = evidence.checkins_count;
  const times = n === 1 ? "time" : "times";
  const timeline = punchMarksTimeline(checkins);

  if (evidence.reason === "holiday_has_checkins") {
    const holidayName = evidence.holiday?.description ?? "a holiday";
    return {
      headline: `Punched ${n} ${times} on ${holidayName}, a public holiday — nobody was scheduled.`,
      subline: null,
      facts: buildFacts([
        fact("Day", holidayName),
        fact("Punch times", punchTimesValue(checkins)),
      ]),
      timeline,
    };
  }

  // off_shift_has_checkins (and any reason this scenario doesn't otherwise
  // recognise): no holiday, and no Shift Assignment covers the day.
  return {
    headline: `Punched ${n} ${times} — no shift was scheduled for this employee that day.`,
    subline: null,
    facts: buildFacts([fact("Punch times", punchTimesValue(checkins))]),
    timeline,
  };
}

// --- NON_PRIMARY_SITE_PUNCH -------------------------------------------------
//
// NON_PRIMARY_SITE_PUNCH's own evidence (_non_primary_site_punch_flag,
// closeout.py:413-436, shared verbatim by intraday.py:126-141) plus
// checkins_count from whichever producer's shared per-employee-day dict it
// rode in on.
//
// No timeline. The finding here is WHERE the punches landed, not WHEN — a
// timeline would render an evenly-spaced set of marks and say nothing about
// location (rule 5: categorical findings — which branch, which device, which
// day type — earn no timeline).
//
// Deliberately never reads evidence.device_sn: on the closeout producer it
// names whichever device triggered THAT closeout job, not the device that
// recorded the off-site punch, and the intraday producer never writes
// device_sn at all. There is no device↔branch registry to resolve either
// case correctly (constraint 8), so no device is named.

type NonPrimarySitePunchEvidence = {
  employee_branch?: string | null;
  non_primary_checkins?: number;
  checkins_count?: number;
};

function buildNonPrimarySitePunchNarrative(
  flag: Flag,
  day: NarrativeDay,
  dateKey: string
): FlagNarrative {
  const genericEvidence = readEvidence(flag);
  const evidence = genericEvidence as NonPrimarySitePunchEvidence;
  // Without both counts there is nothing to compare — the entire finding is
  // "N of M punches were elsewhere", and either count missing would force a
  // fabricated "0 of 0" sentence.
  if (evidence.non_primary_checkins == null || evidence.checkins_count == null) {
    return boundaryFallback(flag, genericEvidence, day, dateKey);
  }

  const nonPrimary = evidence.non_primary_checkins;
  const total = evidence.checkins_count;
  const branch = formatBranchLabel(evidence.employee_branch) ?? "their home branch";

  return {
    headline: `${nonPrimary} of ${total} punches today were at a site other than ${branch}, this employee's home branch.`,
    subline: null,
    facts: buildFacts([
      fact("Home branch", branch),
      fact("Punches elsewhere", `${nonPrimary} of ${total}`),
    ]),
    timeline: null,
  };
}

// --- ATTENDANCE_ISSUE -------------------------------------------------------
//
// One code, four unrelated stories. record_issue_flags.py:24-81 writes
// `single_checkin`, `unpaired_punch`, `unknown_device_branch` and
// `delivery_failed`, each with two or three keys of its own, and closeout.py:692
// then merges every one of them onto the SAME shared per-employee-day dict — so
// all four arrive carrying shift_start, late_threshold and seven grace keys that
// had nothing to do with the finding. `single_checkin` is the flag from the
// spec's opening screenshot: thirteen rows, seven of them grace, the finding at
// row thirteen.
//
// Relevance is therefore scoped to (flag_code, reason), not flag_code:
// `device_sn` is buried provenance for `single_checkin` and a first-class
// "Reported by" fact for `delivery_failed` — same code, opposite treatment.

/** Margin either side of a punch on the axis; matches computeDayTimeWindow's default. */
const RECORD_ISSUE_WINDOW_MARGIN_MIN = 30;

/** A string evidence value, or null for anything that is not one (or is blank). */
function evString(evidence: NarrativeEvidence, key: string): string | null {
  const value = evidence[key];
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

/** A finite number evidence value, or null. */
function evNumber(evidence: NarrativeEvidence, key: string): number | null {
  const value = evidence[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The overnight rollover the day's minute math has to share.
 *
 * Every minute in a record-issue timeline — the shift band, the evidence punch,
 * each checkin — has to sit on ONE frame, or a 01:30 punch (90) sorts hours
 * below a 22:00 shift start (1320): the mark lands outside the band and the
 * window balloons to most of the day. `narrativeShiftBand` already rolls the
 * shift end; this rolls everything else onto the same frame.
 */
type OvernightFrame = { overnight: boolean; shiftStartMin: Minute | null };

function overnightFrame(day: NarrativeDay): OvernightFrame {
  return {
    overnight: isOvernightShift(day.shift),
    shiftStartMin: parseTimeToMinutes(day.shift?.start_time ?? null),
  };
}

function framedMinute(frame: OvernightFrame, min: Minute | null): Minute | null {
  return normalizeOvernightAnchor(min, frame.shiftStartMin, frame.overnight);
}

/**
 * Axis bounds for a record-issue timeline: the shift band, the day's punches
 * and any extra anchor, each with a margin.
 *
 * Returns null when nothing positions an axis, and the caller then draws no
 * timeline at all rather than falling back to a blank 24-hour one. Not
 * `computeDayTimeWindow`: that reads raw minute-of-day off each checkin, which
 * is exactly what the overnight frame exists to correct.
 */
function narrativeWindow(
  day: NarrativeDay,
  band: { startMin: Minute; endMin: Minute } | null,
  anchors: Minute[]
): { startMin: Minute; endMin: Minute } | null {
  const frame = overnightFrame(day);
  const ceiling = (frame.overnight ? 48 : 24) * 60;
  const lows: Minute[] = [];
  const highs: Minute[] = [];

  if (band) {
    lows.push(band.startMin);
    highs.push(band.endMin);
  }

  for (const checkin of day.checkins ?? []) {
    const min = framedMinute(frame, minutesFromDateTime(checkin.time));
    if (min == null) continue;
    lows.push(min - RECORD_ISSUE_WINDOW_MARGIN_MIN);
    highs.push(min + RECORD_ISSUE_WINDOW_MARGIN_MIN);
  }

  for (const anchor of anchors) {
    lows.push(anchor - RECORD_ISSUE_WINDOW_MARGIN_MIN);
    highs.push(anchor + RECORD_ISSUE_WINDOW_MARGIN_MIN);
  }

  if (!lows.length) return null;

  const startMin = clamp(Math.min(...lows), 0, ceiling);
  const endMin = clamp(Math.max(...highs), 0, ceiling);
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

const punchHelpers = {
  parseTime: parseDateTimeLocal,
  minutesFromDateTime,
  clamp,
};

/** The day's paired in/out runs — the context that makes a lone tick read as an anomaly. */
function workedSpans(checkins: Checkin[], frame: OvernightFrame): TimelineSpan[] {
  const spans: TimelineSpan[] = [];
  for (const segment of deriveSegments(checkins, punchHelpers)) {
    const startMin = framedMinute(frame, segment.startMin);
    const endMin = framedMinute(frame, segment.endMin);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    spans.push({ startMin, endMin, tone: "worked" });
  }
  return spans;
}

/**
 * One mark per punch, toned by the caller. (Distinct from Task 4's
 * `punchMarksTimeline`, which builds a whole spec and tones every punch alike.)
 * A non-null atMin already proves the timestamp parsed, so formatCheckinTime
 * cannot hit date-fns' RangeError here.
 */
function punchMarks(
  checkins: Checkin[],
  toneFor: (checkin: Checkin) => "normal" | "alert",
  frame: OvernightFrame
): TimelineMark[] {
  const marks: TimelineMark[] = [];
  for (const checkin of sortCheckinsByTime(checkins, parseDateTimeLocal)) {
    const atMin = framedMinute(frame, minutesFromDateTime(checkin.time));
    if (atMin == null) continue;
    marks.push({ atMin, tone: toneFor(checkin), label: formatCheckinTime(checkin.time) });
  }
  return marks;
}

/**
 * ONE fact, deliberately. The detector writes exactly three keys for this reason
 * (record_issue_flags.py:26-34) and inherits twenty more; the punch time IS the
 * finding, and "First check-in 2:23 PM / Last check-out 2:23 PM / Punch time
 * 2:23 PM" is one timestamp under three labels, none of which says "and then
 * they never punched again".
 */
function narrateSingleCheckin(
  flag: Flag,
  evidence: NarrativeEvidence,
  day: NarrativeDay,
  dateKey: string
): FlagNarrative {
  const punchClock = evidenceTimeText(evidence.punch_time);
  // Without the punch time the whole sentence collapses to "Punched once at —".
  if (punchClock == null) return boundaryFallback(flag, evidence, day, dateKey);

  const frame = overnightFrame(day);
  const punchMin = framedMinute(frame, evidenceMinute(evidence.punch_time));
  const band = narrativeShiftBand(day.shift);
  const window = narrativeWindow(day, band, punchMin == null ? [] : [punchMin]);

  return {
    headline: `Punched once at ${punchClock}, then never again that day.`,
    subline: "There is no matching clock-out, so no hours could be counted for this day.",
    facts: buildFacts([fact("Only punch", punchClock)]),
    timeline:
      window == null || punchMin == null
        ? null
        : {
            window,
            band,
            // Draw only the boundary the flag is about: the lunch band and the
            // late threshold belong to other flags.
            lunch: null,
            threshold: null,
            // A single punch pairs with nothing, so the band is empty by
            // construction — that emptiness is the picture.
            spans: [],
            // The one mark on this axis is the frozen punch, not a re-derived
            // one: this flag exists because the day had exactly one punch, so a
            // calendar that has since been corrected would draw a tick
            // contradicting the headline directly above it. Same pin as
            // UNNOTIFIED_ABSENCE's "Punches" fact. The axis still follows the
            // live calendar (`narrativeWindow` reads day.checkins).
            marks: [{ atMin: punchMin, tone: "alert", label: punchClock }],
          },
  };
}

/**
 * The rogue tick, borrowed rather than reinvented. DayTimeline draws exactly the
 * `rogue` + `unpairedError` presentations as error punches, so routing the panel
 * through the same classifier keeps the two surfaces from disagreeing about
 * which punch is the odd one. The evidence punch is added even when the live day
 * no longer classifies it as unpaired: the panel reports the frozen finding and
 * does not arbitrate against a re-derived calendar.
 */
function unpairedAlertMarks(
  day: NarrativeDay,
  dateKey: string,
  punchMin: Minute | null,
  band: { startMin: Minute; endMin: Minute } | null,
  frame: OvernightFrame
): TimelineMark[] {
  const presentations = classifyUnpairedPresentations(
    day.checkins ?? [],
    {
      dateKey,
      shiftEndMin: band?.endMin ?? null,
      shiftAssigned: day.shift?.shift_assigned === true,
    },
    punchHelpers
  );

  const mins = new Set<Minute>();
  for (const row of presentations) {
    if (row.kind !== "rogue" && row.kind !== "unpairedError") continue;
    const atMin = framedMinute(frame, row.startMin);
    if (atMin != null) mins.add(atMin);
  }
  if (punchMin != null) mins.add(punchMin);

  return [...mins]
    .sort((a, b) => a - b)
    .map((atMin) => ({ atMin, tone: "alert" as const, label: formatMinuteOnDay(dateKey, atMin) }));
}

function narrateUnpairedPunch(
  flag: Flag,
  evidence: NarrativeEvidence,
  day: NarrativeDay,
  dateKey: string
): FlagNarrative {
  const punchClock = evidenceTimeText(evidence.punch_time);
  if (punchClock == null) return boundaryFallback(flag, evidence, day, dateKey);

  const frame = overnightFrame(day);
  const punchMin = framedMinute(frame, evidenceMinute(evidence.punch_time));
  const band = narrativeShiftBand(day.shift);
  const window = narrativeWindow(day, band, punchMin == null ? [] : [punchMin]);
  const marks = unpairedAlertMarks(day, dateKey, punchMin, band, frame);

  return {
    headline: `Punched at ${punchClock}, but it never got matched to a clock-out — the day's other punches paired up fine.`,
    subline: null,
    facts: buildFacts([
      fact("Odd punch", punchClock),
      // A rogue punch has no device branch at all — record_issue_flags.py:47
      // copies whatever the punch carried, which is None for a device that
      // reports no site. An empty "From —" row is exactly the padding this
      // redesign removes, so fact() drops it.
      fact("From", formatBranchLabel(evString(evidence, "custom_device_branch"))),
    ]),
    timeline:
      window == null || !marks.length
        ? null
        : {
            window,
            band,
            lunch: null,
            threshold: null,
            spans: workedSpans(day.checkins ?? [], frame),
            marks,
          },
  };
}

function narrateUnknownDeviceBranch(
  flag: Flag,
  evidence: NarrativeEvidence,
  day: NarrativeDay,
  dateKey: string
): FlagNarrative {
  const count = evNumber(evidence, "unknown_branch_checkins");
  // The count IS the finding, and day.checkins cannot stand in for it — those
  // are the day's punches, not the unlabelled ones.
  if (count == null) return boundaryFallback(flag, evidence, day, dateKey);

  const punches = count === 1 ? "1 punch" : `${count} punches`;
  const checkins = day.checkins ?? [];
  const frame = overnightFrame(day);
  const band = narrativeShiftBand(day.shift);
  // The evidence carries a COUNT and nothing else (record_issue_flags.py:52-62),
  // so WHICH punches were unlabelled can only come from the day's checkin list.
  // With no checkin list there is nothing to point at, and a bare count on an
  // axis would be a chart of one number.
  const window = checkins.length ? narrativeWindow(day, band, []) : null;
  const marks = punchMarks(
    checkins,
    (checkin) => (hasPunchBranch(checkin) ? "normal" : "alert"),
    frame
  );

  return {
    headline: `${punches} today came from a device that didn't report which site it's at.`,
    subline: "This is a device or config problem, not necessarily an employee problem.",
    facts: buildFacts([fact("Unlabelled punches", punches)]),
    timeline:
      window == null || !marks.length
        ? null
        : {
            window,
            band,
            lunch: null,
            threshold: null,
            // The finding is about the punches themselves, not about worked time.
            spans: [],
            marks,
          },
  };
}

/**
 * Badge = the device-side user id. Mirrors the nested-then-top-level lookup in
 * attendance_flag.py:90-103 and flag_identity.py:113-128: Bridge sends the item
 * under `undelivered`, but the identity code still reads the same keys flat, so
 * rows written either way must both resolve here.
 *
 * Only `pin`/`user_id` — those two backends also accept `supabase_log_id` and
 * `custom_supabase_log_id`, but those are opaque row ids; showing one to HR
 * under the label "Badge" would be a wrong answer rather than a missing one.
 */
function undeliveredBadge(evidence: NarrativeEvidence): string | null {
  const sources: NarrativeEvidence[] = [];
  const nested = evidence.undelivered;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    sources.push(nested as NarrativeEvidence);
  }
  sources.push(evidence);

  for (const source of sources) {
    for (const key of ["pin", "user_id"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return null;
}

/**
 * No empty-evidence guard, and it does not need one: the only key this reads for
 * copy is the `reason` that routed us here, nothing is run through a time
 * formatter, and no timeline is drawn — so a blob carrying nothing else degrades
 * to a shorter true sentence rather than a confident row of em-dashes.
 */
function narrateDeliveryFailed(evidence: NarrativeEvidence): FlagNarrative {
  const deviceSn = evString(evidence, "device_sn");
  const badge = undeliveredBadge(evidence);

  return {
    // The company-fallback producer never passes a device_sn, so the headline
    // has to survive without one rather than reading "Device null …".
    headline: deviceSn
      ? `Device ${deviceSn} recorded a punch that never reached HR's records.`
      : "A punch was recorded on a device but never reached HR's records.",
    subline: "A lost record, not a missed check-in — nothing to hold against the employee.",
    facts: buildFacts([
      // device_sn is buried provenance on `single_checkin` and a first-class fact
      // here — same code, opposite treatment. This row is the ONE place in the
      // panel where a device serial is named, because it is the only handle HR
      // has on which box lost the punch.
      fact("Reported by", deviceSn),
      fact("Badge", badge),
    ]),
    // No trustworthy timestamp exists for this punch — that IS the finding — so
    // there is nothing to place on an axis.
    timeline: null,
  };
}

/**
 * An ATTENDANCE_ISSUE whose reason this build does not recognise. The reason is
 * echoed verbatim and unmapped: REASON_LABELS would translate it into a phrase
 * asserting a finding this build cannot vouch for.
 */
function narrateUnreconciledRecord(reason: string): FlagNarrative {
  return {
    headline: "This day's punch data could not be reconciled into complete in/out pairs.",
    subline: null,
    facts: buildFacts([fact("Recorded reason", reason)]),
    timeline: null,
  };
}

function narrateAttendanceIssue(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readEvidence(flag);
  const reason = evidenceReason(evidence);
  // With no reason there is no scenario to narrate — not even the
  // unrecognised-reason sentence, which would assert a reconciliation failure
  // nothing on this flag recorded.
  if (!reason) return boundaryFallback(flag, evidence, day, dateKey);

  switch (reason) {
    case "single_checkin":
      return narrateSingleCheckin(flag, evidence, day, dateKey);
    case "unpaired_punch":
      return narrateUnpairedPunch(flag, evidence, day, dateKey);
    case "unknown_device_branch":
      return narrateUnknownDeviceBranch(flag, evidence, day, dateKey);
    case "delivery_failed":
      return narrateDeliveryFailed(evidence);
    default:
      return narrateUnreconciledRecord(reason);
  }
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
  if (!isEmittedCode(flag.flag_code)) return noDetectorNarrative(flag, evidence);

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
    case "MISSING_TIME":
      return narrateMissingTime(flag, day, dateKey);
    case "UNNOTIFIED_ABSENCE":
    // Same builder, on purpose: one situation, two tenses. The builder reads
    // flag_code to pick the headline, and the evidence shape is identical
    // because intraday writes the same dict it always did.
    case "NO_CHECKIN_YET":
      return narrateUnnotifiedAbsence(flag, day, dateKey);
    case "OFF_SHIFT_PUNCH":
      return buildOffShiftPunchNarrative(flag, day, dateKey);
    case "NON_PRIMARY_SITE_PUNCH":
      return buildNonPrimarySitePunchNarrative(flag, day, dateKey);
    case "ATTENDANCE_ISSUE":
      return narrateAttendanceIssue(flag, day, dateKey);
    default:
      // Emitted codes with no arm of their own. DELIVERY_FAILED is the live
      // example: the Bridge delivery path really does write it, so it gets the
      // formatted label plus the full blob in the disclosure rather than an
      // invented finding — and never noDetectorNarrative, which would tell HR
      // that a code the engine emits isn't a rule it checks.
      return emittedFallbackNarrative(input);
  }
}
