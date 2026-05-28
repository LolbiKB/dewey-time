import { endOfMonth, format, startOfMonth } from "date-fns";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useEffect, useMemo } from "react";

import type { CalendarEmployee, CalendarPayload } from "@/types/calendar";

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
