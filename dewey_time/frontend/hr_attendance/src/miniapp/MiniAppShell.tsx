import { useState } from "react";

import { cn } from "@/lib/utils";
import { MyDayPage } from "@/miniapp/MyDayPage";
import { MySchedulePage } from "@/miniapp/MySchedulePage";
import { MyWeekPage } from "@/miniapp/MyWeekPage";
import { isInsideTelegram } from "@/miniapp/useMiniAppSession";

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

export function MiniTabBar(props: { active: MiniTab; onSelect: (tab: MiniTab) => void }) {
  return (
    <nav className="flex shrink-0 border-t border-border bg-background">
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

  // Not a security check -- the server re-verifies every request. This is so a
  // page opened in a plain browser explains itself instead of firing an
  // unauthenticated call and rendering a permission error.
  if (!isInsideTelegram()) return <OutsideTelegramNotice />;

  return (
    <div className="flex h-dvh w-full flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "day" ? (
          <MyDayPage />
        ) : tab === "week" ? (
          <MyWeekPage />
        ) : (
          <MySchedulePage />
        )}
      </main>
      <MiniTabBar active={tab} onSelect={setTab} />
    </div>
  );
}
