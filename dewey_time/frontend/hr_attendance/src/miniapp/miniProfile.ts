/**
 * The Profile tab's facts, as pure functions.
 *
 * No React, no locale, no `window` — everything here is (data) -> data, so it
 * is testable without a DOM and cannot format a date in the wrong language by
 * accident. Words are `StringKey`s the caller looks up; formatting lives in
 * miniIntl, beside the other locale-aware formatters.
 */
import { totalWorkedMinutes, wasWorked } from "@/miniapp/miniDay";
import { flagCount } from "@/miniapp/miniFlags";
import type { StringKey } from "@/miniapp/miniStrings";
import type { Day } from "@/types/calendar";

export type BiometricState = "enrolled" | "not_enrolled" | "unknown";

export type Biometric = {
  state: BiometricState;
  /** Slugs from finger_slots.py. Empty until the bridge sends finger_id. */
  fingers: string[];
  fingerprint_count: number;
  face: boolean;
  checked_at?: string | null;
};

/**
 * The client half of the finger allowlist.
 *
 * The server (`finger_slots.FINGER_SLUGS`) decides what a device index means;
 * this decides what the words are. `miniProfile.test.ts` reads that Python and
 * keeps the two in step, because a comment asking the next editor to do it is
 * not a guard.
 */
const FINGER_TEXT: Record<string, StringKey> = {
  left_little: "fingerLeftLittle",
  left_ring: "fingerLeftRing",
  left_middle: "fingerLeftMiddle",
  left_index: "fingerLeftIndex",
  left_thumb: "fingerLeftThumb",
  right_thumb: "fingerRightThumb",
  right_index: "fingerRightIndex",
  right_middle: "fingerRightMiddle",
  right_ring: "fingerRightRing",
  right_little: "fingerRightLittle",
  other_finger: "fingerOther",
};

export const KNOWN_FINGER_SLUGS = Object.keys(FINGER_TEXT);

/**
 * The named fingers, or null when a number is the only honest answer.
 *
 * Names are shown ONLY when they account for every template. Two names beside
 * a count of three states something false about the third, and there is no way
 * to render "and one more" that does not read as a bug.
 *
 * Null is the ORDINARY case today: the bridge collapses templates to a count
 * before Frappe ever sees them, so `fingers` is empty for everyone.
 */
export function fingerKeys(bio: Biometric | undefined): StringKey[] | null {
  const fingers = bio?.fingers ?? [];
  if (!fingers.length) return null;
  if (fingers.length !== bio?.fingerprint_count) return null;
  return fingers.map((slug) => FINGER_TEXT[slug] ?? "fingerOther");
}

export function biometricStateKey(state: BiometricState): StringKey {
  if (state === "enrolled") return "bioEnrolled";
  if (state === "not_enrolled") return "bioNotEnrolled";
  return "bioUnknown";
}

/** The line under the state, for the two states that need explaining. */
export function biometricBodyKey(state: BiometricState): StringKey | null {
  if (state === "not_enrolled") return "bioNotEnrolledBody";
  if (state === "unknown") return "bioUnknownBody";
  return null;
}

/**
 * "2024-03-12" at LOCAL midnight.
 *
 * `new Date("2024-03-12")` is parsed as UTC, and east of Greenwich that is the
 * 11th locally — a joining date off by one, and a service length that ticks
 * over a day early. The e2e suite hit the same trap building day keys.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whole years and months since joining. Null when unknown or in the future. */
export function serviceLength(
  joined: string | null | undefined,
  today: Date,
): { years: number; months: number } | null {
  const start = parseDateOnly(joined);
  if (!start || start > today) return null;
  let months =
    (today.getFullYear() - start.getFullYear()) * 12 +
    (today.getMonth() - start.getMonth());
  // Not there yet this month: the 18th to the 17th is eleven months, not one.
  if (today.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export type MonthStats = {
  daysWorked: number;
  /** Null when nothing is known, which `fmt.worked` renders as a dash. */
  minutes: number | null;
  flags: number;
};

/**
 * The month's three numbers, from days already fetched.
 *
 * `flagCount` rather than `day.flags.length`: it is the same function behind
 * the Today tab's pill, so this number and that one cannot disagree about how
 * many flags an employee has — which is exactly how the HR flag-queue header
 * once ended up contradicting the rows beneath it.
 */
export function monthStats(days: Day[], today: Date): MonthStats {
  return {
    // `wasWorked`, not tone: a leave or holiday day somebody actually came in
    // and punched is a day they worked, and it is exactly the day they will
    // check this number against.
    daysWorked: days.filter((day) => wasWorked(day)).length,
    minutes: totalWorkedMinutes(days),
    flags: days.reduce((sum, day) => sum + flagCount(day), 0),
  };
}
