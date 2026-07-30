import type { ReactNode } from "react";
import { format } from "date-fns";

import type { AxisWindow } from "@/lib/timelineAxis";
import { HourGutter } from "@/ui/TimelineAxis";

/**
 * Complete class-name literals, keyed by `minDayWidth`. Tailwind only sees
 * literal class strings scanned out of source files — a template literal
 * here (`` `grid-cols-[...minmax(${x},1fr))]` ``) compiles to nothing, because
 * the interpolated value doesn't exist until runtime. This lookup is the fix
 * *and* the trap: the interpolated form is the obvious-looking refactor, and
 * it silently deletes the grid template from the built CSS.
 */
const COL_TEMPLATES = {
  "8rem": "grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]",
  "3rem": "grid-cols-[3.5rem_repeat(7,minmax(3rem,1fr))]",
} as const;

/** Default day-column minimum — see the `minDayWidth` prop doc below. */
export const DEFAULT_COL_TEMPLATE = COL_TEMPLATES["8rem"];

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
 *   (documented in `WeekDayView.tsx`'s own comment on its single-column grid:
 *   "DayCell's root is a `<button>`, which is inline-level and therefore
 *   shrinks to its content width").
 *
 * `renderHeader` and `renderDay` must each return exactly one element. The
 * `contents` wrapper only preserves grid-item identity for a single child —
 * a fragment with two children silently adds a grid column and shifts the
 * week; returning `null` silently removes one.
 */
export function WeekCanvasFrame(props: {
  weekDates: Date[];
  window: AxisWindow | null;
  renderHeader: (date: Date) => ReactNode;
  renderDay: (date: Date) => ReactNode;
  ariaLabel?: string;
  /**
   * Minimum width of each day column before `1fr` grows it to fill remaining
   * space. Defaults to `"8rem"` — the attendance grid's cells carry chips, a
   * clock total and a time range, and need the room. A caller whose cells are
   * lighter (a duration bar and two small labels) can pass something smaller
   * so all seven columns fit a narrower container without horizontal scroll.
   *
   * Must be a key of `COL_TEMPLATES` above: Tailwind can only see complete,
   * literal class strings, so this can't be interpolated into the class name
   * at runtime — it selects between pre-built literals instead.
   */
  minDayWidth?: keyof typeof COL_TEMPLATES;
}) {
  // The `??` fallback matters even though the type is a closed key set:
  // nothing typechecks this package, so an out-of-range value at runtime
  // must degrade to the default template rather than render `undefined`
  // into the class string.
  const cols = COL_TEMPLATES[props.minDayWidth ?? "8rem"] ?? COL_TEMPLATES["8rem"];

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

        {/* No vertical scroll: the axis is scaled to fit this box, so a week
            with a wide span compresses rather than overflowing. See
            resolveWeekTimelineWindow. */}
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
