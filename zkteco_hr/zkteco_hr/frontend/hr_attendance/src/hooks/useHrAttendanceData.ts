import { endOfMonth, format, startOfMonth } from "date-fns";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useEffect, useMemo } from "react";

import type {
  CalendarEmployee,
  CalendarPayload,
  DeviceAlert,
  FilterPreset,
  Flag,
  FlagStatus,
  Severity,
} from "@/types/calendar";

const EMPLOYEES_METHOD = "zkteco_hr.attendance_engine.hr_calendar.list_calendar_employees";
const CALENDAR_METHOD = "zkteco_hr.attendance_engine.hr_calendar.get_employee_calendar";

export function useCalendarEmployees() {
  const { data, error, isLoading, mutate } = useFrappeGetCall<CalendarEmployee[]>(
    EMPLOYEES_METHOD,
    undefined,
    EMPLOYEES_METHOD
  );

  return {
    employees: data?.message ?? [],
    error,
    isLoading,
    refresh: mutate,
  };
}

export function useEmployeeCalendar(employee: string | null, anchor: Date) {
  const monthStart = useMemo(() => startOfMonth(anchor), [anchor]);
  const monthEnd = useMemo(() => endOfMonth(anchor), [anchor]);
  const startDate = format(monthStart, "yyyy-MM-dd");
  const endDate = format(monthEnd, "yyyy-MM-dd");

  const params = useMemo(
    () =>
      employee
        ? {
            employee,
            start_date: startDate,
            end_date: endDate,
          }
        : undefined,
    [employee, endDate, startDate]
  );

  const swrKey = employee ? `${CALENDAR_METHOD}:${employee}:${startDate}:${endDate}` : null;

  const { data, error, isLoading, mutate } = useFrappeGetCall<CalendarPayload>(
    CALENDAR_METHOD,
    params,
    swrKey,
    undefined,
    "GET"
  );

  const payload = data?.message ?? null;

  return {
    payload,
    monthStart,
    monthEnd,
    error,
    isLoading,
    refresh: mutate,
  };
}

export function useDefaultEmployee(
  employees: CalendarEmployee[],
  employee: string | null,
  setEmployee: (id: string) => void
) {
  useEffect(() => {
    if (employee || !employees.length) return;
    setEmployee(employees[0]!.id);
  }, [employee, employees, setEmployee]);
}

/** Open device closeout alerts overlapping the visible week. */
export function deviceAlertsForWeek(
  alerts: DeviceAlert[] | undefined,
  weekDates: Date[]
): DeviceAlert[] {
  const weekKeys = new Set(weekDates.map((d) => format(d, "yyyy-MM-dd")));
  return (alerts ?? []).filter((a) => weekKeys.has(String(a.local_date)));
}

export function deviceAlertsByDate(alerts: DeviceAlert[]): Map<string, DeviceAlert[]> {
  const map = new Map<string, DeviceAlert[]>();
  for (const alert of alerts) {
    const key = String(alert.local_date);
    map.set(key, [...(map.get(key) ?? []), alert]);
  }
  return map;
}

export function filterFlagsForDisplay(
  flags: Flag[] | undefined,
  preset: FilterPreset,
  statusFilter: Set<FlagStatus>,
  severityFilter: Set<Severity>
): Flag[] {
  return (flags ?? []).filter((flag) => {
    const severity = (flag.severity ?? "WARNING") as Severity;
    if (!severityFilter.has(severity)) return false;

    if (preset === "needs_attention") {
      if (flag.flag_code === "DELIVERY_FAILED") return true;
      return (flag.status ?? "OPEN") === "OPEN";
    }

    return statusFilter.has((flag.status ?? "OPEN") as FlagStatus);
  });
}

export function dayHasAttention(
  day: { flags?: Flag[] } | undefined,
  alertsOnDay: DeviceAlert[],
  preset: FilterPreset,
  statusFilter: Set<FlagStatus>,
  severityFilter: Set<Severity>
): boolean {
  if (preset !== "needs_attention") return true;
  if (alertsOnDay.length > 0) return true;
  return (
    filterFlagsForDisplay(day?.flags, preset, statusFilter, severityFilter).length > 0
  );
}

export function formatDeviceAlertStatus(status: string): string {
  switch (status) {
    case "deferred_offline":
      return "Deferred (offline)";
    case "closure_failed":
      return "Closeout failed";
    case "closed":
      return "Closed";
    default:
      return status.replace(/_/g, " ");
  }
}
