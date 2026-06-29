import { useFrappeGetCall } from "frappe-react-sdk";
import { useMemo } from "react";

import {
  bucketByWeeklyHours,
  type CoverageCounts,
  type CoverageEmployee,
  type HoursBucket,
  type ScheduleCoveragePayload,
} from "@/lib/scheduleCoverage";

const COVERAGE_METHOD = "dewey_time.attendance_engine.coverage_api.get_schedule_coverage";

const EMPTY_COUNTS: CoverageCounts = { active: 0, unassigned: 0, assigned: 0 };

export type ScheduleCoverage = {
  unassigned: CoverageEmployee[];
  buckets: HoursBucket[];
  counts: CoverageCounts;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
};

export function useScheduleCoverage(): ScheduleCoverage {
  const { data, error, isLoading, mutate } = useFrappeGetCall<ScheduleCoveragePayload>(
    COVERAGE_METHOD,
    undefined,
    COVERAGE_METHOD,
  );

  const payload = data?.message;

  return useMemo(
    () => ({
      unassigned: payload?.unassigned ?? [],
      buckets: bucketByWeeklyHours(payload?.assigned ?? []),
      counts: payload?.counts ?? EMPTY_COUNTS,
      isLoading,
      error,
      refresh: () => void mutate(),
    }),
    [payload, isLoading, error, mutate],
  );
}
