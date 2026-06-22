import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import type {
  ApplyScheduleResult,
  HolidayPreviewItem,
  ResolvePlan,
  ScheduleContext,
  WeeklyScheduleTemplate,
  WeekPattern,
} from "@/types/schedule";
import { validateWeekPattern, weekPatternForApi } from "@/types/schedule";

const CONTEXT_METHOD = "dewey_time.attendance_engine.schedule_api.get_employee_schedule_context";
const RESOLVE_METHOD = "dewey_time.attendance_engine.schedule_api.resolve_weekly_schedule_plan";
const HOLIDAY_METHOD = "dewey_time.attendance_engine.schedule_api.get_holiday_preview";
const APPLY_METHOD = "dewey_time.attendance_engine.schedule_api.apply_weekly_schedule";
const TEMPLATES_METHOD = "dewey_time.attendance_engine.schedule_api.list_weekly_schedule_templates";

export function useScheduleContext(employee: string | null) {
  const params = useMemo(() => (employee ? { employee } : undefined), [employee]);
  const swrKey = employee ? `${CONTEXT_METHOD}:${employee}` : null;

  const { data, error, isLoading, mutate } = useFrappeGetCall<ScheduleContext>(
    CONTEXT_METHOD,
    params,
    swrKey
  );

  return {
    context: data?.message ?? null,
    error,
    isLoading,
    refresh: mutate,
  };
}

export function useHolidayPreview(
  employee: string | null,
  startDate: string | null,
  endDate: string | null
) {
  const params = useMemo(
    () =>
      employee && startDate && endDate
        ? { employee, start_date: startDate, end_date: endDate }
        : undefined,
    [employee, endDate, startDate]
  );
  const swrKey =
    employee && startDate && endDate
      ? `${HOLIDAY_METHOD}:${employee}:${startDate}:${endDate}`
      : null;

  const { data, error, isLoading } = useFrappeGetCall<{ holidays: HolidayPreviewItem[] }>(
    HOLIDAY_METHOD,
    params,
    swrKey
  );

  return {
    holidays: data?.message?.holidays ?? [],
    error,
    isLoading,
  };
}

export function useWeeklyScheduleResolve(
  employee: string | null,
  weekPattern: WeekPattern,
  effectiveFrom: string | null,
  debounceMs = 300
) {
  const validationIssues = useMemo(() => validateWeekPattern(weekPattern), [weekPattern]);
  const patternValid = validationIssues.length === 0;
  const apiPattern = useMemo(() => weekPatternForApi(weekPattern), [weekPattern]);
  const patternJson = useMemo(() => JSON.stringify(apiPattern), [apiPattern]);

  const [debouncedPatternJson, setDebouncedPatternJson] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!employee || !effectiveFrom || !patternValid) {
      setDebouncedPatternJson(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedPatternJson(patternJson), debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [debounceMs, effectiveFrom, employee, patternJson, patternValid]);

  const params = useMemo(
    () =>
      employee && effectiveFrom && debouncedPatternJson
        ? {
            employee,
            effective_from: effectiveFrom,
            week_pattern: debouncedPatternJson,
          }
        : undefined,
    [debouncedPatternJson, effectiveFrom, employee]
  );

  const swrKey =
    employee && effectiveFrom && debouncedPatternJson
      ? `${RESOLVE_METHOD}:${employee}:${effectiveFrom}:${debouncedPatternJson}`
      : null;

  const { data, error, isLoading, mutate } = useFrappeGetCall<ResolvePlan>(
    RESOLVE_METHOD,
    params,
    swrKey
  );

  const isDebouncing = Boolean(
    patternValid && employee && effectiveFrom && debouncedPatternJson !== patternJson
  );
  const hasPlan = Boolean(data?.message);
  const resolving = isDebouncing || Boolean(swrKey && isLoading && !hasPlan);

  const refreshPlan = useCallback(() => {
    if (!patternValid || !employee || !effectiveFrom) return;
    setDebouncedPatternJson(patternJson);
    void mutate();
  }, [effectiveFrom, employee, mutate, patternJson, patternValid]);

  return {
    plan: data?.message ?? null,
    resolveError: error,
    resolving,
    validationIssues,
    patternValid,
    refreshPlan,
  };
}

export function useApplyWeeklySchedule() {
  const { call, loading, reset } = useFrappePostCall<{ message: ApplyScheduleResult }>(APPLY_METHOD);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const apply = useCallback(
    async (args: {
      employee: string;
      week_pattern: WeekPattern;
      create_shifts_after: string;
      generate_through?: string | null;
      confirm_create?: boolean;
    }): Promise<ApplyScheduleResult | null> => {
      setStatus(null);
      reset();

      try {
        const result = await call({
          employee: args.employee,
          week_pattern: JSON.stringify(weekPatternForApi(args.week_pattern)),
          create_shifts_after: args.create_shifts_after,
          generate_through: args.generate_through ?? "",
          confirm_create: args.confirm_create ? 1 : 0,
        });
        const payload = result?.message ?? (result as unknown as ApplyScheduleResult);

        if (payload?.needs_confirm) {
          return payload;
        }

        if (!payload?.ok) {
          setStatus({ type: "error", message: "Save did not complete successfully." });
          return null;
        }

        setStatus({
          type: "success",
          message: "Schedule saved and assignments generated.",
        });
        return payload;
      } catch (error) {
        setStatus({ type: "error", message: formatAttendanceLoadError(error) });
        return null;
      }
    },
    [call, reset]
  );

  return { apply, applying: loading, status, clearStatus: () => setStatus(null) };
}

export function useWeeklyScheduleTemplates(limit = 12) {
  const params = useMemo(() => ({ limit }), [limit]);
  const swrKey = `${TEMPLATES_METHOD}:${limit}`;

  const { data, error, isLoading, mutate } = useFrappeGetCall<{ templates: WeeklyScheduleTemplate[] }>(
    TEMPLATES_METHOD,
    params,
    swrKey
  );

  return {
    templates: data?.message?.templates ?? [],
    error,
    isLoading,
    refresh: mutate,
  };
}
