import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getScheduleCoverage } from "@/services/coverage";
import { getEnrollmentReport } from "@/services/enrollment";
import { queryKeys } from "@/lib/queryKeys";
import {
  composeRegister,
  type FeedHealth,
  type RegisterAlert,
  type RegisterRow,
} from "@/lib/coverageRegister";

export type CoverageRegister = {
  /** Joined AND suppressed — see composeRegister's doc comment for why the order matters. */
  rows: RegisterRow[];
  feeds: FeedHealth;
  alert: RegisterAlert;
  truncated: boolean;
  isLoading: boolean;
  /** Neither feed answered — there is genuinely nothing to render. */
  bothFailed: boolean;
  refresh: () => void;
};

export function useCoverageRegister(nowMs: number): CoverageRegister {
  // TWO queries, deliberately, under separate query-key families. A merged
  // endpoint would couple the feeds and a biometric outage would take
  // schedule data down with it — the opposite of what per-column suppression
  // is for. Separate keys also mean invalidating one never touches the other.
  const {
    data: coverageData,
    error: coverageError,
    isLoading: coverageLoading,
    refetch: refetchCoverage,
  } = useQuery({
    queryKey: queryKeys.coverage.all,
    queryFn: getScheduleCoverage,
  });
  const {
    data: enrollmentData,
    error: enrollmentError,
    isLoading: enrollmentLoading,
    refetch: refetchEnrollment,
  } = useQuery({
    queryKey: queryKeys.enrollment.all,
    queryFn: getEnrollmentReport,
  });

  return useMemo(() => {
    // composeRegister owns the join → suppress → alert ordering; see its doc
    // comment in coverageRegister.ts for why the alert must be computed on
    // the SUPPRESSED rows, not the raw join.
    const { rows, feeds, alert } = composeRegister(coverageData, enrollmentData, nowMs);

    return {
      rows,
      feeds,
      alert,
      truncated: Boolean(coverageData?.counts?.truncated || enrollmentData?.counts?.truncated),
      isLoading: coverageLoading || enrollmentLoading,
      bothFailed: Boolean(coverageError) && Boolean(enrollmentError),
      refresh: () => {
        void refetchCoverage();
        void refetchEnrollment();
      },
    };
  }, [
    coverageData,
    enrollmentData,
    coverageLoading,
    enrollmentLoading,
    coverageError,
    enrollmentError,
    refetchCoverage,
    refetchEnrollment,
    nowMs,
  ]);
}
