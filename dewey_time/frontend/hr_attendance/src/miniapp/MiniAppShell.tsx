import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

import { cn } from "@/lib/utils";
import { MyDayPage } from "@/miniapp/MyDayPage";
import { MySchedulePage } from "@/miniapp/MySchedulePage";
import { MyWeekPage } from "@/miniapp/MyWeekPage";
import { MiniIdentity } from "@/miniapp/MiniIdentity";
import {
  isInsideTelegram,
  telegramPhotoUrl,
  useMiniAppCalendar,
} from "@/miniapp/useMiniAppSession";
import {
  bindBackButton,
  bottomInset,
  onViewportChange,
  tabHaptic,
  topInset,
} from "@/miniapp/telegramChrome";

export type MiniTab = "day" | "week" | "schedule";

const TABS: { key: MiniTab; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "Week" },
  { key: "schedule", label: "Schedule" },
];

export function OutsideTelegramNotice() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-foreground">Open this from Telegram</p>
      <p className="text-xs text-muted-foreground">
        Your attendance is only available through the Dewey Time bot.
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
          {tab.label}
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

  const closeDay = useCallback(() => setOpenDay(null), []);
  // Telegram's own back button, shown only while a specific day is open. The
  // teardown hides it, so switching tabs while drilled in cannot strand a
  // visible arrow that no longer does anything.
  useEffect(() => bindBackButton(window, openDay !== null, closeDay), [openDay, closeDay]);

  const selectTab = useCallback((next: MiniTab) => {
    tabHaptic(window);
    // Leaving the drill-in behind. Tapping "Today" while Thursday is open
    // must show today, not Thursday under a heading that says otherwise.
    setOpenDay(null);
    setTab(next);
  }, []);

  const openDayFrom = useCallback((date: Date) => {
    tabHaptic(window);
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
  if (!isInsideTelegram()) return <OutsideTelegramNotice />;

  return (
    // Telegram's own viewport variable rather than dvh. Inside the webview
    // the sheet is not the visual viewport, so dvh overshoots and pushes the
    // tab bar off-screen; --tg-viewport-stable-height is the height Telegram
    // says is actually stable. dvh stays as the fallback for a plain browser.
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
          photoUrl={telegramPhotoUrl(window)}
        />
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto">
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
      <MiniTabBar active={tab} onSelect={selectTab} insetBottom={insets.bottom} />
    </div>
  );
}
