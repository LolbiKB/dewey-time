import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, isSameDay } from "date-fns";

import { cn } from "@/lib/utils";
import { MiniCalendarSheet } from "@/miniapp/MiniCalendarSheet";
import { MyDayPage } from "@/miniapp/MyDayPage";
import { MyProfilePage } from "@/miniapp/MyProfilePage";
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
import { dismissTopLayer, useLayerDepth } from "@/miniapp/miniBackStack";
import { useSafeAreaInsets } from "@/miniapp/useSafeAreaInsets";
import {
  bindBackButton,
  loadLastTab,
  loadLocale,
  onResume,
  onViewportChange,
  safeAreaInsets,
  openHaptic,
  saveLastTab,
  saveLocale,
  tabHaptic,
} from "@/miniapp/telegramChrome";

export type MiniTab = "day" | "profile";

/** Guards what comes back out of CloudStorage — it is data, not a promise. */
export function isMiniTab(value: string): value is MiniTab {
  return value === "day" || value === "profile";
}

// TWO TABS, and both of the departed ones left for the same kind of reason.
//
// "Week" was replaced by the calendar sheet: it answered "which day do I
// want?" seven days at a time, for a whole tab of permanent chrome, and the
// month grid answers it at four times the density from inside the tab the
// reader is already on.
//
// "Schedule" was replaced by Profile. It answered "when am I working", which is
// one of several questions about an employee's own record and the only one the
// app could answer; Profile answers the rest — whether the fingerprint devices
// know them, what HR has on file — and keeps that roster whole at the bottom of
// itself, dated and still paging forward.
//
// A reader whose last session ended on either has a stale key in CloudStorage.
// Neither needs a migration — `isMiniTab` rejects an unknown value and the
// shell falls back to "day", which is the reason that guard exists.
const TABS = [
  { key: "day", label: "tabToday" },
  { key: "profile", label: "tabProfile" },
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

/**
 * Breathing room under the tab bar, on top of whatever the device asks for.
 *
 * The safe-area inset is a CLEARANCE, not a margin: it is exactly the strip
 * the home indicator occupies, so honouring it alone leaves the labels
 * touching the hardware. On a phone with no inset at all it leaves them
 * touching the bottom edge of the sheet. This is the gap that makes the bar
 * read as a bar rather than as the screen running out.
 */
export const TAB_BAR_FLOOR_PX = 12;

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
    // Inline style, not a class: the value is only known at runtime, and an
    // inline padding-bottom would override a Tailwind pb-* anyway. Without the
    // inset the tab bar sits under the home indicator on a notched phone — the
    // bottom row of buttons being the exact thing that gets covered.
    <nav
      className="flex shrink-0 border-t border-border bg-background"
      style={{ paddingBottom: (props.insetBottom ?? 0) + TAB_BAR_FLOOR_PX }}
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
  /** Which week the Profile tab's roster is showing, relative to today's. */
  const [weekOffset, setWeekOffset] = useState(0);
  /** A day chosen from the calendar. Null means "today". */
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Insets are held in state and refreshed on Telegram's own events. Read once
  // at mount they are whatever they were before the sheet was dragged or the
  // device rotated, which is how a tab bar ends up back under the home
  // indicator halfway through a session.
  const insets = useSafeAreaInsets();

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

  const closeDay = useCallback(() => setOpenDay(null), []);

  // Telegram's own back button, over a STACK rather than over one state.
  //
  // It used to be bound to the drill-in alone, so with a sheet open back left
  // the sheet exactly where it was and silently reset the date underneath it --
  // the one layer the reader could not see was the one that moved. Now the
  // topmost open layer goes first (flags sheet, then the date picker), and the
  // drill-in only when nothing is covering it.
  const layerDepth = useLayerDepth();
  const goBack = useCallback(() => {
    if (dismissTopLayer()) return;
    closeDay();
  }, [closeDay]);
  useEffect(
    () => bindBackButton(window, layerDepth > 0 || openDay !== null, goBack),
    [layerDepth, openDay, goBack],
  );

  // The DOCUMENT's language, not just the words. Without this the page stayed
  // `lang="en"` while every string on it turned Khmer, so a screen reader kept
  // reading Khmer text with an English voice -- which is unintelligible rather
  // than merely wrong. `hr-me.html` can only ship one value; this is the only
  // place that knows which language is actually on screen.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

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
    // Today clears the drill-in rather than setting it, so the heading reads
    // "Today" and not the date — picking today from the calendar and tapping
    // the Today tab must land in the same place.
    setOpenDay(isSameDay(date, new Date()) ? null : date);
    setTab("day");
    setPickerOpen(false);
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
        // ALL FOUR EDGES, and the top is the device's notch PLUS Telegram's
        // own header, which stack rather than overlap.
        //
        // The top-right is the one that bites: Telegram draws its close and
        // collapse controls in that corner, and this app puts the employee's
        // avatar row and the language toggle in exactly the same place. Under
        // the old `Math.max` the header cleared the notch and then sat
        // straight underneath those controls — a tap meant to switch language
        // closed the app instead.
        //
        // Left and right are not decoration either: a landscape phone puts
        // the notch on a side, and rounded corners clip a full-bleed row at
        // both. They were previously never read at all.
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
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
          <MyDayPage
            date={openDay ?? undefined}
            onPickDate={() => {
              openHaptic(window);
              setPickerOpen(true);
            }}
          />
        ) : (
          <MyProfilePage offset={weekOffset} onOffsetChange={setWeekOffset} />
        )}
      </main>

      <MiniCalendarSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={openDay ?? new Date()}
        onSelect={openDayFrom}
      />
      {/* NO "add to home screen" ROW. There was one, sitting between the
          content and the tab bar. It was a permanent strip of chrome offering
          a one-time action, on the shortest axis this app has, and Telegram
          cannot reliably say whether the icon already exists — so `unknown`
          re-offered it to people who had already done it, every launch. The
          bot's Main Mini App button and the chat menu button are both always
          there, which is the durable way back in. */}
      <MiniTabBar active={tab} onSelect={selectTab} insetBottom={insets.bottom} />
    </div>
    </MiniLocaleProvider>
  );
}
