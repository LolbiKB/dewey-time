/**
 * Dev-tools maintenance reads/writes: the three preview/clear pairs behind the
 * "(dev)" dialog triggers, plus `runEngineForEmployee` (consumed by Task 6).
 * Plain async functions with no React, following the same shape as
 * `services/schedule.ts`.
 */
import { frappeCall } from "@/lib/frappe";
import type { RunEngineMode, RunEngineResponse } from "@/hooks/useRunEngine";
import type { WipeStep } from "@/hooks/useClearSitePatterns";
import type {
  ClearAllSchedulesPreview,
  ClearAllSchedulesResponse,
  ClearSchedulePreview,
  ClearScheduleResponse,
  ClearSitePatternsPreview,
} from "@/types/schedule";

const NS = "dewey_time.attendance_engine.dev_tools";

export function previewClearEmployeeSchedule(employee: string) {
  return frappeCall<ClearSchedulePreview>(
    `${NS}.preview_clear_employee_schedule_api`,
    { employee },
    { method: "POST" },
  );
}

export function clearEmployeeSchedule(employee: string) {
  return frappeCall<ClearScheduleResponse>(
    `${NS}.clear_employee_schedule_api`,
    { employee, confirm: true },
    { method: "POST" },
  );
}

export function previewClearAllSchedules(includeAllActive: boolean) {
  return frappeCall<ClearAllSchedulesPreview>(
    `${NS}.preview_clear_all_employee_schedules_api`,
    { include_all_active: includeAllActive ? 1 : 0 },
    { method: "POST" },
  );
}

export function clearAllSchedules(args: { confirmPhrase: string; includeAllActive: boolean }) {
  return frappeCall<ClearAllSchedulesResponse>(
    `${NS}.clear_all_employee_schedules_api`,
    {
      confirm: true,
      confirm_phrase: args.confirmPhrase,
      include_all_active: args.includeAllActive ? 1 : 0,
    },
    { method: "POST" },
  );
}

export function previewClearSitePatterns(clearEmployeeData: boolean) {
  return frappeCall<ClearSitePatternsPreview>(
    `${NS}.preview_clear_site_schedule_patterns_api`,
    { clear_employee_data: clearEmployeeData ? 1 : 0 },
    { method: "POST" },
  );
}

export function clearSitePatternsStep(args: { confirmPhrase: string; clearEmployeeData: boolean }) {
  return frappeCall<WipeStep>(
    `${NS}.clear_site_patterns_step_api`,
    {
      confirm_phrase: args.confirmPhrase,
      clear_employee_data: args.clearEmployeeData ? 1 : 0,
    },
    { method: "POST" },
  );
}

// Unused until Task 6 wires `RunEngineDialog` onto this transport — that is
// expected, and `tsc` does not flag an unused export.
export function runEngineForEmployee(args: {
  employee: string;
  start_date: string;
  end_date: string;
  mode: RunEngineMode;
}) {
  return frappeCall<RunEngineResponse>(`${NS}.run_engine_for_employee`, args, { method: "POST" });
}
