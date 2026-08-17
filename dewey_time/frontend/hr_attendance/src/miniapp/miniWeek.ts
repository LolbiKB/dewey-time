/**
 * Which week, as arithmetic.
 *
 * Extracted from MyWeekPage when the calendar sheet replaced that tab. The
 * Schedule tab still pages by week and imported every one of these from there,
 * so deleting the file would have taken the roster's navigation with it.
 */
import { addDays, format, startOfWeek } from "date-fns";

import type { MiniFormat } from "@/miniapp/MiniLocale";

/** Monday-first, matching the HR week view. */
export function weekDatesFor(today: Date): Date[] {
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * How the week header reads: "6 – 12 Oct", or "29 Sep – 5 Oct" across a month.
 *
 * The month is repeated only when the week actually straddles two, because on
 * a 390px phone every character in this header competes with the two arrow
 * buttons beside it.
 */
export function weekRangeLabel(week: Date[], fmt?: MiniFormat): string {
  const first = week[0]!;
  const last = week[6]!;
  const sameMonth = first.getMonth() === last.getMonth();
  // Defaulted so the pure-function tests can call it with a week and nothing
  // else; every render passes the bound formatter.
  const at = fmt?.date ?? ((date: Date, pattern: string) => format(date, pattern));
  return sameMonth
    ? `${at(first, "d")} – ${at(last, "d MMM")}`
    : `${at(first, "d MMM")} – ${at(last, "d MMM")}`;
}

/**
 * Which week is on screen, relative to the one containing today.
 *
 * An OFFSET rather than a stored date, so "this week" cannot drift: a Date in
 * state would still point at last Monday after midnight on Sunday, and the
 * header would quietly disagree with what "Today" shows on the next tab.
 */
export function weekForOffset(today: Date, offset: number): Date[] {
  return weekDatesFor(addDays(startOfWeek(today, { weekStartsOn: 1 }), offset * 7));
}

/** Never past the current week: there is nothing recorded in the future. */
export function canGoForward(offset: number): boolean {
  return offset < 0;
}
