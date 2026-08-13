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
import { EmployeeIdentity } from "@/ui/EmployeeIdentity";
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
              <EmployeeIdentity
                // Whatever identifies this line of the spreadsheet leads: the
                // matched employee's name, or the ID card it was looked up by.
                //
                // `||`, not the `??` this chain used to be written with. Both
                // fields arrive from a parsed spreadsheet cell, where "missing"
                // is the EMPTY STRING and not null — the shape the guard this
                // replaces was written against, `row.id_card &&
                // row.employee_name` — so under `??` the em dash was
                // unreachable and a garbage line rendered a blank name.
                englishName={row.employee_name || row.id_card || "—"}
                // …and the ID card takes line two only when it is not already
                // line one. An empty id renders a zero-height second line
                // (measured), so an unmatched row reads exactly as it does
                // today — one line — rather than gaining a blank one.
                employeeId={row.employee_name ? row.id_card : ""}
                // A parsed spreadsheet row is not an Employee record: the
                // upload carries an ID card and a name, and the backend's
                // parse contract has no Khmer columns to match against. Stated
                // rather than left undefined, which is what the required prop
                // is for.
                khmerName={null}
                // No tail: row number, work days and shift are the surface's
                // own line below, and they describe the SCHEDULE being
                // imported rather than the person. No avatar either — there
                // may be no employee behind this row at all, and initials drawn
                // from an ID card are not a face.
              />
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
