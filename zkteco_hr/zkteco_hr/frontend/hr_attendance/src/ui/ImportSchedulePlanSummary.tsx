import { ChevronDownIcon, Loader2Icon, RepeatIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ImportPatternPlan, ImportPlanStats } from "@/hooks/useImportSchedulePlanSummary";
import { formatDayList, formatTimeInput } from "@/types/schedule";

export type ImportSchedulePlanSummaryProps = {
  stats: ImportPlanStats;
  plans: ImportPatternPlan[];
  loading: boolean;
  error: string | null;
  className?: string;
};

export function ImportSchedulePlanSummary(props: ImportSchedulePlanSummaryProps) {
  const { stats, plans, loading, error } = props;
  const [expanded, setExpanded] = useState(false);

  const scheduleLines = useMemo(() => {
    const lines: Array<{
      key: string;
      label: string;
      action: "use" | "create";
      employeeCount: number;
      days: string;
      times: string;
    }> = [];

    for (const entry of plans) {
      if (!entry.plan) continue;
      for (const group of entry.plan.groups) {
        const scheduleName =
          group.shift_schedule.action === "use"
            ? group.shift_schedule.name
            : group.shift_schedule.proposed_name;
        if (!scheduleName) continue;

        const times = `${formatTimeInput(group.profile.start_time)}–${formatTimeInput(group.profile.end_time)}`;
        lines.push({
          key: `${entry.patternKey}-${scheduleName}-${group.days.join(",")}`,
          label: scheduleName,
          action: group.shift_schedule.action,
          employeeCount: entry.employeeCount,
          days: formatDayList(group.days),
          times,
        });
      }
    }

    return lines.sort((a, b) => b.employeeCount - a.employeeCount);
  }, [plans]);

  if (stats.selectedEmployees === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-background/80 px-3 py-2.5 text-xs",
        props.className
      )}
    >
      <div className="flex items-start gap-2">
        <RepeatIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-foreground">SSA patterns</span>
            {loading ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
                Matching…
              </span>
            ) : null}
          </div>

          <p className="leading-relaxed text-muted-foreground">
            {stats.selectedEmployees} employee{stats.selectedEmployees !== 1 ? "s" : ""} ·{" "}
            {stats.uniquePatterns} unique pattern{stats.uniquePatterns !== 1 ? "s" : ""}
            {!loading && stats.existingShiftSchedules > 0 ? (
              <>
                {" · "}
                <span className="text-foreground">{stats.existingShiftSchedules} existing</span> Shift
                Schedule{stats.existingShiftSchedules !== 1 ? "s" : ""}
              </>
            ) : null}
            {!loading && stats.newShiftSchedules > 0 ? (
              <>
                {" · "}
                <span className="text-foreground">{stats.newShiftSchedules} new</span> Shift Schedule
                {stats.newShiftSchedules !== 1 ? "s" : ""} will be created
              </>
            ) : null}
            {!loading &&
            stats.newShiftSchedules === 0 &&
            stats.existingShiftSchedules === 0 &&
            !error ? (
              <> · uses existing site patterns</>
            ) : null}
          </p>

          {error ? <p className="text-destructive">{error}</p> : null}

          {!loading && scheduleLines.length > 0 ? (
            <div className="pt-0.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                onClick={() => setExpanded((v) => !v)}
              >
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
                />
                {expanded ? "Hide" : "Show"} Shift Schedule details
              </button>

              {expanded ? (
                <ul className="mt-2 max-h-36 space-y-1.5 overflow-y-auto pr-1">
                  {scheduleLines.map((line) => (
                    <li
                      key={line.key}
                      className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate font-medium text-foreground">{line.label}</span>
                        {line.action === "create" ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            New
                          </Badge>
                        ) : null}
                        <span className="ml-auto tabular-nums text-muted-foreground">
                          {line.employeeCount} emp
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {line.days} · {line.times}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
