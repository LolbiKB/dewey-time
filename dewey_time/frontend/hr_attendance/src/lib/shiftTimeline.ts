import type { ShiftContext } from "@/types/calendar";

import {
  clamp,
  minutesFromDateTime,
  minutesSinceMidnight,
  parseDateTimeLocal,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";

export type MissingExpectedInterval = {
  startMin: number;
  endMin: number;
  minutes: number;
};

type MinuteRange = { startMin: number; endMin: number };

function subtractMinuteRange(
  parts: MinuteRange[],
  excludeStart: number,
  excludeEnd: number
): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const part of parts) {
    if (part.endMin <= excludeStart || part.startMin >= excludeEnd) {
      out.push(part);
      continue;
    }
    if (part.startMin < excludeStart) {
      out.push({ startMin: part.startMin, endMin: excludeStart });
    }
    if (excludeEnd < part.endMin) {
      out.push({ startMin: excludeEnd, endMin: part.endMin });
    }
  }
  return out.filter((p) => p.endMin > p.startMin);
}

export type MissingExpectedOptions = {
  /** On today: clip bands to start of present hour so they do not overlap scheduled future bands. */
  maxEndMin?: number | null;
  /** Mid-day away gaps (segment→segment); excluded to avoid double visualization with away bands. */
  excludeIntervals?: MinuteRange[];
};

/**
 * On-shift work windows (shift start→end minus scheduled lunch) not covered by paired segments.
 * Leading/trailing obligation gaps (late start, early leave, no return) — not mid-day away between segments.
 * When maxEndMin is set (present-hour start on today), bands do not extend into the current hour or future.
 */
export function deriveMissingExpectedIntervals(
  shift: ShiftContext | undefined,
  segments: Array<{ startMin?: number | null; endMin?: number | null }>,
  options?: MissingExpectedOptions
): MissingExpectedInterval[] {
  if (!shift?.shift_assigned) return [];

  const maxEndMin = options?.maxEndMin;
  if (maxEndMin != null && maxEndMin <= 0) return [];

  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  const endMin = parseTimeToMinutes(shift.end_time ?? null);
  if (startMin == null || endMin == null || endMin <= startMin) return [];

  let expectedParts: MinuteRange[] = [{ startMin, endMin }];

  const lunchStart = parseTimeToMinutes(shift.lunch_start ?? null);
  const lunchEnd = parseTimeToMinutes(shift.lunch_end ?? null);
  if (lunchStart != null && lunchEnd != null && lunchEnd > lunchStart) {
    expectedParts = subtractMinuteRange(expectedParts, lunchStart, lunchEnd);
  }

  const covered = segments
    .filter((segment) => segment.startMin != null && segment.endMin != null)
    .map((segment) => ({ startMin: segment.startMin!, endMin: segment.endMin! }));

  let missingParts = expectedParts;
  for (const cover of covered) {
    missingParts = subtractMinuteRange(missingParts, cover.startMin, cover.endMin);
  }

  for (const exclude of options?.excludeIntervals ?? []) {
    missingParts = subtractMinuteRange(missingParts, exclude.startMin, exclude.endMin);
  }

  return missingParts
    .map((part) => {
      const cappedEnd =
        maxEndMin != null ? Math.min(part.endMin, maxEndMin) : part.endMin;
      if (cappedEnd <= part.startMin) return null;
      return {
        startMin: part.startMin,
        endMin: cappedEnd,
        minutes: cappedEnd - part.startMin,
      };
    })
    .filter((part): part is MissingExpectedInterval => part != null && part.minutes > 0);
}

/** Past-only cap for missing-expected: start of present hour on today; full day on past; none on future. */
export function missingExpectedMaxEndMin(
  dateKey: string,
  now: Date = new Date()
): number | null {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const todayKey = `${y}-${m}-${d}`;
  if (dateKey > todayKey) return 0;
  if (dateKey < todayKey) return null;
  return presentHourStartMin(now);
}

/** Start of the current clock hour (minutes since midnight). */
export function presentHourStartMin(now: Date = new Date()): number {
  return now.getHours() * 60;
}

/**
 * Scheduled reference band visible only in the future: full range on future days,
 * from present hour through band end on today, hidden on past days.
 */
export function clipScheduledBandToFuture(
  dateKey: string,
  startMin: number,
  endMin: number,
  now: Date = new Date()
): MinuteRange | null {
  if (endMin <= startMin) return null;

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const todayKey = `${y}-${m}-${d}`;

  if (dateKey < todayKey) return null;
  if (dateKey > todayKey) return { startMin, endMin };

  const clippedStart = Math.max(startMin, presentHourStartMin(now));
  if (clippedStart >= endMin) return null;
  return { startMin: clippedStart, endMin };
}

export type ScheduledFutureInterval = {
  startMin: number;
  endMin: number;
  minutes: number;
};

/**
 * Scheduled work windows (shift start→end minus lunch) from present hour through shift end on today.
 * Full future windows on future days; hidden on past days.
 */
export function deriveScheduledFutureIntervals(
  shift: ShiftContext | undefined,
  dateKey: string,
  now: Date = new Date()
): ScheduledFutureInterval[] {
  if (!shift?.shift_assigned) return [];

  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  const endMin = parseTimeToMinutes(shift.end_time ?? null);
  if (startMin == null || endMin == null || endMin <= startMin) return [];

  let parts: MinuteRange[] = [{ startMin, endMin }];

  const lunchStart = parseTimeToMinutes(shift.lunch_start ?? null);
  const lunchEnd = parseTimeToMinutes(shift.lunch_end ?? null);
  if (lunchStart != null && lunchEnd != null && lunchEnd > lunchStart) {
    parts = subtractMinuteRange(parts, lunchStart, lunchEnd);
  }

  const results: ScheduledFutureInterval[] = [];
  for (const part of parts) {
    const clipped = clipScheduledBandToFuture(dateKey, part.startMin, part.endMin, now);
    if (!clipped) continue;
    results.push({
      startMin: clipped.startMin,
      endMin: clipped.endMin,
      minutes: clipped.endMin - clipped.startMin,
    });
  }
  return results;
}

export function computeDaySpan(firstIn: string | null, lastOut: string | null) {
  if (!firstIn || !lastOut) return null;
  const a = parseDateTimeLocal(firstIn);
  const b = parseDateTimeLocal(lastOut);
  const aMin = minutesSinceMidnight(a);
  const bMin = minutesSinceMidnight(b);
  if (!Number.isFinite(aMin) || !Number.isFinite(bMin) || bMin < aMin) return null;
  const topPct = clamp((aMin / (24 * 60)) * 100, 0, 100);
  const bottomPct = clamp((bMin / (24 * 60)) * 100, 0, 100);
  const heightPct = Math.max(2, bottomPct - topPct);
  return { topPct, heightPct };
}

export function computeExpectedWindowPct(shift: ShiftContext) {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time);
  const endMin = parseTimeToMinutes(shift.end_time);
  if (startMin == null || endMin == null) return null;
  if (endMin < startMin) return null;
  const topPct = clamp((startMin / (24 * 60)) * 100, 0, 100);
  const bottomPct = clamp((endMin / (24 * 60)) * 100, 0, 100);
  const heightPct = Math.max(2, bottomPct - topPct);
  return { topPct, heightPct, startMin, endMin };
}

export function computeLunchWindowPct(shift: ShiftContext) {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.lunch_start ?? null);
  const endMin = parseTimeToMinutes(shift.lunch_end ?? null);
  if (startMin == null || endMin == null) return null;
  if (endMin < startMin) return null;
  const topPct = clamp((startMin / (24 * 60)) * 100, 0, 100);
  const bottomPct = clamp((endMin / (24 * 60)) * 100, 0, 100);
  const heightPct = Math.max(2, bottomPct - topPct);
  return { topPct, heightPct, startMin, endMin };
}

export function computeExpectedMinutes(shift: ShiftContext) {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  const endMin = parseTimeToMinutes(shift.end_time ?? null);
  if (startMin == null || endMin == null) return null;
  if (endMin < startMin) return null;
  return endMin - startMin;
}

export function computeLateness(shift: ShiftContext, firstIn: string | null) {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  if (startMin == null) return null;
  const grace = Number.isFinite(shift.grace_minutes) ? Number(shift.grace_minutes) : 0;
  const thresholdMin = startMin + grace;
  const thresholdPct = clamp((thresholdMin / (24 * 60)) * 100, 0, 100);

  if (!firstIn) return { thresholdPct, isLate: false, deltaMinutes: null };
  const fiMin = minutesFromDateTime(firstIn) ?? NaN;
  const deltaMinutes = fiMin - thresholdMin;
  return {
    thresholdPct,
    isLate: deltaMinutes > 0,
    deltaMinutes: deltaMinutes > 0 ? deltaMinutes : 0,
  };
}
