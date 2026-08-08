import type { WeekDaySchedule } from "@/lib/weekSchedule";

export type PlannedBlock = { startMin: number; endMin: number };

/**
 * Exactly the fields `plannedBlocks` reads — not a whole `WeekDaySchedule`.
 *
 * `WeekDaySchedule` still satisfies it, so every existing caller is unaffected;
 * the point is that `PlannedDay` (which has the same minute fields but no
 * `date`/`weekday`/`shift`) can satisfy it too, without the `as WeekDaySchedule`
 * cast that used to paper over six fabricated fields.
 */
export type PlannedBlockSource = Pick<
  WeekDaySchedule,
  "assigned" | "startMin" | "endMin" | "lunchStartMin" | "lunchEndMin"
>;

/**
 * A scheduled day as drawable intervals, with lunch removed rather than drawn.
 *
 * Returning two blocks instead of one block plus a notch is what lets breaks
 * line up vertically across days on a shared axis — the old fixed-height pill
 * positioned its notch against each day's own span, so "halfway down" meant a
 * different clock time on every row.
 *
 * A lunch that touches either bound is ignored: clipping it would leave a
 * zero-length fragment, and a break at the very start or end of a shift is
 * indistinguishable from a shorter shift anyway.
 */
export function plannedBlocks(day: PlannedBlockSource): PlannedBlock[] {
  if (!day.assigned || day.startMin == null || day.endMin == null) return [];
  const { startMin, endMin, lunchStartMin: ls, lunchEndMin: le } = day;
  if (endMin <= startMin) return [];

  const interior = ls != null && le != null && le > ls && ls > startMin && le < endMin;
  if (!interior) return [{ startMin, endMin }];

  return [
    { startMin, endMin: ls! },
    { startMin: le!, endMin },
  ];
}
