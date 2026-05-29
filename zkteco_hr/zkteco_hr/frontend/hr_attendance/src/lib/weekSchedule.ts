import { format } from "date-fns";

import type { Day, ShiftContext } from "@/types/calendar";

export const SCHEDULE_DAY_START_MIN = 6 * 60;
export const SCHEDULE_DAY_END_MIN = 20 * 60;
export const SCHEDULE_DAY_SPAN = SCHEDULE_DAY_END_MIN - SCHEDULE_DAY_START_MIN;

export type WeekDaySchedule = {
  date: string;
  weekday: string;
  weekdayLong: string;
  dayNum: string;
  monthLabel: string;
  shift: ShiftContext;
  assigned: boolean;
  onLeave?: boolean;
  leaveType?: string | null;
  shiftType?: string;
  startMin?: number;
  endMin?: number;
  lunchStartMin?: number;
  lunchEndMin?: number;
  timeLabel?: string;
  lunchLabel?: string;
  durationMin?: number;
};

export function parseShiftTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

export function formatShiftTime12h(time: string | null | undefined): string | null {
  const min = parseShiftTimeToMinutes(time);
  if (min == null) return null;
  const hh = Math.floor(min / 60) % 24;
  const mm = min % 60;
  const period = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

/** Display code from Shift Assignment.shift_type (not projected from SSA). */
export function shortShiftTypeCode(shiftType: string | undefined): string {
  const raw = shiftType?.trim();
  if (!raw) return "Shift";
  const stripped = raw.replace(/^FT_/i, "").replace(/_/g, " ").trim();
  return stripped || raw;
}

export type DayShiftHeaderLabel = {
  assigned: boolean;
  /** Shift type code, or "Off" when no Shift Assignment for the date. */
  primary: string;
  /** Expected window from Shift Type linked to the assignment. */
  time?: string;
};

/** Week column header: sourced from calendar day.shift (Shift Assignment per date). */
export function formatDayShiftHeaderLabel(shift: ShiftContext | undefined): DayShiftHeaderLabel {
  const ctx = shift ?? { shift_assigned: false };
  if (ctx.shift_assigned !== true) {
    return { assigned: false, primary: "Off" };
  }

  const primary = shortShiftTypeCode(ctx.shift_type);
  const start = formatShiftTime12h(ctx.start_time);
  const end = formatShiftTime12h(ctx.end_time);
  const time = start && end ? `${start} – ${end}` : undefined;
  return { assigned: true, primary, time };
}

export function buildWeekSchedule(
  weekDates: Date[],
  daysByDate: Map<string, Day>
): WeekDaySchedule[] {
  return weekDates.map((date) => {
    const key = format(date, "yyyy-MM-dd");
    const day = daysByDate.get(key);
    const shift = day?.shift ?? { shift_assigned: false };
    const assigned = shift.shift_assigned === true;
    const startMin = parseShiftTimeToMinutes(shift.start_time);
    const endMin = parseShiftTimeToMinutes(shift.end_time);
    const lunchStartMin = parseShiftTimeToMinutes(shift.lunch_start);
    const lunchEndMin = parseShiftTimeToMinutes(shift.lunch_end);

    const startLabel = formatShiftTime12h(shift.start_time);
    const endLabel = formatShiftTime12h(shift.end_time);
    const timeLabel =
      startLabel && endLabel ? `${startLabel} – ${endLabel}` : undefined;

    const lunchStartLabel = formatShiftTime12h(shift.lunch_start);
    const lunchEndLabel = formatShiftTime12h(shift.lunch_end);
    const lunchLabel =
      lunchStartLabel && lunchEndLabel ? `${lunchStartLabel} – ${lunchEndLabel}` : undefined;

    const durationMin =
      assigned && startMin != null && endMin != null && endMin > startMin
        ? endMin - startMin -
          (lunchStartMin != null && lunchEndMin != null && lunchEndMin > lunchStartMin
            ? lunchEndMin - lunchStartMin
            : 0)
        : undefined;

    return {
      date: key,
      weekday: format(date, "EEE"),
      weekdayLong: format(date, "EEEE"),
      dayNum: format(date, "d"),
      monthLabel: format(date, "MMM"),
      shift,
      assigned,
      onLeave: day?.leave?.on_leave === true,
      leaveType: day?.leave?.leave_type ?? undefined,
      shiftType: shift.shift_type,
      startMin: startMin ?? undefined,
      endMin: endMin ?? undefined,
      lunchStartMin: lunchStartMin ?? undefined,
      lunchEndMin: lunchEndMin ?? undefined,
      timeLabel,
      lunchLabel,
      durationMin,
    };
  });
}

export function summarizeWeekSchedule(week: WeekDaySchedule[]) {
  const workDays = week.filter((d) => d.assigned).length;
  const leaveDays = week.filter((d) => d.onLeave).length;
  const offDays = week.filter((d) => !d.assigned).length;
  const totalWorkMin = week.reduce((sum, d) => sum + (d.durationMin ?? 0), 0);
  return { workDays, offDays, leaveDays, totalWorkMin };
}

export function formatScheduleDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function minuteToSchedulePct(min: number): number {
  return ((min - SCHEDULE_DAY_START_MIN) / SCHEDULE_DAY_SPAN) * 100;
}

export function formatWeekRangeLabel(weekDates: Date[]) {
  const start = weekDates[0]!;
  const end = weekDates[6]!;
  if (start.getFullYear() !== end.getFullYear()) {
    return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`;
}
