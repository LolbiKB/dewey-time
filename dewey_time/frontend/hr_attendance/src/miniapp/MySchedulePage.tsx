import { format } from "date-fns";

import { formatScheduleDuration } from "@/lib/weekSchedule";
import { plannedDaysFromSchedule } from "@/lib/plannedDays";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { weekDatesFor } from "@/miniapp/MyWeekPage";
import { MiniState } from "@/miniapp/MiniState";

function hhmm(minutes: number | undefined): string {
  if (minutes === undefined) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The assigned shift pattern as a list rather than a canvas.
 *
 * The week view already shows the same data on a timeline. This answers a
 * different question -- "what am I rostered for" -- which is read as text, and
 * a list survives a narrow phone in a way a seven-column grid does not.
 */
export function MySchedulePage(props: { today?: Date }) {
  const today = props.today ?? new Date();
  const week = weekDatesFor(today);
  const query = useMiniAppCalendar(
    format(week[0]!, "yyyy-MM-dd"),
    format(week[6]!, "yyyy-MM-dd"),
  );

  if (query.isLoading) return <MiniState>Loading your schedule…</MiniState>;
  if (query.isError) {
    return <MiniState>Couldn't load your schedule. Try again in a moment.</MiniState>;
  }

  const planned = plannedDaysFromSchedule(week, daysByDate(query.data));
  if (planned.every((d) => !d.works)) {
    return <MiniState>No shifts are assigned to you this week.</MiniState>;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold text-foreground">This week's shifts</h1>
      </header>
      <ul className="divide-y divide-border rounded-md border border-border">
        {planned.map((day) => (
          <li key={day.key} className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-12 shrink-0 text-xs font-medium text-foreground">
              {day.label}
            </span>
            <span className="w-8 shrink-0 text-xs text-muted-foreground tabular-nums">
              {day.sublabel}
            </span>
            <span className="min-w-0 flex-1 text-sm tabular-nums text-foreground">
              {day.onLeave
                ? (day.leaveType ?? "On leave")
                : day.works
                  ? `${hhmm(day.startMin)} – ${hhmm(day.endMin)}`
                  : "—"}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {day.works && !day.onLeave && day.durationMin
                ? formatScheduleDuration(day.durationMin)
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
