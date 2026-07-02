import type { ParsedRow, RowFilter } from "@/types/scheduleImport";
import { DAY_ABBREV } from "@/ui/schedule-import/constants";

export function formatShiftSummary(row: ParsedRow): string {
  if (row.schedule_shape === "per_day" && row.week_pattern) {
    const working = row.week_pattern.days.filter((d) => d.works);
    if (!working.length) return "—";
    const spans = new Set(working.map((d) => `${d.start_time}–${d.end_time}`));
    return spans.size === 1 ? `Varies: ${[...spans][0]}` : "Varies by day";
  }
  if (row.schedule_shape === "pm_only" && row.pm_from && row.pm_to) {
    return `PM ${row.pm_from}–${row.pm_to}`;
  }
  if (row.schedule_shape === "continuous" && row.am_from && row.pm_to) {
    return `${row.am_from}–${row.pm_to}`;
  }
  if (!row.am_from || !row.am_to) return "—";
  const am = `${row.am_from}–${row.am_to}`;
  if (!row.pm_from || !row.pm_to) return am;
  return `${row.am_from}–${row.pm_to}`;
}

export function formatWorkDays(row: ParsedRow): string {
  if (!row.week_pattern) return "—";
  const parts: string[] = [];
  for (const day of row.week_pattern.days) {
    if (!day.works) continue;
    parts.push(DAY_ABBREV[day.weekday] ?? day.weekday.slice(0, 2));
  }
  return parts.join(" ") || "Off all week";
}

export function rowMatchesFilter(row: ParsedRow, filter: RowFilter): boolean {
  switch (filter) {
    case "importable":
      return row.importable;
    case "derived":
      return Boolean(row.derived_employment_type);
    case "errors":
      return row.issues.some((i) => i.severity === "error");
    case "warnings":
      return row.issues.some((i) => i.severity === "warning");
    case "not_found":
      return Boolean(row.id_card) && !row.matched;
    default:
      return true;
  }
}

/**
 * The build id of the bundle THIS tab is actually running — read from the entry
 * script's `?v=` cache-bust token (same value as assets/build-id.txt). This is the
 * ground truth for "is this tab stale?": a tab left open across a deploy keeps
 * serving its old bundle, and its exports will carry the old id.
 */
export function appBuildId(): string {
  try {
    const script = document.querySelector<HTMLScriptElement>(
      'script[src*="hr_attendance/assets/index.js"]'
    );
    if (!script) return "dev";
    return new URL(script.src, window.location.origin).searchParams.get("v") || "dev";
  } catch {
    return "dev";
  }
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
