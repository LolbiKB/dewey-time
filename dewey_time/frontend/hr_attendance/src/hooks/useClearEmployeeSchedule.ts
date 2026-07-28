import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import { queryKeys } from "@/lib/queryKeys";
import { clearEmployeeSchedule as clearEmployeeScheduleApi, previewClearEmployeeSchedule } from "@/services/maintenance";
import type {
  ClearSchedulePreview,
  ClearScheduleResponse,
  ClearScheduleResult,
} from "@/types/schedule";

export function useClearEmployeeSchedule() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const {
    mutateAsync: clearMutateAsync,
    reset: resetClearMutation,
    isPending: clearing,
  } = useMutation({
    mutationFn: (employee: string) => clearEmployeeScheduleApi(employee),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedule.all });
      // Clearing a schedule changes what the attendance week shows. Nothing
      // invalidated the calendar/coverage caches before this — they silently
      // served stale data.
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.coverage.all });
    },
  });

  const loading = previewLoading || clearing;

  const loadPreview = useCallback(
    async (employee: string): Promise<ClearSchedulePreview | null> => {
      setStatus(null);
      setPreviewLoading(true);
      try {
        return await queryClient.fetchQuery({
          queryKey: queryKeys.maintenance.employeeClearPreview(employee),
          queryFn: () => previewClearEmployeeSchedule(employee),
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

  const clearSchedule = useCallback(
    async (employee: string): Promise<ClearScheduleResult | null> => {
      setStatus(null);
      resetClearMutation();
      try {
        const payload: ClearScheduleResponse = await clearMutateAsync(employee);
        if (!payload) {
          setStatus({ type: "error", message: "Clear did not return a response" });
          return null;
        }
        if ("needs_confirm" in payload && payload.needs_confirm) {
          setStatus({ type: "error", message: "Server requires confirmation" });
          return null;
        }
        const summary = payload as ClearScheduleResult;
        const parts = [
          `${summary.deleted_assignments.length} shift assignment(s)`,
          `${summary.deleted_ssas.length} SSA(s) deleted`,
          summary.disabled_ssas.length
            ? `${summary.disabled_ssas.length} SSA(s) disabled`
            : null,
          `${summary.deleted_flags} flag(s)`,
        ].filter(Boolean);
        setStatus({ type: "success", message: `Cleared: ${parts.join(" · ")}` });
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
    clearSchedule,
    loading,
    status,
    clearStatus,
  };
}
