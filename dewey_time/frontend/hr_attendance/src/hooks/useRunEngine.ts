import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";

export const RUN_ENGINE_METHOD = "dewey_time.attendance_engine.dev_tools.run_engine_for_employee";

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
  const { call, loading, reset } = useFrappePostCall<{ message: RunEngineResponse }>(RUN_ENGINE_METHOD);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

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
        const result = await call(args);
        const payload = result?.message ?? (result as unknown as RunEngineResponse);
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
    [call, reset]
  );

  const clearStatus = useCallback(() => setStatus(null), []);

  return {
    runEngine,
    loading,
    status,
    clearStatus,
  };
}
