import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import { plannedDaysFromWeekPattern, resolveWeekPatternWindow } from "@/lib/plannedDays";
import type { ResolvePlan, WeekPattern } from "@/types/schedule";
import { summarizeWeekPattern } from "@/types/schedule";
import { PlannedWeekCanvas } from "@/ui/PlannedWeekCanvas";
import { ResolvePlanGroupsList } from "@/ui/ResolvePlanGroupsList";

export type SchedulePlanPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekPattern: WeekPattern;
  plan: ResolvePlan | null;
  resolving: boolean;
  resolveError: unknown;
  effectiveFrom: string;
  generateThrough: string;
};

export function SchedulePlanPreviewDialog(props: SchedulePlanPreviewDialogProps) {
  const { workDays, offDays, totalWeeklyMinutes } = summarizeWeekPattern(props.weekPattern);
  const weeklyHoursLabel =
    totalWeeklyMinutes > 0 ? formatScheduleDuration(totalWeeklyMinutes) : null;
  const ssaCount = props.plan?.groups?.length ?? 0;

  return (
    <ResponsiveModal
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="md"
      title={<span className="text-base">Weekly schedule preview</span>}
      description={
        <>
          {workDays} work · {offDays} off
          {weeklyHoursLabel ? ` · ${weeklyHoursLabel}/wk` : null}
          {ssaCount ? ` · ${ssaCount} SSA${ssaCount !== 1 ? "s" : ""}` : null}
          {props.effectiveFrom
            ? props.generateThrough
              ? ` · ${props.effectiveFrom} → ${props.generateThrough}`
              : ` · from ${props.effectiveFrom} · open-ended`
            : null}
        </>
      }
      headerClassName="space-y-1 border-b border-border/60 px-5 py-4 text-left"
    >
      <div className="max-h-[min(70dvh,32rem)] overflow-y-auto px-5 py-4">
        <div className="h-[22rem]">
          <PlannedWeekCanvas
            days={plannedDaysFromWeekPattern(props.weekPattern)}
            window={resolveWeekPatternWindow(props.weekPattern)}
            minDayWidth="3rem"
          />
        </div>

        <Separator className="my-5" />

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Matched patterns</h3>
            <p className="text-xs text-muted-foreground">
              One Shift Schedule Assignment (SSA) per group — same records created when you save.
            </p>
          </div>

          {props.resolveError ? (
            <p className="text-sm text-destructive">{String(props.resolveError)}</p>
          ) : props.resolving && !props.plan?.groups?.length ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Matching patterns…
            </p>
          ) : props.plan?.groups?.length ? (
            <ResolvePlanGroupsList groups={props.plan.groups} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Configure shift blocks to see which records will be used.
            </p>
          )}

          {props.plan?.warnings?.length ? (
            <ul className="space-y-1">
              {props.plan.warnings.map((w, i) => (
                <li key={i} className="text-xs text-brand-accent">{w}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </ResponsiveModal>
  );
}

export type SchedulePreviewTriggerProps = {
  onClick: () => void;
  disabled?: boolean;
  resolving?: boolean;
  groupCount?: number;
  className?: string;
};

export function SchedulePreviewTrigger(props: SchedulePreviewTriggerProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="default"
      className={cn("h-9 min-w-[7.5rem]", props.className)}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.resolving ? (
        <>
          <Loader2Icon className="size-3.5 animate-spin" />
          Preview
        </>
      ) : (
        <>Preview{props.groupCount ? ` (${props.groupCount})` : ""}</>
      )}
    </Button>
  );
}
