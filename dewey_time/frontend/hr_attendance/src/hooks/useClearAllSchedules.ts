import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useRef, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import type {
  ClearAllSchedulesPreview,
  ClearAllSchedulesResponse,
  ClearAllSchedulesResult,
} from "@/types/schedule";

export const PREVIEW_CLEAR_ALL_METHOD =
  "dewey_time.attendance_engine.dev_tools.preview_clear_all_employee_schedules_api";

export const CLEAR_ALL_SCHEDULES_METHOD =
  "dewey_time.attendance_engine.dev_tools.clear_all_employee_schedules_api";

export const CLEAR_ALL_CONFIRM_PHRASE = "CLEAR ALL SCHEDULES";

export function useClearAllSchedules() {
  const previewCall = useFrappePostCall<{ message: ClearAllSchedulesPreview }>(PREVIEW_CLEAR_ALL_METHOD);
  const clearCall = useFrappePostCall<{ message: ClearAllSchedulesResponse }>(CLEAR_ALL_SCHEDULES_METHOD);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const previewCallRef = useRef(previewCall);
  previewCallRef.current = previewCall;
  const clearCallRef = useRef(clearCall);
  clearCallRef.current = clearCall;

  const loading = previewCall.loading || clearCall.loading;

  const loadPreview = useCallback(
    async (includeAllActive = false): Promise<ClearAllSchedulesPreview | null> => {
      setStatus(null);
      previewCallRef.current.reset();
      try {
        const result = await previewCallRef.current.call({
          include_all_active: includeAllActive ? 1 : 0,
        });
        return result?.message ?? (result as unknown as ClearAllSchedulesPreview) ?? null;
      } catch (error) {
        setStatus({ type: "error", message: formatAttendanceLoadError(error) });
        return null;
      }
    },
    []
  );

  const clearAllSchedules = useCallback(
    async (includeAllActive = false): Promise<ClearAllSchedulesResult | null> => {
      setStatus(null);
      clearCallRef.current.reset();
      try {
        const result = await clearCallRef.current.call({
          confirm: true,
          confirm_phrase: CLEAR_ALL_CONFIRM_PHRASE,
          include_all_active: includeAllActive ? 1 : 0,
        });
        const payload = result?.message ?? (result as unknown as ClearAllSchedulesResponse);
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
    []
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
