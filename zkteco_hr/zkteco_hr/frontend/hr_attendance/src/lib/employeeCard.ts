import { format } from "date-fns";

import type { CalendarEmployee } from "@/types/calendar";

export type ScheduleStatus = {
  label: string;
  detail?: string;
  tone: "ok" | "warn" | "neutral";
};

export function stripMiddleName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return fullName.trim();
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export function employeeShortName(
  employee: CalendarEmployee | null | undefined,
  fallbackId?: string | null
): string {
  if (!employee) return fallbackId ?? "Select employee";
  const raw =
    employee.employee_name?.trim() ||
    employee.label.split("·").pop()?.trim() ||
    employee.id;
  return stripMiddleName(raw);
}

export function employeeInitials(
  employee: CalendarEmployee | null | undefined,
  fallbackId?: string | null
): string {
  const name = employeeShortName(employee, fallbackId);
  return (
    name
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function formatEmploymentType(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function roleLine(employee: CalendarEmployee | null | undefined): string {
  return [employee?.title, employee?.department].filter(Boolean).join(" · ");
}

/** Subtitle under the selected employee in the picker (no ERP doc ids or shift metadata). */
export function employeePickerSubtitle(employee: CalendarEmployee | null | undefined): string {
  if (!employee) return "Choose an employee";
  const parts = [
    roleLine(employee) || null,
    formatEmploymentType(employee.employment_type) || null,
  ].filter((part) => part != null && String(part).trim());
  if (parts.length) return parts.join(" · ");
  return employee.id;
}

/** Searchable text for the employee command list (excludes shift schedule doc names). */
export function employeeSearchHaystack(employee: CalendarEmployee): string {
  return [
    employee.id,
    employee.employee_name,
    employeeShortName(employee),
    employee.label,
    employee.employment_type,
    employee.title,
    employee.department,
    employee.company,
  ]
    .filter((part) => part != null && String(part).trim())
    .join(" ");
}

export function formatScheduleCoverage(employee: CalendarEmployee): string | null {
  if (!employee.has_shift_assignment || !employee.schedule_min_date) return null;
  const min = format(new Date(employee.schedule_min_date), "MMM yyyy");
  const max = employee.schedule_max_date
    ? format(new Date(employee.schedule_max_date), "MMM yyyy")
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
