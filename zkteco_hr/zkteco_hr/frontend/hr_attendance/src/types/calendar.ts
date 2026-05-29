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

export type LeaveContext = {
  on_leave: boolean;
  leave_type?: string | null;
};

export type Day = {
  date: string;
  shift?: ShiftContext;
  leave?: LeaveContext;
  checkins?: Checkin[];
  first_in?: string | null;
  last_out?: string | null;
  gross_minutes?: number | null;
  flags?: Flag[];
};

export type CalendarPayload = {
  employee: string;
  start_date: string;
  end_date: string;
  days: Day[];
  device_alerts?: DeviceAlert[];
};

export type CalendarEmployee = {
  id: string;
  label: string;
  /** ERPNext Employee.employee_name */
  employee_name?: string | null;
  image?: string | null;
  title?: string | null;
  department?: string | null;
  company?: string | null;
  employment_type?: string | null;
  is_full_time?: boolean;
  /** Enabled Shift Schedule Assignment (HR Setup) — same as has_shift_assignment */
  has_shift_schedule_assignment?: boolean;
  /** True when employee has enabled Shift Schedule Assignment */
  has_shift_assignment?: boolean;
  shift_schedule_assignment?: string | null;
  schedule_min_date?: string | null;
  schedule_max_date?: string | null;
};
