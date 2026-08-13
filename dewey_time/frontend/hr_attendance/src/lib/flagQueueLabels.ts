/**
 * All HR-facing copy for the flag triage queue: tier names, the closed
 * reason vocabulary, outcome and decision-state wording, cause-group and
 * person headlines, device-outage cards, bulk-action labels, and
 * orphan-state summaries. Pure string formatting — no fetching, no state.
 *
 * `ui/FlagQueuePage.tsx`, `ui/FlagQueueList.tsx` and `ui/FlagDecisionPanel.tsx`
 * hold no copy of their own — every string they render is imported from here,
 * so the queue's wording can be reviewed in one file rather than three.
 *
 * Group headers never name a device serial. No device↔branch registry
 * exists in this app: `Employee Checkin.custom_device_serial_number` is
 * unused, and `Device Sync Status`/`Device Closeout Alert` are both keyed by
 * branch, not device id (design doc "Must not do" #6; Global Constraint 9).
 * Branch is therefore the finest granularity the data can support, and this
 * module's copy is written to that ceiling rather than implying a precision
 * the queue does not have — e.g. "Phnom Penh HQ had no device data on
 * 3 Aug", never a serial like "ZK-A4-014". `branchNoDeviceDataHeader` below
 * has no parameter a serial could even arrive through.
 */
import { format } from "date-fns";

import { formatBranchLabel, parseDateKey } from "@/lib/attendanceTime";
import type { PendingDecision } from "@/lib/flagDecisionState";
import { formatFlagContextDate } from "@/lib/flagDetails";
import { formatFlagLabel, formatMissingDuration, parseFlagEvidence } from "@/lib/flagLabels";
import type { Strip } from "@/lib/flagStrip";
import type {
  DecisionState,
  FlagDecision,
  FlagOut,
  Outcome,
  QueueEntry,
  QueuePayload,
  QueuePerson,
  Reason,
  Tier,
} from "@/types/flags";

export const TIER_LABELS: Record<Tier, string> = {
  act: "Act",
  review: "Review",
  routine: "Routine",
};

export function tierLabel(tier: Tier): string {
  return TIER_LABELS[tier];
}

/** Wording lifted verbatim from the design doc's `reason` vocabulary table. */
export const REASON_LABELS: Record<Reason, string> = {
  APPROVED_LEAVE: "Approved leave or holiday",
  DEVICE_OR_DATA_FAULT: "Device or data fault",
  MANAGER_APPROVED: "Manager pre-approved",
  SCHEDULE_WRONG: "Schedule was wrong",
  COVERING_OTHER_SITE: "Covering another site",
  GENUINE_VIOLATION: "Genuine violation",
  OTHER: "Other",
};

export function reasonLabel(reason: Reason): string {
  return REASON_LABELS[reason];
}

function formatDayMonth(attendanceDate: string): string {
  // `parseDateKey` parses "YYYY-MM-DD" at local noon, sidestepping the
  // UTC/local off-by-one a plain `new Date(attendanceDate)` risks on exactly
  // the date boundary this queue is triaging (attendanceTime.ts:66-69).
  return format(parseDateKey(attendanceDate), "d MMM");
}

/**
 * "3 Aug" — which day one flag card is deciding.
 *
 * An entry can now hold several days of the same code, so each card has to name
 * its own: without it a pattern member is three identical "Late by 12 min"
 * cards and HR cannot tell which morning they are excusing. Short form because
 * it sits beside the flag label, under a header that already spells the range
 * out in full (`formatFlagContextDate`).
 */
export function flagDayLabel(attendanceDate: string): string {
  return formatDayMonth(attendanceDate);
}

/**
 * "Phnom Penh HQ had no device data on 3 Aug" — the BRANCH_NO_DEVICE_DATA
 * group header. `branch` is expected pre-resolved to a display name
 * (`Employee.branch`, run through `formatBranchLabel` for the `BRANCH-`
 * prefix some records still carry, the same helper `DeviceAlerts.tsx` uses
 * for branch display).
 *
 * A missing date drops the clause rather than being coerced into one: every
 * group in the contract types `attendance_date` as nullable, and `format`
 * throws `RangeError: Invalid time value` on a date it cannot parse. The
 * caller's old `?? ""` read like a guard and was the opposite — it handed the
 * formatter the one string guaranteed to throw, taking the whole list down
 * rather than wording one header badly.
 */
export function branchNoDeviceDataHeader(
  branch: string,
  attendanceDate: string | null,
  dates: string[] = [],
): string {
  const label = formatBranchLabel(branch) ?? branch;
  // A device that stopped reporting is one fact spanning however many days it was
  // down, so the headline counts days rather than naming one. Naming the first and
  // leaving the rest implied is how eleven rows all read "…on 28 Jul" and looked
  // like eleven separate incidents.
  if (dates.length > 1) return `${label} had no device data on ${dates.length} days`;
  const day = dates[0] ?? attendanceDate;
  if (!day) return `${label} had no device data`;
  return `${label} had no device data on ${formatDayMonth(day)}`;
}

/**
 * "26 Jul – 5 Aug" for a span, the single day for one, "" for nothing.
 *
 * An en dash, not a hyphen: these sit next to "4h 30m" and a hyphen between two
 * dates reads as subtraction at 12px.
 */
export function dateSpanLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const first = formatDayMonth(dates[0]);
  if (dates.length === 1) return first;
  return `${first} – ${formatDayMonth(dates[dates.length - 1])}`;
}

/**
 * A dedicated plural phrase per code, rather than a generic
 * `formatFlagLabel(...) + "s"`, because naive suffixing turns "left early" into
 * "left earlys" and "missing lunch" into "missing lunchs".
 */
const FLAG_CODE_PLURAL_LABELS: Record<string, string> = {
  LEFT_EARLY: "early departures",
  LATE_START: "late starts",
  LATE_FROM_LUNCH: "late returns from lunch",
  NON_PRIMARY_SITE_PUNCH: "other-site punches",
  MISSING_LUNCH: "missing lunches",
  MISSING_TIME: "gaps in the day",
  OFF_SHIFT_PUNCH: "off-shift punches",
  DELIVERY_FAILED: "delivery failures",
  UNKNOWN_DEVICE_BRANCH: "unknown-device punches",
};

function pluralFlagLabel(flagCode: string): string {
  return FLAG_CODE_PLURAL_LABELS[flagCode] ?? `${flagCode.replaceAll("_", " ").toLowerCase()}s`;
}

/**
 * Repeat-pattern group titles. `unit` is what one occurrence is called — a late
 * start happens in the morning, a gap does not, and "8 people · 34 mornings"
 * only reads as English when the noun fits the code.
 *
 * Every code here is one whose flags can reach routine or review tier; act-tier
 * flags never form patterns (`PATTERN_TIERS` in flag_grouping.py), so
 * UNNOTIFIED_ABSENCE and ATTENDANCE_ISSUE are deliberately absent.
 */
const REPEAT_PATTERN_LABELS: Record<string, { title: string; unit: string }> = {
  LATE_START: { title: "Repeatedly late", unit: "mornings" },
  LEFT_EARLY: { title: "Repeatedly leaving early", unit: "days" },
  LATE_FROM_LUNCH: { title: "Repeatedly late back from lunch", unit: "days" },
  NON_PRIMARY_SITE_PUNCH: { title: "Repeatedly punching at another site", unit: "days" },
  MISSING_TIME: { title: "Repeated gaps in the day", unit: "days" },
  OFF_SHIFT_PUNCH: { title: "Repeatedly punching off shift", unit: "days" },
  MISSING_LUNCH: { title: "Repeatedly no lunch recorded", unit: "days" },
  DELIVERY_FAILED: { title: "Repeated delivery failures", unit: "days" },
  UNKNOWN_DEVICE_BRANCH: { title: "Repeated unknown-device punches", unit: "days" },
};

function repeatPatternLabel(flagCode: string): { title: string; unit: string } {
  return (
    REPEAT_PATTERN_LABELS[flagCode] ?? {
      title: `Repeated ${flagCode.replaceAll("_", " ").toLowerCase()}`,
      unit: "days",
    }
  );
}

function minutesRange(members: QueuePerson[], flagCode: string): { min: number; max: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const person of members) {
    for (const f of person.flags) {
      if (f.flag_code !== flagCode) continue;
      const minutes = f.evidence.minutes;
      if (typeof minutes !== "number") continue;
      min = min === null ? minutes : Math.min(min, minutes);
      max = max === null ? minutes : Math.max(max, minutes);
    }
  }
  return min === null || max === null ? null : { min, max };
}

/**
 * "168 one-off late starts, 6–20 min — and nothing else wrong that day".
 *
 * "one-off" is true by construction, not decoration: a repeat offender leaves
 * this pool by precedence (REPEAT_PATTERN outranks ROUTINE_CODE), so everyone
 * left here hit this code on fewer than PATTERN_MIN_DAYS days.
 */
export function routineCodeHeader(flagCode: string, members: QueuePerson[]): string {
  const label = pluralFlagLabel(flagCode);
  const range = minutesRange(members, flagCode);
  const rangeText = range ? `, ${range.min}–${range.max} min` : "";
  return `${members.length} one-off ${label}${rangeText} — and nothing else wrong that day`;
}

/** "Repeatedly late" — a pattern group's title. Its size goes in the subline. */
export function repeatPatternHeader(flagCode: string): string {
  return repeatPatternLabel(flagCode).title;
}

/**
 * The second line of a group row. Both dimensions where both matter — "8 people
 * · 34 mornings" — because a pattern group's size is two numbers and reporting
 * only one is how the header started disagreeing with the list in the first
 * place.
 */
export function groupSubline(entry: Extract<QueueEntry, { kind: "group" }>): string {
  const people = `${entry.members.length} ${entry.members.length === 1 ? "person" : "people"}`;
  if (entry.group_type === "REPEAT_PATTERN") {
    const occurrences = entry.members.reduce((total, member) => total + member.flags.length, 0);
    const { unit } = repeatPatternLabel(entry.flag_code ?? "");
    return `${people} · ${occurrences} ${unit}`;
  }
  // A multi-day outage's headline says how MANY days; the subline says which,
  // because "11 days" alone leaves HR unable to tell a fault that ended last week
  // from one still running this morning.
  if (entry.group_type === "BRANCH_NO_DEVICE_DATA" && entry.dates.length > 1) {
    return `${people} · ${dateSpanLabel(entry.dates)}`;
  }
  return people;
}

/**
 * "also 1 outlier" / "also 2 elsewhere" — the safeguard that makes the per-flag
 * invariant safe in practice. Without it, HR excuses the repeatedly-late group,
 * believes a person is dealt with, and never sees their three-hour absence.
 *
 * "outlier" only when EVERY other entry is a lone person row, because that is
 * the only case where the word is true: a lone row holds the flags that fitted
 * no pattern. Mixed, or another group, reads as the vaguer "elsewhere" rather
 * than claiming a precision the count does not have.
 */
export function crossReferenceLabel(person: QueuePerson): string | null {
  if (person.also_count < 1) return null;
  if (person.also_outlier_count === person.also_count) {
    return `also ${person.also_count} outlier${person.also_count === 1 ? "" : "s"}`;
  }
  return `also ${person.also_count} elsewhere`;
}

/**
 * The Open chip's number, and the only place allowed to format it.
 *
 * `open` counts the flags the scan returned, so once the scan hits its row cap
 * the number IS the cap — 5000 today, 5000 tomorrow, and still 5000 after HR
 * decides a thousand of them. Rendered bare it reads as a measured total and
 * quietly teaches everyone that the numbers on this page are approximate, which
 * is the one lesson that must not reach the evidence panel.
 *
 * "+" is the whole fix: it says "at least this many" without claiming a total
 * nobody has counted. `openCountAria` carries the same fact to a screen reader,
 * where a trailing plus is easily lost.
 */
export function openCountLabel(counts: QueuePayload["counts"]): string {
  return counts.open_capped ? `${counts.open}+` : `${counts.open}`;
}

export function openCountAria(counts: QueuePayload["counts"]): string | undefined {
  if (!counts.open_capped) return undefined;
  return `Open: at least ${counts.open}. The scan reached its limit, so the true total is higher.`;
}

/**
 * "40 people · 12 rows". The header and the list must count the same thing:
 * before nesting, `people` counted distinct employees while the list showed one
 * row per person-DAY, so the toolbar read "40 people with something open" above
 * two hundred rows.
 */
export function queueHeaderDescription(counts: QueuePayload["counts"]): string {
  const people = `${counts.people} ${counts.people === 1 ? "person" : "people"}`;
  const rows = `${counts.rows} ${counts.rows === 1 ? "row" : "rows"}`;
  return `${people} · ${rows}`;
}

/**
 * Copy for the device-outage band.
 *
 * The band exists because a device outage is not a judgment about anybody, and
 * its wording has to keep saying so — an amber strip carrying 256 people's
 * names reads as an accusation unless it states otherwise in words.
 *
 * Every string here observes this module's device rule: branch is the finest
 * granularity the data supports (`_outage_branch_dates`: "nothing in this app
 * maps a device to a branch"), so none of these functions takes a parameter a
 * serial could arrive through.
 */
export const OUTAGE_NOT_A_JUDGMENT = "the machines didn't record — nobody is being judged here";

export const OUTAGE_CEILING_NOTE =
  "Branch and days only — nothing here maps a device to a branch.";

export const DEVICE_HEALTH_LABEL = "Device health";

/** The band's accessible name — the only thing a screen-reader user hears on
 *  entering the landmark, so it is copy like any other string here. */
export const OUTAGE_BAND_LABEL = "Device outages";

/** Unreachable against build_queue's output, which always sets `branch` for a
 *  BRANCH_NO_DEVICE_DATA group, but the contract types it nullable. */
export const UNKNOWN_BRANCH_LABEL = "Unknown branch";

/** The checkbox's only accessible name. Without it the control is unnamed. */
export function outageBranchCheckboxLabel(branch: string): string {
  return `Include ${branch}`;
}

/** Shown while the write is in flight. A greyed button still reading "Excuse
 *  157 people" gives no sign that anything is happening during a multi-second
 *  write over thousands of flags. */
export const OUTAGE_EXCUSING_LABEL = "Excusing…";

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * @param outageBranchCount EVERY branch in the outage — never a filtered or
 *   still-checked subset. This sentence states what happened; it must not move
 *   when the user unchecks a box, or the page reports "1 branch had no device
 *   data" when thirteen did.
 * @param affectedPeopleCount everyone the outage touched. Deliberately NOT the
 *   count the excuse button shows: that one is `coveredEmployeeCount`, which is
 *   smaller. "affected" is what makes the two numbers legible side by side.
 */
export function outageBandHeadline(
  outageBranchCount: number,
  affectedPeopleCount: number,
): string {
  const branches = plural(outageBranchCount, "branch", "branches");
  return `${branches} had no device data · ${plural(affectedPeopleCount, "person", "people")} affected`;
}

export function outageBandSubline(dates: string[], flagCount: number): string {
  // dateSpanLabel returns "" for an empty array, which would leave a dangling
  // " · " at the head of the line. personSubline has a dedicated test for this
  // same failure; the guard is one line.
  const span = dateSpanLabel(dates);
  const head = span ? `${span} · ` : "";
  return `${head}${plural(flagCount, "flag", "flags")} · ${OUTAGE_NOT_A_JUDGMENT}`;
}

export function outageBranchDays(dayCount: number): string {
  return `${plural(dayCount, "day", "days")} with no sync row`;
}

export function outageBranchSummary(affectedPeopleCount: number, flagCount: number): string {
  return `${plural(affectedPeopleCount, "person", "people")} · ${plural(flagCount, "flag", "flags")}`;
}

/** @param outageBranchCount every branch, not the checked subset — "Review 13"
 *  must not become "Review 4" as boxes are unchecked. */
export function outageReviewLabel(outageBranchCount: number): string {
  return `Review ${plural(outageBranchCount, "branch", "branches")}`;
}

/**
 * The band's write action.
 *
 * Three states, not two. Zero-with-nothing-selected and zero-with-nothing-left
 * are different facts and must not share words: "Nothing LEFT to excuse" over an
 * empty selection reads as "this outage has already been handled", when the user
 * has merely unchecked everything to start again. "Left" is a completion word.
 *
 * @param coveredPeopleCount MUST be `outageWrite(...).coveredEmployeeCount` —
 *   Global Constraint 4. Never `branchCount`, never a raw member count.
 * @param flagCount MUST be `outageWrite(...).identities.length`.
 * @param selectedBranchCount how many branches are still checked.
 */
export function outageExcuseLabel(
  coveredPeopleCount: number,
  flagCount: number,
  selectedBranchCount: number,
): string {
  if (selectedBranchCount === 0) return "Select a branch to excuse";
  if (flagCount === 0) return "Nothing left to excuse";
  return `Excuse ${plural(coveredPeopleCount, "person", "people")} · ${plural(flagCount, "flag", "flags")}`;
}

/**
 * Replaces `queueHeaderDescription` on this page.
 *
 * "389 people · 147 rows" counted the outage members among the people waiting on
 * HR, which is the specific lie the band exists to end: 256 of those 389 are
 * waiting on a machine, and no amount of HR attention moves them.
 *
 * `rows` survives the rewrite. It was added deliberately in 20c016fc and fixed
 * for tier filters in 38fbea19, and `queueHeaderDescription`'s own docstring
 * explains why people-only counting misleads above a list that can hold one row
 * for several people. Dropping it here would silently undo both commits.
 *
 * @param includeDecided whether the `Decided` toggle is on. REQUIRED, and
 *   deliberately not defaulted: it is the one control that changes WHO
 *   `queuePeople` counts, so a caller that forgets it must not silently get the
 *   wrong sentence. With it on, `queuePeopleCount(queue)` includes people whose
 *   flags are already settled, and "N people need a decision" is then false
 *   about every one of them — SHOWING_DECIDED_MESSAGE below the header
 *   mitigates that and does not correct it. So the claim is dropped rather
 *   than qualified, and the head falls back to the neutral count the page
 *   carried before this sentence existed.
 */
export function queueSplitDescription(
  queuePeople: number,
  queueRows: number,
  outagePeople: number,
  includeDecided: boolean,
): string {
  const head = splitHead(queuePeople, queueRows, includeDecided);
  if (outagePeople === 0) return head;
  return `${head} · ${outagePeople.toLocaleString("en-US")} waiting on a device fault`;
}

function splitHead(queuePeople: number, queueRows: number, includeDecided: boolean): string {
  if (includeDecided) {
    // "Nothing to show", not "Nothing needs a decision": with the toggle on a
    // settled person is a row this list WOULD have shown, so an empty queue is
    // a statement about the list, not about anyone's workload.
    if (queuePeople === 0) return "Nothing to show";
    return `${plural(queuePeople, "person", "people")} · ${plural(queueRows, "row", "rows")}`;
  }
  if (queuePeople === 0) return "Nothing needs a decision";
  return `${plural(queuePeople, "person needs", "people need")} a decision · ${plural(queueRows, "row", "rows")}`;
}

/** A filter's no-filter option. "All consequences" reads as an inclusion
 *  criterion — "only flags that carry a consequence" — which is the opposite. */
export const TIER_FILTER_ALL_LABEL = "Any consequence";

export const DECIDED_TOGGLE_LABEL = "Decided";

/** The toolbar's three control names. Visually hidden — this page trades the
 *  visible label row for 22px of height — so these are the ONLY names a screen
 *  reader has for the controls that determine the whole list. */
export const RANGE_FROM_LABEL = "From";
export const RANGE_TO_LABEL = "To";
export const TIER_FILTER_LABEL = "Consequence";

/** The affordance on a compressed flag one-liner. Lowercase: it sits inline at
 *  the end of a row of data, not as a button caption. */
export const DECIDE_ONE_LABEL = "decide";

/** When the compressed flags differ in kind, no one label is honest about the
 *  set, and naming only the first would be a lie about the other twelve. */
const MIXED_FINDINGS_LABEL = "Mixed findings";

/**
 * Names the compressed set: "The other 13 — Missing time", or "One more —
 * Mixed findings". Called with a non-empty `rest`, so `codes` is never empty.
 *
 * `formatFlagLabel(code, null)` and not `(code, evidence)`: this heading is
 * about the whole set, and an evidence-derived label ("Missing 3h 20m") is one
 * member's number presented as all of theirs.
 */
export function restHeading(rest: FlagOut[]): string {
  const codes = new Set(rest.map((flag) => flag.flag_code));
  // "The other 1" is not English, and this heading sits above the single most
  // common multi-flag case — a person with exactly two flags.
  const count = rest.length === 1 ? "One more" : `The other ${rest.length}`;
  const label = codes.size === 1 ? formatFlagLabel([...codes][0], null) : MIXED_FINDINGS_LABEL;
  return `${count} — ${label}`;
}

/** Names the pinned footer's target, so a control that never moves is never
 *  ambiguous about what it is about to write. */
export const DECIDING_PREFIX = "Deciding";

/**
 * Names what the pinned footer is about to write: one flag on one day, so it
 * says both — three "Missing 4h" cards in one entry are three different
 * mornings, and the finding alone would not tell them apart.
 *
 * A flag, not an entry. Only a person's footer names its target: a group's
 * submit button already reads "Excuse 9", so "Deciding 9 people" above it would
 * restate the size rather than disambiguate anything.
 */
export function decidingLabel(flag: FlagOut): string {
  return `${formatFlagLabel(flag.flag_code, parseFlagEvidence(flag.evidence))} · ${flagDayLabel(flag.attendance_date)}`;
}

export function narrowRangeLabel(days: number): string {
  return `Last ${plural(days, "day", "days")}`;
}

/**
 * The capped notice, as a control rather than a lecture.
 *
 * The old copy named two levers ("narrow the dates, or filter by consequence")
 * and offered neither, in the loudest colour on the page, on a queue where
 * capping is structural and therefore never clears. A permanent unactionable
 * warning teaches people to skip that colour.
 */
export function cappedHeadline(open: number): string {
  return `Showing the newest ${open.toLocaleString("en-US")} flags`;
}

export const CAPPED_EXPLAINER =
  "Older days in this range aren't loaded. Narrow the dates to reach them.";

export const NOTHING_WAITING_TITLE = "Nothing waiting";

export function nothingWaitingDetail(startDate: string, endDate: string): string {
  return `Every flag between ${formatFlagContextDate(startDate)} and ${formatFlagContextDate(endDate)} has a decision.`;
}

export function showDecidedLabel(count: number): string {
  return `Show the ${count} decided`;
}

/** The skeleton rows' accessible name while the queue is loading — Global
 *  Constraint 2 reaches `aria-label` text too, not just visible copy. */
export const QUEUE_LOADING_LABEL = "Loading flags";

/**
 * Orphan-state summaries for the two counts `get_flag_queue` returns under
 * `orphans`. Both describe a past decision, never an action the toolbar can
 * take — see the design doc's "Orphaning" table (`orphaned_flag_gone`,
 * `orphaned_evidence_changed`).
 */
export function orphanedFlagGoneSummary(count: number): string {
  const noun = count === 1 ? "decision" : "decisions";
  const verb = count === 1 ? "has" : "have";
  return `${count} ${noun} no longer ${verb} a matching flag — kept for audit, not shown in the queue.`;
}

export function orphanedEvidenceChangedSummary(count: number): string {
  const noun = count === 1 ? "flag" : "flags";
  const pronoun = count === 1 ? "it was" : "they were";
  const object = count === 1 ? "it" : "them";
  return `${count} ${noun} changed since ${pronoun} decided — review ${object} again.`;
}

/** The two outcomes `decide_flags` accepts. Order is the button order. */
export const OUTCOME_OPTIONS: readonly Outcome[] = ["EXCUSED", "UPHELD"];

/**
 * Past tense — for describing a decision that has already been made
 * ("Excused — Device or data fault"). Never put these on a button: a control
 * that reads "Excused 39" describes a state that does not exist yet.
 */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  EXCUSED: "Excused",
  UPHELD: "Upheld",
};

export function outcomeLabel(outcome: Outcome): string {
  return OUTCOME_LABELS[outcome];
}

/**
 * Imperative — for buttons and menu actions, which name the thing the click
 * will do: "Excuse 39", not "Excused 39". The pair exists because the same
 * outcome needs both voices, and using one where the other belongs is a
 * mistake a reader notices immediately but a type checker never will.
 */
export const OUTCOME_ACTION_LABELS: Record<Outcome, string> = {
  EXCUSED: "Excuse",
  UPHELD: "Uphold",
};

export function outcomeActionLabel(outcome: Outcome): string {
  return OUTCOME_ACTION_LABELS[outcome];
}

/**
 * The seven reasons, in the `REASONS` order `flag_decision_api.py` declares
 * them — the same order the reason picker offers. Separate from
 * `REASON_LABELS` on purpose: a `Record` has no guaranteed iteration order
 * for a UI to depend on, and `flagQueueLabels.test.ts` asserts the two cover
 * exactly the same set so neither can rot without the other.
 */
export const REASON_OPTIONS: readonly Reason[] = [
  "APPROVED_LEAVE",
  "DEVICE_OR_DATA_FAULT",
  "MANAGER_APPROVED",
  "SCHEDULE_WRONG",
  "COVERING_OTHER_SITE",
  "GENUINE_VIOLATION",
  "OTHER",
];

/**
 * The three states a flag can be in for HR. "Awaiting decision" rather than
 * "Not decided" because the queue's whole claim is that these are waiting on
 * a person, not that they were skipped.
 */
export const DECISION_STATE_LABELS: Record<DecisionState, string> = {
  undecided: "Awaiting decision",
  matched: "Decided",
  needs_re_review: "Needs re-review",
};

export function decisionStateLabel(state: DecisionState): string {
  return DECISION_STATE_LABELS[state];
}

/**
 * The headline for a cause group, dispatched on `group_type` to whichever of
 * the headers above fits. The BRANCH_NO_DEVICE_DATA and ROUTINE_CODE
 * fallbacks below are unreachable against `build_queue`'s output — it always
 * sets `branch` for BRANCH_NO_DEVICE_DATA and `flag_code` for the other two
 * group types — but the contract types both as nullable because some *other*
 * group type leaves them null, so they are handled rather than asserted away.
 */
export function groupHeadline(entry: Extract<QueueEntry, { kind: "group" }>): string {
  if (entry.group_type === "BRANCH_NO_DEVICE_DATA") {
    return branchNoDeviceDataHeader(
      entry.branch ?? "Unknown branch",
      entry.attendance_date,
      entry.dates,
    );
  }
  if (entry.group_type === "REPEAT_PATTERN") {
    return repeatPatternHeader(entry.flag_code ?? "flag");
  }
  return routineCodeHeader(entry.flag_code ?? "flag", entry.members);
}

/**
 * What the decision surface is called when it is a modal rather than a column.
 *
 * The split's panel is titled by its `aria-label` alone ("Selected flag") and
 * needs nothing visible — the row it belongs to is still on screen beside it.
 * A sheet covers that row, so it has to name the thing being decided. Same
 * text as the list row's own headline, so the tap and what it opened agree.
 */
export function decisionSurfaceTitle(entry: QueueEntry): string {
  return entry.kind === "group" ? groupHeadline(entry) : entry.employee_name;
}

/**
 * The one line that stands for a person in the list.
 *
 * `flags` arrives worst-first from `build_queue`, so the first non-`matched`
 * entry is the worst unresolved one; a fully decided person — which the queue
 * does list when HR asks for decided people — falls back to their worst flag
 * overall rather than rendering blank.
 *
 * An entry can now hold several days of the same code (a pattern member, or a
 * person whose repeat did not reach a group). Naming only the worst would
 * report "five late mornings" as "Late by 31 min" — losing the very fact the
 * nesting spec says HR most wants to know.
 *
 * The "worst" figure renders through `formatMissingDuration` for MISSING_TIME
 * — the same helper `formatFlagLabel` uses for its single-flag "Missing 3h
 * 12m" — rather than the raw minute count. Without that, a repeat member
 * would read "3 gaps in the day · worst 192 min" beside a panel that calls
 * the identical flag "3h 12m": two names for the same flag on two screens.
 * Codes that are genuinely minutes (late starts, early departures) keep plain
 * minutes, because that IS their unit everywhere else.
 */
export function personHeadline(person: QueuePerson): string {
  const unresolved = person.flags.filter((f) => f.decision_state !== "matched");
  const shown = unresolved.length > 0 ? unresolved : person.flags;
  const worst = shown[0];
  if (!worst) return "";

  const sameCode = shown.filter((f) => f.flag_code === worst.flag_code);
  if (sameCode.length < 2) {
    return formatFlagLabel(worst.flag_code, parseFlagEvidence(worst.evidence));
  }

  const minutes = sameCode
    .map((f) => f.evidence.minutes)
    .filter((value): value is number => typeof value === "number");
  const summary = `${sameCode.length} ${pluralFlagLabel(worst.flag_code)}`;
  if (minutes.length === 0) return summary;

  const worstMinutes = Math.max(...minutes);
  const worstText =
    worst.flag_code === "MISSING_TIME"
      ? formatMissingDuration(worstMinutes).replace(/^Missing /, "")
      : `${worstMinutes} min`;
  return `${summary} · worst ${worstText}`;
}

/**
 * The strip's only accessible name. Its cells are hidden: at 6px they are not a
 * click target and the sub-line has already given the reader the finding in
 * words — the strip is reinforcement, so it takes one summary and no more.
 */
export function stripAriaLabel(strip: Strip): string {
  const days = `${strip.flaggedCount} flagged ${strip.flaggedCount === 1 ? "day" : "days"}`;
  return `${days} in the last ${strip.cells.length}`;
}

/**
 * A widened range can produce a row whose sub-line names a serious flag while
 * the strip is all green — the flag is older than the window. This marker is
 * what keeps that honest. The sub-line remains driven by the person's worst flag
 * across the WHOLE range, not the strip's window.
 *
 * `count` is DAYS (`Strip.earlierCount`), the same unit as the cells this sits
 * beside and as `stripAriaLabel`'s "N flagged days" above. The noun stays
 * implied rather than printed: the marker follows a 117px strip of day cells in
 * a 352px pane, and "+2 earlier days" is what starts truncating names.
 */
export function earlierMarkerLabel(count: number): string | null {
  return count > 0 ? `+${count} earlier` : null;
}

/**
 * "+2" — the member faces a group row had no room for, beside
 * `earlierMarkerLabel` so the queue's two "+N" affixes follow one rule from one
 * file rather than setting two precedents in the same row. Bare on purpose: it
 * sits at the end of a row of faces, where "+2 more people" would out-argue the
 * headline, and `groupSubline` has already led with "N people".
 */
export function hiddenMemberLabel(count: number): string | null {
  return count > 0 ? `+${count}` : null;
}

/**
 * The day a person row names, or null where naming one would be wrong.
 *
 * A person row names the day; a member of a pattern group does not, because
 * naming one of four mornings would be wrong for the other three.
 * `dates.length === 1` is the honest test for which case this is. With no
 * finding to date there is no day either — a bare "Thu 6 Aug" beside the
 * employee id would read as a person who is in the queue for the sixth.
 *
 * Split out of `personSubline` because the row DRAWS the two halves as two
 * separate facts: the identity block's width ladder can then drop the day whole
 * on a narrow phone, where one joined string was cut mid-word instead.
 */
export function personDayLabel(person: QueuePerson): string | null {
  if (!personHeadline(person) || person.dates.length !== 1) return null;
  return format(parseDateKey(person.dates[0]), "EEE d MMM");
}

/**
 * The row's second line, joined — what a screen reader is told.
 *
 * The two halves are drawn separately (see `personDayLabel`) and spoken
 * together, both off this one rule, so the line and the label can never come to
 * disagree about whether the day is nameable.
 */
export function personSubline(person: QueuePerson): string {
  const headline = personHeadline(person);
  const day = personDayLabel(person);
  return day ? `${headline} · ${day}` : headline;
}

/**
 * A decision that is retained but deliberately NOT in force: its flag's
 * evidence fingerprint moved, so the backend put the flag back in the queue as
 * `needs_re_review`. "Previously" is the whole job of this string — it has to
 * read as history, so HR does not take the day as handled. It never contains
 * the word "Decided" (`DECISION_STATE_LABELS.matched`); a test pins that.
 */
export function priorDecisionLabel(decision: FlagDecision): string {
  return `Previously ${outcomeLabel(decision.outcome).toLowerCase()} — ${reasonLabel(decision.reason)}`;
}

/** A live, applied decision — the flag is settled and out of the queue. */
export function appliedDecisionLabel(decision: FlagDecision): string {
  return `${outcomeLabel(decision.outcome)} — ${reasonLabel(decision.reason)}`;
}

/**
 * Reopens the decision form on a flag that already has a live decision. Reads
 * as a correction rather than a fresh judgment because that is what it is: the
 * new decision supersedes the old one and both stay on the record. The verb on
 * the form's own submit button stays `outcomeActionLabel` ("Excuse" / "Uphold"),
 * so this label never has to guess which way HR will go.
 */
export const DECIDE_AGAIN_LABEL = "Decide again";

/**
 * Shown while the queue is also listing people who have nothing outstanding.
 * The list looks wrong without it — rows with no action left on them, in a
 * queue whose entire premise is "these are waiting on you".
 */
export const SHOWING_DECIDED_MESSAGE =
  "Also showing people whose flags are all decided. Decide one again to replace it — the original decision is kept.";

/**
 * A bulk write where some rows landed and some did not — design doc, "Error
 * handling": *"34 of 39 saved — 5 flags changed while you were deciding"*. The
 * failures are named, and the count is the reason rather than a bare "failed":
 * those flags come back as `needs_re_review`, which is a thing to look at, not
 * a thing to retry.
 */
export function partialFailureMessage(saved: number, attempted: number): string {
  const failed = attempted - saved;
  const noun = failed === 1 ? "flag" : "flags";
  return `${saved} of ${attempted} saved — ${failed} ${noun} changed while you were deciding`;
}

/** Repeats the person's last decision across their remaining undecided flags. */
export function applyToRemainingLabel(count: number): string {
  return `Apply to remaining ${count}`;
}

export const SAME_REASON_LABEL = "Same reason applies";

/**
 * The repeat, stating the decision it would apply.
 *
 * Both callers need it and for the same reason — a one-click write should say
 * which write — so it is one function rather than two hand-built sentences that
 * happened to agree. They did agree, character for character, which is exactly
 * how a pair like that drifts without anyone noticing.
 *
 * The person banner offers it in bulk across the remaining flags; the pinned
 * footer button offers it for the one flag on the bottom edge, where it never
 * scrolls away and is therefore permanently one click from a real write.
 */
export function sameReasonWithDecision(decision: PendingDecision): string {
  return `${SAME_REASON_LABEL} — ${outcomeLabel(decision.outcome)}, ${reasonLabel(decision.reason)}`;
}

/** Breaks a cause group into its member rows when it turns out not to be uniform. */
export const DECIDE_ONE_BY_ONE_LABEL = "Decide one by one";

/** …and the way back, so "Decide one by one" is not a one-way door. */
export const SHOW_AS_GROUP_LABEL = "Show as one group";

/** A decide_flags call that failed outright — nothing was written. */
export const DECIDE_FAILED_MESSAGE = "That decision wasn't saved. Nothing has changed.";

type DeviceAlert = QueuePayload["alerts"][number];

/**
 * Headline for a flagless device-outage card. These are read straight from
 * `Device Closeout Alert`, not derived from flags: when a device reports
 * `deferred_offline` or `closure_failed` the company-fallback path skips those
 * employees entirely and generates NO flags, so a queue built only from flag
 * rows is blind to the worst outages and shows a reassuring empty screen.
 *
 * Branch-granularity on purpose, same ceiling as `branchNoDeviceDataHeader`:
 * there is no device↔branch registry in this app, so naming a serial here
 * would assert something the data cannot support (Global Constraint 9). The
 * `last_error` field this alert also carries can contain one, which is exactly
 * why nothing here takes it.
 */
export function deviceAlertHeadline(alert: DeviceAlert): string {
  const branch = formatBranchLabel(alert.branch) ?? alert.branch;
  const when = formatDayMonth(alert.local_date);
  if (alert.status === "deferred_offline") {
    return `${branch} went offline on ${when} — its punches never arrived`;
  }
  if (alert.status === "closure_failed") {
    return `${branch} failed to close out on ${when}`;
  }
  return `${branch} had no device data on ${when}`;
}

/**
 * The sentence under the cards. Written to explain the absence, because the
 * intuitive reading of a short queue during an outage is "a quiet day" — the
 * opposite of the truth.
 */
export const DEVICE_ALERT_EXPLAINER =
  "No attendance flags were generated for these branches and dates. A short queue here means missing data, not a quiet day.";
