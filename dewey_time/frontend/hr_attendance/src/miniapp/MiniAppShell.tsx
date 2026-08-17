import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { cn } from "@/lib/utils";
import { MyDayPage } from "@/miniapp/MyDayPage";
import { MySchedulePage } from "@/miniapp/MySchedulePage";
import { MyWeekPage } from "@/miniapp/MyWeekPage";
import { MiniIdentity } from "@/miniapp/MiniIdentity";
import { MiniLocaleProvider, useT } from "@/miniapp/MiniLocale";
import {
  isLocale, LOCALE_LABEL, otherLocale, resolveLocale,
  type Locale, type StringKey,
} from "@/miniapp/miniStrings";
import {
  isInsideTelegram,
  telegramLanguageCode,
  telegramPhotoUrl,
  useMiniAppCalendar,
} from "@/miniapp/useMiniAppSession";
import {
  addToHomeScreen,
  bindBackButton,
  bottomInset,
  homeScreenStatus,
  loadLastTab,
  loadLocale,
  onResume,
  onViewportChange,
  openHaptic,
  saveLastTab,
  saveLocale,
  tabHaptic,
  topInset,
  type HomeScreenStatus,
} from "@/miniapp/telegramChrome";

export type MiniTab = "day" | "week" | "schedule";

/** Guards what comes back out of CloudStorage — it is data, not a promise. */
export function isMiniTab(value: string): value is MiniTab {
  return value === "day" || value === "week" || value === "schedule";
}

const TABS = [
  { key: "day", label: "tabToday" },
  { key: "week", label: "tabWeek" },
  { key: "schedule", label: "tabSchedule" },
] as const satisfies readonly { key: MiniTab; label: StringKey }[];

export function OutsideTelegramNotice() {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-foreground">{t("openFromTelegram")}</p>
      <p className="text-xs text-muted-foreground">
        {t("openFromTelegramBody")}
      </p>
    </div>
  );
}

export function MiniTabBar(props: {
  active: MiniTab;
  onSelect: (tab: MiniTab) => void;
  /** Safe-area padding in px. A prop, not a `window` read inside the render:
   *  reading a global while rendering breaks anywhere there is no window, and
   *  it made this component unrenderable in tests. The shell owns the read. */
  insetBottom?: number;
}) {
  const t = useT();
  return (
    // Inline style, not a class: the value is only known at runtime. Without
    // it the tab bar sits under the home indicator on a notched phone — the
    // bottom row of buttons being the exact thing that gets covered.
    <nav
      className="flex shrink-0 border-t border-border bg-background"
      style={{ paddingBottom: props.insetBottom ?? 0 }}
    >
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => props.onSelect(tab.key)}
          aria-current={props.active === tab.key ? "page" : undefined}
          className={cn(
            "flex-1 py-3 text-sm font-medium transition-colors",
            props.active === tab.key
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(tab.label)}
        </button>
      ))}
    </nav>
  );
}

export function MiniAppShell() {
  const [tab, setTab] = useState<MiniTab>("day");
  /** Which week the Week tab is showing, relative to today's. */
  const [weekOffset, setWeekOffset] = useState(0);
  /** A day drilled into from the week list. Null means "today". */
  const [openDay, setOpenDay] = useState<Date | null>(null);

  // Insets are held in state and refreshed on Telegram's own events. Read once
  // at mount they are whatever they were before the sheet was dragged or the
  // device rotated, which is how a tab bar ends up back under the home
  // indicator halfway through a session.
  const [insets, setInsets] = useState(() => ({
    top: topInset(window),
    bottom: bottomInset(window),
  }));
  useEffect(
    () =>
      onViewportChange(window, () =>
        setInsets({ top: topInset(window), bottom: bottomInset(window) }),
      ),
    [],
  );

  // Reopen on the tab they left. Applied ONLY while nothing has been touched:
  // the read resolves asynchronously, so a slow CloudStorage round trip would
  // otherwise yank the screen away from a tab the reader had already chosen.
  const touched = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void loadLastTab(window, isMiniTab).then((saved) => {
      if (cancelled || touched.current || !saved || !isMiniTab(saved)) return;
      setTab(saved);
    });
    return () => { cancelled = true; };
  }, []);

  // A Mini App is minimised, not closed, and comes back holding whatever it
  // loaded. For attendance that is actively wrong -- the commonest use is
  // checking a punch that just happened.
  const queryClient = useQueryClient();
  useEffect(
    () => onResume(window, document, () => {
      void queryClient.invalidateQueries({ queryKey: ["mini-calendar"] });
    }),
    [queryClient],
  );

  // Opens in the client's language, unless they have chosen otherwise once.
  const [locale, setLocale] = useState<Locale>(() =>
    resolveLocale(null, telegramLanguageCode(window)),
  );
  const localeTouched = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void loadLocale(window, isLocale).then((saved) => {
      if (cancelled || localeTouched.current || !saved || !isLocale(saved)) return;
      setLocale(saved);
    });
    return () => { cancelled = true; };
  }, []);
  const toggleLocale = useCallback(() => {
    localeTouched.current = true;
    setLocale((current) => {
      const next = otherLocale(current);
      saveLocale(window, next);
      return next;
    });
  }, []);

  const [homeScreen, setHomeScreen] = useState<HomeScreenStatus>("unsupported");
  useEffect(() => {
    let cancelled = false;
    void homeScreenStatus(window).then((status) => {
      if (!cancelled) setHomeScreen(status);
    });
    return () => { cancelled = true; };
  }, []);

  const closeDay = useCallback(() => setOpenDay(null), []);
  // Telegram's own back button, shown only while a specific day is open. The
  // teardown hides it, so switching tabs while drilled in cannot strand a
  // visible arrow that no longer does anything.
  useEffect(() => bindBackButton(window, openDay !== null, closeDay), [openDay, closeDay]);

  const selectTab = useCallback((next: MiniTab) => {
    touched.current = true;
    tabHaptic(window);
    // Leaving the drill-in behind. Tapping "Today" while Thursday is open
    // must show today, not Thursday under a heading that says otherwise.
    setOpenDay(null);
    setTab(next);
    saveLastTab(window, next);
  }, []);

  const openDayFrom = useCallback((date: Date) => {
    touched.current = true;
    // A heavier tick than a tab change: this opens something rather than
    // switching between peers, and Telegram's own UI makes that distinction.
    openHaptic(window);
    setOpenDay(date);
    setTab("day");
  }, []);

  // Today's one-day range, which is the SAME query key the Day tab uses, so on
  // that tab this costs nothing and everywhere else it costs one narrow
  // request. The identity has to outlive the tab — a header that appeared and
  // vanished as tabs changed would be the opposite of a stable confirmation.
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const identity = useMiniAppCalendar(todayKey, todayKey);

  // Not a security check -- the server re-verifies every request. This is so a
  // page opened in a plain browser explains itself instead of firing an
  // unauthenticated call and rendering a permission error.
  if (!isInsideTelegram()) {
    return (
      <MiniLocaleProvider locale={locale}>
        <OutsideTelegramNotice />
      </MiniLocaleProvider>
    );
  }

  return (
    <MiniLocaleProvider locale={locale}>
    {/* Telegram's own viewport variable rather than dvh. Inside the webview
        the sheet is not the visual viewport, so dvh overshoots and pushes the
        tab bar off-screen; --tg-viewport-stable-height is the height Telegram
        says is actually stable. dvh stays as the fallback for a plain
        browser. */}
    <div
      className="flex w-full flex-col"
      style={{
        height: "var(--tg-viewport-stable-height, 100dvh)",
        // The top inset is Telegram's header and the device's notch. Without
        // it the first heading sits under the client's own chrome in
        // fullscreen mode — the overlap the design guidelines call out.
        paddingTop: insets.top,
      }}
    >
      {/* Rendered only once there is a real answer. A placeholder row saying
          "Your record" over an empty name is a confirmation of nothing, and
          this header's whole job is to be trustworthy at a glance. */}
      {identity.data ? (
        <MiniIdentity
          employee={identity.data.employee}
          employeeName={identity.data.employee_name}
          khmerName={identity.data.khmer_name}
          designation={identity.data.designation}
          branch={identity.data.employee_branch}
          imageUrl={identity.data.image}
          photoUrl={telegramPhotoUrl(window)}
          // Labelled in the language it switches TO, never in the current
          // one: someone stuck in a language they cannot read needs the way
          // out to be the thing they CAN read.
          localeLabel={LOCALE_LABEL[otherLocale(locale)]}
          onToggleLocale={toggleLocale}
        />
      ) : null}

      {/* pb-6 on the SCROLL CONTAINER, not on the pages inside it. A Telegram
          sheet is frequently half the screen, and at that height the last row
          of the week or the roster was sliced horizontally by the tab bar's
          top border — cut mid-row, with nothing to say more existed below.
          Padding here scrolls clear of the bar on every tab at once, and a
          page that fits gains a margin rather than a hairline. */}
      <main className="min-h-0 flex-1 overflow-y-auto pb-6">
        {tab === "day" ? (
          <MyDayPage date={openDay ?? undefined} />
        ) : tab === "week" ? (
          <MyWeekPage
            offset={weekOffset}
            onOffsetChange={setWeekOffset}
            onOpenDay={openDayFrom}
          />
        ) : (
          <MySchedulePage />
        )}
      </main>
      {/* Offered only where Telegram says it is possible AND not already
          done. An employee opens this most working days, and the alternative
          is finding the bot in a chat list first. `unknown` counts as
          offerable: the client supports it but cannot tell whether the icon
          exists, and a duplicate is a far smaller cost than never offering. */}
      {homeScreen === "missed" || homeScreen === "unknown" ? (
        <button
          type="button"
          onClick={() => {
            openHaptic(window);
            addToHomeScreen(window);
            // Optimistic, and one-way: whether it worked is not reliably
            // reported, and re-offering after a tap reads as the button
            // having failed.
            setHomeScreen("added");
          }}
          className="shrink-0 border-t border-border bg-card px-3 py-2 text-left text-[11px] text-muted-foreground"
        >
          Add <span className="font-medium text-foreground">My Attendance</span> to your home screen
        </button>
      ) : null}

      <MiniTabBar active={tab} onSelect={selectTab} insetBottom={insets.bottom} />
    </div>
    </MiniLocaleProvider>
  );
}
