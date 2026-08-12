import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getScheduleCoverage } from "@/services/coverage";
import { getEnrollmentReport } from "@/services/enrollment";
import { queryKeys } from "@/lib/queryKeys";
import {
  composeRegister,
  registerFeedState,
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
  /** Neither feed answered, and neither is holding data from a prior load — see registerFeedState. */
  bothFailed: boolean;
  refresh: () => void;
};

/**
 * The two queries' options, exported (not inlined in the hook) so a plain
 * node:test — there is no jsdom/React Testing Library in this suite, so the
 * hook itself cannot be rendered — can pin the queryKey -> queryFn pairing
 * directly. Both keys are `readonly string[]`, so a swap between the two
 * calls typechecks; it would silently collide this query's cache entry with
 * useScheduleCoverage's under the wrong queryFn.
 */
export const coverageQueryOptions = {
  queryKey: queryKeys.coverage.all,
  queryFn: getScheduleCoverage,
} as const;

export const enrollmentQueryOptions = {
  queryKey: queryKeys.enrollment.all,
  queryFn: getEnrollmentReport,
} as const;

/**
 * Both feeds must refetch on refresh. Exported as a plain function of two
 * callbacks (not react-query's live `refetch`) so a node:test can pin that
 * without rendering the hook.
 */
export function composeRefresh(
  refetchCoverage: () => unknown,
  refetchEnrollment: () => unknown,
): () => void {
  return () => {
    void refetchCoverage();
    void refetchEnrollment();
  };
}

/**
 * @param nowMs Must be stable across renders (compute it once upstream, e.g.
 * via useState/useMemo — never pass `Date.now()` inline). This hook memoises
 * on it, so a fresh value every render defeats the memo, and the staleness
 * boundary composeRegister/feedHealth compute from it can flap between
 * renders. The hook cannot enforce this itself.
 */
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
  } = useQuery(coverageQueryOptions);
  const {
    data: enrollmentData,
    error: enrollmentError,
    isLoading: enrollmentLoading,
    refetch: refetchEnrollment,
  } = useQuery(enrollmentQueryOptions);

  return useMemo(() => {
    // composeRegister owns the join → suppress → alert ordering; see its doc
    // comment in coverageRegister.ts for why the alert must be computed on
    // the SUPPRESSED rows, not the raw join.
    const { rows, feeds, alert } = composeRegister(coverageData, enrollmentData, nowMs);
    const { truncated, isLoading, bothFailed } = registerFeedState(
      { data: coverageData, error: coverageError, isLoading: coverageLoading },
      { data: enrollmentData, error: enrollmentError, isLoading: enrollmentLoading },
    );

    return {
      rows,
      feeds,
      alert,
      truncated,
      isLoading,
      bothFailed,
      refresh: composeRefresh(refetchCoverage, refetchEnrollment),
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
