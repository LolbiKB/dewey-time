import { format } from "date-fns";

import { minutesFromDateTime, parseTimeToMinutes } from "@/lib/attendanceTime";
import type { Day } from "@/types/calendar";

export type WeekTimelineWindow = {
  startMin: number;
  endMin: number;
  spanMinutes: number;
};

/**
 * The window for an employee with no schedule to derive one from — clock-based
 * staff, or a week with no Shift Assignment. A plain working day.
 */
export const FALLBACK_START_MIN = 6 * 60;
export const FALLBACK_END_MIN = 20 * 60;

/** Breathing room either side of the scheduled day, before hour-quantization. */
const PAD_MIN = 60;

/**
 * The scheduled bounds the axis is derived FROM.
 *
 * Overnight shifts (end <= start) are excluded on purpose. Minute-of-day cannot
 * express 22:00->06:00 as a range, and admitting those two numbers would widen
 * the window to 06:00-22:00 and flatten every other day in the week.
 */
export function collectShiftBounds(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): number[] {
  const mins: number[] = [];
  for (const d of weekDates) {
    const shift = daysByDate.get(format(d, "yyyy-MM-dd"))?.shift;
    if (!shift?.shift_assigned) continue;
    const start = parseTimeToMinutes(shift.start_time ?? null);
    const end = parseTimeToMinutes(shift.end_time ?? null);
    if (start == null || end == null || end <= start) continue;
    mins.push(start, end);
  }
  return mins;
}

/**
 * The observed minutes the axis is WIDENED BY, so nothing recorded can fall
 * outside the visible range.
 *
 * Deliberately excludes shift start/end: those belong to collectShiftBounds,
 * which is where the overnight guard lives. Folding them in here would re-admit
 * exactly the bounds that guard just excluded — the reason these are two
 * functions and not one.
 */
export function collectWideningMinutes(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): number[] {
  const mins: number[] = [];
  const push = (m: number | null) => {
    if (m != null) mins.push(m);
  };
  for (const d of weekDates) {
    const info = daysByDate.get(format(d, "yyyy-MM-dd"));
    for (const c of info?.checkins ?? []) push(minutesFromDateTime(c.time));
    push(minutesFromDateTime(info?.first_in));
    push(minutesFromDateTime(info?.last_out));
    const shift = info?.shift;
    if (shift?.shift_assigned) {
      push(parseTimeToMinutes(shift.lunch_start ?? null));
      push(parseTimeToMinutes(shift.lunch_end ?? null));
    }
  }
  return mins;
}

/**
 * The shared vertical axis, used by both the week grid and the phone day view.
 *
 * Derived from the week's assigned shifts, not its punches. Punches still widen
 * it — nothing recorded can be hidden — but they no longer define it, so one
 * stray 05:20 punch moves the axis by a labelled hour instead of re-scaling all
 * seven days. Schedules are assigned and stable; punches are noisy.
 *
 * Quantized to whole hours so the gridlines always land on an hour, which is
 * what makes the gutter's labels trustworthy.
 *
 * The axis always fits its container — there is no canvas taller than the
 * viewport and therefore no scrolling (see #78, and weekTimelineScroll.test.tsx).
 */
export function resolveWeekTimelineWindow(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): WeekTimelineWindow {
  const bounds = collectShiftBounds(weekDates, daysByDate);

  let startMin = FALLBACK_START_MIN;
  let endMin = FALLBACK_END_MIN;
  if (bounds.length) {
    startMin = Math.floor((Math.min(...bounds) - PAD_MIN) / 60) * 60;
    endMin = Math.ceil((Math.max(...bounds) + PAD_MIN) / 60) * 60;
  }

  for (const m of collectWideningMinutes(weekDates, daysByDate)) {
    if (m < startMin) startMin = Math.floor(m / 60) * 60;
    if (m > endMin) endMin = Math.ceil(m / 60) * 60;
  }

  startMin = Math.max(0, startMin);
  endMin = Math.min(24 * 60, endMin);
  return { startMin, endMin, spanMinutes: endMin - startMin };
}
