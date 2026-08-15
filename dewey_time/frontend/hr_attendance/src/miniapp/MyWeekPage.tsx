import { addDays, format, startOfWeek } from "date-fns";

import { PlannedWeekCanvas } from "@/ui/PlannedWeekCanvas";
import { plannedDaysFromSchedule } from "@/lib/plannedDays";
import { resolveWeekTimelineWindow } from "@/lib/weekTimelineWindow";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { MiniState } from "@/miniapp/MiniState";

/** Monday-first, matching the HR week view. */
export function weekDatesFor(today: Date): Date[] {
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function MyWeekPage(props: { today?: Date }) {
  const today = props.today ?? new Date();
  const week = weekDatesFor(today);
  const query = useMiniAppCalendar(
    format(week[0]!, "yyyy-MM-dd"),
    format(week[6]!, "yyyy-MM-dd"),
  );

  if (query.isLoading) return <MiniState>Loading your week…</MiniState>;
  if (query.isError) return <MiniState>Couldn't load your week. Try again in a moment.</MiniState>;

  const byDate = daysByDate(query.data);
  const window = resolveWeekTimelineWindow(week, byDate);

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold text-foreground">
          {format(week[0]!, "d MMM")} – {format(week[6]!, "d MMM")}
        </h1>
      </header>
      {/* "3rem", the narrow option WeekCanvasFrame already supports, rather
          than the 8rem default the HR grid uses: seven columns plus the axis
          gutter have to fit a phone. The container scrolls horizontally rather
          than letting the columns squeeze below that. */}
      <div className="h-[24rem] overflow-x-auto">
        <PlannedWeekCanvas
          days={plannedDaysFromSchedule(week, byDate)}
          window={window}
          minDayWidth="8rem"
        />
      </div>
    </div>
  );
}
