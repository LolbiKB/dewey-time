import { plannedBlocksForDay, type PlannedDay } from "@/lib/plannedDays";
import { pctOfWindow, type AxisWindow } from "@/lib/timelineAxis";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import { AppTooltip } from "@/ui/AppTooltip";
import { HourGrid } from "@/ui/TimelineAxis";

/**
 * "8:00 AM" from a minute-of-day.
 *
 * `PlannedDay` carries only minutes, not the `"HH:MM:SS"` strings
 * `formatShiftTime12h` (weekSchedule.ts) expects, so this formats directly
 * off the number rather than round-tripping through a fabricated time string.
 */
function minuteLabel(min: number): string {
  const hh = Math.floor(min / 60) % 24;
  const mm = min % 60;
  const period = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

/** One day of the planned week. Mirrors DayCell's shape without its punch machinery. */
export function PlannedDayColumn(props: { day: PlannedDay; window: AxisWindow | null }) {
  const { day } = props;
  const blocks = props.window ? plannedBlocksForDay(day) : [];
  const timeLabel =
    day.startMin != null && day.endMin != null
      ? `${minuteLabel(day.startMin)} – ${minuteLabel(day.endMin)}`
      : null;
  const lunchLabel =
    day.lunchStartMin != null && day.lunchEndMin != null
      ? `${minuteLabel(day.lunchStartMin)} – ${minuteLabel(day.lunchEndMin)}`
      : null;
  const tip = [
    day.shiftCode,
    timeLabel,
    lunchLabel ? `lunch ${lunchLabel}` : null,
    day.durationMin ? `${formatScheduleDuration(day.durationMin)} net` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative min-h-0 border-b border-r border-border/60 p-3 pl-5">
      <div className="relative h-full rounded-xl bg-muted/25">
        <HourGrid window={props.window} />

        {day.onLeave ? (
          <div className="absolute inset-0 flex items-center justify-center px-2">
            <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-brand-accent">
              {day.leaveType ?? "On leave"}
            </span>
          </div>
        ) : !day.works ? (
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
