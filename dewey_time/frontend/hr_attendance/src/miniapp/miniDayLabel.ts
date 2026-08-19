/**
 * What a screen reader hears when it reaches the Day tab's canvas.
 *
 * `dayCellAccessibleName` builds HR's version, in English, from English
 * fragments joined by English commas — "Wednesday 19 August, worked 7:58 AM –
 * 5:06 PM, 8h 3m, 1 flag". Because it is an `aria-label`, it REPLACES
 * everything inside the element, so a Khmer reader using a screen reader heard
 * that sentence and never heard the Khmer punch times the canvas draws.
 *
 * Pure, so it can be tested without a DOM: the caller supplies the translator
 * and the formatters it already holds.
 */
import { dayFacts, netWorkedFor, wasWorked } from "@/miniapp/miniDay";
import type { MiniFormat } from "@/miniapp/MiniLocale";
import type { StringKey } from "@/miniapp/miniStrings";
import type { Day } from "@/types/calendar";

export function miniDayAccessibleName(
  day: Day | undefined,
  date: Date,
  today: Date,
  words: { t: (key: StringKey) => string; fmt: MiniFormat },
  flags = 0,
): string {
  const { t, fmt } = words;
  const facts = dayFacts(day, date, today);
  const parts: string[] = [fmt.date(date, "EEEE d MMMM")];

  // The day's own word, in the reader's language. `noteKey` is exactly the key
  // the visible chip uses, so the two cannot describe the same day differently.
  if (facts.noteKey) parts.push(t(facts.noteKey));

  // The punch times themselves — the thing the canvas is FOR, and the part the
  // English label silently replaced.
  if (facts.firstInAt || facts.lastOutAt) {
    const from = fmt.punch(facts.firstInAt);
    const to = fmt.punch(facts.lastOutAt);
    if (from && to) parts.push(`${from} – ${to}`);
    else if (from) parts.push(from);
  }

  // Hours punched, including on a leave or holiday day, where `facts` reports
  // none by design. Same rule as the month total: tone governs wording, not
  // arithmetic.
  if (wasWorked(day)) {
    // `netWorkedFor`, NOT `facts.workedMinutes`: the latter is null on exactly
    // the leave and holiday days this branch exists to cover.
    const worked = fmt.worked(netWorkedFor(day));
    if (worked) parts.push(worked);
  }

  // The same template the visible flags button renders, so the two cannot
  // disagree about the count or its wording.
  if (flags > 0) parts.push(t("flagsToCheck").replace("{n}", fmt.digits(String(flags))));

  return parts.join(", ");
}
