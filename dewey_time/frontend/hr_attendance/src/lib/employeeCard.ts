import { parseDateKey } from "@/lib/attendanceTime";
import { format } from "date-fns";

import type { CalendarEmployee } from "@/types/calendar";

export type ScheduleStatus = {
  label: string;
  detail?: string;
  tone: "ok" | "warn" | "neutral";
};

/**
 * The employee's Khmer name, family name first, or null when there is none.
 *
 * `${last} ${first}` — ចាន់ សុភា, where ចាន់ is the family name. That is the
 * order the vendored ADMS reference frontend already uses, and reversing it
 * names a different person to a Khmer reader.
 *
 * Neither ERPNext field is required, so one-of-two is a real shape: a partial
 * name is still a name and is shown. Whitespace-only is not — that is what a
 * Data field holds after someone tabs through it, and rendering it would put a
 * bare `·` separator on the line with nothing after it.
 */
export function khmerName(
  last: string | null | undefined,
  first: string | null | undefined,
): string | null {
  const parts = [last, first].map((part) => (part ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/**
 * The employee's name exactly as ERPNext records it.
 *
 * Was `employeeShortName`, and it used to run `stripMiddleName`. The pickers
 * stripped and the tables did not, so one person read two ways depending on
 * where you were standing. One shared identity component means one rule, and
 * this is it: show what is recorded and let truncation do any shortening. A
 * silently shortened name and a visibly truncated one are different claims,
 * and only the second one admits that something was left out.
 */
export function employeeDisplayName(
  employee: CalendarEmployee | null | undefined,
  fallbackId?: string | null,
): string {
  if (!employee) return fallbackId ?? "Select employee";
  return (
    employee.employee_name?.trim() ||
    employee.label.split("·").pop()?.trim() ||
    employee.id
  );
}

export function employeeInitials(
  employee: CalendarEmployee | null | undefined,
  fallbackId?: string | null
): string {
  const name = employeeDisplayName(employee, fallbackId);
  return (
    name
      // Any run of whitespace, not one literal space. employeeDisplayName only
      // trims outer whitespace, so a two-part name separated by a double space
      // or a non-breaking space arrives verbatim, and splitting on one literal
      // space would give ["Chan", "", "Dara"], with slice(0, 2) taking
      // ["Chan", ""] — one initial, the second silently swallowed.
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      // [...part][0], not part[0]: string indexing yields a UTF-16 code unit, so
      // an astral first character returns half a surrogate pair. Spreading
      // iterates code points. One initial is still honest for a mononym.
      .map((part) => [...part][0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

export function formatEmploymentType(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Employment types allowed in the Weekly Schedule wizard picker. */
export const WEEKLY_SCHEDULE_EMPLOYMENT_TYPES = [
  "Full-time",
  "Part-time Fixed",
  "Intern",
] as const;

export function isWeeklyScheduleEligible(
  employmentType: string | null | undefined
): boolean {
  const normalized = formatEmploymentType(employmentType).toLowerCase();
  if (!normalized) return false;
  return WEEKLY_SCHEDULE_EMPLOYMENT_TYPES.some(
    (type) => type.toLowerCase() === normalized
  );
}

/** Subtitle for Weekly Schedule employee picker — employment type only. */
export function scheduleEmployeeSubtitle(
  employee: CalendarEmployee | null | undefined
): string {
  if (!employee) return "Choose an employee";
  return formatEmploymentType(employee.employment_type) || "Employment type not set";
}

/** User-facing message when calendar selection is not valid on Weekly Schedule. */
export function weeklyScheduleIneligibleMessage(
  employee: CalendarEmployee | null | undefined,
  employeeId?: string | null
): string | null {
  if (!employee || isWeeklyScheduleEligible(employee.employment_type)) return null;

  const name = employeeDisplayName(employee, employeeId);
  const typeLabel = scheduleEmployeeSubtitle(employee);

  if (typeLabel === "Employment type not set") {
    return `${name} has no employment type set. Weekly Schedule supports Full-time, Part-time Fixed, and Intern only.`;
  }

  return `${name} (${typeLabel}) is not eligible for Weekly Schedule. Choose Full-time, Part-time Fixed, or Intern.`;
}

export function roleLine(employee: CalendarEmployee | null | undefined): string {
  return [employee?.title, employee?.department].filter(Boolean).join(" · ");
}

/** Searchable text for the employee command list (excludes shift schedule doc names). */
export function employeeSearchHaystack(employee: CalendarEmployee): string {
  const haystack = [
    employee.id,
    employee.employee_name,
    employeeDisplayName(employee),
    employee.label,
    employee.employment_type,
    employee.title,
    employee.department,
    employee.company,
  ]
    .filter((part) => part != null && String(part).trim())
    .join(" ");
  return haystack || employee.id || "employee";
}

/**
 * cmdk `filter` for the employee command lists. cmdk's default scorer is a fuzzy
 * *subsequence* match: over our multi-field haystack (id + name + label + title +
 * department + company) it scores almost every row > 0, so the list never narrows
 * — every employee (even the "ADMS Bridge" service account) stays visible no matter
 * what you type. Match on contiguous substrings instead: each whitespace-separated
 * token in the query must appear somewhere in the item value (+ keywords). Returns
 * 1 to keep the row, 0 to hide it (cmdk hides anything scoring 0).
 */
export function employeeCommandFilter(
  value: string,
  search: string,
  keywords?: string[]
): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase();
  return query.split(/\s+/).every((token) => haystack.includes(token)) ? 1 : 0;
}

export function formatScheduleCoverage(employee: CalendarEmployee): string | null {
  if (!employee.has_shift_assignment || !employee.schedule_min_date) return null;
  const min = format(parseDateKey(employee.schedule_min_date), "MMM yyyy");
  const max = employee.schedule_max_date
    ? format(parseDateKey(employee.schedule_max_date), "MMM yyyy")
    : "ongoing";
  return `Shifts: ${min} – ${max}`;
}

export function shiftScheduleStatus(
  employee: CalendarEmployee | null | undefined,
  weekDates: Date[],
  weekAssignedShiftDays: number,
  showWeekDetail: boolean
): ScheduleStatus {
  if (!employee) {
    return { label: "Weekly schedule", tone: "neutral" };
  }

  if (employee.has_shift_assignment !== true && employee.has_shift_schedule_assignment !== true) {
    return {
      label: "No shift schedule",
      detail:
        "Assign a Shift Schedule Assignment in ERPNext to enable expected hours, lunch, and grace rules.",
      tone: "warn",
    };
  }

  if (!showWeekDetail) {
    return { label: "Schedule on file", tone: "ok" };
  }

  const weekLabel = `${format(weekDates[0]!, "MMM d")}–${format(weekDates[6]!, "MMM d")}`;

  if (weekAssignedShiftDays === 0) {
    return {
      label: "No shifts this week",
      detail: `No shift assignments in ${weekLabel}. Check dates, weekly-off, or holidays.`,
      tone: "warn",
    };
  }

  return {
    label: `${weekAssignedShiftDays}/7 days scheduled`,
    detail: `${weekAssignedShiftDays} days with shift assignments (${weekLabel}).`,
    tone: "ok",
  };
}
