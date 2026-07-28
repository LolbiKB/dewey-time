/**
 * Spreadsheet schedule-import wizard reads/writes. Plain async functions with
 * no React — `hooks/useScheduleImport.ts` wraps these with `useMutation`.
 * (The wizard's per-pattern plan preview reuses `resolveSchedulePlan` from
 * `services/schedule.ts` directly — it is the exact same call the manual
 * weekly-schedule wizard already makes, just once per matched pattern group.)
 */
import { frappeCall } from "@/lib/frappe";
import type { ParseResult } from "@/types/scheduleImport";

const IMPORT_NS = "dewey_time.attendance_engine.schedule_import";
const SCHEDULE_NS = "dewey_time.attendance_engine.schedule_api";

export function parseScheduleImport(args: { file_b64: string; filename: string }) {
  return frappeCall<ParseResult>(`${IMPORT_NS}.parse_schedule_upload`, args, { method: "POST" });
}

export function applyScheduleImportRow(args: {
  employee: string;
  week_pattern: string;
  create_shifts_after: string;
  generate_through: string;
  confirm_create: number;
  derive_employment_type: number;
}) {
  return frappeCall<unknown>(`${SCHEDULE_NS}.apply_weekly_schedule`, args, { method: "POST" });
}
