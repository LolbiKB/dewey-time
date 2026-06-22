import { useFrappeGetCall } from "frappe-react-sdk";
import { useMemo } from "react";

const SESSION_METHOD = "dewey_time.attendance_engine.hr_calendar.get_calendar_session";

type CalendarSession = {
  hr_staff: boolean;
  employee_id: string | null;
};

export function useCalendarSession() {
  const { data, error, isLoading } = useFrappeGetCall<CalendarSession>(
    SESSION_METHOD,
    undefined,
    SESSION_METHOD
  );

  const session = data?.message;

  return useMemo(
    () => ({
      hrStaff: session?.hr_staff ?? false,
      linkedEmployeeId: session?.employee_id ?? null,
      isLoading,
      error,
    }),
    [error, isLoading, session?.employee_id, session?.hr_staff]
  );
}
