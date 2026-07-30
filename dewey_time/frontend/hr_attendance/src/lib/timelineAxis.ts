/**
 * The vertical axis shared by the week grid and the phone day view.
 *
 * Pure on purpose: two window shapes exist in this package
 * (`WeekTimelineWindow` carries `spanMinutes`, `DayDayTrack`'s internal memo
 * carries `span` and may be null), and neither should leak into the axis chrome.
 * `AxisWindow` is the narrow shape both satisfy structurally.
 */
export type AxisWindow = { startMin: number; endMin: number };

/** Above this many hours, hourly labels collide (~20px/hour) and the step doubles. */
const HOURLY_STEP_MAX_HOURS = 17;

/**
 * Whole-hour marks inside the window, inclusive of an exact hit on either bound.
 *
 * The two-hour step is phased from the first whole hour at or after `startMin`
 * rather than aligned to even clock hours — one rule, so a 05:00 window reads
 * 05, 07, 09 and never silently drops its own first line.
 */
export function hourTicks(startMin: number, endMin: number): number[] {
  if (!(endMin > startMin)) return [];
  const stepMin = (endMin - startMin) / 60 > HOURLY_STEP_MAX_HOURS ? 120 : 60;
  const out: number[] = [];
  for (let m = Math.ceil(startMin / 60) * 60; m <= endMin; m += stepMin) out.push(m);
  return out;
}

/**
 * `"7 AM"`, `"12 PM"`. The `% 24` is load-bearing: a late punch widens the
 * window's end to 1440, that tick is labelled, and a bare `Math.floor(min / 60)`
 * would render it "24".
 */
export function hourLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${suffix}`;
}

/** The single place a minute becomes a vertical percentage for axis chrome. */
export function pctOfWindow(min: number, window: AxisWindow): number {
  const span = window.endMin - window.startMin;
  if (span <= 0) return 0;
  return ((min - window.startMin) / span) * 100;
}
