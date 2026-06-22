import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useRef, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import type {
  ClearSchedulePreview,
  ClearScheduleResponse,
  ClearScheduleResult,
} from "@/types/schedule";

export const PREVIEW_CLEAR_METHOD =
  "dewey_time.attendance_engine.dev_tools.preview_clear_employee_schedule_api";

export const CLEAR_SCHEDULE_METHOD =
  "dewey_time.attendance_engine.dev_tools.clear_employee_schedule_api";

export function useClearEmployeeSchedule() {
  const previewCall = useFrappePostCall<{ message: ClearSchedulePreview }>(PREVIEW_CLEAR_METHOD);
  const clearCall = useFrappePostCall<{ message: ClearScheduleResponse }>(CLEAR_SCHEDULE_METHOD);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const previewCallRef = useRef(previewCall);
  previewCallRef.current = previewCall;
  const clearCallRef = useRef(clearCall);
  clearCallRef.current = clearCall;

  const loading = previewCall.loading || clearCall.loading;

  const loadPreview = useCallback(async (employee: string): Promise<ClearSchedulePreview | null> => {
    setStatus(null);
    previewCallRef.current.reset();
    try {
      const result = await previewCallRef.current.call({ employee });
      return result?.message ?? (result as unknown as ClearSchedulePreview) ?? null;
    } catch (error) {
      setStatus({ type: "error", message: formatAttendanceLoadError(error) });
      return null;
    }
  }, []);

  const clearSchedule = useCallback(
    async (employee: string): Promise<ClearScheduleResult | null> => {
      setStatus(null);
      clearCallRef.current.reset();
      try {
        const result = await clearCallRef.current.call({ employee, confirm: true });
        const payload = result?.message ?? (result as unknown as ClearScheduleResponse);
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
    []
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
