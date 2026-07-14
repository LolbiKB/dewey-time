import { format, isSameDay } from "date-fns";

import type { Day } from "@/types/calendar";

export type PipState = "today" | "holiday" | "off" | "flagged" | "normal";

const key = (d: Date) => format(d, "yyyy-MM-dd");

export function initialSelectedDate(weekDates: Date[], today: Date): string {
  const inWeek = weekDates.find((d) => isSameDay(d, today));
  return key(inWeek ?? weekDates[0]!);
}

export function stepDay(weekDates: Date[], currentKey: string, dir: -1 | 1): string {
  const idx = weekDates.findIndex((d) => key(d) === currentKey);
  if (idx === -1) return currentKey;
  const next = Math.min(weekDates.length - 1, Math.max(0, idx + dir));
  return key(weekDates[next]!);
}

// Matches the desktop grid's off-day rule (holiday wins; no assigned shift == off).
export function dayPipState(day: Day | undefined, isToday: boolean): PipState {
  if (isToday) return "today";
  if (day?.holiday != null) return "holiday";
  if (day?.shift?.shift_assigned !== true) return "off";
  if ((day?.flags ?? []).length > 0) return "flagged";
  return "normal";
}
