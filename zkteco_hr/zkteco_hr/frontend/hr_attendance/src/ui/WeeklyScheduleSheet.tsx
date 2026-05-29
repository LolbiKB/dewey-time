import { format } from "date-fns";
import { CalendarRangeIcon } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { employeeShortName, shiftScheduleStatus } from "@/lib/employeeCard";
import {
  buildWeekSchedule,
  formatScheduleDuration,
  formatWeekRangeLabel,
  minuteToSchedulePct,
  shortShiftTypeCode,
  summarizeWeekSchedule,
  type WeekDaySchedule,
} from "@/lib/weekSchedule";
import { cn } from "@/lib/utils";
import type { CalendarEmployee, Day } from "@/types/calendar";

export type WeeklyScheduleSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: CalendarEmployee | null;
  weekDates: Date[];
  daysByDate: Map<string, Day>;
  weekAssignedShiftDays: number;
  showWeekDetail: boolean;
};

export function WeeklyScheduleSheet(props: WeeklyScheduleSheetProps) {
  const week = buildWeekSchedule(props.weekDates, props.daysByDate);
  const summary = summarizeWeekSchedule(week);
  const status = shiftScheduleStatus(
    props.employee,
    props.weekDates,
    props.weekAssignedShiftDays,
    props.showWeekDetail
  );
  const name = employeeShortName(props.employee, props.employee?.id ?? null);
  const rangeLabel = formatWeekRangeLabel(props.weekDates);
  const hasSsa =
    props.employee?.has_shift_assignment === true ||
    props.employee?.has_shift_schedule_assignment === true;

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="space-y-1 border-b border-border/60 px-5 py-4 text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarRangeIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">{name}</SheetTitle>
              <SheetDescription className="text-xs">{rangeLabel}</SheetDescription>
              {props.employee?.shift_schedule_assignment ? (
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {props.employee.shift_schedule_assignment}
                </p>
              ) : null}
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Work days" value={String(summary.workDays)} accent="primary" />
            <StatCard label="Off" value={String(summary.offDays)} />
            <StatCard
              label="Expected"
              value={formatScheduleDuration(summary.totalWorkMin)}
              accent={summary.totalWorkMin > 0 ? "primary" : undefined}
            />
          </div>

          <WeekAtAGlance week={week} />

          {status.tone === "warn" ? (
            <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
              {status.detail ?? status.label}
              {!hasSsa ? " Assign a Shift Schedule Assignment in ERPNext to generate shifts." : null}
            </p>
          ) : null}

          <div className="mt-5 space-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Day by day
            </h3>
            <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card/40">
              {week.map((day) => (
                <ScheduleDayRow key={day.date} day={day} />
              ))}
            </ul>
          </div>

          <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
            Expected shifts from submitted Shift Assignments. Lunch breaks shown when configured on
            the shift type.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatCard(props: { label: string; value: string; accent?: "primary" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums tracking-tight",
          props.accent === "primary" && "text-primary"
        )}
      >
        {props.value}
      </div>
    </div>
  );
}

function WeekAtAGlance(props: { week: WeekDaySchedule[] }) {
  const todayKey = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-muted/15 p-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        This week
      </div>
      <div className="grid grid-cols-7 gap-1">
        {props.week.map((day) => {
          const isToday = day.date === todayKey;
          const state = day.onLeave ? "leave" : day.assigned ? "work" : "off";
          return (
            <div key={day.date} className="flex flex-col items-center gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">{day.weekday}</span>
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  isToday && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  state === "work" && "bg-primary text-primary-foreground",
                  state === "off" && "bg-muted/50 text-muted-foreground",
                  state === "leave" && "bg-sky-500/15 text-sky-800 ring-1 ring-sky-500/30 dark:text-sky-100"
                )}
                title={
                  state === "leave"
                    ? `On leave${day.leaveType ? ` · ${day.leaveType}` : ""}`
                    : state === "work"
                      ? day.timeLabel ?? "Scheduled"
                      : "Off"
                }
              >
                {day.dayNum}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleDayRow(props: { day: WeekDaySchedule }) {
  const { day } = props;
  const isToday = day.date === format(new Date(), "yyyy-MM-dd");

  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4",
        isToday && "bg-primary/[0.04]"
      )}
    >
      <div className="flex w-full shrink-0 items-baseline gap-2 sm:w-28 sm:flex-col sm:items-start sm:gap-0">
        <span className={cn("text-sm font-semibold", isToday && "text-primary")}>
          {day.weekdayLong}
        </span>
        <span className="text-xs text-muted-foreground">
          {day.monthLabel} {day.dayNum}
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <HorizontalShiftBar day={day} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {day.onLeave ? (
            <span className="font-medium text-sky-700 dark:text-sky-300">On leave</span>
          ) : day.assigned ? (
            <>
              <span className="font-medium">{shortShiftTypeCode(day.shiftType)}</span>
              {day.timeLabel ? (
                <span className="text-muted-foreground">{day.timeLabel}</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">Day off</span>
          )}
          {day.lunchLabel && day.assigned ? (
            <span className="text-muted-foreground">· Lunch {day.lunchLabel}</span>
          ) : null}
          {day.durationMin != null && day.durationMin > 0 && day.assigned ? (
            <span className="text-muted-foreground">
              · {formatScheduleDuration(day.durationMin)} net
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function HorizontalShiftBar(props: { day: WeekDaySchedule }) {
  const { day } = props;

  if (!day.assigned || day.startMin == null || day.endMin == null || day.endMin <= day.startMin) {
    return (
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted/35">
        <div className="absolute inset-y-0 left-[8%] right-[8%] rounded-full border border-dashed border-border/60" />
      </div>
    );
  }

  const left = clampPct(minuteToSchedulePct(day.startMin));
  const width = clampPct(minuteToSchedulePct(day.endMin) - left);

  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted/30">
      <div
        className="absolute inset-y-0 rounded-full bg-primary/90 shadow-sm"
        style={{ left: `${left}%`, width: `${Math.max(2, width)}%` }}
      />
      {day.lunchStartMin != null &&
      day.lunchEndMin != null &&
      day.lunchEndMin > day.lunchStartMin ? (
        <div
          className="absolute inset-y-0 rounded-full bg-background/80 ring-1 ring-border/50"
          style={segmentStyle(day.lunchStartMin, day.lunchEndMin)}
        />
      ) : null}
    </div>
  );
}

function segmentStyle(startMin: number, endMin: number) {
  const left = clampPct(minuteToSchedulePct(startMin));
  const width = clampPct(minuteToSchedulePct(endMin) - left);
  return {
    left: `${left}%`,
    width: `${Math.max(1.5, width)}%`,
  };
}

function clampPct(value: number) {
  return Math.min(100, Math.max(0, value));
}
