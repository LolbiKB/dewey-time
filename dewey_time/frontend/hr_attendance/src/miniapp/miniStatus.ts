/**
 * Where you are in the day, right now.
 *
 * This is the one thing the timeline canvas genuinely cannot tell you at a
 * glance. The canvas is a picture of the day's SHAPE: blocks, gaps, a dashed
 * roster band. Reading your current position off it means finding the red
 * now-line, checking whether a block is open under it, and knowing whether the
 * gap you are standing in is the rostered lunch or not. That is three
 * inferences to answer "am I clocked in?".
 *
 * So this is present tense and nothing else. It does not restate the punch
 * times, the roster or the total — that was the summary block, and it was
 * removed for saying what the picture already said. A status says what is true
 * of this minute, which no picture of a whole day states outright.
 *
 * IT REPORTS, IT DOES NOT JUDGE. `outDuringShift` is the clock's observation
 * that you are out while the rostered window is still open; it is not
 * "unauthorised", "early" or "absent". The engine's verdict on a day is
 * provisional until HR reviews it — intraday re-inserts AUTO flags on every
 * punch — and the Mini App is not shown flags at all, so it could not report
 * one if it wanted to. Every label here has to survive being read by the
 * person it describes.
 */
import { isSameDay } from "date-fns";

import { parseTimeToMinutes } from "@/lib/attendanceTime";
import type { Day } from "@/types/calendar";
import type { StringKey } from "@/miniapp/miniStrings";

export type MiniStatus =
  /** Nothing to say: a past day, whose shape the canvas already carries. */
  | { kind: "none" }
  /** A day-level fact, in the DATA's own words — a leave type, a holiday name. */
  | { kind: "named"; key: StringKey; text: string | null }
  /** Live states, today only. `branch` is where the last punch was taken. */
  | { kind: "notIn" }
  | { kind: "in"; branch: string | null }
  | { kind: "lunch" }
  | { kind: "outDuringShift" }
  | { kind: "out" };

/** Minute-of-day for a wall clock. */
export function minuteOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

/**
 * The punches in the order they happened.
 *
 * Sorted rather than trusted: the payload's order is the query's order, and
 * "which punch was last" is the entire basis of in-versus-out below. One
 * out-of-order row would invert the answer.
 */
function inOrder(day: Day | undefined) {
  return [...(day?.checkins ?? [])].sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

export function miniStatus(day: Day | undefined, date: Date, now: Date): MiniStatus {
  // Day-level facts first, and for ANY day rather than only today. A holiday
  // is a holiday whether or not it is this morning, and leave is the state the
  // canvas is least able to draw — DayCell reads holiday and punches, never
  // `leave`, so without this a leave day is a blank dashed band.
  if (day?.leave?.on_leave) {
    return { kind: "named", key: "stateOnLeave", text: day.leave.leave_type ?? null };
  }
  if (day?.holiday) {
    return { kind: "named", key: "stateHoliday", text: day.holiday.description ?? null };
  }

  const punches = inOrder(day);
  const rostered = day?.shift?.shift_assigned === true;
  if (!rostered && !punches.length) return { kind: "named", key: "stateDayOff", text: null };

  // Everything below is present tense, so it needs a present. A day being
  // looked back at has no "where you are now" — and claiming one would put
  // "Not checked in" on a Tuesday three weeks ago.
  if (!isSameDay(date, now)) return { kind: "none" };

  if (!punches.length) return { kind: "notIn" };

  const last = punches[punches.length - 1]!;
  if (String(last.log_type || "").toUpperCase() !== "OUT") {
    return { kind: "in", branch: (last.custom_device_branch || "").trim() || null };
  }

  const nowMin = minuteOfDay(now);
  const lunchStart = parseTimeToMinutes(day?.shift?.lunch_start);
  const lunchEnd = parseTimeToMinutes(day?.shift?.lunch_end);
  if (
    lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart &&
    nowMin >= lunchStart && nowMin < lunchEnd
  ) {
    return { kind: "lunch" };
  }

  const end = parseTimeToMinutes(day?.shift?.end_time);
  const start = parseTimeToMinutes(day?.shift?.start_time);
  // Only INSIDE the window. Out before the shift opens is not "out during" it,
  // and an overnight shift's end is before its start on the clock — treating
  // that as a plain range would call the whole evening "during".
  if (start !== null && end !== null && end > start && nowMin >= start && nowMin < end) {
    return { kind: "outDuringShift" };
  }
  return { kind: "out" };
}

/** The string key for a status, or null when the data supplies its own words. */
export function statusKey(status: MiniStatus): StringKey | null {
  switch (status.kind) {
    case "named": return status.key;
    case "notIn": return "statusNotIn";
    case "in": return "statusIn";
    case "lunch": return "statusLunch";
    case "outDuringShift": return "statusOutDuringShift";
    case "out": return "statusOut";
    case "none": return null;
  }
}

/**
 * Whether this status describes something happening RIGHT NOW.
 *
 * Only one does, and it is the only one that earns colour and a live dot. A
 * dot on "Day off" would be a heartbeat on a day nobody is working.
 */
export function isLive(status: MiniStatus): boolean {
  return status.kind === "in" || status.kind === "lunch";
}
