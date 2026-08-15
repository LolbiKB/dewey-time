import { useState } from "react";

import { cn } from "@/lib/utils";
import { MyDayPage } from "@/miniapp/MyDayPage";
import { MySchedulePage } from "@/miniapp/MySchedulePage";
import { MyWeekPage } from "@/miniapp/MyWeekPage";
import { isInsideTelegram } from "@/miniapp/useMiniAppSession";
import { bottomInset, tabHaptic } from "@/miniapp/telegramChrome";

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
          onClick={() => {
            tabHaptic(window);
            props.onSelect(tab.key);
          }}
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
      style={{ height: "var(--tg-viewport-stable-height, 100dvh)" }}
    >
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "day" ? (
          <MyDayPage />
        ) : tab === "week" ? (
          <MyWeekPage />
        ) : (
          <MySchedulePage />
        )}
      </main>
      <MiniTabBar active={tab} onSelect={setTab} insetBottom={bottomInset(window)} />
    </div>
  );
}
