import {
  formatCheckinTime,
  formatDurationMinutes,
  parseDateKey,
} from "@/lib/attendanceTime";
import { formatFlagLabel, parseFlagEvidence, type FlagEvidence } from "@/lib/flagLabels";
import type { Flag, FlagStatus, Severity } from "@/types/calendar";
import { format } from "date-fns";

export type EvidenceDetailRow = { label: string; value: string };

const STATUS_LABELS: Record<FlagStatus, string> = {
  OPEN: "Awaiting HR review",
  EXPLAINED: "Employee explained",
  APPROVED: "Approved by HR",
  REJECTED: "Rejected by HR",
  CLOSED: "Closed",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Critical",
  WARNING: "Warning",
  INFO: "Info",
};

const REASON_LABELS: Record<string, string> = {
  single_checkin: "Single punch only",
  unpaired_punch: "Unpaired punch",
  delivery_failed: "Punch not saved to HR",
  unknown_device_branch: "Unknown device location",
  off_shift_punch: "Punched on a day off",
  holiday_has_checkins: "Punched on a holiday",
  off_shift_has_checkins: "Punched with no shift assigned",
  missing_lunch_pair: "Could not verify lunch punches",
};

const FLAG_SUMMARIES: Record<string, string> = {
  LATE_START:
    "This employee's first paired check-in was after shift start, including the effective grace period.",
  LATE_FROM_LUNCH:
    "This employee returned from lunch later than the scheduled lunch end plus grace.",
  LEFT_EARLY:
    "This employee's last check-out was before shift end, after applying the effective grace period.",
  MISSING_TIME:
    "There was an on-shift gap of at least 30 minutes that is not covered by lunch or other expected time away.",
  ATTENDANCE_ISSUE:
    "Punch data for this day could not be fully reconciled (for example a single punch or unpaired sequence).",
  NO_CHECKIN_YET:
    "This is a scheduled shift day and no check-in has been recorded yet. The flag may clear if the employee punches in.",
  OFF_SHIFT_PUNCH:
    "Punches were recorded on a day with no shift assignment (day off, holiday, or outside the schedule window).",
  MISSING_IN_OR_OUT: "Only one punch was recorded on a scheduled shift day.",
  MISSING_LUNCH:
    "A full-day shift with a lunch window had no plausible lunch out/in pair in the punch data.",
  UNNOTIFIED_ABSENCE:
    "No punches were recorded on a scheduled shift day at closeout. Confirm leave, holiday, or absence with the employee.",
  NON_PRIMARY_SITE_PUNCH:
    "At least one punch came from a device branch that does not match the employee's assigned branch.",
  UNKNOWN_DEVICE_BRANCH:
    "At least one punch is missing device branch metadata and could not be validated against the employee site.",
  DELIVERY_FAILED:
    "Device closeout reported punches that did not reach HR. Confirm whether the employee's time should still count.",
};

const TIME_EVIDENCE_KEYS: Record<string, string> = {
  first_in: "First check-in",
  last_out: "Last check-out",
  shift_start: "Shift start",
  shift_end: "Shift end",
  late_threshold: "Late threshold",
  early_threshold: "Early leave threshold",
  interval_start: "Interval start",
  interval_end: "Interval end",
  lunch_out: "Lunch out",
  lunch_in: "Lunch return",
  return_threshold: "Return threshold",
  punch_time: "Punch time",
};

const GRACE_EVIDENCE_KEYS: Record<string, string> = {
  grace_minutes: "Effective grace",
  effective_start_grace_minutes: "Start grace",
  effective_end_grace_minutes: "End grace",
  effective_lunch_return_grace_minutes: "Lunch return grace",
  custom_grace_minutes: "Custom grace",
  late_entry_grace_period: "HRMS late entry grace",
  early_exit_grace_period: "HRMS early exit grace",
};

const EXTRA_EVIDENCE_KEYS: Record<string, string> = {
  non_primary_checkins: "Off-site punches",
  employee_branch: "Employee branch",
  threshold_minutes: "Gap threshold",
};

const SKIP_EVIDENCE_KEYS = new Set([
  "date",
  "on_shift",
  "provisional",
  "checkins_count",
  "shift_type",
  "employee",
  "attendance_date",
]);

export function formatFlagStatusLabel(status: FlagStatus | string | undefined | null): string {
  if (!status) return STATUS_LABELS.OPEN;
  return STATUS_LABELS[status as FlagStatus] ?? status.replaceAll("_", " ").toLowerCase();
}

export function formatSeverityLabel(severity: Severity | string | undefined | null): string {
  if (!severity) return SEVERITY_LABELS.WARNING;
  return SEVERITY_LABELS[severity as Severity] ?? severity.replaceAll("_", " ").toLowerCase();
}

export function flagIsProvisional(flag: Flag): boolean {
  return flag.is_provisional === true || flag.day_closed === 0;
}

export function flagFinalizationLabel(flag: Flag): string | null {
  if (flagIsProvisional(flag)) return "Provisional until closeout";
  if (flag.day_closed === 1) return "Final at closeout";
  return null;
}

export function flagHrGuidance(flag: Flag): string {
  const status = flag.status ?? "OPEN";
  const provisional = flagIsProvisional(flag);

  if (status === "APPROVED") {
    return "This flag has been approved in Desk. No further action is required unless payroll policy changes.";
  }
  if (status === "REJECTED") {
    return "This flag was rejected in Desk. Review the HR note on the Attendance Flag record for context.";
  }
  if (status === "EXPLAINED") {
    return "The employee submitted an explanation. Review it in Desk and approve or reject the flag.";
  }
  if (status === "CLOSED") {
    return "This flag is closed. It remains visible for audit but does not need action.";
  }

  if (provisional) {
    return "This flag is still provisional and may change or disappear after device closeout. Use the timeline below to verify punches, then review again after closeout if it remains.";
  }

  switch (flag.flag_code) {
    case "UNNOTIFIED_ABSENCE":
      return "Confirm whether the employee was on approved leave, holiday, or an excused absence. If not, follow your no-show process and record the decision in Desk.";
    case "OFF_SHIFT_PUNCH":
      return "Check whether the punches were expected (for example overtime or a schedule error). If valid, document the reason in Desk; otherwise note the off-shift activity.";
    case "MISSING_TIME":
    case "LATE_START":
    case "LATE_FROM_LUNCH":
    case "LEFT_EARLY":
      return "Compare the supporting details with the day timeline. If the issue is valid, leave the flag open or add an HR note in Desk; if excused, approve or close the flag there.";
    case "ATTENDANCE_ISSUE":
    case "MISSING_IN_OR_OUT":
    case "DELIVERY_FAILED":
    case "UNKNOWN_DEVICE_BRANCH":
      return "This is a data-quality issue. Verify punches in the timeline and Desk, correct check-ins if needed, then resolve the flag in Desk.";
    default:
      return "Open the Attendance Flag in Desk to add an HR note, approve, reject, or close this issue.";
  }
}

export function flagSummary(flagCode: string): string {
  return (
    FLAG_SUMMARIES[flagCode] ??
    "This attendance flag was raised automatically from check-ins and shift rules."
  );
}

export function flagDeskUrl(flagName: string): string {
  return `/app/attendance-flag/${encodeURIComponent(flagName)}`;
}

function formatEvidenceTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return formatCheckinTime(value);
    return value;
  }
  return String(value);
}

function formatEvidenceValue(key: string, value: unknown, dateKey?: string): string | null {
  if (value == null || value === "") return null;

  if (key in TIME_EVIDENCE_KEYS) {
    return formatEvidenceTime(value);
  }

  if (key in GRACE_EVIDENCE_KEYS && typeof value === "number") {
    return formatDurationMinutes(value);
  }

  if ((key === "minutes" || key === "threshold_minutes") && typeof value === "number") {
    return formatDurationMinutes(value);
  }

  if (key === "reason" && typeof value === "string") {
    return REASON_LABELS[value] ?? value.replaceAll("_", " ");
  }

  if (key === "kind" && typeof value === "string") {
    return value.replaceAll("_", " ");
  }

  if (key === "non_primary_checkins" && typeof value === "number") {
    return value === 1 ? "1 punch" : `${value} punches`;
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;

  return null;
}

export function formatFlagEvidenceDetails(
  evidence: unknown,
  dateKey?: string
): { rows: EvidenceDetailRow[]; fallbackJson: string | null } {
  const parsed = parseFlagEvidence(evidence) ?? (typeof evidence === "object" && evidence ? (evidence as FlagEvidence) : null);
  if (!parsed || typeof parsed !== "object") {
    return { rows: [], fallbackJson: null };
  }

  const rows: EvidenceDetailRow[] = [];
  const consumed = new Set<string>();

  const orderedKeys = [
    ...Object.keys(TIME_EVIDENCE_KEYS),
    ...Object.keys(GRACE_EVIDENCE_KEYS),
    ...Object.keys(EXTRA_EVIDENCE_KEYS),
    "minutes",
    "threshold_minutes",
    "reason",
    "kind",
  ];

  for (const key of orderedKeys) {
    if (!(key in parsed) || SKIP_EVIDENCE_KEYS.has(key)) continue;
    const value = formatEvidenceValue(key, (parsed as Record<string, unknown>)[key], dateKey);
    if (value == null) continue;
    const label =
      TIME_EVIDENCE_KEYS[key] ??
      GRACE_EVIDENCE_KEYS[key] ??
      EXTRA_EVIDENCE_KEYS[key] ??
      key.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
    rows.push({ label, value });
    consumed.add(key);
  }

  const leftover: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (consumed.has(key) || SKIP_EVIDENCE_KEYS.has(key)) continue;
    if (value == null || value === "") continue;
    leftover[key] = value;
  }

  const fallbackJson =
    Object.keys(leftover).length > 0 ? JSON.stringify(leftover, null, 2) : null;

  return { rows, fallbackJson };
}

export function formatFlagContextDate(dateKey: string): string {
  return format(parseDateKey(dateKey), "EEE, MMM d, yyyy");
}

export function flagDialogTitle(flag: Flag): string {
  return formatFlagLabel(flag.flag_code, parseFlagEvidence(flag.evidence));
}
