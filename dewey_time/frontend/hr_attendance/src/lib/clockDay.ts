import type { Day } from "@/types/calendar";

/**
 * A clock day: an employee who works to the clock rather than a schedule, on a
 * date with no Shift Assignment. Schedule wins when present — if a shift is
 * assigned the day is scheduled and keeps full late/early/absence logic.
 */
export function isClockDay(isClockBased: boolean | undefined, day: Day | undefined): boolean {
  if (!isClockBased) return false;
  return day?.shift?.shift_assigned !== true;
}

/** Sum of paired in/out segment minutes. Null when there are no usable segments. */
export function netWorkedMinutes(segments: Array<{ minutes: number | null }>): number | null {
  const usable = segments.filter((s) => s.minutes != null);
  if (!usable.length) return null;
  return usable.reduce((total, s) => total + (s.minutes ?? 0), 0);
}

/**
 * The figure to display on a clock day.
 *
 * Net worked is the payable number, but `deriveSegments` drops any run whose
 * first punch has no device branch, so missing branch data yields zero segments.
 * Showing `0h` would be wrong — they worked, the data is incomplete — so fall
 * back to the gross span and mark it unverified. That same condition already
 * raises ATTENDANCE_ISSUE (unknown_device_branch), which explains the gap.
 */
export function clockDayMinutes(
  segments: Array<{ minutes: number | null }>,
  grossMinutes: number | null | undefined
): { minutes: number | null; unverified: boolean } {
  const net = netWorkedMinutes(segments);
  if (net != null) return { minutes: net, unverified: false };
  if (grossMinutes != null) return { minutes: grossMinutes, unverified: true };
  return { minutes: null, unverified: false };
}
