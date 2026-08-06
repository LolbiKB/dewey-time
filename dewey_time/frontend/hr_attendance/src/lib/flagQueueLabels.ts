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
import { formatFlagLabel, parseFlagEvidence } from "@/lib/flagLabels";
import type {
  DecisionState,
  FlagDecision,
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
 * "Phnom Penh HQ had no device data on 3 Aug" — the BRANCH_NO_DEVICE_DATA
 * group header. `branch` is expected pre-resolved to a display name
 * (`Employee.branch`, run through `formatBranchLabel` for the `BRANCH-`
 * prefix some records still carry, the same helper `DeviceAlerts.tsx` uses
 * for branch display).
 */
export function branchNoDeviceDataHeader(branch: string, attendanceDate: string): string {
  const label = formatBranchLabel(branch) ?? branch;
  return `${label} had no device data on ${formatDayMonth(attendanceDate)}`;
}

// The five flag codes that can appear in a ROUTINE_CODE group (design doc
// "Triage ranking" table, Routine tier). A dedicated plural phrase per code,
// rather than a generic `formatFlagLabel(...) + "s"`, because naive
// suffixing turns "left early" into "left earlys" and "missing lunch" into
// "missing lunchs".
const ROUTINE_CODE_PLURAL_LABELS: Record<string, string> = {
  LEFT_EARLY: "early departures",
  LATE_START: "late starts",
  LATE_FROM_LUNCH: "late returns from lunch",
  NON_PRIMARY_SITE_PUNCH: "other-site punches",
  MISSING_LUNCH: "missing lunches",
};

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
 * "168 late starts, 6–20 min — and nothing else wrong that day" — the
 * ROUTINE_CODE group header. The minute range is scanned from the members'
 * own flags rather than passed in separately, so the header can never drift
 * from what the group actually contains.
 */
export function routineCodeHeader(flagCode: string, members: QueuePerson[]): string {
  const label =
    ROUTINE_CODE_PLURAL_LABELS[flagCode] ?? `${flagCode.replaceAll("_", " ").toLowerCase()}s`;
  const range = minutesRange(members, flagCode);
  const rangeText = range ? `, ${range.min}–${range.max} min` : "";
  return `${members.length} ${label}${rangeText} — and nothing else wrong that day`;
}

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

export const OUTCOME_LABELS: Record<Outcome, string> = {
  EXCUSED: "Excused",
  UPHELD: "Upheld",
};

export function outcomeLabel(outcome: Outcome): string {
  return OUTCOME_LABELS[outcome];
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
 * the two headers above fits. Both fallbacks below are unreachable against
 * `build_queue`'s output — it always sets `branch` for BRANCH_NO_DEVICE_DATA
 * and `flag_code` for ROUTINE_CODE — but the contract types both as nullable
 * because the *other* group type leaves them null, so they are handled rather
 * than asserted away.
 */
export function groupHeadline(entry: Extract<QueueEntry, { kind: "group" }>): string {
  if (entry.group_type === "BRANCH_NO_DEVICE_DATA") {
    return branchNoDeviceDataHeader(entry.branch ?? "Unknown branch", entry.attendance_date);
  }
  return routineCodeHeader(entry.flag_code ?? "flag", entry.members);
}

/**
 * The one line that stands for a person in the list: their worst flag that is
 * still waiting on someone. `flags` arrives worst-first from `build_queue`, so
 * the first non-`matched` entry is the worst unresolved one; a fully decided
 * person (who should not be in the queue at all) falls back to their worst
 * flag overall rather than rendering blank.
 *
 * Reuses `formatFlagLabel` rather than defining a second set of flag-code
 * labels — that helper already renders `MISSING_TIME` as "Missing 3h 12m",
 * distinguishes a holiday punch from a day-off punch, and carries
 * `ATTENDANCE_ISSUE`'s reason sub-label. A divergent second set would have HR
 * reading two different names for the same flag on two screens.
 */
export function personHeadline(person: QueuePerson): string {
  const worst = person.flags.find((f) => f.decision_state !== "matched") ?? person.flags[0];
  if (!worst) return "";
  return formatFlagLabel(worst.flag_code, parseFlagEvidence(worst.evidence));
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

/** Breaks a cause group into its member rows when it turns out not to be uniform. */
export const DECIDE_ONE_BY_ONE_LABEL = "Decide one by one";

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
