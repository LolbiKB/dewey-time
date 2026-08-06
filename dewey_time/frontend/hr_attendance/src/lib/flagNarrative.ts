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
  formatCheckinTime,
  minutesFromDateTime,
  parseDateTimeLocal,
} from "@/lib/attendanceTime";
import { formatFlagLabel, parseFlagEvidence, type FlagEvidence } from "@/lib/flagLabels";
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

  // No per-code builders exist yet, so every emitted code gets the generic
  // treatment. Task 2 converts this single return into a
  // `switch (flag.flag_code)` whose `default:` arm is this same call; Tasks 3-5
  // then add their own arms to that switch:
  //   Task 2 — LATE_START, LEFT_EARLY, LATE_FROM_LUNCH
  //   Task 3 — MISSING_TIME, UNNOTIFIED_ABSENCE
  //   Task 4 — OFF_SHIFT_PUNCH, NON_PRIMARY_SITE_PUNCH
  //   Task 5 — ATTENDANCE_ISSUE
  //
  // Stub arms are deliberately NOT scaffolded here: eight case labels that all
  // return the same thing as `default:` are dead weight until the task that
  // fills them lands.
  //
  // Codes whose treatment splits by evidence.reason branch on it INSIDE their
  // builder (Global Constraint 7: relevance is scoped to (flag_code, reason) —
  // `device_sn` is buried provenance for `single_checkin` and a first-class
  // fact for `delivery_failed`, same code, opposite treatment). Keeping that
  // second level inside the builder leaves the eventual switch one level deep.
  return emittedFallbackNarrative(input);
}
