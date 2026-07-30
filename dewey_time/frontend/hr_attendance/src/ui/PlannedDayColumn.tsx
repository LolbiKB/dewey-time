import { plannedBlocks } from "@/lib/plannedBlocks";
import { pctOfWindow, type AxisWindow } from "@/lib/timelineAxis";
import { formatScheduleDuration, shortShiftTypeCode, type WeekDaySchedule } from "@/lib/weekSchedule";
import { cn } from "@/lib/utils";
import { AppTooltip } from "@/ui/AppTooltip";
import { HourGrid } from "@/ui/TimelineAxis";

/** One day of the planned week. Mirrors DayCell's shape without its punch machinery. */
export function PlannedDayColumn(props: {
  day: WeekDaySchedule;
  window: AxisWindow | null;
  isToday: boolean;
}) {
  const { day } = props;
  const blocks = props.window ? plannedBlocks(day) : [];
  const tip = [
    shortShiftTypeCode(day.shiftType),
    day.timeLabel,
    day.lunchLabel ? `lunch ${day.lunchLabel}` : null,
    day.durationMin ? `${formatScheduleDuration(day.durationMin)} net` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "relative min-h-0 border-b border-r border-border/60 p-3 pl-5",
        props.isToday && "bg-primary/3 ring-1 ring-primary/20",
      )}
    >
      <div className="relative h-full rounded-xl bg-muted/25">
        <HourGrid window={props.window} />

        {day.onLeave ? (
          <div className="absolute inset-0 flex items-center justify-center px-2">
            <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-brand-accent">
              {day.leaveType ?? "On leave"}
            </span>
          </div>
        ) : !day.assigned ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">Day off</span>
          </div>
        ) : null}

        {blocks.map((b, i) => {
          const top = pctOfWindow(b.startMin, props.window!);
          const height = pctOfWindow(b.endMin, props.window!) - top;
          if (height <= 0) return null;
          return (
            <AppTooltip key={i} side="right" content={tip || "Scheduled"}>
              <div
                /* Outlined, not filled: planned time must never be mistaken for
                   the solid blocks the attendance canvas uses for real punches. */
                className="absolute inset-x-2 rounded-sm border border-primary/45 bg-primary/12"
                style={{ top: `${top}%`, height: `${height}%`, minHeight: 3 }}
              />
            </AppTooltip>
          );
        })}
      </div>
    </div>
  );
}
