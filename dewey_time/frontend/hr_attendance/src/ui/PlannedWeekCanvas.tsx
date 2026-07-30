import { formatScheduleDuration } from "@/lib/weekSchedule";
import type { AxisWindow } from "@/lib/timelineAxis";
import type { PlannedDay } from "@/lib/plannedDays";
import { PlannedDayColumn } from "@/ui/PlannedDayColumn";
import { WeekCanvasFrame } from "@/ui/WeekCanvasFrame";

/** The one week length WeekCanvasFrame's grid supports (`grid-cols-[3.5rem_repeat(7,...)]`,
 * WeekCanvasFrame.tsx:36) — a `days` array of any other length would silently
 * wrap into a broken second row rather than fail loudly. */
const WEEK_LENGTH = 7;

/**
 * Seven distinct, otherwise-unused dates, purely so `WeekCanvasFrame` — which
 * keys and iterates by `Date` — has something to key on.
 *
 * `PlannedWeekCanvas` is source-agnostic: `days` may come from a dated
 * calendar week or the schedule editor's undated `WeekPattern`, neither of
 * which is a real `Date` by the time it reaches here. Content is looked up
 * by array position (reference-equal to the placeholder the frame hands
 * back), never by the placeholder's date value.
 */
function placeholderWeek(): Date[] {
  return Array.from({ length: WEEK_LENGTH }, (_, i) => new Date(2000, 0, i + 3)); // Mon 3 Jan 2000 onward
}

/**
 * The planned week, on the same canvas as the attendance timeline.
 *
 * Source-agnostic on purpose: `days` is the normalised `PlannedDay[]`
 * (plannedDays.ts), and `window` is supplied by the caller rather than
 * derived here. A dated calendar week reaches this shape through
 * `plannedDaysFromSchedule` + `resolveWeekTimelineWindow`; the schedule
 * editor's undated `WeekPattern` has its own adapter. Neither `Day` nor a
 * real date is imported by this component.
 */
export function PlannedWeekCanvas(props: {
  days: PlannedDay[];
  window: AxisWindow | null;
  /** Forwarded to `WeekCanvasFrame` — see its doc comment. Omit for the
   * default 8rem (the attendance grid's width); narrower callers such as the
   * schedule preview dialog pass something smaller. */
  minDayWidth?: string;
}) {
  if (props.days.length !== WEEK_LENGTH) {
    throw new Error(
      `PlannedWeekCanvas expects a ${WEEK_LENGTH}-day week, got ${props.days.length}`,
    );
  }
  const placeholders = placeholderWeek();

  return (
    <WeekCanvasFrame
      weekDates={placeholders}
      window={props.window}
      minDayWidth={props.minDayWidth}
      ariaLabel="Weekly expected schedule"
      renderHeader={(d) => {
        const day = props.days[placeholders.indexOf(d)];
        return (
          <div className="px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">{day?.label}</span>
              {day?.sublabel ? (
                <span className="text-sm font-semibold">{day.sublabel}</span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[10px] tabular-nums text-muted-foreground">
              {day?.durationMin ? `${formatScheduleDuration(day.durationMin)} net` : " "}
            </div>
          </div>
        );
      }}
      renderDay={(d) => {
        const day = props.days[placeholders.indexOf(d)];
        if (!day) return <div className="border-b border-r border-border/60" />;
        return <PlannedDayColumn day={day} window={props.window} />;
      }}
    />
  );
}
