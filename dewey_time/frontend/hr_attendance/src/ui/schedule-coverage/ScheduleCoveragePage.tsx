import { useState } from "react";
import { ArrowLeftIcon, LayoutListIcon, UsersIcon } from "lucide-react";
import { Link, Navigate, useOutletContext } from "react-router-dom";

import { cn } from "@/lib/utils";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { useScheduleCoverage } from "@/hooks/useScheduleCoverage";
import { HoursBuckets } from "@/ui/schedule-coverage/HoursBuckets";
import { UnassignedList } from "@/ui/schedule-coverage/UnassignedList";

type View = "needs" | "hours";

export function ScheduleCoveragePage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const { unassigned, buckets, counts, isLoading, error } = useScheduleCoverage();
  const [chosenView, setChosenView] = useState<View | null>(null);

  if (sessionLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!hrStaff) {
    return <Navigate to="/hr-attendance" replace />;
  }

  // Auto-default to whichever view has something to show, until the user picks.
  const view: View = chosenView ?? (counts.unassigned > 0 ? "needs" : "hours");

  const tabs: { key: View; label: string; count: number; icon: typeof UsersIcon }[] = [
    { key: "needs", label: "Needs a schedule", count: counts.unassigned, icon: UsersIcon },
    { key: "hours", label: "Weekly hours", count: counts.assigned, icon: LayoutListIcon },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-border/60 px-5 py-3 sm:px-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5">
          <Link
            to="/hr-schedule"
            className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Weekly Schedule
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold tracking-tight">Schedule coverage</h1>
              <p className="text-xs text-muted-foreground">
                {counts.active} active · {counts.unassigned} need a schedule ·{" "}
                {counts.assigned} assigned
              </p>
              {counts.truncated ? (
                <p className="text-xs text-brand-accent">
                  Showing the first {counts.active} employees — more exist.
                </p>
              ) : null}
            </div>
          </div>

          {/* A view switcher, not document tabs — role=group + aria-pressed avoids the
              ARIA Tabs keyboard contract (arrow keys / tabpanel) we don't implement. */}
          <div
            role="group"
            aria-label="Coverage views"
            className="flex w-full gap-1 rounded-lg bg-muted/40 p-1 sm:w-fit"
          >
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = view === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setChosenView(t.key)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {t.label}
                  <span className="tabular-nums opacity-70">{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8">
        <div className="mx-auto w-full max-w-4xl" aria-live="polite">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading coverage…</p>
          ) : error ? (
            <p className="py-12 text-center text-sm text-destructive">
              Couldn’t load coverage. Try refreshing.
            </p>
          ) : view === "needs" ? (
            <UnassignedList employees={unassigned} />
          ) : (
            <HoursBuckets buckets={buckets} />
          )}
        </div>
      </div>
    </div>
  );
}
