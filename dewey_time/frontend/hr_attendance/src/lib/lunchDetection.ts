import type { Checkin, ObservedLunch, ShiftContext } from "@/types/calendar";
import { minutesFromDateTime, parseDateTimeLocal, parseTimeToMinutes } from "@/lib/attendanceTime";

export type { ObservedLunch };

export function detectObservedLunch(
  checkins: Checkin[],
  shift: ShiftContext | undefined,
  dateKey: string
): ObservedLunch | null {
  if (!shift?.shift_assigned || !shift.lunch_start || !shift.lunch_end) return null;

  const punchTimes = sortedPunchTimes(checkins);
  if (punchTimes.length < 2) return null;

  const lunchStartMin = parseTimeToMinutes(shift.lunch_start);
  const lunchEndMin = parseTimeToMinutes(shift.lunch_end);
  if (lunchStartMin == null || lunchEndMin == null || lunchEndMin <= lunchStartMin) return null;

  const grace = Math.max(0, shift.grace_minutes ?? 0);
  const lunchStartDt = combineDateAndMinutes(dateKey, lunchStartMin);
  const lunchEndDt = combineDateAndMinutes(dateKey, lunchEndMin);
  const returnThreshold = lunchEndDt + grace * 60_000;
  const windowEnd = lunchEndDt + (grace + 60) * 60_000;

  const pair = findPlausibleLunchPair(punchTimes, lunchStartDt, windowEnd);
  if (!pair) return null;

  const [lunchOut, lunchIn] = pair;
  const minutes = Math.max(0, Math.round((lunchIn - lunchOut) / 60_000));

  return {
    lunch_out: new Date(lunchOut).toISOString(),
    lunch_in: new Date(lunchIn).toISOString(),
    minutes,
    lunch_start: new Date(lunchStartDt).toISOString(),
    lunch_end: new Date(lunchEndDt).toISOString(),
    return_threshold: new Date(returnThreshold).toISOString(),
    late_return: lunchIn > returnThreshold,
  };
}

function sortedPunchTimes(checkins: Checkin[]): number[] {
  return checkins
    .map((c) => parseDateTimeLocal(c.time).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
}

function combineDateAndMinutes(dateKey: string, minutes: number): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return new Date(y!, m! - 1, d!, hh, mm, 0, 0).getTime();
}

function findPlausibleLunchPair(
  punchTimes: number[],
  lunchStartMs: number,
  windowEndMs: number
): [number, number] | null {
  for (let i = 0; i < punchTimes.length - 1; i++) {
    const lunchOut = punchTimes[i]!;
    const lunchIn = punchTimes[i + 1]!;
    if (lunchOut < lunchStartMs) continue;
    if (lunchIn <= lunchOut) continue;
    if (lunchIn <= windowEndMs) return [lunchOut, lunchIn];
  }
  return null;
}

export function observedLunchMinuteRange(
  observed: ObservedLunch | null | undefined
): { startMin: number; endMin: number } | null {
  if (!observed) return null;
  const startMin = minutesFromDateTime(observed.lunch_out);
  const endMin = minutesFromDateTime(observed.lunch_in);
  if (startMin == null || endMin == null || endMin <= startMin) return null;
  return { startMin, endMin };
}

export function scheduledLunchMinuteRange(shift: ShiftContext | undefined): {
  startMin: number;
  endMin: number;
} | null {
  if (!shift?.shift_assigned || !shift.lunch_start || !shift.lunch_end) return null;
  const startMin = parseTimeToMinutes(shift.lunch_start);
  const endMin = parseTimeToMinutes(shift.lunch_end);
  if (startMin == null || endMin == null || endMin <= startMin) return null;
  const grace = Math.max(0, shift.grace_minutes ?? 0);
  return { startMin, endMin: endMin + grace };
}

export function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a1 > b0 && b1 > a0;
}

export function subtractRange(
  start: number,
  end: number,
  excludeStart: number,
  excludeEnd: number
): Array<{ startMin: number; endMin: number }> {
  if (end <= excludeStart || start >= excludeEnd) return [{ startMin: start, endMin: end }];
  const out: Array<{ startMin: number; endMin: number }> = [];
  if (start < excludeStart) out.push({ startMin: start, endMin: excludeStart });
  if (excludeEnd < end) out.push({ startMin: excludeEnd, endMin: end });
  return out.filter((p) => p.endMin > p.startMin);
}
