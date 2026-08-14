import type { RolloutPhase } from "@/types/flags";

export type Severity = "INFO" | "WARNING" | "CRITICAL";
export type FlagStatus = "OPEN" | "EXPLAINED" | "APPROVED" | "REJECTED" | "CLOSED";

export type ShiftContext = {
  shift_assigned: boolean;
  shift_type?: string;
  start_time?: string;
  end_time?: string;
  grace_minutes?: number;
  lunch_start?: string | null;
  lunch_end?: string | null;
  /** True when the covering Shift Assignment is Inactive (retired in ERP) on a past day. */
  schedule_superseded?: boolean;
  assignment_status?: string;
};

export type Checkin = {
  name?: string;
  time: string;
  /** Present on ERPNext rows but ignored by UI/engine MVP; direction is inferred from punch order. */
  log_type?: "IN" | "OUT" | null;
  device_id?: string | null;
  custom_device_branch?: string | null;
};

export type DeviceAlert = {
  device_sn: string;
  branch?: string | null;
  local_date: string;
  status: "closed" | "deferred_offline" | "closure_failed" | string;
  last_error?: string | null;
};

export type DeviceSyncStatus = {
  device_sn: string;
  branch?: string | null;
  local_date: string;
  last_device_log_at?: string | null;
  last_delivered_at?: string | null;
  pending_count?: number | null;
  last_error?: string | null;
};

export type Flag = {
  name: string;
  flag_code: string;
  severity?: Severity;
  status?: FlagStatus;
  source?: "AUTO" | "EMPLOYEE" | "HR";
  day_closed?: 0 | 1;
  is_provisional?: boolean;
  rule_version?: string;
  evidence?: unknown;
};

export type ObservedLunch = {
  lunch_out: string;
  lunch_in: string;
  minutes: number;
  lunch_start: string;
  lunch_end: string;
  return_threshold: string;
  late_return: boolean;
};

export type LeaveContext = {
  on_leave: boolean;
  leave_type?: string | null;
};

export type HolidayContext = {
  description: string;
  weekly_off: boolean;
};

export type Day = {
  date: string;
  shift?: ShiftContext;
  holiday?: HolidayContext | null;
  leave?: LeaveContext;
  checkins?: Checkin[];
  first_in?: string | null;
  last_out?: string | null;
  gross_minutes?: number | null;
  /** Punch-derived lunch OUT→IN (same heuristic as closeout flags). */
  observed_lunch?: ObservedLunch | null;
  flags?: Flag[];
  /**
   * Which rollout phase this day fell in, from the day's OWN attendance_date.
   * Optional, unlike the queue's `rollout` block: hr_calendar has no cache
   * prefix to version, so a payload from before Phase A genuinely can arrive
   * without it. Absent reads as "no opinion", not as PRELAUNCH.
   */
  rollout_phase?: RolloutPhase;
};

export type CalendarPayload = {
  employee: string;
  start_date: string;
  end_date: string;
  days: Day[];
  device_alerts?: DeviceAlert[];
  device_sync?: DeviceSyncStatus[];
  /** From Employee Checkin ledger — week nav backward bound. */
  first_checkin_date?: string | null;
  schedule_max_date?: string | null;
  has_shift_assignment?: boolean;
  /**
   * Calendar payload only: the employee has concrete Shift Assignment ROWS.
   * Distinct from `has_shift_assignment` on CalendarEmployee, which means
   * "has a Shift SCHEDULE Assignment" — a different doctype. The two used to
   * share a name across two payloads, which is how the week grid got hidden
   * for employees who did have assignments.
   */
  has_shift_assignment_rows?: boolean;
  is_clock_based?: boolean;
  /** The employee's primary site (Employee.branch). Null/absent for the many
   *  employees who have none — consumers must treat that as "do not judge". */
  employee_branch?: string | null;
};

export type CalendarEmployee = {
  id: string;
  label: string;
  /** ERPNext Employee.employee_name */
  employee_name?: string | null;
  image?: string | null;
  title?: string | null;
  department?: string | null;
  /**
   * ERPNext `Employee.branch` — the person's primary site.
   *
   * Already emitted by `_list_calendar_employee_rows`; this declaration is
   * what stops it being discarded at the type boundary. Null for the many
   * employees who have none, which consumers must treat as "do not judge",
   * not as a finding.
   */
  branch?: string | null;
  company?: string | null;
  employment_type?: string | null;
  is_full_time?: boolean;
  /** Employment type is set and outside the Weekly-Schedule allowlist — clocks in/out. */
  is_clock_based?: boolean;
  /** Enabled Shift Schedule Assignment (HR Setup) — same as has_shift_assignment */
  has_shift_schedule_assignment?: boolean;
  /** True when employee has enabled Shift Schedule Assignment */
  has_shift_assignment?: boolean;
  shift_schedule_assignment?: string | null;
  schedule_min_date?: string | null;
  schedule_max_date?: string | null;
  /** Earliest Employee Checkin day (`time`); includes off-shift rows. Week nav backward bound. */
  first_checkin_date?: string | null;
  /**
   * ERPNext `Employee.custom_khmer_last_name` / `custom_khmer_first_name`.
   *
   * Raw and unordered on the wire; compose with `khmerName()` before display,
   * which puts the family name first. Optional because a site mid-migration may
   * not have the columns yet — the backend selects them behind a
   * `has_column` check.
   */
  custom_khmer_last_name?: string | null;
  custom_khmer_first_name?: string | null;
};
