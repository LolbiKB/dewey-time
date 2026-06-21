import type { ComponentProps, ComponentType } from "react";
import { CalendarDaysIcon, CalendarRangeIcon, FlagIcon, LayoutGridIcon } from "lucide-react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { AppShell } from "@lolbikb/dewey-ui";

import { useCalendarSession } from "@/hooks/useCalendarSession";
import { DeweyTimeLockup } from "@/brand/DeweyTimeLockup";
import { defaultHrAccessContext, type HrAccessOutletContext } from "@/lib/hrAccess";
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

  const outletContext: HrAccessOutletContext = sessionLoading
    ? defaultHrAccessContext
    : { hrStaff, sessionLoading: false };

  return (
    <AppShell
      navMode={{
        type: "tabs",
        "aria-label": "ZKTeco HR sections",
        tabs: [
          {
            label: hrStaff ? "Attendance" : "My calendar",
            href: tabHref("attendance", employee),
            active: tab === "attendance",
            icon: CalendarDaysIcon,
          },
          ...(hrStaff
            ? [
                {
                  label: "Weekly Schedule",
                  shortLabel: "Schedule",
                  href: tabHref("schedule", employee),
                  active: tab === "schedule",
                  icon: CalendarRangeIcon,
                },
              ]
            : []),
        ],
      }}
      logo={<DeweyTimeLockup />}
      homeHref={tabHref("attendance", employee)}
      linkComponent={RouterLink}
      headerEnd={
        <>
          {hrStaff ? <DeskLink href={FLAGS_INBOX_URL} label="Flags" icon={FlagIcon} /> : null}
          <DeskLink href={DESK_URL} label="Desk" icon={LayoutGridIcon} />
        </>
      }
    >
      <Outlet context={outletContext} />
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
