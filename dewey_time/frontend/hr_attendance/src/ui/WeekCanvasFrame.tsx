import type { ReactNode } from "react";
import { format } from "date-fns";

import type { AxisWindow } from "@/lib/timelineAxis";
import { HourGutter } from "@/ui/TimelineAxis";

/**
 * The week canvas shell: a labelled hour gutter and seven day slots on one
 * shared axis.
 *
 * Both week surfaces render through this. That is deliberate and load-bearing:
 * the attendance timeline and the schedule week previously used different
 * layouts, different time axes and different densities, and nothing structural
 * stopped them diverging. A single frame makes their agreement a property of
 * the code rather than of whoever edits it next.
 *
 * Both per-day wrappers below carry `className="contents"`: they generate no
 * box, so whatever `renderHeader`/`renderDay` returns stays a DIRECT grid item.
 * One mechanism, two distinct collapses it prevents — a plain wrapper would
 * become the grid item itself and:
 *
 * - in the header row, take the `align-self: stretch` for itself and leave the
 *   returned cell at auto height, so an off-day or holiday tint would stop
 *   short of the row's bottom edge on the shorter columns;
 * - in the day row, re-expose issue #71 — `DayCell`'s root is a `<button>`,
 *   which is inline-level and shrinks to a sliver unless it is the grid item
 *   (documented at `WeekDayView.tsx:141`).
 */
export function WeekCanvasFrame(props: {
  weekDates: Date[];
  window: AxisWindow | null;
  renderHeader: (date: Date) => ReactNode;
  renderDay: (date: Date) => ReactNode;
  ariaLabel?: string;
}) {
  const cols = "grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
        <div className={`grid shrink-0 ${cols} border-b border-border/60`}>
          <div aria-hidden="true" />
          {props.weekDates.map((d) => (
            <div key={format(d, "yyyy-MM-dd")} className="contents">
              {props.renderHeader(d)}
            </div>
          ))}
        </div>

        {/* No vertical scroll: the axis is scaled to fit this box. See #78. */}
        <div className="relative min-h-0 flex-1 overflow-hidden" aria-label={props.ariaLabel}>
          <div className={`grid h-full ${cols}`}>
            <HourGutter window={props.window} />
            {props.weekDates.map((d) => (
              <div key={format(d, "yyyy-MM-dd")} className="contents">
                {props.renderDay(d)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
