import { format } from "date-fns";

import { formatDayCheckinTimeRange, formatDurationMinutes } from "@/lib/attendanceTime";
import type { Day } from "@/types/calendar";

/**
 * Accessible name for a week-grid day button.
 *
 * The day column is a single <button> whose entire contents are either
 * aria-hidden (grid lines, the now-line) or described only by a hover tooltip,
 * so without this a screen reader announces seven identical "button"s — and a
 * scheduled day with zero punches, the single most important one to notice,
 * announces nothing at all.
 *
 * Kept as a pure function so it can be tested: `src/ui/*.test.tsx` renders,
 * but asserting a computed label is far cheaper here.
 */
export function dayCellAccessibleName(date: Date, info?: Day): string {
  const parts: string[] = [format(date, "EEEE d MMMM")];

  if (info?.holiday) {
    parts.push(info.holiday.weekly_off ? "weekly off" : "holiday");
  } else if (info?.leave?.on_leave) {
    parts.push(info.leave.leave_type ? `on leave, ${info.leave.leave_type}` : "on leave");
  } else if (info?.shift?.shift_assigned !== true && !(info?.checkins?.length)) {
    parts.push("day off");
  } else {
    const range = formatDayCheckinTimeRange(info);
    const punches = info?.checkins?.length ?? 0;
    if (range) {
      parts.push(`worked ${range}`);
    } else if (punches > 0) {
      // Punches exist but no usable first_in/last_out range (an unpaired punch,
      // or a payload without those fields). "No punches recorded" would be a lie.
      parts.push(`${punches} punch${punches === 1 ? "" : "es"} recorded`);
    } else {
      parts.push("no punches recorded");
    }
  }

  // The worked total belongs in the name for its own sake, and e2e selects a day
  // by it (e2e/attendance.spec.ts). aria-label REPLACES the name computed from
  // contents, so omitting it here would hide a figure the column already shows.
  if (info?.gross_minutes) parts.push(formatDurationMinutes(info.gross_minutes));

  const flags = info?.flags?.length ?? 0;
  if (flags > 0) parts.push(`${flags} flag${flags === 1 ? "" : "s"}`);

  return parts.join(", ");
}
