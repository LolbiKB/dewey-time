/** Human labels for Attendance Flag codes (AUTO + manual). */
export const FLAG_LABELS: Record<string, string> = {
  LATE_START: "Late start",
  LATE_FROM_LUNCH: "Late from lunch",
  LEFT_EARLY: "Left early",
  MISSING_TIME: "Missing time",
  ATTENDANCE_ISSUE: "Attendance record issue",
  NO_CHECKIN_YET: "No check-in yet",
  MISSING_LUNCH: "Missing lunch",
  MISSING_IN_OR_OUT: "Missing in or out",
  UNNOTIFIED_ABSENCE: "Did not show up",
  OFF_SHIFT_PUNCH: "Punched on day off",
  NON_PRIMARY_SITE_PUNCH: "Wrong site",
  UNKNOWN_DEVICE_BRANCH: "Unknown device branch",
  DELIVERY_FAILED: "Delivery failed",
};

const RECORD_ISSUE_SUBLABELS: Record<string, string> = {
  single_checkin: "Single punch only",
  unpaired_punch: "Unpaired punch",
  delivery_failed: "Punch not saved to HR",
  unknown_device_branch: "Unknown device location",
  off_shift_punch: "Punched on a day off",
  missing_lunch_pair: "Could not verify lunch punches",
};

export type FlagEvidence = {
  minutes?: number;
  reason?: string;
  interval_start?: string;
  interval_end?: string;
  kind?: string;
};

export function formatMissingDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `Missing ${h}h ${m}m`;
  if (h > 0) return `Missing ${h}h`;
  return `Missing ${m}m`;
}

export function parseFlagEvidence(evidence: unknown): FlagEvidence | null {
  if (!evidence) return null;
  if (typeof evidence === "object" && evidence !== null) {
    return evidence as FlagEvidence;
  }
  if (typeof evidence === "string") {
    try {
      return JSON.parse(evidence) as FlagEvidence;
    } catch {
      return null;
    }
  }
  return null;
}

export function formatFlagLabel(flagCode: string, evidence?: FlagEvidence | null): string {
  if (flagCode === "MISSING_TIME" && evidence?.minutes != null && evidence.minutes > 0) {
    return formatMissingDuration(evidence.minutes);
  }
  if (flagCode === "ATTENDANCE_ISSUE" && evidence?.reason) {
    const sub = RECORD_ISSUE_SUBLABELS[evidence.reason];
    if (sub) return `Attendance record issue · ${sub}`;
  }
  return FLAG_LABELS[flagCode] ?? flagCode.replaceAll("_", " ").toLowerCase();
}

export const FLAG_FILTER_GROUPS = {
  absence: ["UNNOTIFIED_ABSENCE", "MISSING_TIME"],
  schedule: ["LATE_START", "LATE_FROM_LUNCH", "LEFT_EARLY"],
  wrongSite: ["NON_PRIMARY_SITE_PUNCH"],
  offShift: ["OFF_SHIFT_PUNCH"],
  record: ["ATTENDANCE_ISSUE", "MISSING_IN_OR_OUT", "UNKNOWN_DEVICE_BRANCH", "DELIVERY_FAILED"],
} as const;
