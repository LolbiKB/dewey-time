/**
 * The "(dev)" flag-engine backfill behind `RunEngineDialog`.
 *
 * The dotted method path now lives once, in `services/maintenance.ts`; the
 * `RUN_ENGINE_METHOD` constant that used to sit here had no importers and would
 * only have drifted from it.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import { queryKeys } from "@/lib/queryKeys";
import { runEngineForEmployee } from "@/services/maintenance";

export type RunEngineMode = "intraday" | "closeout" | "both";

export type RunEngineDayResult = {
  date: string;
  flag_codes: string[];
};

export type RunEngineResponse = {
  ok: boolean;
  employee: string;
  start_date: string;
  end_date: string;
  mode: RunEngineMode;
  days_processed: number;
  flags_after: number;
  days: RunEngineDayResult[];
};

export function useRunEngine() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { mutateAsync, reset, isPending } = useMutation({
    mutationFn: runEngineForEmployee,
    onSuccess: () => {
      // Re-running the engine rewrites AUTO flags for the range — exactly what
      // the week grid renders, so the calendar family has to be dropped.
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
    },
  });

  const runEngine = useCallback(
    async (args: {
      employee: string;
      start_date: string;
      end_date: string;
      mode: RunEngineMode;
    }): Promise<RunEngineResponse | null> => {
      setStatus(null);
      reset();

      try {
        const payload = await mutateAsync(args);
        if (!payload?.ok) {
          setStatus({ type: "error", message: "Engine run did not return ok" });
          return null;
        }

        setStatus({
          type: "success",
          message: `Processed ${payload.days_processed} days · ${payload.flags_after} flags`,
        });
        return payload;
      } catch (error) {
        setStatus({ type: "error", message: formatAttendanceLoadError(error) });
        return null;
      }
    },
    [mutateAsync, reset]
  );

  const clearStatus = useCallback(() => setStatus(null), []);

  return {
    runEngine,
    loading: isPending,
    status,
    clearStatus,
  };
}
