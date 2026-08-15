import { format } from "date-fns";

import { DayCell } from "@/ui/DayTimeline";
import { HourGutter } from "@/ui/TimelineAxis";
import { resolveWeekTimelineWindow } from "@/lib/weekTimelineWindow";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { MiniState } from "@/miniapp/MiniState";

export function MyDayPage(props: { today?: Date }) {
  const today = props.today ?? new Date();
  const key = format(today, "yyyy-MM-dd");
  const query = useMiniAppCalendar(key, key);

  if (query.isLoading) return <MiniState>Loading your day…</MiniState>;
  if (query.isError) return <MiniState>Couldn't load your day. Try again in a moment.</MiniState>;

  const byDate = daysByDate(query.data);
  const info = byDate.get(key);
  // The same window maths the HR week uses, over a single day: it keeps the
  // axis on whole hours and sized to the shift rather than to 00:00-24:00.
  const window = resolveWeekTimelineWindow([today], byDate);

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold text-foreground">
          {format(today, "EEEE d MMMM")}
        </h1>
      </header>
      {/* `grid` with an explicit column, NOT a block. DayCell's root is a
          <button>, which is inline-level and collapses to a narrow sliver in a
          block wrapper — issue #71, documented at WeekDayView.tsx:143. The
          week grid never notices because its items stretch to fill their
          column; a single-column grid stretches it the same way, so the two
          surfaces cannot drift apart. The 3.5rem gutter is the hour axis,
          without which a lone timeline has no scale to read against. */}
      <div className="h-[26rem] grid grid-cols-[3.5rem_1fr] [&>button]:border-0">
        <HourGutter window={window} />
        <DayCell
          date={today}
          outside={false}
          today
          info={info}
          timelineStartMin={window.startMin}
          timelineEndMin={window.endMin}
          // No inspector in the Mini App: the day sheet is HR's review
          // surface and carries flag evidence an employee must not see.
          onInspectDay={() => {}}
        />
      </div>
    </div>
  );
}
