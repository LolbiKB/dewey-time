import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { EnrollmentPayload } from "@/lib/enrollmentReport";
import { queryKeys } from "@/lib/queryKeys";
import { getEnrollmentReport } from "@/services/enrollment";

export type EnrollmentReport = {
  /** Undefined until loaded, and undefined on error -- deliberately NOT an
   *  empty payload, which would render as "nobody is enrolled". */
  payload: EnrollmentPayload | undefined;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
};

export function useEnrollmentReport(): EnrollmentReport {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.enrollment.all,
    queryFn: getEnrollmentReport,
  });

  return useMemo(
    () => ({ payload: data, isLoading, error, refresh: () => void refetch() }),
    [data, isLoading, error, refetch],
  );
}
