/**
 * What one day says about itself, in one place.
 *
 * The Day tab and the Week list answer the same question at two zoom levels,
 * and before this they each derived it — which is how two surfaces start
 * describing the same Tuesday differently. `dayFacts` is the single
 * derivation; both render it.
 *
 * It says what HAPPENED and never what it MEANS. A scheduled day with no
 * punches reads "No punches recorded", never "absent": the engine's verdict is
 * provisional until HR reviews it (intraday re-inserts AUTO flags on every
 * punch), so calling it an absence here would be the app taking a position
 * nobody has taken yet. The Mini App also receives no flags at all — the API
 * allowlist drops them — so it could not report one even if it wanted to.
 */
import { format, isSameDay } from "date-fns";

import {
  clamp,
  formatDayCheckinTimeRange,
  formatDurationMinutes,
  minutesFromDateTime,
  parseDateTimeLocal,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
import { deriveSegments } from "@/lib/attendancePunches";
import { netWorkedMinutes } from "@/lib/clockDay";
import type { Day } from "@/types/calendar";
import { translator, type StringKey } from "@/miniapp/miniStrings";
import { openRunStartedAt } from "@/miniapp/miniStatus";

/**
 * Which kind of day this is. Drives colour and wording, so it is a closed set
 * rather than a string: an unhandled tone is a compile error rather than an
 * unstyled row.
 */
export type DayTone = "worked" | "leave" | "holiday" | "off" | "scheduled" | "nothing";

export type DayFacts = {
  tone: DayTone;
  /** Punch span, e.g. "7:58 AM – 5:06 PM". Null when nothing was recorded. */
  range: string | null;
  /**
   * The first in and last out as the API's own datetime strings, NOT as
   * rendered times.
   *
   * Raw on purpose: the Mini App renders these in the reader's script, and a
   * formatted "7:58 AM" cannot be converted to "៧:៥៨ ព្រឹក" without parsing
   * our own output back out again. Whoever displays them owns the locale;
   * this function owns the facts. (Caught by a test that got "null – null"
   * after exactly that mistake.)
   */
  firstInAt: string | null;
  lastOutAt: string | null;
  /** Net worked, lunch removed, already formatted. */
  worked: string | null;
  /** Net worked in minutes, for totalling a week without re-parsing text. */
  workedMinutes: number | null;
  /** The rostered shift, e.g. "8:00 AM – 5:00 PM". Null when not scheduled. */
  shift: string | null;
  /** Rostered minutes, gross of lunch. */
  shiftMinutes: number | null;
  /** The rostered lunch, e.g. "12:00 PM – 1:00 PM". Null when none is set. */
  lunch: string | null;
  /** Rostered lunch minutes, so net rostered time can be shown. */
  lunchMinutes: number | null;
  /**
   * The DATA's own name for the day — a leave type, a holiday's description.
   * Never translated: it is a value out of ERPNext, not a word this app owns.
   */
  noteText: string | null;
  /**
   * The app's own name for the state, as a key rather than a sentence, so the
   * Khmer interface is a lookup and not a second copy of this logic.
   */
  noteKey: StringKey | null;
  /**
   * The English rendering of whichever of the two applies. Kept because the
   * accessible names and the tests read one string, and because a surface
   * with no locale in hand still has to say something.
   */
  note: string | null;
};

/**
 * A minute-of-day as "8:00 AM".
 *
 * TWELVE HOUR, matching every other time this app shows. Punches already read
 * "7:58 AM" (formatCheckinTime), so a roster printed as "08:00 – 17:00" beside
 * them made one screen speak two clock conventions — and 17:00 is not how
 * anybody here says five o'clock.
 *
 * Minute-of-day rather than a datetime, because a roster has no date: the same
 * 08:00 applies to every Monday. `formatMinuteOnDay` needs a date key it would
 * only be given a fake one of.
 */
export function formatMinuteOfDay(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  // Any date will do; only the clock face is read off it.
  const at = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return format(at, "h:mm a");
}

/** "8:00 AM – 5:00 PM" from two minute-of-day values. */
export function formatSpan(
  startMin: number | null | undefined,
  endMin: number | null | undefined,
): string | null {
  const start = formatMinuteOfDay(startMin);
  const end = formatMinuteOfDay(endMin);
  return start && end ? `${start} – ${end}` : null;
}

/** The rostered window, when there is one. */
function shiftOf(day: Day | undefined): {
  label: string | null;
  minutes: number | null;
  lunch: string | null;
  lunchMinutes: number | null;
} {
  const none = { label: null, minutes: null, lunch: null, lunchMinutes: null };
  if (!day?.shift?.shift_assigned) return none;
  const start = parseTimeToMinutes(day.shift.start_time);
  const end = parseTimeToMinutes(day.shift.end_time);
  if (start === null || end === null) return none;
  // An overnight shift ends "before" it starts on the clock; the roster still
  // spans the wrap, and a negative duration would render as a negative day.
  const span = end >= start ? end - start : 24 * 60 - start + end;

  const lunchStart = parseTimeToMinutes(day.shift.lunch_start);
  const lunchEnd = parseTimeToMinutes(day.shift.lunch_end);
  const hasLunch = lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart;

  return {
    label: formatSpan(start, end),
    minutes: span,
    lunch: hasLunch ? formatSpan(lunchStart, lunchEnd) : null,
    lunchMinutes: hasLunch ? lunchEnd - lunchStart : null,
  };
}

const inEnglish = translator("en");

/** Attach the data's name, the state key, and the English rendering of both. */
function note(
  partial: Omit<DayFacts, "noteText" | "noteKey" | "note">,
  text: string | null,
  key: StringKey,
): DayFacts {
  return { ...partial, noteText: text, noteKey: key, note: text ?? inEnglish(key) };
}

/**
 * Net worked on a day, lunch removed, from the punches alone.
 *
 * Hoisted out of `dayFacts` because that function answers leave and holiday
 * FIRST and returns before it ever looks at a punch -- correct for the day's
 * tone, useless for somebody who came in for two hours on a public holiday.
 * `dayNumbers` needs the figure on exactly those days.
 *
 * One derivation, called from both, so a holiday's two hours cannot come out
 * differently depending on which surface asked.
 */
export function netWorkedFor(day: Day | undefined): number | null {
  const segments = deriveSegments(day?.checkins ?? [], {
    parseTime: parseDateTimeLocal,
    minutesFromDateTime,
    clamp,
  });
  return netWorkedMinutes(segments);
}

export function dayFacts(day: Day | undefined, date: Date, today: Date): DayFacts {
  const shift = shiftOf(day);
  const base = {
    range: null,
    firstInAt: null,
    lastOutAt: null,
    worked: null,
    workedMinutes: null,
    shift: shift.label,
    shiftMinutes: shift.minutes,
    lunch: shift.lunch,
    lunchMinutes: shift.lunchMinutes,
  };

  // Leave and holiday outrank punches deliberately: someone who came in for an
  // hour on a public holiday is still on a holiday, and the header should say
  // so rather than reporting an hour as an ordinary day.
  if (day?.leave?.on_leave) {
    return note({ ...base, tone: "leave" }, day.leave.leave_type ?? null, "stateOnLeave");
  }
  if (day?.holiday) {
    return note({ ...base, tone: "holiday" }, day.holiday.description ?? null, "stateHoliday");
  }

  const range = formatDayCheckinTimeRange(day);
  if (range) {
    const net = netWorkedFor(day);
    return {
      ...base,
      tone: "worked",
      range,
      firstInAt: day?.first_in ?? null,
      lastOutAt: day?.last_out ?? null,
      worked: net == null ? null : formatDurationMinutes(net),
      workedMinutes: net ?? null,
      noteText: null,
      noteKey: null,
      note: null,
    };
  }

  if (!day?.shift?.shift_assigned) {
    return note({ ...base, tone: "off" }, null, "stateDayOff");
  }
  // Scheduled and not yet arrived. A future day has simply not happened.
  if (date > today && !isSameDay(date, today)) {
    return note({ ...base, tone: "scheduled" }, null, "stateScheduled");
  }
  return note({ ...base, tone: "nothing" }, null, "stateNoPunches");
}

/**
 * Did this day have punches of its own, whatever else the day was?
 *
 * The same question `dayFacts` asks on its way to tone "worked" -- asked
 * without the leave/holiday early return in front of it, because a public
 * holiday somebody came in and worked is still a day they worked.
 */
export function wasWorked(day: Day | undefined): boolean {
  return formatDayCheckinTimeRange(day) !== null;
}

/**
 * Net worked across a set of days, in minutes. Null when nothing is known.
 *
 * Reads the DAYS, not their facts, and that is the whole point. `dayFacts`
 * answers leave and holiday before it ever looks at a punch and returns
 * `workedMinutes: null` for both -- right for the day's tone, and the reason
 * this total used to silently drop the hours a worker most wants to check.
 * They saw "8h 12m" on the Day tab for a public holiday they worked, and then
 * "Worked this month" and "days worked" reporting that it never happened. On
 * the surface built so they can check their pay, that reads as the company
 * quietly not recording their premium day.
 *
 * Tone still governs colour and wording. It does not govern arithmetic.
 */
export function totalWorkedMinutes(days: (Day | undefined)[]): number | null {
  const known = days
    .map((day) => netWorkedFor(day))
    .filter((minutes): minutes is number => minutes !== null);
  if (!known.length) return null;
  return known.reduce((sum, minutes) => sum + minutes, 0);
}

/**
 * The two numbers the Day tab's canvas cannot state.
 *
 * The canvas prints each run's own duration -- 4h 3m, then 4h 8m -- and nobody
 * adds those in their head. It also has no way to say what the day was
 * supposed to be, net of its lunch.
 *
 * SEPARATE from `dayFacts.workedMinutes`, which stays exactly as it was. That
 * field is what `totalWorkedMinutes` sums for the calendar sheet's month
 * figure, and what HR's surfaces read; the projection below must not reach
 * either.
 */
export type DayNumbers = {
  /** Net worked, plus any open run when the day is today. Null when none. */
  worked: number | null;
  /** Net rostered, lunch removed. Null when not rostered, or on leave/holiday. */
  rostered: number | null;
  /** A run is still open, so the worked figure is still moving. */
  live: boolean;
};

/**
 * Minutes since a punch, floored at zero.
 *
 * Never negative: a device clock running ahead of the phone would otherwise
 * SUBTRACT from the day's total, which reads as work being taken away.
 */
function minutesSince(at: string, now: Date): number {
  const started = parseDateTimeLocal(at);
  const delta = now.getTime() - started.getTime();
  if (!Number.isFinite(delta) || delta < 0) return 0;
  return Math.round(delta / 60000);
}

export function dayNumbers(
  day: Day | undefined,
  date: Date,
  today: Date,
  now: Date,
): DayNumbers {
  // Only for the day's TONE and its roster -- the worked figure comes from
  // netWorkedFor below, for the reason given there.
  const facts = dayFacts(day, date, today);

  // No rostered figure on a day somebody was entitled to be away: there is
  // nothing they failed to meet, and "— / 8h" beside "Annual Leave" reads as
  // eight hours missing. Work actually punched still counts, below.
  const excused = facts.tone === "leave" || facts.tone === "holiday";
  const rostered =
    excused || facts.shiftMinutes === null
      ? null
      : facts.shiftMinutes - (facts.lunchMinutes ?? 0);

  // `netWorkedFor`, NOT `facts.workedMinutes`: dayFacts answers leave and
  // holiday before it looks at a punch, so its figure is null on exactly the
  // days where somebody may still have worked.
  const punched = netWorkedFor(day);

  // TODAY only. `openRunStartedAt` reports an unclosed punch on any day, and
  // on a past one that is a gap in the record rather than somebody at work.
  const openedAt = isSameDay(date, today) ? openRunStartedAt(day) : null;
  const worked =
    openedAt === null ? punched : (punched ?? 0) + minutesSince(openedAt, now);

  return { worked, rostered, live: openedAt !== null };
}
