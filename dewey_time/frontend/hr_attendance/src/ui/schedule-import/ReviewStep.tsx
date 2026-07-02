import { useMemo } from "react";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildProblemRows } from "@/lib/importProblems";
import {
  buildImportPatternBuckets,
  useImportSchedulePlanSummary,
} from "@/hooks/useImportSchedulePlanSummary";
import { ImportSchedulePlanSummary } from "@/ui/ImportSchedulePlanSummary";
import type { ScheduleImportController } from "@/hooks/useScheduleImport";
import { rowMatchesFilter } from "@/ui/schedule-import/format";
import { GroupEffectiveDates } from "@/ui/schedule-import/GroupEffectiveDates";
import { PreviewRow } from "@/ui/schedule-import/PreviewRow";
import { SummaryBar } from "@/ui/schedule-import/SummaryBar";

function ApplyActions(props: {
  controller: ScheduleImportController;
  onBackToSchedule: () => void;
}) {
  const c = props.controller;
  const total = c.applyTotal;

  if (c.step === "applying") {
    const pct = total > 0 ? Math.round((c.settledCount / total) * 100) : 0;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Applying… {c.settledCount}/{total}
          </span>
          <span>
            {c.doneCount} ok{c.failCount > 0 ? ` · ${c.failCount} failed` : ""}
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Applying schedules"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={c.settledCount}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full"
          onClick={c.cancel}
        >
          Cancel remaining
        </Button>
      </div>
    );
  }

  if (c.step === "done") {
    const skipped = Math.max(0, total - c.settledCount);
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {c.doneCount > 0 ? <span className="text-primary">{c.doneCount} saved</span> : null}
          {c.failCount > 0 ? (
            <span className="text-destructive">{c.failCount} failed</span>
          ) : null}
          {skipped > 0 ? (
            <span className="text-muted-foreground">{skipped} not applied (cancelled)</span>
          ) : null}
          {c.settledCount === 0 ? (
            <span className="text-muted-foreground">No schedules were applied.</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="default"
            className="h-9 flex-1"
            onClick={c.reset}
          >
            Import another
          </Button>
          <Button
            type="button"
            size="default"
            className="h-9 flex-1"
            onClick={props.onBackToSchedule}
          >
            Back to schedule
          </Button>
        </div>
      </div>
    );
  }

  // preview
  return (
    <Button
      type="button"
      size="default"
      className="h-10 w-full"
      onClick={() => void c.apply()}
      disabled={!c.eligibleCount || !c.effectiveFrom}
    >
      {c.effectiveFrom
        ? `Apply ${c.eligibleCount} employee${c.eligibleCount !== 1 ? "s" : ""}`
        : "Pick an effective date"}
    </Button>
  );
}

export function ReviewStep(props: {
  controller: ScheduleImportController;
  onBackToSchedule: () => void;
}) {
  const c = props.controller;
  const summary = c.summary!;
  const disabled = c.step !== "preview";

  const visibleRows = useMemo(
    () =>
      c.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => rowMatchesFilter(row, c.rowFilter)),
    [c.rows, c.rowFilter]
  );

  const problemRows = useMemo(
    () => buildProblemRows(c.feedbackRows, c.rows, c.applyStatuses),
    [c.feedbackRows, c.rows, c.applyStatuses]
  );

  const buckets = useMemo(
    () => buildImportPatternBuckets(c.rows, c.selected),
    [c.rows, c.selected]
  );

  const planSummary = useImportSchedulePlanSummary(
    buckets,
    c.step === "preview" && c.effectiveFrom ? c.effectiveFrom : null
  );

  const problemFilename = `schedule-import-problems-${
    c.currentFileName?.replace(/\.[^.]+$/, "") ?? "upload"
  }.csv`;

  const eligibleVisible = visibleRows.filter(({ row }) => row.importable).map(({ index }) => index);
  const allVisibleSelected =
    eligibleVisible.length > 0 && eligibleVisible.every((i) => c.selected.has(i));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SummaryBar
        summary={summary}
        filter={c.rowFilter}
        onFilterChange={c.setRowFilter}
        visibleCount={visibleRows.length}
        problemRows={problemRows}
        problemFilename={problemFilename}
        appliedAt={c.appliedAt}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Row list — the full-width, full-height workspace */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-5 pt-3 pb-1">
            <span className="text-xs text-muted-foreground">
              {visibleRows.length} row{visibleRows.length !== 1 ? "s" : ""}
            </span>
            {eligibleVisible.length > 0 && !disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => c.setRowsSelected(eligibleVisible, !allVisibleSelected)}
              >
                {allVisibleSelected ? "Deselect visible" : "Select visible"}
              </Button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">
            <div className="space-y-2">
              {visibleRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No rows match this filter.
                </p>
              ) : (
                visibleRows.map(({ row, index }) => (
                  <PreviewRow
                    key={`${row.row_number}-${index}`}
                    row={row}
                    selected={c.selected.has(index)}
                    onToggle={() => c.toggleRow(index)}
                    applyStatus={c.applyStatuses[index]}
                    locked={disabled}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar (desktop) / footer (mobile): dates, plan, apply */}
        <aside className="flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-y-auto border-t border-border/60 bg-muted/10 px-5 py-4 lg:max-h-none lg:w-[23rem] lg:border-l lg:border-t-0">
          <GroupEffectiveDates
            buckets={buckets}
            effectiveFrom={c.effectiveFrom}
            onEffectiveFromChange={c.setEffectiveFrom}
            groupOverrides={c.groupOverrides}
            onGroupOverrideChange={c.setGroupOverride}
            disabled={disabled}
          />

          {c.step === "preview" && c.effectiveFrom && c.eligibleCount > 0 ? (
            <ImportSchedulePlanSummary
              stats={planSummary.stats}
              plans={planSummary.plans}
              loading={planSummary.loading}
              error={planSummary.error}
            />
          ) : null}

          {c.step === "applying" ? (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Groups apply in parallel; members of a group save in sequence.
            </p>
          ) : null}

          <div className="mt-auto pt-1">
            <ApplyActions controller={c} onBackToSchedule={props.onBackToSchedule} />
          </div>
        </aside>
      </div>
    </div>
  );
}
