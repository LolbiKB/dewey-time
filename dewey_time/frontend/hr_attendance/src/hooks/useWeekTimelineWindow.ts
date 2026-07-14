import { useMemo } from "react";

import { resolveWeekTimelineWindow, type WeekTimelineWindow } from "@/lib/weekTimelineWindow";
import type { Day } from "@/types/calendar";

export function useWeekTimelineWindow(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): WeekTimelineWindow {
  return useMemo(() => resolveWeekTimelineWindow(weekDates, daysByDate), [weekDates, daysByDate]);
}
