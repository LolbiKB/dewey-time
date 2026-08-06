/**
 * All HR-facing copy for the flag triage queue: tier names, the closed
 * reason vocabulary, cause-group headers, and orphan-state summaries. Pure
 * string formatting — no fetching, no state.
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
import type { QueuePerson, Reason, Tier } from "@/types/flags";

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
