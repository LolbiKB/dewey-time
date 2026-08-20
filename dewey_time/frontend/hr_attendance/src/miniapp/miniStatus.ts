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
import { liveWalk } from "@/lib/punchLiveVerbs";
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

/**
 * The unclosed arrival on this day, as the API's own datetime string.
 *
 * Reads the LIVE walk (`liveWalk`, the TypeScript twin of the Telegram
 * receipt's verb rule), because "is somebody at work right now" is a live
 * question and the retrospective pairing answers a different one: `pairRun`
 * sees the whole day and calls the last punch of a run a departure, which
 * mid-afternoon closes the day on the punch the person just came BACK on.
 *
 * A run is open only when the walk's last verb is IN — a claimable arrival:
 * an explicit label, the day's first punch, or a same-branch return. A lone
 * unlabelled punch opening a fresh run is indistinguishable from a departure
 * through that campus's exit device, so the walk refuses a verb and this
 * returns null: no live marker, no climbing "so far", for someone who may
 * have gone home. (The earlier rule here fell back to WHOLE-DAY parity for
 * that punch, which read "still at work, since 17:04" all evening whenever
 * the day's total count happened to be odd.)
 *
 * The moment returned is the walk's own open arrival — the FIRST arrival of
 * the open stretch, so a repeated arrival does not move it and nobody is
 * quietly docked an hour (issue #191).
 *
 * Says nothing about WHICH day. An unclosed punch three weeks ago is a gap in
 * the record, not somebody still at work; a caller that cares must check the
 * date itself.
 */
export function openRunStartedAt(day: Day | undefined): string | null {
  const walk = liveWalk(inOrder(day));
  return walk.openClaimable ? walk.openTime : null;
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

  // THE RECEIPT'S RULE, not a third one. "Am I clocked in" is the question
  // the Telegram receipt just answered about the same punch on the same
  // phone, so the chip reads the same causal walk (`liveWalk`, the TS twin of
  // receipt.py) and makes the claims the receipt made — one deliberate step
  // further: a bounced tap gets a neutral MESSAGE but is a non-event for
  // STATE, so the chip keeps saying "in" over a bounce. A kept IN is
  // "in"; a kept OUT — a label, or a blank punch closing the open arrival —
  // is out; and where the receipt refused a verb (a lone
  // unlabelled punch opening a fresh run, indistinguishable from a departure
  // through that campus's exit device), the chip says NOTHING rather than
  // guessing. The rule that lived here before — last punch's label, else
  // whole-day parity — said "In" all evening to someone who left through a
  // second campus, and the first replacement (retrospective `pairRun`) said
  // "Out during shift" to someone back from lunch. Both were confident
  // sentences the receipt had declined to say.
  const walk = liveWalk(punches);
  if (walk.lastKeptVerb === "IN") {
    const last = punches[punches.length - 1]!;
    return { kind: "in", branch: (last.custom_device_branch || "").trim() || null };
  }
  if (walk.lastKeptVerb !== "OUT") return { kind: "none" };

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
