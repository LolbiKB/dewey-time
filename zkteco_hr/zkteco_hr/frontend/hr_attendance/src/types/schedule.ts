export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type WeekPatternDay = {
  weekday: Weekday;
  works: boolean;
  start_time?: string | null;
  end_time?: string | null;
  lunch_start?: string | null;
  lunch_end?: string | null;
  grace_minutes?: number | null;
};

export type WeekPattern = {
  frequency: string;
  days: WeekPatternDay[];
};

export type ShiftTypeMatch = {
  action: "use" | "create";
  name?: string;
  proposed_name?: string;
};

export type ShiftScheduleMatch = {
  action: "use" | "create";
  name?: string;
  proposed_name?: string;
  alternatives?: string[];
};

export type ResolvePlanGroup = {
  days: Weekday[];
  profile: {
    start_time: string;
    end_time: string;
    lunch_start?: string | null;
    lunch_end?: string | null;
    grace_minutes: number;
  };
  shift_type: ShiftTypeMatch;
  shift_schedule: ShiftScheduleMatch;
};

export type ReconcilePreview = {
  effective_from: string;
  disable_ssas: Array<{
    name: string;
    shift_schedule: string;
    shift_type?: string | null;
  }>;
  affected_assignments: Array<{
    name: string;
    shift_type?: string;
    start_date: string;
    end_date?: string | null;
    action: "cancel" | "end_before";
    proposed_end_date?: string | null;
  }>;
};

export type ResolvePlan = {
  employee: string;
  groups: ResolvePlanGroup[];
  warnings: string[];
  needs_create: boolean;
};

export type ScheduleContextSsa = {
  name: string;
  shift_schedule?: string | null;
  enabled?: number | boolean;
  shift_status?: string | null;
  create_shifts_after?: string | null;
  repeat_days: string[];
  shift_type?: string | null;
};

export type ScheduleContext = {
  employee: string;
  employee_name: string;
  company?: string | null;
  branch?: string | null;
  ssas: ScheduleContextSsa[];
  enabled_ssa_count: number;
  can_apply: boolean;
  assignment_summary: {
    earliest_start_date?: string | null;
    latest_end_date?: string | null;
  };
  week_pattern: WeekPattern;
  default_effective_from: string;
  default_generate_through: string;
};

export type HolidayPreviewItem = {
  date: string;
  description: string;
  weekly_off: boolean;
};

export type ApplyScheduleResult = {
  ok?: boolean;
  needs_confirm?: boolean;
  plan?: ResolvePlan;
  employee?: string;
  ssas?: Array<{ name: string; shift_schedule: string }>;
  created?: {
    shift_types: string[];
    shift_schedules: string[];
  };
  assignments_generated_through?: string;
  attendance_url?: string;
};

export function emptyWeekPattern(): WeekPattern {
  return {
    frequency: "Every Week",
    days: WEEKDAYS.map((weekday) => ({ weekday, works: false })),
  };
}

export function cloneWeekPattern(pattern: WeekPattern): WeekPattern {
  return {
    frequency: pattern.frequency,
    days: pattern.days.map((day) => ({ ...day })),
  };
}

/** HH:MM or HH:MM:SS for API payloads. */
export function toApiTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return null;
  const parts = trimmed.split(":");
  if (parts.length === 2) return `${parts[0]!.padStart(2, "0")}:${parts[1]!.padStart(2, "0")}:00`;
  if (parts.length >= 3) {
    return `${parts[0]!.padStart(2, "0")}:${parts[1]!.padStart(2, "0")}:${parts[2]!.padStart(2, "0")}`;
  }
  return trimmed;
}

export function formatTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = toApiTime(value);
  if (!normalized) return "";
  return normalized.slice(0, 5);
}

export type DayValidationIssue = {
  weekday: Weekday;
  message: string;
};

export function validateWeekPattern(pattern: WeekPattern): DayValidationIssue[] {
  const issues: DayValidationIssue[] = [];

  for (const row of pattern.days) {
    if (!row.works) continue;

    const start = toApiTime(row.start_time);
    const end = toApiTime(row.end_time);
    if (!start || !end) {
      issues.push({ weekday: row.weekday, message: "Start and end are required when working." });
      continue;
    }

    if (start >= end) {
      issues.push({ weekday: row.weekday, message: "End must be after start (same-day shifts only)." });
    }

    const lunchStart = toApiTime(row.lunch_start);
    const lunchEnd = toApiTime(row.lunch_end);
    if ((lunchStart && !lunchEnd) || (!lunchStart && lunchEnd)) {
      issues.push({ weekday: row.weekday, message: "Set both lunch start and end, or leave both empty." });
      continue;
    }

    if (lunchStart && lunchEnd) {
      if (lunchStart < start || lunchEnd > end || lunchStart >= lunchEnd) {
        issues.push({ weekday: row.weekday, message: "Lunch must fall inside the shift window." });
      }
    }
  }

  return issues;
}

export function weekPatternForApi(pattern: WeekPattern): WeekPattern {
  return {
    frequency: pattern.frequency,
    days: pattern.days.map((row) => ({
      weekday: row.weekday,
      works: row.works,
      start_time: row.works ? toApiTime(row.start_time) : null,
      end_time: row.works ? toApiTime(row.end_time) : null,
      lunch_start: row.works ? toApiTime(row.lunch_start) : null,
      lunch_end: row.works ? toApiTime(row.lunch_end) : null,
      grace_minutes: row.works ? Number(row.grace_minutes ?? 10) : null,
    })),
  };
}

export const TEMPLATE_55_DAY: Partial<Record<Weekday, Omit<WeekPatternDay, "weekday">>> = {
  Monday: {
    works: true,
    start_time: "08:00",
    end_time: "17:00",
    lunch_start: "12:00",
    lunch_end: "13:00",
    grace_minutes: 10,
  },
  Tuesday: {
    works: true,
    start_time: "08:00",
    end_time: "17:00",
    lunch_start: "12:00",
    lunch_end: "13:00",
    grace_minutes: 10,
  },
  Wednesday: {
    works: true,
    start_time: "08:00",
    end_time: "17:00",
    lunch_start: "12:00",
    lunch_end: "13:00",
    grace_minutes: 10,
  },
  Thursday: {
    works: true,
    start_time: "08:00",
    end_time: "17:00",
    lunch_start: "12:00",
    lunch_end: "13:00",
    grace_minutes: 10,
  },
  Friday: {
    works: true,
    start_time: "08:00",
    end_time: "17:00",
    lunch_start: "12:00",
    lunch_end: "13:00",
    grace_minutes: 10,
  },
  Saturday: {
    works: true,
    start_time: "08:00",
    end_time: "12:00",
    lunch_start: null,
    lunch_end: null,
    grace_minutes: 10,
  },
  Sunday: { works: false },
};

export function apply55DayTemplate(pattern: WeekPattern): WeekPattern {
  return {
    ...pattern,
    days: pattern.days.map((row) => {
      const template = TEMPLATE_55_DAY[row.weekday];
      if (!template) return { ...row, works: false };
      return { weekday: row.weekday, ...template };
    }),
  };
}

export function formatDayList(days: string[]): string {
  if (days.length === 5 && days.every((d, i) => d === WEEKDAYS[i])) return "Mon–Fri";
  if (days.length === 1) return days[0]!.slice(0, 3);
  return days.map((d) => d.slice(0, 3)).join(", ");
}
