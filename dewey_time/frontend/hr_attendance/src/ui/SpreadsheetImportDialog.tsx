import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildImportPatternBuckets,
  useImportSchedulePlanSummary,
} from "@/hooks/useImportSchedulePlanSummary";
import { extractFrappeError } from "@/lib/frappeError";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import { cn } from "@/lib/utils";
import { ImportSchedulePlanSummary } from "@/ui/ImportSchedulePlanSummary";
import type { WeekPattern } from "@/types/schedule";
import { summarizeWeekPattern, weekPatternForApi } from "@/types/schedule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImportIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  field?: string | null;
  suggestion?: string | null;
};

type ParsedRow = {
  row_number: number;
  id_card: string;
  email: string;
  employee: string | null;
  employee_name: string | null;
  employment_type?: string | null;
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

type ParseSummary = {
  total_rows: number;
  importable: number;
  matched: number;
  unmatched: number;
  errors: number;
  warnings: number;
  garbage_rows: number;
  by_code: Record<string, number>;
};

type FeedbackRow = {
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

type ParseResult = {
  rows: ParsedRow[];
  summary: ParseSummary;
  feedback_rows: FeedbackRow[];
};

type RowApplyStatus =
  | { type: "idle" }
  | { type: "applying" }
  | { type: "ok"; message?: string }
  | { type: "error"; message: string };

type RowFilter = "all" | "importable" | "errors" | "warnings" | "not_found";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARSE_METHOD = "dewey_time.attendance_engine.schedule_import.parse_schedule_upload";
const APPLY_METHOD = "dewey_time.attendance_engine.schedule_api.apply_weekly_schedule";

const DAY_ABBREV: Record<string, string> = {
  Monday: "M",
  Tuesday: "T",
  Wednesday: "W",
  Thursday: "Th",
  Friday: "F",
  Saturday: "S",
  Sunday: "Su",
};

const SHAPE_LABELS: Record<string, string> = {
  full_day: "Full day",
  am_only: "AM only",
  pm_only: "PM only",
  continuous: "Continuous",
  per_day: "Per-day",
  invalid: "Invalid",
};

const ISSUE_CODE_LABELS: Record<string, string> = {
  MISSING_EMPLOYEE_ID: "Missing ID",
  INVALID_EMPLOYEE_ID: "Bad ID format",
  EMPLOYEE_NOT_FOUND: "Not in Frappe",
  INVALID_TIME_FORMAT: "Bad time",
  MISSING_SHIFT_TIMES: "Missing times",
  END_BEFORE_START: "Time order",
  NO_WORKING_DAYS: "All days off",
  GARBAGE_ROW: "Garbage row",
  MIDNIGHT_AS_NOON: "00:00 → noon?",
  INVALID_EMAIL: "Bad email",
  INVALID_DAYS_OFF_TOKEN: "Bad days_off",
  DUPLICATE_EMPLOYEE_ID: "Duplicate ID",
  SHORT_LUNCH_GAP: "Short lunch",
  PM_ONLY: "PM only",
  CONTINUOUS_SHIFT: "Continuous",
  AM_ONLY: "AM only",
  INELIGIBLE_EMPLOYMENT_TYPE: "Employment type",
  ACTIVE_SSA_EXISTS: "Active SSA",
  INVALID_WEEK_PATTERN: "Pattern invalid",
  PER_DAY: "Per-day",
  MATCHED_BY_NAME: "Name match",
  NAME_AMBIGUOUS: "Name ambiguous",
  INVALID_DAY_SPEC: "Bad day spec",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatShiftSummary(row: ParsedRow): string {
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

function formatWorkDays(row: ParsedRow): string {
  if (!row.week_pattern) return "—";
  const parts: string[] = [];
  for (const day of row.week_pattern.days) {
    if (!day.works) continue;
    parts.push(DAY_ABBREV[day.weekday] ?? day.weekday.slice(0, 2));
  }
  return parts.join(" ") || "Off all week";
}

function rowMatchesFilter(row: ParsedRow, filter: RowFilter): boolean {
  switch (filter) {
    case "importable":
      return row.importable;
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

function downloadFeedbackCsv(feedback: FeedbackRow[], filename: string) {
  const header = "row_number,employee_id,email,employee_name,field,code,severity,message,suggestion";
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = feedback.map((r) =>
    [
      r.row_number,
      r.employee_id,
      r.email,
      r.employee_name ?? "",
      r.field,
      r.code,
      r.severity,
      r.message,
      r.suggestion,
    ]
      .map(escape)
      .join(",")
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DropZone(props: { onFile: (file: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        dragging
          ? "border-primary/60 bg-primary/5"
          : "border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-muted/30",
        props.disabled && "pointer-events-none opacity-50"
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) props.onFile(file);
      }}
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
        <FileSpreadsheetIcon className="size-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">Drop normalised schedule CSV here</p>
        <p className="text-xs text-muted-foreground">
          Canonical 7-column format — use Haiku prompt first, then import
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) props.onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function IssueBadge(props: { issue: ImportIssue }) {
  const { issue } = props;
  const label = ISSUE_CODE_LABELS[issue.code] ?? issue.code;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-normal",
        issue.severity === "error" && "border-destructive/40 text-destructive",
        issue.severity === "warning" && "border-brand-accent/40 text-brand-accent",
        issue.severity === "info" && "border-border text-muted-foreground"
      )}
      title={issue.suggestion ?? issue.message}
    >
      {label}
    </Badge>
  );
}

function PreviewRow(props: {
  row: ParsedRow;
  selected: boolean;
  onToggle: () => void;
  applyStatus?: RowApplyStatus;
}) {
  const { row, selected, onToggle, applyStatus } = props;
  const canSelect = row.importable;
  const applied = applyStatus?.type === "ok";
  const failed = applyStatus?.type === "error";
  const issues = row.issues.filter((i) => i.severity !== "info");
  const primaryIssue = issues.find((i) => i.severity === "error") ?? issues[0];
  const weeklyMinutes = row.week_pattern
    ? summarizeWeekPattern(row.week_pattern).totalWeeklyMinutes
    : 0;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm transition-colors",
        applied
          ? "border-primary/30 bg-primary/5"
          : failed
            ? "border-destructive/30 bg-destructive/5"
            : selected
              ? "border-primary/30 bg-primary/[0.03]"
              : "border-border/60 bg-card/40"
      )}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={canSelect && selected}
          disabled={!canSelect || applied || applyStatus?.type === "applying"}
          onCheckedChange={onToggle}
          aria-label={`Include row ${row.row_number}`}
          className="mt-0.5"
        />

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium leading-snug">
                  {row.employee_name ?? row.id_card ?? "—"}
                </span>
                {row.id_card && row.employee_name ? (
                  <span className="truncate text-xs text-muted-foreground">{row.id_card}</span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="tabular-nums">Row {row.row_number}</span>
                {" · "}
                {formatWorkDays(row)}
                {" · "}
                {formatShiftSummary(row)}
                {row.schedule_shape === "full_day" && row.pm_from && row.pm_to ? (
                  <span> · lunch {row.am_to}–{row.pm_from}</span>
                ) : null}
                {weeklyMinutes > 0 ? (
                  <span> · {formatScheduleDuration(weeklyMinutes)}/wk</span>
                ) : null}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {row.schedule_shape !== "invalid" ? (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {SHAPE_LABELS[row.schedule_shape] ?? row.schedule_shape}
                </Badge>
              ) : null}
              {applyStatus?.type === "applying" ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : applied ? (
                <CheckCircle2Icon className="size-4 text-primary" />
              ) : failed ? (
                <XCircleIcon className="size-4 text-destructive" />
              ) : row.importable ? (
                <CheckCircle2Icon className="size-4 text-primary/80" />
              ) : issues.some((i) => i.severity === "error") ? (
                <XCircleIcon className="size-4 text-destructive" />
              ) : issues.length > 0 ? (
                <AlertCircleIcon className="size-4 text-brand-accent" />
              ) : null}
            </div>
          </div>

          {issues.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {issues.map((i) => (
                <IssueBadge key={`${i.code}-${i.field ?? ""}`} issue={i} />
              ))}
            </div>
          ) : null}

          {primaryIssue?.suggestion ? (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
              {primaryIssue.suggestion}
            </p>
          ) : null}

          {applyStatus?.type === "error" ? (
            <p className="text-[11px] text-destructive">{applyStatus.message}</p>
          ) : applyStatus?.type === "ok" ? (
            <p className="text-[11px] text-primary">Schedule saved</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryBar(props: {
  summary: ParseSummary;
  filter: RowFilter;
  onFilterChange: (f: RowFilter) => void;
  visibleCount: number;
  feedbackCount: number;
  feedbackFilename: string;
  feedbackRows: FeedbackRow[];
  showFeedbackDownload: boolean;
}) {
  const { summary, filter, onFilterChange, visibleCount } = props;

  const chips: { key: RowFilter; label: string; count: number; tone?: string }[] = [
    { key: "all", label: "All", count: summary.total_rows },
    { key: "importable", label: "Ready", count: summary.importable },
    { key: "errors", label: "Errors", count: summary.errors, tone: "text-destructive" },
    { key: "warnings", label: "Warnings", count: summary.warnings, tone: "text-brand-accent" },
    { key: "not_found", label: "Not found", count: summary.unmatched, tone: "text-destructive" },
  ];

  return (
    <div className="shrink-0 space-y-3 border-b border-border/60 bg-muted/20 px-5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">{summary.importable}</strong> ready ·{" "}
            <strong className="text-foreground">{summary.matched}</strong> matched
            {summary.garbage_rows > 0 ? (
              <span className="text-destructive"> · {summary.garbage_rows} garbage</span>
            ) : null}
          </p>
          <p>
            Showing {visibleCount} of {summary.total_rows} rows
          </p>
        </div>

        {props.showFeedbackDownload ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            onClick={() => downloadFeedbackCsv(props.feedbackRows, props.feedbackFilename)}
          >
            <DownloadIcon className="size-3.5" />
            AI feedback ({props.feedbackCount})
          </Button>
        ) : null}
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <div className="flex w-max min-w-full gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onFilterChange(chip.key)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === chip.key
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:border-primary/30"
              )}
            >
              <span className={chip.tone}>{chip.label}</span>
              <span className="ml-1 tabular-nums opacity-80">{chip.count}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

type Step = "idle" | "parsing" | "preview" | "applying" | "done";

export function SpreadsheetImportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEffectiveFrom?: string;
  onSuccess?: () => void;
}) {
  const { open, onOpenChange, defaultEffectiveFrom = "", onSuccess } = props;

  const [step, setStep] = useState<Step>("idle");
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [feedbackRows, setFeedbackRows] = useState<FeedbackRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
  const [applyStatuses, setApplyStatuses] = useState<Record<number, RowApplyStatus>>({});
  const [currentFile, setCurrentFile] = useState<File | null>(null);

  const { call: callParse } = useFrappePostCall<{ message: ParseResult }>(PARSE_METHOD);
  const { call: callApply } = useFrappePostCall<{ message: unknown }>(APPLY_METHOD);

  const visibleRows = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => rowMatchesFilter(row, rowFilter)),
    [rows, rowFilter]
  );

  function reset() {
    setStep("idle");
    setParseError(null);
    setRows([]);
    setSummary(null);
    setFeedbackRows([]);
    setSelected(new Set());
    setRowFilter("all");
    setApplyStatuses({});
    setCurrentFile(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  const handleFile = useCallback(
    async (file: File) => {
      setCurrentFile(file);
      setParseError(null);
      setStep("parsing");

      try {
        const b64 = await fileToBase64(file);
        const result = await callParse({ file_b64: b64, filename: file.name });
        const parsed: ParseResult = result?.message ?? (result as unknown as ParseResult);

        setRows(parsed.rows);
        setSummary(parsed.summary);
        setFeedbackRows(parsed.feedback_rows ?? []);

        const preSelected = new Set(
          parsed.rows.map((r, i) => (r.importable ? i : -1)).filter((i) => i >= 0)
        );
        setSelected(preSelected);
        setRowFilter(parsed.summary.importable < parsed.summary.total_rows ? "importable" : "all");
        setStep("preview");
      } catch (err: unknown) {
        setParseError(extractFrappeError(err));
        setStep("idle");
      }
    },
    [callParse]
  );

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAllVisible() {
    const eligible = visibleRows
      .filter(({ row }) => row.importable)
      .map(({ index }) => index);
    const allSelected = eligible.every((i) => selected.has(i));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const i of eligible) next.delete(i);
      } else {
        for (const i of eligible) next.add(i);
      }
      return next;
    });
  }

  async function handleApply() {
    if (!effectiveFrom) return;
    const toApply = [...selected].filter((i) => rows[i]?.importable);
    if (!toApply.length) return;

    setStep("applying");
    let anyOk = false;

    for (const idx of toApply) {
      const row = rows[idx];
      setApplyStatuses((prev) => ({ ...prev, [idx]: { type: "applying" } }));

      try {
        const patternJson = JSON.stringify(weekPatternForApi(row.week_pattern as WeekPattern));
        await callApply({
          employee: row.employee,
          week_pattern: patternJson,
          create_shifts_after: effectiveFrom,
          generate_through: "",
          confirm_create: 1,
        });
        setApplyStatuses((prev) => ({ ...prev, [idx]: { type: "ok" } }));
        anyOk = true;
      } catch (err: unknown) {
        setApplyStatuses((prev) => ({
          ...prev,
          [idx]: { type: "error", message: extractFrappeError(err, "Failed") },
        }));
      }
    }

    setStep("done");
    if (anyOk) onSuccess?.();
  }

  const eligibleCount = rows.filter((r, i) => r.importable && selected.has(i)).length;
  const doneCount = Object.values(applyStatuses).filter((s) => s.type === "ok").length;
  const failCount = Object.values(applyStatuses).filter((s) => s.type === "error").length;
  const isApplying = step === "applying";
  const isDone = step === "done";

  const importPatternBuckets = useMemo(
    () => buildImportPatternBuckets(rows, selected),
    [rows, selected]
  );

  const planSummary = useImportSchedulePlanSummary(
    importPatternBuckets,
    step === "preview" && effectiveFrom ? effectiveFrom : null
  );

  const feedbackFilename = `schedule-import-feedback-${currentFile?.name?.replace(/\.[^.]+$/, "") ?? "upload"}.csv`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[min(90dvh,44rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg lg:max-w-2xl"
        showCloseButton
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 px-5 py-4 pr-12 text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UploadIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">Import from spreadsheet</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                Upload a normalised CSV, review validation issues, then apply schedules in bulk.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {(step === "idle" || step === "parsing") && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-4">
              {parseError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {parseError}
                </p>
              ) : null}
              <DropZone onFile={handleFile} disabled={step === "parsing"} />
              {step === "parsing" ? (
                <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  Validating {currentFile?.name ?? "file"}…
                </p>
              ) : null}
            </div>
          </div>
        )}

        {(step === "preview" || step === "applying" || step === "done") && summary ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <SummaryBar
              summary={summary}
              filter={rowFilter}
              onFilterChange={setRowFilter}
              visibleCount={visibleRows.length}
              feedbackCount={feedbackRows.length}
              feedbackFilename={feedbackFilename}
              feedbackRows={feedbackRows}
              showFeedbackDownload={feedbackRows.length > 0 && !isDone}
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <div className="space-y-2 pb-1">
                {visibleRows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No rows match this filter.
                  </p>
                ) : (
                  visibleRows.map(({ row, index }) => (
                    <PreviewRow
                      key={`${row.row_number}-${index}`}
                      row={row}
                      selected={selected.has(index)}
                      onToggle={() => toggleRow(index)}
                      applyStatus={applyStatuses[index]}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="shrink-0 space-y-2 border-t border-border/60 bg-muted/20 px-5 py-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <DatePickerInput
                  id="import-effective-from"
                  label="Effective from"
                  value={effectiveFrom}
                  onChange={setEffectiveFrom}
                  disabled={isApplying || isDone}
                  className="min-w-[11rem] flex-1 sm:max-w-[14rem]"
                />
                {!isDone && visibleRows.some(({ row }) => row.importable) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 shrink-0 px-2 text-xs"
                    onClick={toggleAllVisible}
                    disabled={isApplying}
                  >
                    Toggle visible
                  </Button>
                ) : null}
              </div>

              {!isDone && effectiveFrom && eligibleCount > 0 ? (
                <ImportSchedulePlanSummary
                  stats={planSummary.stats}
                  plans={planSummary.plans}
                  loading={planSummary.loading}
                  error={planSummary.error}
                />
              ) : null}
            </div>

            <DialogFooter className="mx-0 mb-0 flex shrink-0 flex-row flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border/60 bg-muted/50 px-5 py-4">
              {isDone ? (
                <>
                  {doneCount > 0 ? (
                    <span className="mr-auto self-center text-xs text-primary">
                      {doneCount} saved
                    </span>
                  ) : null}
                  {failCount > 0 ? (
                    <span className="self-center text-xs text-destructive">{failCount} failed</span>
                  ) : null}
                  <Button type="button" variant="outline" size="default" className="h-9" onClick={reset}>
                    Import another
                  </Button>
                  <Button type="button" size="default" className="h-9" onClick={() => handleOpenChange(false)}>
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="default"
                    className="h-9"
                    onClick={reset}
                    disabled={isApplying}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    size="default"
                    className="h-9 min-w-[9rem]"
                    onClick={() => void handleApply()}
                    disabled={!eligibleCount || !effectiveFrom || isApplying}
                  >
                    {isApplying ? (
                      <>
                        <Loader2Icon className="size-3.5 animate-spin" />
                        Applying…
                      </>
                    ) : (
                      `Apply ${eligibleCount} employee${eligibleCount !== 1 ? "s" : ""}`
                    )}
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function SpreadsheetImportTrigger(props: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="default"
      className={cn("h-9 gap-2", props.className)}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <UploadIcon className="size-3.5" />
      Import
    </Button>
  );
}
