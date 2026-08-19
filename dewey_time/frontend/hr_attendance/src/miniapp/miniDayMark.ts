/**
 * What a day looks like at a glance in the month grid.
 *
 * ONE DOT PER DAY, and the whole design of it turns on a constraint that is
 * structural rather than aesthetic: the Mini App is never shown flags.
 * `miniapp_api.py` narrows the HR payload through an allowlist carrying
 * `date, shift, checkins, holiday, leave, observed_lunch, first_in, last_out`
 * — no flags, no tiers, no severity, and no grace minutes.
 *
 * So a mark reports THE RECORD, never a verdict on the person. "This Tuesday
 * has no punches" is a fact about the record that HR can still forgive;
 * "Tuesday was an unauthorised absence" is a claim this app has no standing to
 * make and no data to support. Every state below survives being read by the
 * person it describes, and none of them can contradict HR, because none of
 * them is a claim HR could overturn.
 *
 * It also rules out the cheap-looking alternative — deriving lateness here
 * from `first_in` against `shift.start_time`. Grace minutes are HR-only and
 * not in the payload, so the phone would call somebody late on a morning the
 * engine forgave: two disagreeing verdicts about one day, with the wrong one
 * in their pocket.
 */
import { isSameDay } from "date-fns";

import { parseTimeToMinutes } from "@/lib/attendanceTime";
import type { Day } from "@/types/calendar";
import type { DayFacts } from "@/miniapp/miniDay";
import type { StringKey } from "@/miniapp/miniStrings";

export type DayMark =
  /** Nothing drawn: a future day, or today while it is still running. */
  | "none"
  /** Not a working day — day off, holiday, or on leave. */
  | "off"
  /** A whole record: punches present, and they pair up. */
  | "complete"
  /** A punch that never got its pair. Somebody did not clock out. */
  | "incomplete"
  /** Rostered, the day is over, and nothing was recorded at all. */
  | "missing"
  /**
   * The device feed never delivered for this day, so the gap in the record is
   * OURS. Without this the two were the same mark: a Bridge outage looked
   * exactly like a no-show, on the phone of somebody who punched in normally.
   */
  | "uncertain";

/** The accessible wording for each mark. Colour alone cannot carry a grid. */
export const MARK_LABEL: Record<Exclude<DayMark, "none">, StringKey> = {
  off: "markOff",
  complete: "markComplete",
  incomplete: "markIncomplete",
  missing: "markMissing",
  uncertain: "markUncertain",
};

/**
 * Has this day finished, for the purpose of judging its record?
 *
 * THE MOST IMPORTANT LINE IN THIS FILE. At 09:00 on a rostered day there is
 * one punch and no matching out — which is normal, and marking it `incomplete`
 * would put an accusation on a morning that is going perfectly well. Same for
 * `missing`: at 07:30 nobody has arrived yet because it is not eight o'clock.
 *
 * A past day is over. Today is over once the rostered end time has passed. A
 * day with no roster has no end time and is never judged this way — it comes
 * out as `off` above.
 */
function isFinished(day: Day | undefined, date: Date, now: Date): boolean {
  if (!isSameDay(date, now)) return date < now;
  const end = parseTimeToMinutes(day?.shift?.end_time);
  if (end === null) return false;

  // AN OVERNIGHT SHIFT DOES NOT END TODAY. `end` is a minute-of-day, so a
  // 22:00–06:00 roster reports an end of 360 and every minute after six in the
  // morning compared as "the day is over" — marking a night worker's day
  // `missing` from 06:00 onward, sixteen hours before their shift even starts,
  // and then `incomplete` all night while they are standing at the machine.
  const start = parseTimeToMinutes(day?.shift?.start_time);
  if (start !== null && end <= start) return false;

  return now.getHours() * 60 + now.getMinutes() >= end;
}

/**
 * Are the day's punches paired?
 *
 * PARITY, not `classifyUnpairedPresentations`. That function draws the finer
 * distinction — an open session today versus a genuinely unpaired punch — but
 * it reads device-sync state this payload deliberately drops, so here it would
 * run degraded and could classify a day differently from the same function in
 * the HR console.
 *
 * Parity is the rule `miniStatus.stillInside` and the notifier's
 * `direction_of` already use. Three surfaces agree on it today; a fourth rule
 * is exactly how they would start describing one Tuesday three ways.
 */
function punchCount(day: Day | undefined): number {
  return day?.checkins?.length ?? 0;
}

function isPaired(day: Day | undefined): boolean {
  return punchCount(day) % 2 === 0;
}

export function dayMark(
  facts: DayFacts,
  day: Day | undefined,
  date: Date,
  now: Date,
): DayMark {
  // NOTHING IS MARKED IN THE FUTURE, not even a day off. This grid is about
  // the RECORD, and a day that has not happened has none — a row of hollow
  // rings across next week's weekends is noise standing exactly where the
  // eye is scanning for the days that need attention. What is PLANNED is the
  // Schedule tab's question, and it answers it properly.
  if (date > now && !isSameDay(date, now)) return "none";

  // Leave and holiday outrank punches, matching `dayFacts` exactly. Somebody
  // who came in for an hour on a public holiday is still on a holiday, and the
  // grid must not disagree with the heading the same day shows when opened.
  if (facts.tone === "leave" || facts.tone === "holiday" || facts.tone === "off") {
    return "off";
  }

  // Today, mid-shift. A trailing in-punch with no out is what being at work
  // looks like; marking it is an accusation on a morning going perfectly well.
  const punches = punchCount(day);
  if (!isFinished(day, date, now)) {
    return punches > 0 && isPaired(day) ? "complete" : "none";
  }

  // COUNTED, not read off `facts.tone`. A day with exactly one punch has no
  // range — `dayFacts` needs a first_in AND a last_out to build one — so its
  // tone is "nothing", the same tone a day with no punches at all gets. Keying
  // on that called "clocked in and never clocked out" a day nobody came to,
  // which are opposite problems: one is a forgotten tap, the other is an
  // absence. Found by a test, not by reading.
  const mark = punches === 0 ? "missing" : isPaired(day) ? "complete" : "incomplete";

  // A deficient record on a day our own feed could not vouch for is not the
  // employee's to answer for. Only the deficient marks are rewritten: punches
  // that arrived and paired up are a complete record whatever the device did
  // afterwards, and calling every day uncertain would excuse real absences.
  if (day?.feed_uncertain && (mark === "missing" || mark === "incomplete")) {
    return "uncertain";
  }
  return mark;
}
