import { hourLabel, hourTicks, pctOfWindow, type AxisWindow } from "@/lib/timelineAxis";
import { cn } from "@/lib/utils";

/**
 * Hour lines, drawn inside a day track BEHIND the punch bands.
 *
 * Must be the first child of the track: nothing in DayTimeline sets a z-index,
 * so stacking is DOM order and a later insertion paints over the bands.
 */
export function HourGrid(props: { window: AxisWindow | null }) {
  if (!props.window) return null;
  const window = props.window;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {hourTicks(window.startMin, window.endMin).map((m) => (
        <div
          key={m}
          className="absolute inset-x-0 h-px bg-border"
          style={{ top: `${pctOfWindow(m, window)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The labelled time column.
 *
 * `py-3` matches DayCell's `p-3`, which is what puts each label on its line.
 * No tooltips: WeekDayView.test.tsx renders without a TooltipProvider.
 */
export function HourGutter(props: {
  window: AxisWindow | null;
  className?: string;
  /** The axis in the reader's language and script. Omitted means English. */
  formatHour?: (minuteOfDay: number) => string;
}) {
  const label = props.formatHour ?? hourLabel;
  return (
    <div className={cn("relative shrink-0 py-3 pr-1.5", props.className)} aria-hidden="true">
      <div className="relative h-full">
        {props.window
          ? hourTicks(props.window.startMin, props.window.endMin).map((m) => (
              <div
                key={m}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium tabular-nums text-muted-foreground/70"
                style={{ top: `${pctOfWindow(m, props.window!)}%` }}
              >
                {label(m)}
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
