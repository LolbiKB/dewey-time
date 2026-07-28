import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import { queryKeys } from "@/lib/queryKeys";
import {
  clearAllSchedules as clearAllSchedulesApi,
  previewClearAllSchedules,
} from "@/services/maintenance";
import type {
  ClearAllSchedulesPreview,
  ClearAllSchedulesResponse,
  ClearAllSchedulesResult,
} from "@/types/schedule";

export const CLEAR_ALL_CONFIRM_PHRASE = "CLEAR ALL SCHEDULES";

export function useClearAllSchedules() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const {
    mutateAsync: clearMutateAsync,
    reset: resetClearMutation,
    isPending: clearing,
  } = useMutation({
    mutationFn: (args: { includeAllActive: boolean }) =>
      clearAllSchedulesApi({ confirmPhrase: CLEAR_ALL_CONFIRM_PHRASE, includeAllActive: args.includeAllActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedule.all });
      // Clearing schedules changes what the attendance week shows. Nothing
      // invalidated the calendar/coverage caches before this — they silently
      // served stale data.
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.coverage.all });
    },
  });

  const loading = previewLoading || clearing;

  const loadPreview = useCallback(
    async (includeAllActive = false): Promise<ClearAllSchedulesPreview | null> => {
      setStatus(null);
      setPreviewLoading(true);
      try {
        return await queryClient.fetchQuery({
          queryKey: queryKeys.maintenance.allClearPreview(),
          queryFn: () => previewClearAllSchedules(includeAllActive),
        });
      } catch (error) {
        setStatus({ type: "error", message: formatAttendanceLoadError(error) });
        return null;
      } finally {
        setPreviewLoading(false);
      }
    },
    [queryClient]
  );

  const clearAllSchedules = useCallback(
    async (includeAllActive = false): Promise<ClearAllSchedulesResult | null> => {
      setStatus(null);
      resetClearMutation();
      try {
        const payload: ClearAllSchedulesResponse = await clearMutateAsync({ includeAllActive });
        if (!payload) {
          setStatus({ type: "error", message: "Clear did not return a response" });
          return null;
        }
        if ("needs_confirm" in payload && payload.needs_confirm) {
          setStatus({ type: "error", message: "Server requires confirmation" });
          return null;
        }
        const summary = payload as ClearAllSchedulesResult;
        const parts = [
          `${summary.cleared_count} employee(s)`,
          `${summary.deleted_assignments} shift assignment(s)`,
          `${summary.deleted_ssas} SSA(s) deleted`,
          summary.disabled_ssas ? `${summary.disabled_ssas} SSA(s) disabled` : null,
          `${summary.deleted_flags} flag(s)`,
        ].filter(Boolean);
        if (summary.error_count) {
          setStatus({
            type: "error",
            message: `Partial clear: ${parts.join(" · ")} · ${summary.error_count} error(s)`,
          });
        } else {
          setStatus({ type: "success", message: `Cleared: ${parts.join(" · ")}` });
        }
        return summary;
      } catch (error) {
        setStatus({ type: "error", message: formatAttendanceLoadError(error) });
        return null;
      }
    },
    [clearMutateAsync, resetClearMutation]
  );

  const clearStatus = useCallback(() => setStatus(null), []);

  return {
    loadPreview,
    clearAllSchedules,
    loading,
    status,
    clearStatus,
  };
}
