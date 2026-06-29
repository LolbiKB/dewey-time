import type { WeekPattern } from "@/types/schedule";

// Shared types for the spreadsheet schedule-import flow. These mirror the
// backend `parse_schedule_upload` contract and are used by the import page,
// the headless `useScheduleImport` hook, and the sessionStorage persistence
// layer. Kept here (not inside a component) so all three share one source.

export type ImportIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  field?: string | null;
  suggestion?: string | null;
};

export type ParsedRow = {
  row_number: number;
  id_card: string;
  email: string;
  employee: string | null;
  employee_name: string | null;
  employment_type?: string | null;
  /** Set by the backend when an ineligible/blank type is derived from the schedule. */
  derived_employment_type?: string | null;
  matched: boolean;
  am_from: string | null;
  am_to: string | null;
  pm_from: string | null;
  pm_to: string | null;
  day_off: { full_off: string[]; afternoon_off: string[] };
  week_pattern: WeekPattern | null;
  schedule_shape: string;
  issues: ImportIssue[];
  importable: boolean;
  warnings: string[];
};

export type ParseSummary = {
  total_rows: number;
  importable: number;
  matched: number;
  unmatched: number;
  errors: number;
  warnings: number;
  garbage_rows: number;
  by_code: Record<string, number>;
};

export type FeedbackRow = {
  row_number: number;
  employee_id: string;
  email: string;
  employee_name?: string;
  field: string;
  code: string;
  severity: string;
  message: string;
  suggestion: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  summary: ParseSummary;
  feedback_rows: FeedbackRow[];
};

export type RowApplyStatus =
  | { type: "idle" }
  | { type: "applying" }
  | { type: "ok"; message?: string }
  | { type: "error"; message: string };

export type RowFilter =
  | "all"
  | "importable"
  | "derived"
  | "errors"
  | "warnings"
  | "not_found";
