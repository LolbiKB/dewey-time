import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useMemo } from "react";

import { queryKeys } from "@/lib/queryKeys";
import { calendarFetchRange } from "@/lib/weekCalendar";
import { getEmployeeCalendar, listCalendarEmployees } from "@/services/calendar";
import type { CalendarEmployee, DeviceAlert, DeviceSyncStatus } from "@/types/calendar";

export function useCalendarEmployees() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.employees.list(),
    queryFn: listCalendarEmployees,
  });

  const employees = useMemo<CalendarEmployee[]>(() => data?.employees ?? [], [data?.employees]);

  return {
    employees,
    currentUserEmployee: data?.current_user_employee ?? null,
    error,
    isLoading,
    refresh: refetch,
  };
}

export function useEmployeeCalendar(employee: string | null, anchor: Date) {
  const { rangeStart, rangeEnd } = useMemo(() => calendarFetchRange(anchor), [anchor]);
  const startDate = format(rangeStart, "yyyy-MM-dd");
  const endDate = format(rangeEnd, "yyyy-MM-dd");

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: employee
      ? queryKeys.calendar.employee(employee, startDate, endDate)
      : queryKeys.calendar.all,
    queryFn: () => getEmployeeCalendar({ employee: employee!, startDate, endDate }),
    enabled: Boolean(employee),
  });

  return {
    payload: data ?? null,
    rangeStart,
    rangeEnd,
    error,
    isLoading,
    refresh: refetch,
  };
}

/**
 * Set a default employee when none is selected.
 * For HR staff, prefer their own linked employee (preferredId) over the first in the list.
 */
export function useDefaultEmployee(
  employees: CalendarEmployee[],
  employee: string | null,
  setEmployee: (id: string) => void,
  preferredId: string | null = null
) {
  useEffect(() => {
    if (employee || !employees.length) return;
    const preferred = preferredId
      ? employees.find((e) => e.id === preferredId)
      : null;
    setEmployee(preferred ? preferred.id : employees[0]!.id);
  }, [employee, employees, preferredId, setEmployee]);
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

/** Extract a readable message from a rejected loader: FrappeCallError, string, or error body. */
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
