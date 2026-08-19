/**
 * Numbers, dates and durations in the reader's own script.
 *
 * A Khmer interface that prints "17 August" and "8h 11m" is half-translated,
 * and the half it left behind is the half carrying the information. Someone
 * reading Khmer is reading ១៧ សីហា; the Latin digits are not a neutral
 * fallback, they are a second alphabet dropped into the middle of a sentence.
 *
 * TWO SEPARATE JOBS, and they are separate because they fail separately:
 *
 *   WORDS — month and weekday names come from date-fns's `km` locale and are
 *   correct, including the single-consonant weekday abbreviations (ច for
 *   ចន្ទ) that look like a truncation bug and are the actual convention.
 *   Its DAY PERIODS are the one exception and are replaced below: it has
 *   only two, and calls every PM hour ល្ងាច, the evening.
 *
 *   DIGITS — date-fns emits Latin digits under every locale, `km` included,
 *   so the numerals are ours to convert. It is a pure per-character mapping
 *   with no locale-specific grouping to get wrong.
 *
 * Applied at the RENDER boundary rather than inside the data layer, so the
 * fact-derivation functions stay pure and testable in one language, and no
 * value is ever converted twice.
 */
import { format as formatDate } from "date-fns";
import { km } from "date-fns/locale";

import { parseDateTimeLocal } from "@/lib/attendanceTime";
import { hourLabel } from "@/lib/timelineAxis";
import type { Locale } from "@/miniapp/miniStrings";

/** ០១២៣៤៥៦៧៨៩, indexed by the digit they replace. */
const KHMER_DIGITS = "០១២៣៤៥៦៧៨៩";

/**
 * Latin digits to Khmer ones, leaving everything else alone.
 *
 * Deliberately blind to what it is converting: it runs over already-formatted
 * output, so a colon in a time, an en dash in a range and the "h" in a
 * duration all survive untouched. What it must never be pointed at is an
 * identifier — see `MiniIdentity`, where the employee code stays Latin
 * because HR-EMP-00042 is a name, not a quantity.
 */
export function toKhmerDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => KHMER_DIGITS[Number(d)]!);
}

/** The digit converter for a locale — identity for English. */
export function digitsFor(locale: Locale): (text: string) => string {
  return locale === "km" ? toKhmerDigits : (text) => text;
}

/** date-fns's locale object, or undefined for its own default. */
function dateFnsLocale(locale: Locale) {
  return locale === "km" ? km : undefined;
}

/** `format`, in the reader's language and script. */
export function formatIn(locale: Locale, date: Date, pattern: string): string {
  return digitsFor(locale)(formatDate(date, pattern, { locale: dateFnsLocale(locale) }));
}

/**
 * The Khmer word for the part of the day an hour falls in.
 *
 * NOT date-fns's. Its `km` locale has exactly two day periods, AM and PM, and
 * maps every PM hour to ល្ងាច — which means "evening". A 1 PM lunch and a
 * 5 PM clock-out both came out described as the evening, and a roster that
 * calls the afternoon "evening" is wrong in the plainest way a reader can
 * notice. The month names and weekdays from that locale are fine and are
 * still used; only this one token is replaced.
 *
 * Three periods rather than the five Khmer can draw on. The boundary cases
 * this app actually renders are shift hours — roughly 6am to 10pm — and each
 * extra word is another one that needs a native speaker's eye. ព្រឹក before
 * noon, រសៀល through the afternoon, ល្ងាច from six. Noon itself reads as
 * រសៀល rather than the more precise ថ្ងៃត្រង់; that is a simplification, not
 * an error.
 */
export function khmerDayPeriod(hour: number): string {
  if (hour < 12) return "ព្រឹក";
  if (hour < 18) return "រសៀល";
  return "ល្ងាច";
}

/** One wall-clock time: "5:06 PM", or "៥:០៦ រសៀល". */
function formatClock(locale: Locale, at: Date): string {
  if (locale !== "km") return formatDate(at, "h:mm a");
  return `${toKhmerDigits(formatDate(at, "h:mm"))} ${khmerDayPeriod(at.getHours())}`;
}

/**
 * A minute-of-day as a clock time: "8:00 AM", or "៨:០០ ព្រឹក".
 *
 * Minute-of-day rather than a datetime, because a roster has no date — the
 * same 08:00 applies to every Monday.
 */
/**
 * One hour tick on a timeline axis: "7 AM", or "៧ ព្រឹក".
 *
 * Compact on purpose -- the axis is a 3.5rem gutter beside the canvas, and a
 * full "7:00 ព្រឹក" at every hour wraps. English delegates to `hourLabel` so
 * HR's axis and this one cannot drift apart.
 */
export function formatHourTick(locale: Locale, minuteOfDay: number): string {
  if (locale !== "km") return hourLabel(minuteOfDay);
  const h24 = Math.floor(minuteOfDay / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${toKhmerDigits(String(h12))} ${khmerDayPeriod(h24)}`;
}


export function formatClockMinute(locale: Locale, minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  // Any date will do; only the clock face is read off it.
  const at = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return formatClock(locale, at);
}

/** "8:00 AM – 5:00 PM" from two minute-of-day values. */
export function formatClockSpan(
  locale: Locale,
  startMin: number | null | undefined,
  endMin: number | null | undefined,
): string | null {
  const start = formatClockMinute(locale, startMin);
  const end = formatClockMinute(locale, endMin);
  return start && end ? `${start} – ${end}` : null;
}

/** One punch's wall-clock time, from the API's datetime string. */
export function formatPunchTime(locale: Locale, value: string | null | undefined): string | null {
  if (!value) return null;
  const at = parseDateTimeLocal(value);
  if (!Number.isFinite(at.getTime())) return null;
  return formatClock(locale, at);
}

/**
 * The same punch time, tightened for the timeline canvas.
 *
 * The canvas prints a start and an end INSIDE a punch block, which on a 320px
 * phone is a few dozen pixels wide, so the shared timeline has always drawn
 * "7:58AM" without the space. Khmer keeps its space: "៧:៥៨ ព្រឹក" is a numeral
 * followed by a separate word, and closing that gap sets two scripts against
 * each other rather than saving room.
 */
export function formatPunchCompact(locale: Locale, value: string | null | undefined): string | null {
  if (locale === "km") return formatPunchTime(locale, value);
  if (!value) return null;
  const at = parseDateTimeLocal(value);
  if (!Number.isFinite(at.getTime())) return null;
  return formatDate(at, "h:mma");
}


/**
 * A duration in hours and minutes — NEVER days.
 *
 * `formatDurationMinutes` in the shared lib rolls anything past 24h into
 * days, which is right for one day's duration and wrong the moment a week is
 * summed: a normal week rendered as "2d 6h 48m", arithmetically true and
 * useless. Nobody is owed hours in days and no payslip states them that way.
 *
 * The units are words in Khmer and letters in English because that is what
 * each language does: "៨ ម៉ោង ១១ នាទី" reads, "៨h ១១m" is two scripts in one
 * token. English stays compact where it has always been.
 */
export function formatWorkedMinutes(
  locale: Locale,
  minutes: number | null | undefined,
  units: { hour: string; minute: string },
): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  const digits = digitsFor(locale);
  // Khmer separates the number from its unit; English does not. Driving that
  // off the locale rather than off the unit strings keeps "8h" from becoming
  // "8 h" the day somebody edits the English table.
  const join = locale === "km" ? " " : "";
  const h = `${digits(String(hours))}${join}${units.hour}`;
  const m = `${digits(String(rest))}${join}${units.minute}`;
  if (!hours) return m;
  return rest ? `${h} ${m}` : h;
}

/**
 * "2y 5mo", or "២ ឆ្នាំ ៥ ខែ".
 *
 * Composed exactly the way formatWorkedMinutes composes hours and minutes,
 * including the space-before-unit rule: Khmer separates the number from its
 * word, English does not, and driving that off the LOCALE rather than off the
 * unit strings keeps "2y" from becoming "2 y" the day somebody edits the
 * English table.
 */
export function formatServiceLength(
  locale: Locale,
  service: { years: number; months: number } | null,
  units: { year: string; month: string },
): string | null {
  if (!service) return null;
  const digits = digitsFor(locale);
  const join = locale === "km" ? " " : "";
  const years = `${digits(String(service.years))}${join}${units.year}`;
  const months = `${digits(String(service.months))}${join}${units.month}`;
  if (!service.years) return months;
  return service.months ? `${years} ${months}` : years;
}
