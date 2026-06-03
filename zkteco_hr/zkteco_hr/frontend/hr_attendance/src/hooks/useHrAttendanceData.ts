import { format } from "date-fns";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useEffect, useMemo } from "react";

import { calendarFetchRange } from "@/lib/weekCalendar";
import type { CalendarEmployee, CalendarPayload, DeviceAlert, DeviceSyncStatus } from "@/types/calendar";

const EMPLOYEES_METHOD = "zkteco_hr.attendance_engine.hr_calendar.list_calendar_employees";
const CALENDAR_METHOD = "zkteco_hr.attendance_engine.hr_calendar.get_employee_calendar";

export function useCalendarEmployees() {
  const { data, error, isLoading, mutate } = useFrappeGetCall<CalendarEmployee[]>(
    EMPLOYEES_METHOD,
    undefined,
    EMPLOYEES_METHOD
  );

  const employees = useMemo<CalendarEmployee[]>(() => data?.message ?? [], [data?.message]);

  return {
    employees,
    error,
    isLoading,
    refresh: mutate,
  };
}

export function useEmployeeCalendar(employee: string | null, anchor: Date) {
  const { rangeStart, rangeEnd } = useMemo(() => calendarFetchRange(anchor), [anchor]);
  const startDate = format(rangeStart, "yyyy-MM-dd");
  const endDate = format(rangeEnd, "yyyy-MM-dd");

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
    rangeStart,
    rangeEnd,
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

export function deviceSyncByDate(rows: DeviceSyncStatus[]): Map<string, DeviceSyncStatus[]> {
  const map = new Map<string, DeviceSyncStatus[]>();
  for (const row of rows) {
    const key = String(row.local_date);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return map;
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

/** Extract a readable message from frappe-react-sdk / Axios errors. */
export function formatAttendanceLoadError(error: unknown): string {
  if (!error) return "Unknown error";

  const pickMessage = (value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const parsed = JSON.parse(value) as { message?: string };
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      /* plain text */
    }
    return value.trim();
  };

  if (typeof error === "string") {
    return pickMessage(error) ?? error;
  }

  if (error instanceof Error) {
    return pickMessage(error.message) ?? error.message;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const response = record.response as { data?: { message?: string; exc?: string } } | undefined;
    const fromResponse =
      pickMessage(response?.data?.message) ?? pickMessage(response?.data?.exc);
    if (fromResponse) return fromResponse;

    const direct = pickMessage(record.message) ?? pickMessage(record.exc);
    if (direct) return direct;
  }

  return "Unknown error";
}
