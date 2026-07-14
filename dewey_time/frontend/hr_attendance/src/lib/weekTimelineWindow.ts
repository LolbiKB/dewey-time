import { format } from "date-fns";

import { computeWeekTimelineWindow, weekTimelineCanvasHeightPct } from "@/lib/attendancePunches";
import { minutesFromDateTime, parseTimeToMinutes } from "@/lib/attendanceTime";
import type { Day } from "@/types/calendar";

export type WeekTimelineWindow = {
  startMin: number;
  endMin: number;
  spanMinutes: number;
  canvasHeightPct: number;
};

/** Every minute-of-day that should influence the shared vertical axis across the week. */
export function collectWeekTimelineMinutes(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): number[] {
  const mins: number[] = [];
  for (const d of weekDates) {
    const key = format(d, "yyyy-MM-dd");
    const info = daysByDate.get(key);
    for (const c of info?.checkins ?? []) {
      const m = minutesFromDateTime(c.time);
      if (m != null) mins.push(m);
    }
    if (info?.first_in) {
      const m = minutesFromDateTime(info.first_in);
      if (m != null) mins.push(m);
    }
    if (info?.last_out) {
      const m = minutesFromDateTime(info.last_out);
      if (m != null) mins.push(m);
    }
    const shift = info?.shift;
    if (shift?.shift_assigned) {
      const start = parseTimeToMinutes(shift.start_time ?? null);
      const end = parseTimeToMinutes(shift.end_time ?? null);
      if (start != null) mins.push(start);
      if (end != null) mins.push(end);
      const lunchStart = parseTimeToMinutes(shift.lunch_start ?? null);
      const lunchEnd = parseTimeToMinutes(shift.lunch_end ?? null);
      if (lunchStart != null) mins.push(lunchStart);
      if (lunchEnd != null) mins.push(lunchEnd);
    }
  }
  return mins;
}

/** The shared axis window + inner canvas height, used by both the week grid and the phone day view. */
export function resolveWeekTimelineWindow(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): WeekTimelineWindow {
  const window = computeWeekTimelineWindow(collectWeekTimelineMinutes(weekDates, daysByDate));
  return { ...window, canvasHeightPct: weekTimelineCanvasHeightPct(window.spanMinutes) };
}
