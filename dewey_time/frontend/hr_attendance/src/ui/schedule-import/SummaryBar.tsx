import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { problemsToCsv, type ProblemRow } from "@/lib/importProblems";
import type { ParseSummary, RowFilter } from "@/types/scheduleImport";
import { downloadCsv } from "@/ui/schedule-import/format";

export function SummaryBar(props: {
  summary: ParseSummary;
  filter: RowFilter;
  onFilterChange: (f: RowFilter) => void;
  visibleCount: number;
  problemRows: ProblemRow[];
  problemFilename: string;
}) {
  const { summary, filter, onFilterChange, visibleCount } = props;

  const derivedCount = summary.by_code?.["EMPLOYMENT_TYPE_DERIVED"] ?? 0;

  const chips: { key: RowFilter; label: string; count: number; tone?: string }[] = [
    { key: "all", label: "All", count: summary.total_rows },
    { key: "importable", label: "Ready", count: summary.importable },
    // Only surfaced when the import actually derived any types, to avoid clutter.
    ...(derivedCount > 0
      ? [{ key: "derived" as const, label: "Derived", count: derivedCount, tone: "text-brand-accent" }]
      : []),
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

        {props.problemRows.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            onClick={() => downloadCsv(problemsToCsv(props.problemRows), props.problemFilename)}
            title="Download every not-found, error, warning, and apply-failure row as CSV"
          >
            <DownloadIcon className="size-3.5" />
            Problems ({props.problemRows.length})
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
