import { ChevronDownIcon, Loader2Icon, RepeatIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import { cn } from "@/lib/utils";
import type { ImportPatternPlan, ImportPlanStats } from "@/hooks/useImportSchedulePlanSummary";
import { summarizeWeekPattern } from "@/types/schedule";
import { ResolvePlanGroupsList } from "@/ui/ResolvePlanGroupsList";

export type ImportSchedulePlanSummaryProps = {
  stats: ImportPlanStats;
  plans: ImportPatternPlan[];
  loading: boolean;
  error: string | null;
  className?: string;
};

function formatWeeklyHoursRange(min: number | null, max: number | null): string | null {
  if (min === null || max === null || min <= 0) return null;
  if (min === max) return `${formatScheduleDuration(min)}/wk`;
  return `${formatScheduleDuration(min)}–${formatScheduleDuration(max)}/wk`;
}

export function ImportSchedulePlanSummary(props: ImportSchedulePlanSummaryProps) {
  const { stats, plans, loading, error } = props;
  const [expanded, setExpanded] = useState(false);

  const patternEntries = useMemo(
    () =>
      plans
        .filter((entry) => entry.plan?.groups?.length)
        .map((entry) => {
          const { workDays, offDays, totalWeeklyMinutes } = summarizeWeekPattern(entry.weekPattern);
          const ssaPerEmployee = entry.plan?.groups.length ?? 0;
          return {
            key: entry.patternKey,
            entry,
            workDays,
            offDays,
            totalWeeklyMinutes,
            ssaPerEmployee,
            totalSsaAssignments: ssaPerEmployee * entry.employeeCount,
          };
        })
        .sort((a, b) => b.entry.employeeCount - a.entry.employeeCount),
    [plans]
  );

  const weeklyHoursLabel = formatWeeklyHoursRange(stats.weeklyMinutesMin, stats.weeklyMinutesMax);

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
            <span className="font-medium text-foreground">SSA assignment preview</span>
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
            {!loading && stats.totalSsaAssignments > 0 ? (
              <>
                {" · "}
                <span className="text-foreground">{stats.totalSsaAssignments}</span> SSA
                {stats.totalSsaAssignments !== 1 ? "s" : ""} total
              </>
            ) : null}
            {!loading && weeklyHoursLabel ? (
              <>
                {" · "}
                <span className="text-foreground">{weeklyHoursLabel}</span>
              </>
            ) : null}
            {!loading && stats.existingShiftSchedules > 0 ? (
              <>
                {" · "}
                {stats.existingShiftSchedules} existing PAT
                {stats.existingShiftSchedules !== 1 ? "s" : ""}
              </>
            ) : null}
            {!loading && stats.newShiftSchedules > 0 ? (
              <>
                {" · "}
                {stats.newShiftSchedules} new PAT{stats.newShiftSchedules !== 1 ? "s" : ""}
              </>
            ) : null}
          </p>

          <p className="text-[11px] text-muted-foreground">
            Same resolve plan as manual Weekly Schedule — one SSA per matched group when you apply.
          </p>

          {error ? <p className="text-destructive">{error}</p> : null}

          {!loading && patternEntries.length > 0 ? (
            <div className="pt-0.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                onClick={() => setExpanded((v) => !v)}
              >
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
                />
                {expanded ? "Hide" : "Show"} SSA groups
              </button>

              {expanded ? (
                <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                  {patternEntries.map((item) => (
                    <li
                      key={item.key}
                      className="rounded-md border border-border/50 bg-muted/20 px-2 py-2"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-medium text-foreground">
                          {item.entry.employeeCount} employee
                          {item.entry.employeeCount !== 1 ? "s" : ""}
                        </span>
                        <span className="text-muted-foreground">
                          {item.workDays} work · {item.offDays} off
                          {item.totalWeeklyMinutes > 0
                            ? ` · ${formatScheduleDuration(item.totalWeeklyMinutes)}/wk`
                            : null}
                        </span>
                        <Badge variant="secondary" className="ml-auto text-[10px] font-normal">
                          {item.ssaPerEmployee} SSA{item.ssaPerEmployee !== 1 ? "s" : ""}/emp
                        </Badge>
                      </div>
                      <ResolvePlanGroupsList groups={item.entry.plan!.groups} compact />
                      {item.entry.plan?.warnings?.length ? (
                        <ul className="mt-2 space-y-0.5">
                          {item.entry.plan.warnings.map((warning, index) => (
                            <li
                              key={index}
                              className="text-[11px] text-brand-accent"
                            >
                              {warning}
                            </li>
                          ))}
                        </ul>
                      ) : null}
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
