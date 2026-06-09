import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileSpreadsheetIcon,
  Loader2Icon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback, useRef, useState } from "react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { WeekPattern, Weekday } from "@/types/schedule";
import { weekPatternForApi } from "@/types/schedule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParsedRow = {
  id_card: string;
  email: string;
  employee: string | null;
  employee_name: string | null;
  matched: boolean;
  am_from: string | null;
  am_to: string | null;
  pm_from: string | null;
  pm_to: string | null;
  day_off: { full_off: string[]; afternoon_off: string[] };
  week_pattern: WeekPattern | null;
  warnings: string[];
};

type ParseResult = { rows: ParsedRow[] };

type RowApplyStatus =
  | { type: "idle" }
  | { type: "applying" }
  | { type: "ok"; message?: string }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARSE_METHOD = "zkteco_hr.attendance_engine.schedule_import.parse_schedule_upload";
const APPLY_METHOD = "zkteco_hr.attendance_engine.schedule_api.apply_weekly_schedule";

const DAY_ABBREV: Record<string, string> = {
  Monday: "M",
  Tuesday: "T",
  Wednesday: "W",
  Thursday: "Th",
  Friday: "F",
  Saturday: "S",
  Sunday: "Su",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:...;base64," prefix
      const b64 = result.split(",")[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatShiftSummary(row: ParsedRow): string {
  if (!row.am_from || !row.am_to) return "—";
  const am = `${row.am_from}–${row.am_to}`;
  if (!row.pm_from || !row.pm_to) return am;
  return `${row.am_from}–${row.pm_to}`;
}

function formatWorkDays(row: ParsedRow): string {
  if (!row.week_pattern) return "—";
  const fullOff = new Set(row.day_off.full_off);
  const amOnly = new Set(row.day_off.afternoon_off);
  const hasPm = Boolean(row.pm_from && row.pm_to);

  const parts: string[] = [];
  for (const day of row.week_pattern.days) {
    if (!day.works) continue;
    const abbrev = DAY_ABBREV[day.weekday] ?? day.weekday.slice(0, 2);
    const suffix = (amOnly.has(day.weekday) || !hasPm) && !fullOff.has(day.weekday) ? "" : "";
    parts.push(abbrev + suffix);
  }
  return parts.join(" ") || "Off all week";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DropZone(props: {
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) props.onFile(file);
  }

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
      onDrop={handleDrop}
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
        <FileSpreadsheetIcon className="size-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">Drop your schedule spreadsheet here</p>
        <p className="text-xs text-muted-foreground">or click to browse — .xlsx or .csv</p>
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

function RowStatusIcon(props: { row: ParsedRow; applyStatus?: RowApplyStatus }) {
  const { row, applyStatus } = props;
  if (applyStatus?.type === "applying") {
    return <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (applyStatus?.type === "ok") {
    return <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />;
  }
  if (applyStatus?.type === "error") {
    return <XCircleIcon className="size-4 shrink-0 text-destructive" />;
  }
  if (!row.matched) {
    return <XCircleIcon className="size-4 shrink-0 text-destructive" />;
  }
  if (row.warnings.length > 0) {
    return <AlertCircleIcon className="size-4 shrink-0 text-amber-500" />;
  }
  return <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />;
}

function PreviewRow(props: {
  row: ParsedRow;
  selected: boolean;
  onToggle: () => void;
  applyStatus?: RowApplyStatus;
}) {
  const { row, selected, onToggle, applyStatus } = props;
  const canSelect = row.matched && Boolean(row.week_pattern);
  const applied = applyStatus?.type === "ok";
  const failed = applyStatus?.type === "error";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
        applied
          ? "border-emerald-500/30 bg-emerald-500/5"
          : failed
            ? "border-destructive/30 bg-destructive/5"
            : selected
              ? "border-primary/30 bg-primary/[0.03]"
              : "border-border/50 bg-card/50"
      )}
    >
      <div className="flex items-center pt-0.5">
        <Checkbox
          checked={canSelect && selected}
          disabled={!canSelect || applied || applyStatus?.type === "applying"}
          onCheckedChange={onToggle}
          aria-label={`Include ${row.id_card}`}
        />
      </div>

      <RowStatusIcon row={row} applyStatus={applyStatus} />

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium">{row.employee_name ?? row.id_card}</span>
          <span className="text-xs text-muted-foreground">{row.id_card}</span>
          {!row.matched ? (
            <Badge variant="destructive" className="text-[10px]">
              Not found
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{formatWorkDays(row)}</span>
          </span>
          <span>{formatShiftSummary(row)}</span>
          {row.pm_from && row.pm_to ? (
            <span className="text-muted-foreground/70">
              lunch {row.am_to}–{row.pm_from}
            </span>
          ) : null}
        </div>

        {row.warnings.filter((w) => !w.startsWith("No active employee")).length > 0 ? (
          <ul className="mt-0.5 space-y-0">
            {row.warnings
              .filter((w) => !w.startsWith("No active employee"))
              .map((w, i) => (
                <li key={i} className="text-[11px] text-amber-700 dark:text-amber-400">
                  ⚠ {w}
                </li>
              ))}
          </ul>
        ) : null}

        {applyStatus?.type === "error" ? (
          <p className="text-[11px] text-destructive">✗ {applyStatus.message}</p>
        ) : applyStatus?.type === "ok" ? (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ Schedule saved</p>
        ) : null}
      </div>

      {/* Day-off chips */}
      {row.day_off.full_off.length > 0 ? (
        <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          {row.day_off.full_off.map((d) => (
            <Badge key={d} variant="secondary" className="text-[10px] font-normal">
              {d.slice(0, 3)} off
            </Badge>
          ))}
        </div>
      ) : null}
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
  const [applyStatuses, setApplyStatuses] = useState<Record<number, RowApplyStatus>>({});
  const [currentFile, setCurrentFile] = useState<File | null>(null);

  const { call: callParse } = useFrappePostCall<{ message: ParseResult }>(PARSE_METHOD);
  const { call: callApply } = useFrappePostCall<{ message: unknown }>(APPLY_METHOD);

  function reset() {
    setStep("idle");
    setParseError(null);
    setRows([]);
    setSelected(new Set());
    setApplyStatuses({});
    setCurrentFile(null);
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
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

        // Pre-select all matched rows with a valid week_pattern
        const preSelected = new Set(
          parsed.rows
            .map((r, i) => (r.matched && r.week_pattern ? i : -1))
            .filter((i) => i >= 0)
        );
        setSelected(preSelected);
        setStep("preview");
      } catch (err: unknown) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        setParseError(msg);
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

  function toggleAll() {
    const eligible = rows
      .map((r, i) => (r.matched && r.week_pattern ? i : -1))
      .filter((i) => i >= 0);
    const allSelected = eligible.every((i) => selected.has(i));
    setSelected(new Set(allSelected ? [] : eligible));
  }

  async function handleApply() {
    if (!effectiveFrom) return;
    const toApply = [...selected].filter((i) => {
      const r = rows[i];
      return r.matched && r.week_pattern;
    });
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
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed";
        setApplyStatuses((prev) => ({ ...prev, [idx]: { type: "error", message: msg } }));
      }
    }

    setStep("done");
    if (anyOk) onSuccess?.();
  }

  // Derived state
  const eligibleCount = rows.filter((r, i) => r.matched && r.week_pattern && selected.has(i)).length;
  const matchedCount = rows.filter((r) => r.matched && r.week_pattern).length;
  const unmatchedCount = rows.filter((r) => !r.matched).length;
  const doneCount = Object.values(applyStatuses).filter((s) => s.type === "ok").length;
  const failCount = Object.values(applyStatuses).filter((s) => s.type === "error").length;
  const isApplying = step === "applying";
  const isDone = step === "done";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton>
        <DialogHeader className="space-y-1 border-b border-border/60 px-5 py-4 text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UploadIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">Import from spreadsheet</DialogTitle>
              <DialogDescription className="text-xs">
                Upload an xlsx with columns: ID Card, Email, AM From/To, PM From/To, Day off
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[min(70dvh,36rem)] overflow-y-auto">
          {/* ── Step: idle / parsing ── */}
          {(step === "idle" || step === "parsing") && (
            <div className="px-5 py-5 space-y-4">
              {parseError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {parseError}
                </p>
              ) : null}
              <DropZone onFile={handleFile} disabled={step === "parsing"} />
              {step === "parsing" ? (
                <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  Reading {currentFile?.name ?? "file"}…
                </p>
              ) : null}
            </div>
          )}

          {/* ── Step: preview / applying / done ── */}
          {(step === "preview" || step === "applying" || step === "done") && (
            <>
              {/* Summary bar */}
              <div className="border-b border-border/60 bg-muted/20 px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <strong className="text-foreground">{rows.length}</strong> rows parsed
                  </span>
                  <span>
                    <strong className="text-foreground">{matchedCount}</strong> employees matched
                  </span>
                  {unmatchedCount > 0 ? (
                    <span className="text-destructive">
                      {unmatchedCount} not found
                    </span>
                  ) : null}
                  {isDone ? (
                    <>
                      {doneCount > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          ✓ {doneCount} saved
                        </span>
                      ) : null}
                      {failCount > 0 ? (
                        <span className="text-destructive">✗ {failCount} failed</span>
                      ) : null}
                    </>
                  ) : null}

                  {!isDone && matchedCount > 0 ? (
                    <button
                      type="button"
                      className="ml-auto text-xs text-primary underline-offset-2 hover:underline"
                      onClick={toggleAll}
                      disabled={isApplying}
                    >
                      {selected.size === matchedCount ? "Deselect all" : "Select all"}
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Row list */}
              <div className="px-5 py-3 space-y-2">
                {rows.map((row, i) => (
                  <PreviewRow
                    key={i}
                    row={row}
                    selected={selected.has(i)}
                    onToggle={() => toggleRow(i)}
                    applyStatus={applyStatuses[i]}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {(step === "preview" || step === "applying" || step === "done") && (
          <>
            <Separator />
            <DialogFooter className="flex-col items-stretch gap-3 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-end gap-3">
                <DatePickerInput
                  id="import-effective-from"
                  label="Effective from"
                  value={effectiveFrom}
                  onChange={setEffectiveFrom}
                  disabled={isApplying || isDone}
                />
                {isDone ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    className="h-9 shrink-0"
                    onClick={reset}
                  >
                    Import another
                  </Button>
                ) : null}
              </div>

              <div className="flex items-center gap-2 sm:justify-end">
                {!isDone ? (
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
                ) : (
                  <Button
                    type="button"
                    size="default"
                    className="h-9"
                    onClick={() => handleOpenChange(false)}
                  >
                    Done
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Trigger button (export for use in WeeklySchedulePage)
// ---------------------------------------------------------------------------

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
