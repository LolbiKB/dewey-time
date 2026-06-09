import { useFrappePostCall } from "frappe-react-sdk";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import type { ResolvePlan, WeekPattern } from "@/types/schedule";
import { summarizeWeekPattern, weekPatternForApi } from "@/types/schedule";

const RESOLVE_METHOD = "zkteco_hr.attendance_engine.schedule_api.resolve_weekly_schedule_plan";

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
  const { call } = useFrappePostCall<{ message: ResolvePlan }>(RESOLVE_METHOD);
  const [plans, setPlans] = useState<ImportPatternPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedKey, setDebouncedKey] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

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

  useEffect(() => {
    if (!debouncedKey || !effectiveFrom || !buckets.length) {
      setPlans([]);
      setLoading(false);
      setError(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const resolved = await Promise.all(
          buckets.map(async (bucket): Promise<ImportPatternPlan> => {
            try {
              const result = await call({
                employee: bucket.representativeEmployee,
                effective_from: effectiveFrom,
                week_pattern: JSON.stringify(weekPatternForApi(bucket.weekPattern)),
              });
              const plan = result?.message ?? (result as unknown as ResolvePlan);
              return { ...bucket, plan, error: null };
            } catch (err) {
              return {
                ...bucket,
                plan: null,
                error: formatAttendanceLoadError(err),
              };
            }
          })
        );

        if (requestId.current !== id) return;
        setPlans(resolved);
      } catch (err) {
        if (requestId.current !== id) return;
        setError(formatAttendanceLoadError(err));
        setPlans([]);
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    })();
  }, [debouncedKey, buckets, call, effectiveFrom]);

  const stats = useMemo(() => collectStats(plans), [plans]);

  return { plans, stats, loading, error };
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
