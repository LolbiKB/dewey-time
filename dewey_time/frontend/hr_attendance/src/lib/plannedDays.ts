import { plannedBlocks, type PlannedBlock } from "./plannedBlocks";
import { buildWeekSchedule, shortShiftTypeCode, type WeekDaySchedule } from "./weekSchedule";
import { FALLBACK_END_MIN, FALLBACK_START_MIN } from "./weekTimelineWindow";
import type { AxisWindow } from "./timelineAxis";
import { toApiTime, weekPatternDayNetMinutes, type WeekPattern } from "@/types/schedule";
import type { Day } from "@/types/calendar";

/**
 * The planned week, source-agnostic: a normalised Mon–Sun list with no
 * assumption of a real date underneath it.
 *
 * `PlannedWeekCanvas` is mounted from two different shapes of source data — a
 * dated calendar week (`Day` records keyed by date, via `plannedDaysFromSchedule`
 * below) and the schedule editor's undated `WeekPattern` (a sibling adapter,
 * added alongside this one). `PlannedDay` is the shape both funnel into, so the
 * canvas and its day column never need to know which one they were handed.
 */
export type PlannedDay = {
  /** Date string, or weekday name for an undated pattern. Unique within the week. */
  key: string;
  /** "Mon" */
  label: string;
  /** "27" for a dated week; omitted for an undated pattern. */
  sublabel?: string;
  works: boolean;
  onLeave?: boolean;
  leaveType?: string | null;
  startMin?: number;
  endMin?: number;
  lunchStartMin?: number;
  lunchEndMin?: number;
  shiftCode?: string;
  durationMin?: number;
};

/** A dated calendar week (weekDates + daysByDate) into the normalised shape. */
export function plannedDaysFromSchedule(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): PlannedDay[] {
  return buildWeekSchedule(weekDates, daysByDate).map((d) => ({
    key: d.date,
    label: d.weekday,
    sublabel: d.dayNum,
    works: d.assigned,
    onLeave: d.onLeave,
    leaveType: d.leaveType,
    startMin: d.startMin,
    endMin: d.endMin,
    lunchStartMin: d.lunchStartMin,
    lunchEndMin: d.lunchEndMin,
    shiftCode: d.assigned ? shortShiftTypeCode(d.shiftType) : undefined,
    durationMin: d.durationMin,
  }));
}

/**
 * `plannedBlocks` (plannedBlocks.ts), for a `PlannedDay`.
 *
 * `PlannedDay` already carries the same minute fields under the same names
 * as `WeekDaySchedule` — the only mismatch is `works` vs. `assigned` — so
 * this delegates through a spread with that one field renamed, rather than
 * duplicating `plannedBlocks`'s guard/interior-lunch logic a second time.
 * That keeps the one live call path (`PlannedDayColumn` calls this, not
 * `plannedBlocks` directly) covered by `plannedBlocks.test.ts`'s edge cases
 * instead of leaving them pinned against a function nothing calls.
 * `plannedBlocks.ts` itself is untouched.
 */
export function plannedBlocksForDay(day: PlannedDay): PlannedBlock[] {
  return plannedBlocks({ ...day, assigned: day.works } as WeekDaySchedule);
}

/**
 * Minute-of-day for a `WeekPatternDay` time field ("HH:MM" or "HH:MM:SS"), or
 * null when absent/unparseable. Moved from `SchedulePlanPreviewDialog.tsx`'s
 * retired `MiniShiftTrack` — this file is now its only caller.
 */
function timeToMinutes(value: string | null | undefined): number | null {
  const normalized = toApiTime(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/** The schedule editor's undated `WeekPattern` into the normalised shape. */
export function plannedDaysFromWeekPattern(pattern: WeekPattern): PlannedDay[] {
  return pattern.days.map((row) => {
    const startMin = row.works ? (timeToMinutes(row.start_time) ?? undefined) : undefined;
    const endMin = row.works ? (timeToMinutes(row.end_time) ?? undefined) : undefined;
    const lunchStartMin = row.works ? (timeToMinutes(row.lunch_start) ?? undefined) : undefined;
    const lunchEndMin = row.works ? (timeToMinutes(row.lunch_end) ?? undefined) : undefined;
    const durationMin = row.works ? weekPatternDayNetMinutes(row) || undefined : undefined;

    return {
      key: row.weekday,
      label: row.weekday.slice(0, 3),
      works: row.works,
      startMin,
      endMin,
      lunchStartMin,
      lunchEndMin,
      durationMin,
    };
  });
}

/** Padding either side of the pattern's own bounds, before hour-quantization —
 * matches `PAD_MIN` in weekTimelineWindow.ts so a dated week and an undated
 * pattern land on the same scale. */
const PATTERN_PAD_MIN = 60;

/**
 * The axis window for an undated `WeekPattern`, derived and quantized the
 * same way `resolveWeekTimelineWindow` derives one from a dated week, so the
 * schedule preview canvas and the calendar's week grid share one scale.
 *
 * There is no punch data to widen by here — an undated pattern has no
 * checkins — so this is only the shift-bounds half of that function. Lunch
 * times are validated to fall inside the shift window (`validateWeekPattern`)
 * and never extend it, so they do not need to widen the window either.
 * Overnight days (`end <= start`) are excluded from the bounds for the same
 * reason `collectShiftBounds` excludes them: minute-of-day cannot express
 * 22:00->06:00 as a range.
 */
export function resolveWeekPatternWindow(pattern: WeekPattern): AxisWindow {
  const bounds: number[] = [];
  for (const row of pattern.days) {
    if (!row.works) continue;
    const start = timeToMinutes(row.start_time);
    const end = timeToMinutes(row.end_time);
    if (start == null || end == null || end <= start) continue;
    bounds.push(start, end);
  }

  if (!bounds.length) {
    return { startMin: FALLBACK_START_MIN, endMin: FALLBACK_END_MIN };
  }

  const startMin = Math.max(0, Math.floor((Math.min(...bounds) - PATTERN_PAD_MIN) / 60) * 60);
  const endMin = Math.min(24 * 60, Math.ceil((Math.max(...bounds) + PATTERN_PAD_MIN) / 60) * 60);
  return { startMin, endMin };
}
