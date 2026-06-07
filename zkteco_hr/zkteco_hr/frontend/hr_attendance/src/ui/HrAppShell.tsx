import type { ComponentType } from "react";
import { CalendarDaysIcon, CalendarRangeIcon, FlagIcon, LayoutGridIcon } from "lucide-react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";

import { useCalendarSession } from "@/hooks/useCalendarSession";
import { defaultHrAccessContext, type HrAccessOutletContext } from "@/lib/hrAccess";
import { cn } from "@/lib/utils";

const APP_LOGO = "/assets/zkteco_hr/images/attendance-svgrepo-com.svg";
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
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto flex h-10 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link
            to={tabHref("attendance", employee)}
            className="flex min-w-0 shrink-0 items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <img
              src={APP_LOGO}
              alt=""
              className="size-6 shrink-0 rounded-sm"
              width={24}
              height={24}
            />
            <span className="hidden truncate sm:inline">ZKTeco HR</span>
          </Link>

          <nav
            className="flex min-w-0 flex-1 items-center justify-center gap-0.5"
            aria-label="ZKTeco HR sections"
          >
            <ShellTab
              to={tabHref("attendance", employee)}
              active={tab === "attendance"}
              label={hrStaff ? "Attendance" : "My calendar"}
              icon={CalendarDaysIcon}
            />
            {hrStaff ? (
              <ShellTab
                to={tabHref("schedule", employee)}
                active={tab === "schedule"}
                label="Weekly Schedule"
                shortLabel="Schedule"
                icon={CalendarRangeIcon}
              />
            ) : null}
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {hrStaff ? <DeskLink href={FLAGS_INBOX_URL} label="Flags" icon={FlagIcon} /> : null}
            <DeskLink href={DESK_URL} label="Desk" icon={LayoutGridIcon} />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}

function ShellTab(props: {
  to: string;
  active: boolean;
  label: string;
  shortLabel?: string;
  icon: ComponentType<{ className?: string }>;
}) {
  const Icon = props.icon;

  return (
    <Link
      to={props.to}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
        props.active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
      aria-current={props.active ? "page" : undefined}
    >
      <Icon className="size-3.5 shrink-0 opacity-80" />
      {props.shortLabel ? (
        <>
          <span className="sm:hidden">{props.shortLabel}</span>
          <span className="hidden sm:inline">{props.label}</span>
        </>
      ) : (
        <span>{props.label}</span>
      )}
    </Link>
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
