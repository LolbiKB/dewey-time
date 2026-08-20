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

import { groupCheckinsByBranchRuns, pairRun } from "@/lib/attendancePunches";
import { parseTimeToMinutes } from "@/lib/attendanceTime";
import type { Day } from "@/types/calendar";
import { dayFacts, type DayFacts } from "@/miniapp/miniDay";
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

/**
 * The accessible wording for each mark. Colour alone cannot carry a grid.
 *
 * Not exported: `incomplete` has three possible wordings and only
 * `dayMarkLabel` below knows which is honest, so every consumer goes
 * through it.
 */
const MARK_LABEL: Record<Exclude<DayMark, "none">, StringKey> = {
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

function punchCount(day: Day | undefined): number {
  return day?.checkins?.length ?? 0;
}

/** Sorted rather than trusted: the payload's order is the query's order. */
function inOrder(day: Day | undefined) {
  return [...(day?.checkins ?? [])].sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

/**
 * Every punch that never found its pair, under THE SAME retrospective
 * pairing that draws the timeline and totals the day: branch runs, then
 * `pairRun` within each. (The Telegram receipt and the status chip answer a
 * different, LIVE question with a different rule — `punchLiveVerbs.ts` —
 * that drops bounces and refuses verbs; a finished day's record is this
 * rule's to judge.) Whole-day parity lived here before, and it was blind to
 * campus and to double taps — a cover shift's nine punches read "incomplete"
 * as one undifferentiated oddness, and two bounced taps could cancel into a
 * "complete" record the timeline drew as two strays.
 *
 * Still not `classifyUnpairedPresentations`: that draws the finer
 * open-today-versus-unpaired distinction but reads device-sync state this
 * payload deliberately drops, so here it would run degraded and could
 * classify a day differently from the HR console.
 */
function unmatchedPunches(day: Day | undefined) {
  return groupCheckinsByBranchRuns(inOrder(day)).flatMap((run) => pairRun(run).unmatched);
}

function isPaired(day: Day | undefined): boolean {
  return unmatchedPunches(day).length === 0;
}

/**
 * The words for a mark.
 *
 * Static for every mark but `incomplete`, whose one string — "no clock-out
 * recorded" — used to be the wording of EVERY deficient day, and was a claim
 * about the DAY that the day often refuted: IN, OUT, IN has a recorded
 * clock-out at midday, a lone explicit OUT has the opposite end missing, and
 * a stray can be a duplicate of an end that exists and paired. So the label
 * now claims only what is true of the unmatched punch ITSELF — "a clock-in
 * without its pair" — and the direction in that claim comes from the punch's
 * OWN label and nothing else (the #192 rule: labels decide direction,
 * position only pairs). Unlabelled or mixed strays get the direction-free
 * wording, the same refusal the receipt makes when it cannot honestly call
 * a punch.
 */
export function dayMarkLabel(mark: Exclude<DayMark, "none">, day: Day | undefined): StringKey {
  if (mark !== "incomplete") return MARK_LABEL[mark];
  const labels = unmatchedPunches(day).map((p) => String(p.log_type || "").trim().toUpperCase());
  if (labels.length && labels.every((l) => l === "IN")) return "markIncomplete";
  if (labels.length && labels.every((l) => l === "OUT")) return "markIncompleteNoIn";
  return "markUnpaired";
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

/**
 * Whether the Day tab should show its "no data from the device" notice.
 *
 * THE SAME PREDICATE AS THE CALENDAR MARK, on purpose. The notice used to key
 * on `feed_uncertain` alone, which is a branch-level fact — any unresolved
 * closeout alert at the employee's branch, from any device — so it appeared
 * under days whose own record was complete and fully paired, flatly
 * contradicting the timeline drawn right above it. Routing through `dayMark`
 * means the banner shows exactly when the calendar shows the uncertain mark:
 * the day is deficient AND the feed cannot be vouched for. One rule, two
 * surfaces, no disagreement possible.
 */
export function showsFeedNotice(day: Day | undefined, date: Date, now: Date): boolean {
  // Composed exactly the way the calendar sheet composes its marks, so the
  // two surfaces cannot read the same day differently.
  return dayMark(dayFacts(day, date, now), day, date, now) === "uncertain";
}
