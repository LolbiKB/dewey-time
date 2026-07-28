import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { queryKeys } from "@/lib/queryKeys";
import { getCalendarSession } from "@/services/calendar";

export type CalendarSession = {
  hr_staff: boolean;
  employee_id: string | null;
};

export function useCalendarSession() {
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.session.all,
    queryFn: getCalendarSession,
  });

  return useMemo(
    () => ({
      hrStaff: data?.hr_staff ?? false,
      linkedEmployeeId: data?.employee_id ?? null,
      isLoading,
      error,
    }),
    [error, isLoading, data?.employee_id, data?.hr_staff]
  );
}
