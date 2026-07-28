/**
 * Weekly-schedule wizard reads/writes. Plain async functions with no React —
 * the whole point is that they are trivially readable and independently
 * callable. Hooks in `hooks/useWeeklySchedule.ts` wrap these with
 * `useQuery`/`useMutation`.
 */
import { frappeCall } from "@/lib/frappe";
import type {
  ApplyScheduleResult,
  HolidayPreviewItem,
  ResolvePlan,
  ScheduleContext,
  WeeklyScheduleTemplate,
} from "@/types/schedule";

const NS = "dewey_time.attendance_engine.schedule_api";

export function getScheduleContext(employee: string) {
  return frappeCall<ScheduleContext>(`${NS}.get_employee_schedule_context`, { employee });
}

export function resolveSchedulePlan(args: {
  employee: string;
  effectiveFrom: string;
  weekPatternJson: string;
}) {
  return frappeCall<ResolvePlan>(`${NS}.resolve_weekly_schedule_plan`, {
    employee: args.employee,
    effective_from: args.effectiveFrom,
    week_pattern: args.weekPatternJson,
  });
}

export function getHolidayPreview(args: { employee: string; startDate: string; endDate: string }) {
  return frappeCall<{ holidays: HolidayPreviewItem[] }>(`${NS}.get_holiday_preview`, {
    employee: args.employee,
    start_date: args.startDate,
    end_date: args.endDate,
  });
}

export function listScheduleTemplates(limit: number) {
  return frappeCall<{ templates: WeeklyScheduleTemplate[] }>(
    `${NS}.list_weekly_schedule_templates`,
    { limit },
  );
}

export function applyWeeklySchedule(args: {
  employee: string;
  week_pattern: unknown;
  create_shifts_after: string;
  generate_through: string;
  confirm_create: boolean;
}) {
  return frappeCall<ApplyScheduleResult>(`${NS}.apply_weekly_schedule`, args, { method: "POST" });
}
