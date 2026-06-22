import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useRef, useState } from "react";

import { formatAttendanceLoadError } from "@/hooks/useHrAttendanceData";
import type {
  ClearSitePatternsPreview,
  ClearSitePatternsResponse,
  ClearSitePatternsResult,
} from "@/types/schedule";

export const PREVIEW_CLEAR_SITE_PATTERNS_METHOD =
  "dewey_time.attendance_engine.dev_tools.preview_clear_site_schedule_patterns_api";

export const CLEAR_SITE_PATTERNS_METHOD =
  "dewey_time.attendance_engine.dev_tools.clear_site_schedule_patterns_api";

export const CLEAR_SITE_PATTERNS_CONFIRM_PHRASE = "CLEAR SITE PATTERNS";

export function useClearSitePatterns() {
  const previewCall = useFrappePostCall<{ message: ClearSitePatternsPreview }>(
    PREVIEW_CLEAR_SITE_PATTERNS_METHOD
  );
  const clearCall = useFrappePostCall<{ message: ClearSitePatternsResponse }>(CLEAR_SITE_PATTERNS_METHOD);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const previewCallRef = useRef(previewCall);
  previewCallRef.current = previewCall;
  const clearCallRef = useRef(clearCall);
  clearCallRef.current = clearCall;

  const loading = previewCall.loading || clearCall.loading;

  const loadPreview = useCallback(
    async (clearEmployeeData = true): Promise<ClearSitePatternsPreview | null> => {
      setStatus(null);
      previewCallRef.current.reset();
      try {
        const result = await previewCallRef.current.call({
          clear_employee_data: clearEmployeeData ? 1 : 0,
        });
        return result?.message ?? (result as unknown as ClearSitePatternsPreview) ?? null;
      } catch (error) {
        setStatus({ type: "error", message: formatAttendanceLoadError(error) });
        return null;
      }
    },
    []
  );

  const clearSitePatterns = useCallback(
    async (clearEmployeeData = true): Promise<ClearSitePatternsResult | null> => {
      setStatus(null);
      clearCallRef.current.reset();
      try {
        const result = await clearCallRef.current.call({
          confirm: true,
          confirm_phrase: CLEAR_SITE_PATTERNS_CONFIRM_PHRASE,
          clear_employee_data: clearEmployeeData ? 1 : 0,
        });
        const payload = result?.message ?? (result as unknown as ClearSitePatternsResponse);
        if (!payload) {
          setStatus({ type: "error", message: "Clear did not return a response" });
          return null;
        }
        if ("needs_confirm" in payload && payload.needs_confirm) {
          setStatus({ type: "error", message: "Server requires confirmation" });
          return null;
        }
        const summary = payload as ClearSitePatternsResult;
        const parts = [
          summary.clear_employee_data && summary.employee_clear
            ? `${summary.employee_clear.cleared_count} employee(s) cleared`
            : null,
          `${summary.deleted_shift_schedules.length} Shift Schedule(s)`,
          `${summary.deleted_shift_types.length} Shift Type(s)`,
        ].filter(Boolean);
        if (summary.error_count) {
          setStatus({
            type: "error",
            message: `Partial wipe: ${parts.join(" · ")} · ${summary.error_count} error(s)`,
          });
        } else {
          setStatus({ type: "success", message: `Wiped: ${parts.join(" · ")}` });
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
    clearSitePatterns,
    loading,
    status,
    clearStatus,
  };
}
