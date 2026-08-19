/**
 * The words and number formats the day timeline renders, as one injectable set.
 *
 * ONE COMPONENT, TWO AUDIENCES. `DayCell` draws HR's week view and the Mini
 * App's Day tab from the same code, and until now it spoke English to both: a
 * Khmer-locale employee got a fully translated heading above a canvas reading
 * "7:58AM", "4h 3m" and "Day off", in Latin digits — the only numbers on the
 * screen that say when they arrived and left.
 *
 * Injected rather than read from a hook, because this module is imported by
 * HR's surfaces too and they have no locale provider. The default below IS the
 * previous behaviour, so a caller that passes nothing renders exactly what it
 * rendered before; the Mini App is the only caller that supplies its own.
 *
 * The Mini App's implementations come from `useFormat()`/`useT()`, which route
 * digits through `toKhmerDigits` and day periods through `khmerDayPeriod` —
 * the policy argued out in miniIntl.ts, applied here rather than re-decided.
 */
import { format } from "date-fns";

import { formatDurationMinutes, parseDateTimeLocal } from "@/lib/attendanceTime";
import { hourLabel } from "@/lib/timelineAxis";

/** Every word the timeline puts on screen or into a tooltip. */
export type TimelineLabelKey =
  | "lunch"
  | "away"
  | "observed"
  | "scheduled"
  | "missingExpected"
  | "holiday"
  | "weeklyOff"
  | "inTransit"
  | "roguePunch"
  | "unpairedPunch"
  | "offShiftPunch"
  | "late"
  | "segment";

const ENGLISH: Record<TimelineLabelKey, string> = {
  lunch: "Lunch",
  away: "Away",
  observed: "observed",
  scheduled: "Scheduled",
  missingExpected: "Missing expected",
  holiday: "Holiday",
  weeklyOff: "Weekly off",
  inTransit: "Punches may still be in transit",
  roguePunch: "Rogue punch",
  unpairedPunch: "Unpaired punch",
  offShiftPunch: "Off-shift punch",
  late: "Late",
  segment: "Segment",
};

export type TimelineIntl = {
  /** One punch's wall-clock time, from the API's datetime string. */
  punch: (value: string | null | undefined) => string;
  /** A duration in hours and minutes. */
  duration: (minutes: number | null | undefined) => string;
  /** An hour tick on the axis: "7 AM", or "៧ ព្រឹក". */
  hour: (minuteOfDay: number) => string;
  /** One of the timeline's own words. */
  label: (key: TimelineLabelKey) => string;
};

export const DEFAULT_TIMELINE_INTL: TimelineIntl = {
  punch: (value) => (value ? format(parseDateTimeLocal(value), "h:mma") : "—"),
  duration: (minutes) => (minutes == null ? "—" : formatDurationMinutes(minutes)),
  hour: (minuteOfDay) => hourLabel(minuteOfDay),
  label: (key) => ENGLISH[key],
};
