import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import { queryKeys } from "@/lib/queryKeys";
import { resolveSchedulePlan } from "@/services/schedule";
import type { ResolvePlan, WeekPattern } from "@/types/schedule";
import { summarizeWeekPattern, weekPatternForApi } from "@/types/schedule";

export type ImportPatternBucket = {
  patternKey: string;
  weekPattern: WeekPattern;
  employeeCount: number;
  representativeEmployee: string;
};

export type ImportPatternPlan = ImportPatternBucket & {
  plan: ResolvePlan | null;
  error: string | null;
};

export type ImportPlanStats = {
  selectedEmployees: number;
  uniquePatterns: number;
  totalSsaAssignments: number;
  newShiftSchedules: number;
  existingShiftSchedules: number;
  newShiftTypes: number;
  existingShiftTypes: number;
  needsCreate: boolean;
  weeklyMinutesMin: number | null;
  weeklyMinutesMax: number | null;
};

function patternKey(pattern: WeekPattern): string {
  return JSON.stringify(weekPatternForApi(pattern));
}

function collectStats(plans: ImportPatternPlan[]): ImportPlanStats {
  const shiftSchedulesNew = new Set<string>();
  const shiftSchedulesUse = new Set<string>();
  const shiftTypesNew = new Set<string>();
  const shiftTypesUse = new Set<string>();
  const weeklyMinutes: number[] = [];
  let needsCreate = false;
  let selectedEmployees = 0;
  let totalSsaAssignments = 0;

  for (const entry of plans) {
    selectedEmployees += entry.employeeCount;
    const { totalWeeklyMinutes } = summarizeWeekPattern(entry.weekPattern);
    if (totalWeeklyMinutes > 0) weeklyMinutes.push(totalWeeklyMinutes);

    const plan = entry.plan;
    if (!plan) continue;
    if (plan.needs_create) needsCreate = true;
    const groupCount = plan.groups?.length ?? 0;
    totalSsaAssignments += groupCount * entry.employeeCount;
    for (const group of plan.groups ?? []) {
      const st = group.shift_type;
      const ss = group.shift_schedule;
      if (st.action === "create" && st.proposed_name) shiftTypesNew.add(st.proposed_name);
      if (st.action === "use" && st.name) shiftTypesUse.add(st.name);
      if (ss.action === "create" && ss.proposed_name) shiftSchedulesNew.add(ss.proposed_name);
      if (ss.action === "use" && ss.name) shiftSchedulesUse.add(ss.name);
    }
  }

  return {
    selectedEmployees,
    uniquePatterns: plans.length,
    totalSsaAssignments,
    newShiftSchedules: shiftSchedulesNew.size,
    existingShiftSchedules: shiftSchedulesUse.size,
    newShiftTypes: shiftTypesNew.size,
    existingShiftTypes: shiftTypesUse.size,
    needsCreate,
    weeklyMinutesMin: weeklyMinutes.length ? Math.min(...weeklyMinutes) : null,
    weeklyMinutesMax: weeklyMinutes.length ? Math.max(...weeklyMinutes) : null,
  };
}

export function useImportSchedulePlanSummary(
  buckets: ImportPatternBucket[],
  effectiveFrom: string | null,
  debounceMs = 400
) {
  const [debouncedKey, setDebouncedKey] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bucketKey = useMemo(() => {
    if (!effectiveFrom || !buckets.length) return null;
    return `${effectiveFrom}:${buckets.map((b) => `${b.patternKey}:${b.representativeEmployee}`).join("|")}`;
  }, [buckets, effectiveFrom]);

  useEffect(() => {
    if (!bucketKey) {
      setDebouncedKey(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedKey(bucketKey), debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [bucketKey, debounceMs]);

  // Debounce the trigger, not each request (same shape as
  // useWeeklyScheduleResolve): the buckets themselves are known
  // synchronously (they come from the current selection), so they stay live
  // — only the network fetch is gated on `settled`, via each query's
  // `enabled`. This is what useWeeklyScheduleResolve's `isDebouncing` fold
  // into `resolving` does too: keep the panel mounted (bucket/employee
  // counts render immediately) and show "Matching…" through the debounce
  // window, instead of unmounting it on every selection change.
  const settled = bucketKey !== null && bucketKey === debouncedKey;

  const results = useQueries({
    queries: buckets.map((bucket) => ({
      queryKey: queryKeys.schedule.resolve(
        bucket.representativeEmployee,
        effectiveFrom ?? "",
        bucket.patternKey
      ),
      queryFn: () =>
        resolveSchedulePlan({
          employee: bucket.representativeEmployee,
          effectiveFrom: effectiveFrom!,
          weekPatternJson: bucket.patternKey,
        }),
      enabled: settled,
    })),
  });

  const plans: ImportPatternPlan[] = buckets.map((bucket, i) => {
    const result = results[i];
    if (result?.isError) {
      return { ...bucket, plan: null, error: formatAttendanceLoadError(result.error) };
    }
    return { ...bucket, plan: result?.data ?? null, error: null };
  });

  const loading = !settled || results.some((r) => r.isPending);
  const stats = collectStats(plans);

  // Per-bucket errors already surface on `plans[i].error` above; this
  // top-level field mirrors the pre-conversion hook's shape (a genuine
  // Promise.all-level failure, which can't happen with useQueries — each
  // query fails independently into its own `result.isError`) so callers
  // don't need to change.
  return { plans, stats, loading, error: null as string | null };
}

export function buildImportPatternBuckets(
  rows: Array<{ employee: string | null; week_pattern: WeekPattern | null; importable: boolean }>,
  selected: Set<number>
): ImportPatternBucket[] {
  const grouped = new Map<
    string,
    { weekPattern: WeekPattern; employees: string[] }
  >();

  rows.forEach((row, index) => {
    if (!selected.has(index) || !row.importable || !row.employee || !row.week_pattern) return;
    const key = patternKey(row.week_pattern);
    const bucket = grouped.get(key) ?? { weekPattern: row.week_pattern, employees: [] };
    bucket.employees.push(row.employee);
    grouped.set(key, bucket);
  });

  return [...grouped.entries()].map(([key, value]) => ({
    patternKey: key,
    weekPattern: value.weekPattern,
    employeeCount: value.employees.length,
    representativeEmployee: value.employees[0]!,
  }));
}
