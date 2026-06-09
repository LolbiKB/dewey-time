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

export type WeeklyScheduleTemplate = {
  key: string;
  label: string;
  count: number;
  blocks: ShiftBlock[];
};

export type ClearSchedulePreview = {
  employee: string;
  shift_assignment_count: number;
  ssa_count: number;
  attendance_flag_count: number;
  sample_shift_assignments: string[];
  sample_ssas: string[];
};

export type ClearScheduleNeedsConfirm = {
  needs_confirm: true;
  preview: ClearSchedulePreview;
};

export type ClearScheduleResult = {
  ok: true;
  employee: string;
  cancelled_assignments: string[];
  deleted_assignments: string[];
  deleted_ssas: string[];
  disabled_ssas: string[];
  deleted_flags: number;
};

export type ClearScheduleResponse = ClearScheduleNeedsConfirm | ClearScheduleResult;

export type ClearAllSchedulesPreview = {
  include_all_active: boolean;
  employee_count: number;
  shift_assignment_count: number;
  ssa_count: number;
  attendance_flag_count: number;
  sample_employees: string[];
  confirm_phrase: string;
};

export type ClearAllSchedulesNeedsConfirm = {
  needs_confirm: true;
  preview: ClearAllSchedulesPreview;
};

export type ClearAllSchedulesResult = {
  ok: boolean;
  include_all_active: boolean;
  employee_count: number;
  cleared_count: number;
  error_count: number;
  errors: Array<{ employee: string; error: string }>;
  sample_cleared_employees: string[];
  cancelled_assignments: number;
  deleted_assignments: number;
  deleted_ssas: number;
  disabled_ssas: number;
  deleted_flags: number;
};

export type ClearAllSchedulesResponse = ClearAllSchedulesNeedsConfirm | ClearAllSchedulesResult;

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

export type DayTimeConfig = Omit<WeekPatternDay, "weekday">;

export type ShiftBlock = {
  id: string;
  days: Weekday[];
  profile: {
    start_time: string;
    end_time: string;
    lunch_start: string | null;
    lunch_end: string | null;
    grace_minutes: number;
  };
};

function defaultShiftProfile(): ShiftBlock["profile"] {
  return {
    start_time: "08:00",
    end_time: "17:00",
    lunch_start: "12:00",
    lunch_end: "13:00",
    grace_minutes: 10,
  };
}

export const DEFAULT_LUNCH_START = "12:00";
export const DEFAULT_LUNCH_END = "13:00";

/** True when both lunch times are set (full-day style). */
export function hasLunchBreak(profile: {
  lunch_start?: string | null;
  lunch_end?: string | null;
}): boolean {
  return Boolean(toApiTime(profile.lunch_start) && toApiTime(profile.lunch_end));
}

function profileKey(profile: ShiftBlock["profile"]): string {
  return [
    toApiTime(profile.start_time),
    toApiTime(profile.end_time),
    toApiTime(profile.lunch_start),
    toApiTime(profile.lunch_end),
    profile.grace_minutes,
  ].join("|");
}

function timeToMinutes(value: string | null | undefined): number | null {
  const normalized = toApiTime(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/** Net working minutes for one day (end − start − lunch), matching calendar week schedule. */
export function weekPatternDayNetMinutes(row: WeekPatternDay): number {
  if (!row.works) return 0;
  const start = timeToMinutes(row.start_time);
  const end = timeToMinutes(row.end_time);
  if (start === null || end === null || end <= start) return 0;
  const lunchStart = timeToMinutes(row.lunch_start);
  const lunchEnd = timeToMinutes(row.lunch_end);
  const lunch =
    lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart
      ? lunchEnd - lunchStart
      : 0;
  return end - start - lunch;
}

export function weekPatternWeeklyMinutes(pattern: WeekPattern): number {
  return pattern.days.reduce((sum, day) => sum + weekPatternDayNetMinutes(day), 0);
}

export function summarizeWeekPattern(pattern: WeekPattern) {
  const workDays = pattern.days.filter((day) => day.works).length;
  const offDays = pattern.days.length - workDays;
  const totalWeeklyMinutes = weekPatternWeeklyMinutes(pattern);
  return { workDays, offDays, totalWeeklyMinutes };
}

/** Same grouping as server `group_week_pattern` — days with identical hours become one block. */
export function weekPatternToBlocks(pattern: WeekPattern): ShiftBlock[] {
  const buckets = new Map<string, { days: Weekday[]; profile: ShiftBlock["profile"] }>();

  for (const row of pattern.days) {
    if (!row.works) continue;

    const profile = {
      start_time: formatTimeInput(row.start_time) || "",
      end_time: formatTimeInput(row.end_time) || "",
      lunch_start: row.lunch_start ? formatTimeInput(row.lunch_start) : null,
      lunch_end: row.lunch_end ? formatTimeInput(row.lunch_end) : null,
      grace_minutes: Number(row.grace_minutes ?? 10),
    };

    if (!profile.start_time || !profile.end_time) continue;

    const startMinutes = timeToMinutes(profile.start_time);
    const endMinutes = timeToMinutes(profile.end_time);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue;

    const key = profileKey(profile);
    const bucket = buckets.get(key) ?? { days: [], profile };
    bucket.days.push(row.weekday);
    buckets.set(key, bucket);
  }

  const blocks = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      days: [...bucket.days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)),
    }))
    .sort((a, b) => WEEKDAYS.indexOf(a.days[0]!) - WEEKDAYS.indexOf(b.days[0]!))
    .map((bucket, index) => ({
      id: `block-${index}`,
      days: bucket.days,
      profile: bucket.profile,
    }));

  return blocks;
}

export function weekPatternFromBlocks(
  blocks: ShiftBlock[],
  frequency = "Every Week"
): WeekPattern {
  const rows = new Map<Weekday, WeekPatternDay>(
    WEEKDAYS.map((weekday) => [weekday, { weekday, works: false }])
  );

  for (const block of blocks) {
    for (const weekday of block.days) {
      rows.set(weekday, {
        weekday,
        works: true,
        start_time: block.profile.start_time,
        end_time: block.profile.end_time,
        lunch_start: block.profile.lunch_start,
        lunch_end: block.profile.lunch_end,
        grace_minutes: block.profile.grace_minutes,
      });
    }
  }

  return {
    frequency,
    days: WEEKDAYS.map((weekday) => rows.get(weekday)!),
  };
}

export function createShiftBlock(partial?: Partial<ShiftBlock>): ShiftBlock {
  return {
    id: partial?.id ?? `block-${Date.now()}`,
    days: partial?.days ?? [],
    profile: partial?.profile ?? defaultShiftProfile(),
  };
}

/** Stable compare key for shift blocks (ignores block ids). */
export function blocksFingerprint(blocks: ShiftBlock[]): string {
  return JSON.stringify(
    blocks.map((block) => ({
      days: block.days,
      profile: block.profile,
    }))
  );
}

export function normalizeTemplateBlocks(blocks: ShiftBlock[]): ShiftBlock[] {
  if (!blocks.length) return [];
  return weekPatternToBlocks(weekPatternFromBlocks(blocks));
}

export function findMatchingTemplateKey(
  blocks: ShiftBlock[],
  templates: Array<{ key: string; blocks: ShiftBlock[] }>
): string {
  if (!blocks.length) return "manual";
  const fp = blocksFingerprint(blocks);
  for (const template of templates) {
    if (template.key === "manual") continue;
    if (blocksFingerprint(normalizeTemplateBlocks(template.blocks)) === fp) {
      return template.key;
    }
  }
  return "manual";
}

export function dayConfigFromRow(row: WeekPatternDay): DayTimeConfig {
  return {
    works: row.works,
    start_time: row.start_time,
    end_time: row.end_time,
    lunch_start: row.lunch_start,
    lunch_end: row.lunch_end,
    grace_minutes: row.grace_minutes,
  };
}

export function applyConfigToDays(
  pattern: WeekPattern,
  config: DayTimeConfig,
  targets: Iterable<Weekday>
): WeekPattern {
  const targetSet = new Set(targets);
  return {
    ...pattern,
    days: pattern.days.map((row) =>
      targetSet.has(row.weekday) ? { weekday: row.weekday, ...config } : row
    ),
  };
}

export function formatDayConfigSummary(row: WeekPatternDay): string {
  if (!row.works) return "Off";
  const start = formatTimeInput(row.start_time) || "—";
  const end = formatTimeInput(row.end_time) || "—";
  const lunchStart = formatTimeInput(row.lunch_start);
  const lunchEnd = formatTimeInput(row.lunch_end);
  const lunch =
    lunchStart && lunchEnd ? ` · lunch ${lunchStart}–${lunchEnd}` : "";
  return `${start}–${end}${lunch}`;
}
