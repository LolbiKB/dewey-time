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
