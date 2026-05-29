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

export type Day = {
  date: string;
  shift?: ShiftContext;
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
  image?: string | null;
  title?: string | null;
  department?: string | null;
  company?: string | null;
};
