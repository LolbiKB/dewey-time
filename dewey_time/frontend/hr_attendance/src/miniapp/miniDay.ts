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
import { isSameDay } from "date-fns";

import {
  clamp,
  formatCheckinTime,
  formatDayCheckinTimeRange,
  formatDurationMinutes,
  minutesFromDateTime,
  parseDateTimeLocal,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
import { deriveSegments } from "@/lib/attendancePunches";
import { netWorkedMinutes } from "@/lib/clockDay";
import type { Day } from "@/types/calendar";

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
  firstIn: string | null;
  lastOut: string | null;
  /** Net worked, lunch removed, already formatted. */
  worked: string | null;
  /** Net worked in minutes, for totalling a week without re-parsing text. */
  workedMinutes: number | null;
  /** The rostered shift, e.g. "08:00 – 17:00". Null when not scheduled. */
  shift: string | null;
  /** Rostered minutes, so a day can be compared against its plan. */
  shiftMinutes: number | null;
  /** The one-line answer when there is no span: leave type, holiday, or state. */
  note: string | null;
};

function hhmm(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The rostered window, when there is one. */
function shiftOf(day: Day | undefined): { label: string | null; minutes: number | null } {
  if (!day?.shift?.shift_assigned) return { label: null, minutes: null };
  const start = parseTimeToMinutes(day.shift.start_time);
  const end = parseTimeToMinutes(day.shift.end_time);
  if (start === null || end === null) return { label: null, minutes: null };
  // An overnight shift ends "before" it starts on the clock; the roster still
  // spans the wrap, and a negative duration would render as a negative day.
  const span = end >= start ? end - start : 24 * 60 - start + end;
  return { label: `${hhmm(start)} – ${hhmm(end)}`, minutes: span };
}

export function dayFacts(day: Day | undefined, date: Date, today: Date): DayFacts {
  const shift = shiftOf(day);
  const base = {
    range: null,
    firstIn: null,
    lastOut: null,
    worked: null,
    workedMinutes: null,
    shift: shift.label,
    shiftMinutes: shift.minutes,
  };

  // Leave and holiday outrank punches deliberately: someone who came in for an
  // hour on a public holiday is still on a holiday, and the header should say
  // so rather than reporting an hour as an ordinary day.
  if (day?.leave?.on_leave) {
    return { ...base, tone: "leave", note: day.leave.leave_type ?? "On leave" };
  }
  if (day?.holiday) {
    return { ...base, tone: "holiday", note: day.holiday.description ?? "Holiday" };
  }

  const range = formatDayCheckinTimeRange(day);
  if (range) {
    const segments = deriveSegments(day?.checkins ?? [], {
      parseTime: parseDateTimeLocal,
      minutesFromDateTime,
      clamp,
    });
    const net = netWorkedMinutes(segments);
    return {
      ...base,
      tone: "worked",
      range,
      firstIn: formatCheckinTime(day?.first_in) || null,
      lastOut: formatCheckinTime(day?.last_out) || null,
      worked: net == null ? null : formatDurationMinutes(net),
      workedMinutes: net ?? null,
      note: null,
    };
  }

  if (!day?.shift?.shift_assigned) {
    return { ...base, tone: "off", note: "Day off" };
  }
  // Scheduled and not yet arrived. A future day has simply not happened.
  if (date > today && !isSameDay(date, today)) {
    return { ...base, tone: "scheduled", note: "Scheduled" };
  }
  return { ...base, tone: "nothing", note: "No punches recorded" };
}

/** Net worked across a set of days, in minutes. Null when nothing is known. */
export function totalWorkedMinutes(facts: DayFacts[]): number | null {
  const known = facts.filter((f) => f.workedMinutes !== null);
  if (!known.length) return null;
  return known.reduce((sum, f) => sum + (f.workedMinutes ?? 0), 0);
}

/**
 * The week's total, in hours and minutes — never days.
 *
 * NOT `formatDurationMinutes`, which rolls anything past 24h into days. That
 * is right for one day's duration, which never reaches a day, and wrong the
 * moment a week is summed: a normal week rendered as "2d 6h 48m", which is
 * arithmetically true and useless. Nobody is owed hours in days, no payslip
 * states them that way, and it cannot be checked against a 40-hour roster
 * without doing the conversion in your head.
 *
 * Caught by rendering the page, not by a test — the unit suite only asserted
 * that a total existed.
 */
export function formatTotalWorked(facts: DayFacts[]): string | null {
  const total = totalWorkedMinutes(facts);
  if (total === null) return null;
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
