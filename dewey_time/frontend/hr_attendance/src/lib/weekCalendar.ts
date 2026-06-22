import { addDays, addMonths, endOfMonth, format, max, min, startOfMonth, startOfWeek } from "date-fns";

import { parseDateKey } from "@/lib/attendanceTime";
import type { CalendarEmployee, Day } from "@/types/calendar";

/** Visible week plus any month boundary it crosses (for API fetch range). */
export function calendarFetchRange(anchor: Date) {
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);
  const rangeStart = min([weekStart, startOfMonth(anchor)]);
  const rangeEnd = max([weekEnd, endOfMonth(anchor)]);
  return { rangeStart, rangeEnd };
}

export function countWeekAssignedShiftDays(weekDates: Date[], daysByDate: Map<string, Day>) {
  let assigned = 0;
  for (const date of weekDates) {
    const key = format(date, "yyyy-MM-dd");
    if (daysByDate.get(key)?.shift?.shift_assigned) assigned += 1;
  }
  return assigned;
}

export type WeekNavBounds = {
  minWeekStart: Date;
  maxWeekStart: Date;
  calendarMinDate: Date;
  calendarMaxDate: Date;
};

export type WeekNavOverrides = {
  firstCheckinDate?: string | null;
  scheduleMaxDate?: string | null;
  hasShiftAssignment?: boolean;
};

export function pickEarliestDateKey(
  ...values: Array<string | null | undefined>
): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  if (!dates.length) return null;
  return dates.sort()[0]!;
}

export function earliestDayWithCheckins(days: Day[] | undefined): string | null {
  let earliest: string | null = null;
  for (const day of days ?? []) {
    if ((day.checkins?.length ?? 0) === 0) continue;
    if (!earliest || day.date < earliest) earliest = day.date;
  }
  return earliest;
}

/** Backward nav: first week with any Employee Checkin. Forward nav: shift assignment max. */
export function computeWeekNavBounds(
  employee: CalendarEmployee | null | undefined,
  now: Date = new Date(),
  overrides?: WeekNavOverrides
): WeekNavBounds {
  const todayWeekStart = startOfWeek(now, { weekStartsOn: 1 });

  const firstCheckinDate = pickEarliestDateKey(
    overrides?.firstCheckinDate,
    employee?.first_checkin_date
  );

  if (!firstCheckinDate) {
    const calendarMaxDate = addDays(todayWeekStart, 6);
    return {
      minWeekStart: todayWeekStart,
      maxWeekStart: todayWeekStart,
      calendarMinDate: todayWeekStart,
      calendarMaxDate,
    };
  }

  const minWeekStart = startOfWeek(parseDateKey(firstCheckinDate), { weekStartsOn: 1 });

  const hasShiftAssignment =
    overrides?.hasShiftAssignment ?? employee?.has_shift_assignment ?? false;
  const scheduleMaxDate = overrides?.scheduleMaxDate ?? employee?.schedule_max_date ?? null;

  let maxWeekStart: Date;
  let calendarMaxDate: Date;

  if (scheduleMaxDate) {
    calendarMaxDate = parseDateKey(scheduleMaxDate);
    maxWeekStart = startOfWeek(calendarMaxDate, { weekStartsOn: 1 });
  } else if (hasShiftAssignment) {
    maxWeekStart = startOfWeek(addMonths(now, 12), { weekStartsOn: 1 });
    calendarMaxDate = addDays(maxWeekStart, 6);
  } else {
    maxWeekStart = todayWeekStart;
    calendarMaxDate = now;
  }

  let calendarMinDate = minWeekStart;
  if (calendarMinDate > calendarMaxDate) {
    calendarMaxDate = addDays(calendarMinDate, 6);
    maxWeekStart = minWeekStart;
  }

  return {
    minWeekStart,
    maxWeekStart,
    calendarMinDate,
    calendarMaxDate,
  };
}

export function clampDateToNavBounds(date: Date, bounds: WeekNavBounds): Date {
  if (date < bounds.calendarMinDate) return bounds.calendarMinDate;
  if (date > bounds.calendarMaxDate) return bounds.calendarMaxDate;
  return date;
}

export function clampWeekStart(date: Date, bounds: WeekNavBounds): Date {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  if (weekStart < bounds.minWeekStart) return bounds.calendarMinDate;
  if (weekStart > bounds.maxWeekStart) return bounds.calendarMaxDate;
  return date;
}
