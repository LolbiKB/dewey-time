import { plannedBlocks, type PlannedBlock } from "./plannedBlocks";
import { buildWeekSchedule, shortShiftTypeCode, type WeekDaySchedule } from "./weekSchedule";
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
