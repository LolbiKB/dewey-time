import assert from "node:assert/strict";
import test from "node:test";

import {
  formatClockMinute,
  formatClockSpan,
  formatIn,
  formatPunchTime,
  formatWorkedMinutes,
  khmerDayPeriod,
  toKhmerDigits,
} from "@/miniapp/miniIntl";

const EN_UNITS = { hour: "h", minute: "m" };
const KM_UNITS = { hour: "ម៉ោង", minute: "នាទី" };
/** A Monday in August, so the month and weekday are both worth checking. */
const DAY = new Date(2026, 7, 17, 17, 6);

test("Latin digits become Khmer ones and nothing else changes", () => {
  assert.equal(toKhmerDigits("17 August"), "១៧ August");
  assert.equal(toKhmerDigits("8:00 AM – 5:00 PM"), "៨:០០ AM – ៥:០០ PM");
  assert.equal(toKhmerDigits("0123456789"), "០១២៣៤៥៦៧៨៩");
  // Separators, letters and Khmer text all pass through untouched.
  assert.equal(toKhmerDigits("សីហា"), "សីហា");
  assert.equal(toKhmerDigits(""), "");
});

test("the month and weekday come out in Khmer, with Khmer numerals", () => {
  assert.equal(formatIn("en", DAY, "d MMMM"), "17 August");
  assert.equal(formatIn("km", DAY, "d MMMM"), "១៧ សីហា");
  assert.equal(formatIn("en", DAY, "EEEE"), "Monday");
  assert.equal(formatIn("km", DAY, "EEEE"), "ចន្ទ");
});

test("the Khmer weekday abbreviation is one consonant, and that is correct", () => {
  // ច for ចន្ទ. It looks like a truncation bug and is the actual convention;
  // pinned so nobody "fixes" it into three Latin-style letters.
  assert.equal(formatIn("km", DAY, "EEE"), "ច");
  assert.equal(formatIn("en", DAY, "EEE"), "Mon");
});

test("the afternoon is not called the evening", () => {
  // date-fns's km locale has two day periods and maps every PM hour to
  // ល្ងាច, which means EVENING. A 1pm lunch and a 5pm clock-out both came
  // out described as the evening. Replaced, and pinned at each boundary.
  assert.equal(khmerDayPeriod(0), "ព្រឹក");
  assert.equal(khmerDayPeriod(11), "ព្រឹក");
  assert.equal(khmerDayPeriod(12), "រសៀល");
  assert.equal(khmerDayPeriod(13), "រសៀល");
  assert.equal(khmerDayPeriod(17), "រសៀល");
  assert.equal(khmerDayPeriod(18), "ល្ងាច");
  assert.equal(khmerDayPeriod(23), "ល្ងាច");

  assert.equal(formatPunchTime("km", "2026-08-17 07:58:00"), "៧:៥៨ ព្រឹក");
  assert.equal(formatPunchTime("km", "2026-08-17 13:00:00"), "១:០០ រសៀល");
  assert.equal(formatPunchTime("km", "2026-08-17 17:06:00"), "៥:០៦ រសៀល");
  assert.equal(formatPunchTime("km", "2026-08-17 19:30:00"), "៧:៣០ ល្ងាច");
});

test("a minute-of-day is a 12-hour clock time in either language", () => {
  assert.equal(formatClockMinute("en", 0), "12:00 AM");
  assert.equal(formatClockMinute("en", 8 * 60), "8:00 AM");
  assert.equal(formatClockMinute("en", 17 * 60 + 6), "5:06 PM");
  assert.equal(formatClockMinute("km", 8 * 60), "៨:០០ ព្រឹក");
  assert.equal(formatClockMinute("km", 12 * 60), "១២:០០ រសៀល");
  assert.equal(formatClockMinute("km", null), null);
  assert.equal(formatClockMinute("km", undefined), null);
  assert.equal(formatClockMinute("km", Number.NaN), null);
});

test("a span needs both ends, in either language", () => {
  assert.equal(formatClockSpan("en", 8 * 60, 17 * 60), "8:00 AM – 5:00 PM");
  assert.equal(formatClockSpan("km", 8 * 60, 17 * 60), "៨:០០ ព្រឹក – ៥:០០ រសៀល");
  assert.equal(formatClockSpan("en", 8 * 60, null), null);
  assert.equal(formatClockSpan("en", null, 17 * 60), null);
});

test("a punch time is read from the API's own datetime string", () => {
  assert.equal(formatPunchTime("en", "2026-08-17 07:58:00"), "7:58 AM");
  assert.equal(formatPunchTime("en", null), null);
  assert.equal(formatPunchTime("en", ""), null);
  assert.equal(formatPunchTime("en", "not a date"), null);
});

test("a duration is hours and minutes, NEVER days", () => {
  // formatDurationMinutes in the shared lib rolls past 24h into days, which
  // is right for one day and useless for a week: a normal week rendered as
  // "2d 6h 48m", arithmetically true and unusable against a 40-hour roster.
  const week = formatWorkedMinutes("en", 54 * 60 + 48, EN_UNITS)!;
  assert.doesNotMatch(week, /d/, `a weekly total must not be given in days: ${week}`);
  assert.equal(week, "54h 48m");
});

test("an exact hour drops the minutes rather than saying 0m", () => {
  assert.equal(formatWorkedMinutes("en", 9 * 60, EN_UNITS), "9h");
  assert.equal(formatWorkedMinutes("km", 9 * 60, KM_UNITS), "៩ ម៉ោង");
});

test("under an hour is minutes alone, not '0h 40m'", () => {
  assert.equal(formatWorkedMinutes("en", 40, EN_UNITS), "40m");
  assert.equal(formatWorkedMinutes("km", 40, KM_UNITS), "៤០ នាទី");
});

test("Khmer spaces the unit off the number and English does not", () => {
  // "៨ម៉ោង" runs the numeral into the word; "8 h" is not how English writes a
  // duration. Driven off the locale, not off the unit strings, so editing the
  // English table cannot introduce a space.
  assert.equal(formatWorkedMinutes("en", 8 * 60 + 11, EN_UNITS), "8h 11m");
  assert.equal(formatWorkedMinutes("km", 8 * 60 + 11, KM_UNITS), "៨ ម៉ោង ១១ នាទី");
});

test("no total is null, never zero", () => {
  // "0h" is a claim that someone worked no hours. A week nobody has reached
  // yet has not made that claim, and a zero would read as one.
  assert.equal(formatWorkedMinutes("en", null, EN_UNITS), null);
  assert.equal(formatWorkedMinutes("en", undefined, EN_UNITS), null);
  assert.equal(formatWorkedMinutes("en", Number.NaN, EN_UNITS), null);
  // An explicit zero is a real measurement and does render.
  assert.equal(formatWorkedMinutes("en", 0, EN_UNITS), "0m");
});
