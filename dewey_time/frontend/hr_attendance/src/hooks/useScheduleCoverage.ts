import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { queryKeys } from "@/lib/queryKeys";
import {
  bucketByWeeklyHours,
  type CoverageCounts,
  type CoverageEmployee,
  type HoursBucket,
} from "@/lib/scheduleCoverage";
import { getScheduleCoverage } from "@/services/coverage";

const EMPTY_COUNTS: CoverageCounts = {
  active: 0,
  unassigned: 0,
  assigned: 0,
  truncated: false,
};

export type ScheduleCoverage = {
  unassigned: CoverageEmployee[];
  buckets: HoursBucket[];
  counts: CoverageCounts;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
};

export function useScheduleCoverage(): ScheduleCoverage {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.coverage.all,
    queryFn: getScheduleCoverage,
  });

  return useMemo(
    () => ({
      unassigned: data?.unassigned ?? [],
      buckets: bucketByWeeklyHours(data?.assigned ?? []),
      counts: data?.counts ?? EMPTY_COUNTS,
      isLoading,
      error,
      refresh: () => void refetch(),
    }),
    [data, isLoading, error, refetch],
  );
}
