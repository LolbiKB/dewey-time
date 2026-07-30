import { format, isSameDay } from "date-fns";

import { buildWeekSchedule, formatScheduleDuration } from "@/lib/weekSchedule";
import { resolveWeekTimelineWindow } from "@/lib/weekTimelineWindow";
import type { Day } from "@/types/calendar";
import { PlannedDayColumn } from "@/ui/PlannedDayColumn";
import { WeekCanvasFrame } from "@/ui/WeekCanvasFrame";

/**
 * The scheduled week, on the same canvas as the attendance timeline.
 *
 * The window comes from resolveWeekTimelineWindow, which already derives from
 * assigned shift bounds — exactly what a planned view wants, and the reason the
 * two surfaces cannot land on different scales.
 */
export function PlannedWeekCanvas(props: { weekDates: Date[]; daysByDate: Map<string, Day> }) {
  const week = buildWeekSchedule(props.weekDates, props.daysByDate);
  const window = resolveWeekTimelineWindow(props.weekDates, props.daysByDate);
  const byDate = new Map(week.map((d) => [d.date, d]));

  return (
    <WeekCanvasFrame
      weekDates={props.weekDates}
      window={window}
      ariaLabel="Weekly expected schedule"
      renderHeader={(d) => {
        const day = byDate.get(format(d, "yyyy-MM-dd"));
        return (
          <div className="px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">{day?.weekday}</span>
              <span className="text-sm font-semibold">{day?.dayNum}</span>
            </div>
            <div className="mt-0.5 truncate text-[10px] tabular-nums text-muted-foreground">
              {day?.durationMin ? `${formatScheduleDuration(day.durationMin)} net` : " "}
            </div>
          </div>
        );
      }}
      renderDay={(d) => {
        const day = byDate.get(format(d, "yyyy-MM-dd"));
        if (!day) return null;
        return (
          <PlannedDayColumn day={day} window={window} isToday={isSameDay(d, new Date())} />
        );
      }}
    />
  );
}
