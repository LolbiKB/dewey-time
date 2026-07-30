import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extractFrappeError } from "@/lib/frappeError";
import { queryKeys } from "@/lib/queryKeys";
import {
  applyWeeklySchedule,
  getHolidayPreview,
  getScheduleContext,
  listScheduleTemplates,
  resolveSchedulePlan,
} from "@/services/schedule";
import type { ApplyScheduleResult, WeekPattern } from "@/types/schedule";
import { validateWeekPattern, weekPatternForApi } from "@/types/schedule";

export function useScheduleContext(employee: string | null) {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: employee ? queryKeys.schedule.context(employee) : queryKeys.schedule.all,
    queryFn: () => getScheduleContext(employee!),
    enabled: Boolean(employee),
  });

  return {
    context: data ?? null,
    error,
    isLoading,
    refresh: refetch,
  };
}

export function useHolidayPreview(
  employee: string | null,
  startDate: string | null,
  endDate: string | null
) {
  const enabled = Boolean(employee && startDate && endDate);

  const { data, error, isLoading } = useQuery({
    queryKey: enabled
      ? queryKeys.schedule.holidays(employee!, startDate!, endDate!)
      : queryKeys.schedule.all,
    queryFn: () =>
      getHolidayPreview({ employee: employee!, startDate: startDate!, endDate: endDate! }),
    enabled,
  });

  return {
    holidays: data?.holidays ?? [],
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

  const enabled = Boolean(employee && effectiveFrom && debouncedPatternJson);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: enabled
      ? queryKeys.schedule.resolve(employee!, effectiveFrom!, debouncedPatternJson!)
      : queryKeys.schedule.all,
    queryFn: () =>
      resolveSchedulePlan({
        employee: employee!,
        effectiveFrom: effectiveFrom!,
        weekPatternJson: debouncedPatternJson!,
      }),
    enabled,
  });

  const isDebouncing = Boolean(
    patternValid && employee && effectiveFrom && debouncedPatternJson !== patternJson
  );
  const hasPlan = Boolean(data);
  const resolving = isDebouncing || Boolean(enabled && isLoading && !hasPlan);

  const refreshPlan = useCallback(() => {
    if (!patternValid || !employee || !effectiveFrom) return;
    setDebouncedPatternJson(patternJson);
    void refetch();
  }, [effectiveFrom, employee, patternJson, patternValid, refetch]);

  return {
    plan: data ?? null,
    resolveError: error,
    resolving,
    validationIssues,
    patternValid,
    refreshPlan,
  };
}

export function useApplyWeeklySchedule() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { mutateAsync, reset, isPending } = useMutation({
    mutationFn: (args: {
      employee: string;
      week_pattern: WeekPattern;
      create_shifts_after: string;
      generate_through?: string | null;
      confirm_create?: boolean;
    }) =>
      applyWeeklySchedule({
        employee: args.employee,
        week_pattern: JSON.stringify(weekPatternForApi(args.week_pattern)),
        create_shifts_after: args.create_shifts_after,
        generate_through: args.generate_through ?? "",
        confirm_create: Boolean(args.confirm_create),
      }),
    onSuccess: (payload) => {
      // A needs_confirm response is the server's dry run — it wrote nothing, so
      // there is no stale cache to clear. Without this, every "Review changes"
      // click invalidates three families and refetches every active query in
      // them for a preview the user has not accepted yet.
      if (payload?.needs_confirm) return;

      void queryClient.invalidateQueries({ queryKey: queryKeys.schedule.all });
      // Clearing or re-applying a schedule changes what the attendance week shows.
      // Nothing invalidated this before — the calendar silently served stale data.
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.coverage.all });
      // list_calendar_employees carries has_shift_assignment,
      // schedule_min/max_date and shift_schedule_assignment, all of which this
      // mutation changes. staleTime:0 hides it across a route change but not
      // within a mount: the schedule and import pages keep the picker mounted,
      // so it kept sorting a just-cleared employee under "assigned".
      void queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
    },
  });

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
        const payload = await mutateAsync(args);

        if (payload?.needs_confirm) {
          return payload;
        }

        if (!payload?.ok) {
          setStatus({
            type: "error",
            message: extractFrappeError(payload, "Save did not complete successfully."),
          });
          return null;
        }

        setStatus({
          type: "success",
          message: "Schedule saved and assignments generated.",
        });
        return payload;
      } catch (error) {
        setStatus({
          type: "error",
          message: extractFrappeError(error, "Couldn't save the schedule. Please try again."),
        });
        return null;
      }
    },
    [mutateAsync, reset]
  );

  return { apply, applying: isPending, status, clearStatus: () => setStatus(null) };
}

export function useWeeklyScheduleTemplates(limit = 12) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.schedule.templates(limit),
    queryFn: () => listScheduleTemplates(limit),
  });

  return {
    templates: data?.templates ?? [],
    isLoading,
  };
}
