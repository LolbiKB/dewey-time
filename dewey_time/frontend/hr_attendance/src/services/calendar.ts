/**
 * HR calendar reads: the employee list, one employee's week, and the session
 * probe that tells the shell whether the viewer is HR staff. Plain async
 * functions with no React, following the same shape as `services/schedule.ts` —
 * the hooks in `hooks/useHrAttendanceData.ts` and `hooks/useCalendarSession.ts`
 * wrap these with `useQuery`.
 */
import { frappeCall } from "@/lib/frappe";
import type { CalendarEmployee, CalendarPayload } from "@/types/calendar";
import type { CalendarSession } from "@/hooks/useCalendarSession";

const NS = "dewey_time.attendance_engine.hr_calendar";

export function listCalendarEmployees() {
  return frappeCall<{ employees: CalendarEmployee[]; current_user_employee: string | null }>(
    `${NS}.list_calendar_employees`,
  );
}

export function getEmployeeCalendar(args: {
  employee: string;
  startDate: string;
  endDate: string;
}) {
  return frappeCall<CalendarPayload>(`${NS}.get_employee_calendar`, {
    employee: args.employee,
    start_date: args.startDate,
    end_date: args.endDate,
  });
}

export function getCalendarSession() {
  return frappeCall<CalendarSession>(`${NS}.get_calendar_session`);
}
