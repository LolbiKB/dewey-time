/**
 * The Mini App's words, in English and Khmer.
 *
 * A table rather than an i18n framework, deliberately. This surface is three
 * tabs and about thirty strings; a framework would add a build step, a loader
 * and a lazy-loading failure mode to a bundle that ships to phones on a
 * factory floor, and buy nothing this table does not already give.
 *
 * TRANSLATIONS NEED A NATIVE SPEAKER'S REVIEW BEFORE THEY REACH EMPLOYEES.
 * They are written to be literal and unambiguous rather than idiomatic, and
 * attendance wording is exactly where a near-miss does damage: "អវត្តមាន"
 * (absent) instead of "មិនមានកំណត់ត្រា" (no record) would have this app
 * accusing people of something HR has not decided. Every state here is
 * phrased as a RECORD, never as a judgement, and that property has to survive
 * review.
 *
 * Exhaustive by type: a key added to `en` and forgotten in `km` is a compile
 * error, not a screen that silently falls back to English for one label.
 */
export type Locale = "en" | "km";

export type StringKey = keyof typeof EN;

const EN = {
  // Tabs
  tabToday: "Today",
  tabWeek: "Week",
  tabSchedule: "Schedule",

  // Day states — records, never judgements. See the note above.
  stateWorked: "Worked",
  stateDayOff: "Day off",
  stateOnLeave: "On leave",
  stateHoliday: "Holiday",
  stateScheduled: "Scheduled",
  stateNoPunches: "No punches recorded",

  // Day summary
  labelIn: "In",
  labelOut: "Out",
  labelWorked: "Worked",
  labelRostered: "Rostered",
  labelLunch: "Lunch",
  lunchNotCounted: "not counted as worked",
  summary: "Summary",

  // Week / schedule
  thisWeek: "This week",
  previousWeek: "Previous week",
  nextWeek: "Next week",
  backToThisWeek: "Back to this week",
  workedThisWeek: "Worked this week, net of lunch",
  rosteredThisWeek: "Rostered this week, net of lunch",
  noShiftsThisWeek: "No shifts are assigned to you this week.",

  // Chrome
  yourRecord: "Your record",
  addToHomeScreen: "Add to your home screen",
  openFromTelegram: "Open this from Telegram",
  openFromTelegramBody: "Your attendance is only available through the Dewey Time bot.",

  // States
  loadingDay: "Loading your day…",
  loadingWeek: "Loading your week…",
  loadingSchedule: "Loading your schedule…",
  errorDay: "Couldn't load your day. Try again in a moment.",
  errorWeek: "Couldn't load your week. Try again in a moment.",
  errorSchedule: "Couldn't load your schedule. Try again in a moment.",
} as const;

const KM: Record<StringKey, string> = {
  tabToday: "ថ្ងៃនេះ",
  tabWeek: "សប្តាហ៍",
  tabSchedule: "កាលវិភាគ",

  stateWorked: "បានធ្វើការ",
  stateDayOff: "ថ្ងៃឈប់",
  stateOnLeave: "ច្បាប់ឈប់សម្រាក",
  stateHoliday: "ថ្ងៃបុណ្យ",
  stateScheduled: "មានកាលវិភាគ",
  // "No record of entry/exit" -- NOT "absent". The distinction is the whole
  // point; see the module note.
  stateNoPunches: "មិនមានកំណត់ត្រាចូល-ចេញ",

  labelIn: "ចូល",
  labelOut: "ចេញ",
  labelWorked: "បានធ្វើការ",
  labelRostered: "តាមកាលវិភាគ",
  labelLunch: "អាហារថ្ងៃត្រង់",
  lunchNotCounted: "មិនរាប់បញ្ចូលក្នុងម៉ោងធ្វើការ",
  summary: "សង្ខេប",

  thisWeek: "សប្តាហ៍នេះ",
  previousWeek: "សប្តាហ៍មុន",
  nextWeek: "សប្តាហ៍ក្រោយ",
  backToThisWeek: "ត្រឡប់ទៅសប្តាហ៍នេះ",
  workedThisWeek: "ម៉ោងធ្វើការសប្តាហ៍នេះ (ដកអាហារថ្ងៃត្រង់)",
  rosteredThisWeek: "ម៉ោងតាមកាលវិភាគសប្តាហ៍នេះ (ដកអាហារថ្ងៃត្រង់)",
  noShiftsThisWeek: "សប្តាហ៍នេះ អ្នកមិនមានវេនការងារទេ។",

  yourRecord: "កំណត់ត្រារបស់អ្នក",
  addToHomeScreen: "បន្ថែមទៅអេក្រង់ដើម",
  openFromTelegram: "សូមបើកពី Telegram",
  openFromTelegramBody: "កំណត់ត្រាវត្តមានរបស់អ្នកអាចមើលបានតែតាម Dewey Time bot ប៉ុណ្ណោះ។",

  loadingDay: "កំពុងផ្ទុក…",
  loadingWeek: "កំពុងផ្ទុក…",
  loadingSchedule: "កំពុងផ្ទុក…",
  errorDay: "មិនអាចផ្ទុកបានទេ។ សូមព្យាយាមម្ដងទៀត។",
  errorWeek: "មិនអាចផ្ទុកបានទេ។ សូមព្យាយាមម្ដងទៀត។",
  errorSchedule: "មិនអាចផ្ទុកបានទេ។ សូមព្យាយាមម្ដងទៀត។",
};

const TABLES: Record<Locale, Record<StringKey, string>> = { en: EN, km: KM };

/** A lookup bound to one locale. */
export type Translate = (key: StringKey) => string;

export function translator(locale: Locale): Translate {
  const table = TABLES[locale] ?? EN;
  // Falls back to English per key rather than per table: a string that somehow
  // arrives empty should show SOMETHING, and a blank label is indistinguishable
  // from a layout bug.
  return (key) => table[key] || EN[key];
}

/**
 * Which language to open in.
 *
 * Telegram's `language_code` is the client's own setting and comes from
 * `initDataUnsafe` — untrusted, and correctly so: nothing is authorised by it,
 * it only decides which column of a table is read. A saved preference wins,
 * because someone who has chosen once has said something more specific than
 * their phone's locale.
 *
 * Anything that is not Khmer opens in English. Guessing Khmer from a region or
 * a timezone would put an unreadable interface in front of the people least
 * able to report it.
 */
export function resolveLocale(saved: string | null, languageCode: string | undefined): Locale {
  if (saved === "en" || saved === "km") return saved;
  return (languageCode || "").toLowerCase().startsWith("km") ? "km" : "en";
}

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "km";
}

/** The other one, for a two-way toggle. */
export function otherLocale(locale: Locale): Locale {
  return locale === "km" ? "en" : "km";
}

/** How the toggle labels itself: always in the language it switches TO. */
export const LOCALE_LABEL: Record<Locale, string> = { en: "English", km: "ភាសាខ្មែរ" };
