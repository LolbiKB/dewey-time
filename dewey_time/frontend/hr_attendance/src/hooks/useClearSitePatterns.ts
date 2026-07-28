import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import { queryKeys } from "@/lib/queryKeys";
import {
  clearSitePatternsStep as clearSitePatternsStepApi,
  previewClearSitePatterns,
} from "@/services/maintenance";
import type { ClearSitePatternsPreview } from "@/types/schedule";

export const CLEAR_SITE_PATTERNS_CONFIRM_PHRASE = "CLEAR SITE PATTERNS";

export type WipeStep = {
  clear_employee_data: boolean;
  current_table: string | null;
  deleted: number;
  counts: Record<string, number>;
  total_remaining: number;
  done: boolean;
  verified_empty: boolean;
  remaining_counts: Record<string, number> | null;
};

export type WipeProgress = {
  processed: number;
  total: number;
  currentTable: string | null;
  done: boolean;
};

// Backstop against an infinite loop if the server never reports `done` (batch=2000, so
// even a very large site is a few dozen steps).
const MAX_WIPE_STEPS = 5000;

export function useClearSitePatterns() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [progress, setProgress] = useState<WipeProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Each call is one bounded, committed batch (see MAX_WIPE_STEPS loop below) —
  // there's no single "the clear succeeded" mutation event to hang cache
  // invalidation off of (this mutation's onSuccess would fire — and
  // re-invalidate — after every intermediate step). Instead invalidation
  // happens once, unconditionally, in clearSitePatterns's own `finally` below,
  // covering every exit from the loop (done, step limit, or a thrown error).
  const { mutateAsync: stepMutateAsync } = useMutation({
    mutationFn: (args: { clearEmployeeData: boolean }) =>
      clearSitePatternsStepApi({
        confirmPhrase: CLEAR_SITE_PATTERNS_CONFIRM_PHRASE,
        clearEmployeeData: args.clearEmployeeData,
      }),
  });

  const loading = previewLoading || running;

  const loadPreview = useCallback(
    async (clearEmployeeData = true): Promise<ClearSitePatternsPreview | null> => {
      setStatus(null);
      setPreviewLoading(true);
      try {
        return await queryClient.fetchQuery({
          queryKey: queryKeys.maintenance.siteClearPreview(clearEmployeeData),
          queryFn: () => previewClearSitePatterns(clearEmployeeData),
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

  const clearSitePatterns = useCallback(
    async (clearEmployeeData = true): Promise<WipeStep | null> => {
      setStatus(null);
      setProgress({ processed: 0, total: 0, currentTable: null, done: false });
      setRunning(true);
      try {
        let initialTotal = 0;
        for (let i = 0; i < MAX_WIPE_STEPS; i++) {
          const step = await stepMutateAsync({ clearEmployeeData });
          if (!step) {
            setStatus({ type: "error", message: "Wipe step returned no response" });
            return null;
          }

          const remaining = step.total_remaining ?? 0;
          // The first step already deleted a batch, so the pre-wipe total is
          // (what's left) + (what this step removed).
          if (initialTotal === 0) initialTotal = remaining + (step.deleted ?? 0);
          const total = Math.max(initialTotal, remaining);
          setProgress({
            processed: Math.max(0, total - remaining),
            total,
            currentTable: step.current_table,
            done: step.done,
          });

          if (step.done) {
            setProgress({ processed: total, total, currentTable: null, done: true });
            if (step.verified_empty) {
              setStatus({ type: "success", message: "Site wipe verified clean — all tables empty." });
            } else {
              const leftover = Object.entries(step.remaining_counts ?? {})
                .filter(([, count]) => count > 0)
                .map(([table, count]) => `${count} ${table}`)
                .join(", ");
              setStatus({
                type: "error",
                message: `Wipe incomplete — rows remain: ${leftover || "unknown"}.`,
              });
            }
            return step;
          }
        }
        setStatus({ type: "error", message: "Wipe did not finish within the step limit." });
        return null;
      } catch (error) {
        setStatus({ type: "error", message: formatAttendanceLoadError(error) });
        return null;
      } finally {
        // Every batch here is independently committed, so the database can have
        // changed even if this call returns null/throws (a bad step response, the
        // MAX_WIPE_STEPS backstop, or a network drop mid-wipe). Invalidate
        // unconditionally, once per call, regardless of how the loop exits —
        // otherwise those paths leave deleted rows in the calendar/coverage/
        // schedule caches.
        void queryClient.invalidateQueries({ queryKey: queryKeys.schedule.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.coverage.all });
        setRunning(false);
      }
    },
    [queryClient, stepMutateAsync]
  );

  const clearStatus = useCallback(() => {
    setStatus(null);
    setProgress(null);
  }, []);

  return {
    loadPreview,
    clearSitePatterns,
    loading,
    running,
    progress,
    status,
    clearStatus,
  };
}
