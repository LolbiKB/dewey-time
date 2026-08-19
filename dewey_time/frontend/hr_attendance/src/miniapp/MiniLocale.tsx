/**
 * The current language, and the lookup bound to it.
 *
 * A context rather than a prop, because every leaf renders a word: threading
 * `t` through DaySummary, WeekRow, ScheduleRow, WeekNav and the tab bar would
 * be five signatures widened to carry the same value, and a component that
 * forgot it would silently stay English.
 *
 * Defaults to English with no provider, so anything rendered outside one — a
 * test, a stray usage — reads normally instead of throwing.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  digitsFor,
  formatClockMinute,
  formatClockSpan,
  formatIn,
  formatPunchTime,
  formatServiceLength,
  formatWorkedMinutes,
  formatHourTick,
  formatPunchCompact,
} from "@/miniapp/miniIntl";
import { translator, type Locale, type Translate } from "@/miniapp/miniStrings";

const LocaleContext = createContext<{ locale: Locale; t: Translate }>({
  locale: "en",
  t: translator("en"),
});

export function MiniLocaleProvider(props: { locale: Locale; children: ReactNode }) {
  const value = useMemo(
    () => ({ locale: props.locale, t: translator(props.locale) }),
    [props.locale],
  );
  return <LocaleContext.Provider value={value}>{props.children}</LocaleContext.Provider>;
}

export function useT(): Translate {
  return useContext(LocaleContext).t;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

/**
 * The formatters, already bound to the current language.
 *
 * A hook rather than free functions taking a locale, because the locale
 * argument is exactly the thing a component forgets — and forgetting it fails
 * SILENTLY, printing "17 August" in the middle of a Khmer screen rather than
 * throwing. Binding it once here means the only way to format a date in this
 * app is to have the locale already applied.
 */
export type MiniFormat = {
  /** date-fns `format`, in the reader's language and script. */
  date: (date: Date, pattern: string) => string;
  /** A minute-of-day as a clock time. */
  clock: (minutes: number | null | undefined) => string | null;
  /** One hour tick on a timeline axis, compact: "7 AM" / "៧ ព្រឹក". */
  hour: (minuteOfDay: number) => string;
  /** Two minute-of-day values as "8:00 AM – 5:00 PM". */
  span: (startMin: number | null | undefined, endMin: number | null | undefined) => string | null;
  /** One punch's wall-clock time, from the API's datetime string. */
  punch: (value: string | null | undefined) => string | null;
  /** The same, tightened for the timeline canvas. See formatPunchCompact. */
  punchCompact: (value: string | null | undefined) => string | null;
  /** A duration in hours and minutes, with the units in the reader's language. */
  worked: (minutes: number | null | undefined) => string | null;
  /** Latin digits to the reader's script, for a string formatted elsewhere. */
  digits: (text: string) => string;
  /** Length of service, in the reader's language. */
  service: (service: { years: number; months: number } | null) => string | null;
};

export function useFormat(): MiniFormat {
  const { locale, t } = useContext(LocaleContext);
  return useMemo(
    () => ({
      date: (date, pattern) => formatIn(locale, date, pattern),
      clock: (minutes) => formatClockMinute(locale, minutes),
      hour: (minuteOfDay) => formatHourTick(locale, minuteOfDay),
      span: (startMin, endMin) => formatClockSpan(locale, startMin, endMin),
      punch: (value) => formatPunchTime(locale, value),
      punchCompact: (value) => formatPunchCompact(locale, value),
      worked: (minutes) =>
        formatWorkedMinutes(locale, minutes, { hour: t("unitHour"), minute: t("unitMinute") }),
      digits: digitsFor(locale),
      service: (service) =>
        formatServiceLength(locale, service, {
          year: t("unitYear"),
          month: t("unitMonth"),
        }),
    }),
    [locale, t],
  );
}
