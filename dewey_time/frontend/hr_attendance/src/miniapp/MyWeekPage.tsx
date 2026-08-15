import { addDays, format, isSameDay, startOfWeek } from "date-fns";

import { clamp, formatDayCheckinTimeRange, formatDurationMinutes, minutesFromDateTime, parseDateTimeLocal } from "@/lib/attendanceTime";
import { deriveSegments } from "@/lib/attendancePunches";
import { netWorkedMinutes } from "@/lib/clockDay";
import { cn } from "@/lib/utils";
import type { Day } from "@/types/calendar";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { MiniState } from "@/miniapp/MiniState";

/** Monday-first, matching the HR week view. */
export function weekDatesFor(today: Date): Date[] {
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export type DayLine = {
  /** Punch span, e.g. "7:58 AM – 5:06 PM", or null when nothing was recorded. */
  range: string | null;
  /** Net worked, already formatted. Null when there is nothing to total. */
  worked: string | null;
  /** What to say when there is no span: leave, holiday, off, or nothing yet. */
  note: string | null;
};

/**
 * One row of the week.
 *
 * Deliberately says what happened and never what it means. A scheduled day
 * with no punches reads "No punches recorded", NOT "absent" — at this point
 * the engine's own verdict is still provisional (intraday re-inserts AUTO
 * flags on every punch) and HR has not reviewed anything. Calling it an
 * absence here would be the app taking a position it has no standing to take.
 */
export function dayLine(day: Day | undefined, date: Date, today: Date): DayLine {
  if (day?.leave?.on_leave) {
    return { range: null, worked: null, note: day.leave.leave_type ?? "On leave" };
  }
  if (day?.holiday) {
    return { range: null, worked: null, note: day.holiday.description ?? "Holiday" };
  }

  const range = formatDayCheckinTimeRange(day);
  if (range) {
    const segments = deriveSegments(day?.checkins ?? [], {
      parseTime: parseDateTimeLocal,
      minutesFromDateTime,
      clamp,
    });
    const net = netWorkedMinutes(segments);
    return {
      range,
      worked: net == null ? null : formatDurationMinutes(net),
      note: null,
    };
  }

  if (!day?.shift?.shift_assigned) {
    return { range: null, worked: null, note: "Day off" };
  }
  // Scheduled, no punches. A future day has simply not happened yet.
  if (date > today && !isSameDay(date, today)) {
    return { range: null, worked: null, note: "Scheduled" };
  }
  return { range: null, worked: null, note: "No punches recorded" };
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

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold text-foreground">
          {format(week[0]!, "d MMM")} – {format(week[6]!, "d MMM")}
        </h1>
        <p className="text-xs text-muted-foreground">What you actually worked</p>
      </header>

      {/* A list, not the HR week canvas. Seven timeline columns need ~8rem
          each to keep their headers readable, which is 56rem against a 390px
          phone -- two and a half days visible and five off-screen. A vertical
          list shows the whole week at once, which is the question this tab
          answers. */}
      <ul className="divide-y divide-border rounded-md border border-border">
        {week.map((date) => {
          const key = format(date, "yyyy-MM-dd");
          const line = dayLine(byDate.get(key), date, today);
          const isToday = isSameDay(date, today);
          return (
            <li
              key={key}
              className={cn(
                "flex items-baseline gap-3 px-3 py-2.5",
                isToday && "bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "w-10 shrink-0 text-xs font-medium",
                  isToday ? "text-primary" : "text-foreground",
                )}
              >
                {format(date, "EEE")}
              </span>
              <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                {format(date, "d")}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm tabular-nums",
                  line.range ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {line.range ?? line.note}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {line.worked ?? ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
