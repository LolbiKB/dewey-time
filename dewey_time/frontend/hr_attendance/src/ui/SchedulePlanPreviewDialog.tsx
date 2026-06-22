import { CalendarRangeIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import type { ResolvePlan, WeekPattern, WeekPatternDay } from "@/types/schedule";
import { formatTimeInput, summarizeWeekPattern, toApiTime } from "@/types/schedule";
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
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton>
        <DialogHeader className="space-y-1 border-b border-border/60 px-5 py-4 text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarRangeIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">Weekly schedule preview</DialogTitle>
              <DialogDescription className="text-xs">
                {workDays} work · {offDays} off
                {weeklyHoursLabel ? ` · ${weeklyHoursLabel}/wk` : null}
                {ssaCount ? ` · ${ssaCount} SSA${ssaCount !== 1 ? "s" : ""}` : null}
                {props.effectiveFrom
                  ? props.generateThrough
                    ? ` · ${props.effectiveFrom} → ${props.generateThrough}`
                    : ` · from ${props.effectiveFrom} · open-ended`
                  : null}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[min(70dvh,32rem)] overflow-y-auto px-5 py-4">
          <WeekPatternStrip pattern={props.weekPattern} />

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
      </DialogContent>
    </Dialog>
  );
}

function WeekPatternStrip(props: { pattern: WeekPattern }) {
  return (
    <section aria-label="Weekly pattern">
      <div className="grid grid-cols-7 gap-1.5">
        {props.pattern.days.map((row) => (
          <DayColumn key={row.weekday} row={row} />
        ))}
      </div>
    </section>
  );
}

function DayColumn(props: { row: WeekPatternDay }) {
  const { row } = props;
  const label = row.weekday.slice(0, 3);

  return (
    <div
      className={cn(
        "flex min-h-[7.5rem] flex-col items-center rounded-xl border px-1 py-2 text-center",
        row.works
          ? "border-primary/25 bg-primary/[0.04]"
          : "border-dashed border-border/70 bg-muted/15"
      )}
    >
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          row.works ? "text-primary" : "text-muted-foreground"
        )}
      >
        {label}
      </span>

      {row.works ? (
        <>
          <MiniShiftTrack row={row} />
          <span className="mt-1.5 text-[10px] font-medium tabular-nums leading-tight text-foreground">
            {formatTimeInput(row.start_time)}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {formatTimeInput(row.end_time)}
          </span>
        </>
      ) : (
        <span className="mt-auto mb-auto text-[10px] text-muted-foreground">Off</span>
      )}
    </div>
  );
}

function MiniShiftTrack(props: { row: WeekPatternDay }) {
  const startMin = timeToMinutes(props.row.start_time);
  const endMin = timeToMinutes(props.row.end_time);
  const lunchStartMin = timeToMinutes(props.row.lunch_start);
  const lunchEndMin = timeToMinutes(props.row.lunch_end);

  if (startMin == null || endMin == null || endMin <= startMin) {
    return <div className="mt-2 h-14 w-2 rounded-full bg-muted/40" />;
  }

  const span = endMin - startMin;
  const lunchTop =
    lunchStartMin != null && lunchEndMin != null && lunchEndMin > lunchStartMin
      ? clampPct(((lunchStartMin - startMin) / span) * 100)
      : null;
  const lunchHeight =
    lunchTop != null && lunchStartMin != null && lunchEndMin != null
      ? clampPct(((lunchEndMin - lunchStartMin) / span) * 100)
      : null;

  return (
    <div className="relative mt-2 h-14 w-2 overflow-hidden rounded-full bg-muted/40">
      <div className="absolute inset-0 rounded-full bg-primary/90 ring-1 ring-primary/20" />
      {lunchTop != null && lunchHeight != null ? (
        <div
          className="absolute inset-x-0 rounded-sm bg-background ring-1 ring-border/40"
          style={{ top: `${lunchTop}%`, height: `${Math.max(12, lunchHeight)}%` }}
        />
      ) : null}
    </div>
  );
}

function timeToMinutes(value: string | null | undefined): number | null {
  const normalized = toApiTime(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function clampPct(value: number) {
  return Math.min(100, Math.max(0, value));
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
