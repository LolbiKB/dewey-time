/**
 * What the engine noticed about a day, in words its subject can read.
 *
 * The wording rule is the one miniStrings and miniDayMark already follow: every
 * line here is a statement about the RECORD, never a verdict on the person.
 * "No record for this day" is a fact HR can still forgive; "unnotified absence"
 * is a claim this app has no standing to make — so UNNOTIFIED_ABSENCE maps to
 * the former.
 *
 * This table is also the client half of a two-sided allowlist. The server
 * (`miniapp_api.EMPLOYEE_FLAG_CODES`) decides what leaves the machine; a code
 * with no entry here renders nothing rather than an empty card, so the two
 * cannot drift into a blank row on somebody's phone. `miniFlags.test.ts` keeps
 * the lists in step.
 */
import type { Day, Flag } from "@/types/calendar";
import type { StringKey } from "@/miniapp/miniStrings";

const FLAG_TEXT: Record<string, { title: StringKey; body: StringKey }> = {
  LATE_START: { title: "flagLateStart", body: "flagLateStartBody" },
  LEFT_EARLY: { title: "flagLeftEarly", body: "flagLeftEarlyBody" },
  LATE_FROM_LUNCH: { title: "flagLateFromLunch", body: "flagLateFromLunchBody" },
  MISSING_TIME: { title: "flagMissingTime", body: "flagMissingTimeBody" },
  MISSING_IN_OR_OUT: { title: "flagMissingInOrOut", body: "flagMissingInOrOutBody" },
  UNNOTIFIED_ABSENCE: { title: "flagNoRecord", body: "flagNoRecordBody" },
  OFF_SHIFT_PUNCH: { title: "flagOffShiftPunch", body: "flagOffShiftPunchBody" },
  MISSING_LUNCH: { title: "flagMissingLunch", body: "flagMissingLunchBody" },
  ATTENDANCE_ISSUE: { title: "flagAttendanceIssue", body: "flagAttendanceIssueBody" },
};

export function flagText(flag: Flag): { title: StringKey; body: StringKey } | null {
  return FLAG_TEXT[flag.flag_code] ?? null;
}

/** The day's flags this app has words for, in payload order. */
export function visibleFlags(day: Day | undefined): Flag[] {
  return (day?.flags ?? []).filter((flag) => flag.flag_code in FLAG_TEXT);
}

/** ONE function behind both the pill's number and the sheet's rows. */
export function flagCount(day: Day | undefined): number {
  return visibleFlags(day).length;
}

/**
 * The line under each flag: where HR has got to with it.
 *
 * `needs_re_review` beats the outcome deliberately. It means the day changed
 * after HR decided, so the stored verdict describes a day that no longer
 * exists — showing "Excused by HR" then would be a promise the record cannot
 * keep.
 */
export function flagStatusKey(flag: Flag): StringKey {
  if (flag.decision_state === "needs_re_review") return "flagStatusRereview";
  const outcome = flag.decision?.outcome;
  if (outcome === "EXCUSED") return "flagStatusExcused";
  if (outcome === "UPHELD") return "flagStatusUpheld";
  return "flagStatusAwaiting";
}
