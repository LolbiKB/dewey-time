import { useEffect, type ComponentProps, type ComponentType } from "react";
import { CalendarDaysIcon, CalendarRangeIcon, FlagIcon, LayoutGridIcon } from "lucide-react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { AppShell } from "@lolbikb/dewey-ui";

import { useCalendarSession } from "@/hooks/useCalendarSession";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DeweyTimeLockup } from "@/brand/DeweyTimeLockup";
import { InstallButton } from "@/pwa/InstallButton";
import { NotificationsButton } from "@/pwa/NotificationsButton";
import { rebindPush, refreshBadgeFromPage } from "@/pwa/push";
import { MobileTabBar, type MobileTab } from "@/ui/MobileTabBar";
import { defaultHrAccessContext, type HrAccessOutletContext } from "@/lib/hrAccess";
import { cn } from "@/lib/utils";
const DESK_URL = "/desk";
const FLAGS_INBOX_URL = "/app/attendance-flag";

type AppTab = "attendance" | "schedule";

function activeTab(pathname: string): AppTab {
  return pathname.startsWith("/hr-schedule") ? "schedule" : "attendance";
}

function tabHref(tab: AppTab, employee: string | null): string {
  const base = tab === "schedule" ? "/hr-schedule" : "/hr-attendance";
  return employee ? `${base}?employee=${encodeURIComponent(employee)}` : base;
}

// AppShell is router-agnostic; adapt react-router's Link to its href contract.
const RouterLink = ({ href, ...props }: ComponentProps<"a"> & { href: string }) => (
  <Link to={href} {...props} />
);

export function HrAppShell() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const employee = searchParams.get("employee");
  const tab = activeTab(pathname);
  const { hrStaff, isLoading: sessionLoading } = useCalendarSession();
  const isMobile = useIsMobile();

  // On load (= a fresh session): silently re-bind any existing push subscription
  // to the current user, and sync the app-icon badge. Both are best-effort no-ops
  // when push is unsupported or not yet opted into.
  useEffect(() => {
    rebindPush();
    refreshBadgeFromPage();
  }, []);

  const outletContext: HrAccessOutletContext = sessionLoading
    ? defaultHrAccessContext
    : { hrStaff, sessionLoading: false };

  const tabs: MobileTab[] = [
    {
      label: hrStaff ? "Attendance" : "My calendar",
      href: tabHref("attendance", employee),
      active: tab === "attendance",
      icon: CalendarDaysIcon,
    },
    ...(hrStaff
      ? [
          {
            label: "Schedule",
            href: tabHref("schedule", employee),
            active: tab === "schedule",
            icon: CalendarRangeIcon,
          },
        ]
      : []),
  ];

  // Phone (< md) gets a fixed bottom tab-bar instead of the top strip — but only
  // when there's more than one destination to switch between.
  const showBottomNav = tabs.length >= 2;
  const topTabs = isMobile && showBottomNav ? [] : tabs;

  return (
    <AppShell
      navMode={{ type: "tabs", "aria-label": "ZKTeco HR sections", tabs: topTabs }}
      logo={<DeweyTimeLockup />}
      homeHref={tabHref("attendance", employee)}
      linkComponent={RouterLink}
      headerEnd={
        <>
          <NotificationsButton />
          <InstallButton />
          {hrStaff ? <DeskLink href={FLAGS_INBOX_URL} label="Flags" icon={FlagIcon} /> : null}
          <DeskLink href={DESK_URL} label="Desk" icon={LayoutGridIcon} />
        </>
      }
    >
      {/* dewey-ui's content slot (`min-h-0 flex-1 overflow-hidden`) is a definite-height
          block that hands its full height to its DIRECT child; the screens fill it with
          an `h-full` root. This wrapper sits in between, so it must pass that height
          through (`h-full`) — otherwise it collapses to content height and the week grid /
          shift-blocks cards stop flexing to fill (on desktop too: the wrapper is always
          rendered). `flex min-h-0 flex-col` makes it a proper column passthrough. The
          bottom-nav padding is the only conditional part — it reserves room for the fixed
          MobileTabBar on phones (md:pb-0 drops it where the top tabs are used). */}
      <div
        className={cn(
          "flex h-full min-h-0 flex-col",
          showBottomNav && "pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0",
        )}
      >
        <Outlet context={outletContext} />
      </div>
      {showBottomNav && <MobileTabBar items={tabs} />}
    </AppShell>
  );
}

function DeskLink(props: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}) {
  const Icon = props.icon;

  return (
    <a
      href={props.href}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:px-2.5 sm:text-sm"
    >
      <Icon className="size-3.5 shrink-0 opacity-80" />
      <span className="hidden sm:inline">{props.label}</span>
    </a>
  );
}
