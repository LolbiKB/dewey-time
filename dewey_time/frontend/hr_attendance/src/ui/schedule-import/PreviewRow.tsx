import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import type { ParsedRow, RowApplyStatus } from "@/types/scheduleImport";
import { summarizeWeekPattern } from "@/types/schedule";
import { SHAPE_LABELS } from "@/ui/schedule-import/constants";
import { formatShiftSummary, formatWorkDays } from "@/ui/schedule-import/format";
import { IssueBadge } from "@/ui/schedule-import/IssueBadge";

export function PreviewRow(props: {
  row: ParsedRow;
  selected: boolean;
  onToggle: () => void;
  applyStatus?: RowApplyStatus;
  /** Selection is frozen once apply starts (applying/done steps). */
  locked?: boolean;
}) {
  const { row, selected, onToggle, applyStatus, locked } = props;
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
          disabled={!canSelect || locked || applied || applyStatus?.type === "applying"}
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
                  <span>
                    {" "}
                    · lunch {row.am_to}–{row.pm_from}
                  </span>
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
                <IssueBadge
                  key={`${i.code}-${i.field ?? ""}`}
                  issue={i}
                  derivedType={row.derived_employment_type}
                />
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
