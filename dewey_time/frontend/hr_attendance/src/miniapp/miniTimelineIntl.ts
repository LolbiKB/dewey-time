/**
 * The shared day timeline, speaking the reader's language.
 *
 * `DayCell` and `HourGutter` are HR's components, imported by the Mini App and
 * rendered under a fully translated heading — while printing "7:58AM",
 * "4h 3m", "Day off" and a Latin-digit hour axis. Those are the only numbers on
 * the Day tab that say when the person arrived and left, so the one screen a
 * Khmer reader opens every morning was half in a script they may not read.
 *
 * Nothing new is decided here. The digits, the day periods and the duration
 * units all come from `useFormat()`, which routes them through the policy
 * argued out in miniIntl.ts; the words come from the string table. This module
 * only assembles them into the shape `timelineIntl.ts` asks for.
 */
import { useMemo } from "react";

import { useFormat, useT } from "@/miniapp/MiniLocale";
import type { TimelineIntl, TimelineLabelKey } from "@/ui/timelineIntl";
import type { StringKey } from "@/miniapp/miniStrings";

/**
 * `lunch` and `holiday` reuse keys the app already had rather than adding a
 * second Khmer word for the same thing — two translations of one concept drift.
 */
const LABEL_KEYS: Record<TimelineLabelKey, StringKey> = {
  lunch: "labelLunch",
  away: "timelineAway",
  observed: "timelineObserved",
  scheduled: "timelineScheduled",
  missingExpected: "timelineMissingExpected",
  holiday: "stateHoliday",
  weeklyOff: "timelineWeeklyOff",
  inTransit: "timelineInTransit",
  roguePunch: "timelineRoguePunch",
  unpairedPunch: "timelineUnpairedPunch",
  offShiftPunch: "timelineOffShiftPunch",
  late: "timelineLate",
  segment: "timelineSegment",
};

export function useTimelineIntl(): TimelineIntl {
  const t = useT();
  const fmt = useFormat();
  return useMemo(
    () => ({
      // An em dash for a punch that has no time, matching the English default:
      // a missing value must not render as the word "null" or as a blank the
      // reader cannot distinguish from a layout bug.
      punch: (value) => fmt.punch(value) ?? "—",
      duration: (minutes) => fmt.worked(minutes) ?? "—",
      hour: (minuteOfDay) => fmt.hour(minuteOfDay),
      label: (key) => t(LABEL_KEYS[key]),
    }),
    [t, fmt],
  );
}
