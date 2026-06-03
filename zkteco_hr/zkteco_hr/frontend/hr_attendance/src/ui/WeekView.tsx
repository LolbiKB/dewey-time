import type { Day, DeviceAlert, DeviceSyncStatus, Flag } from "@/types/calendar";
import { format, isSameDay } from "date-fns";
import { useEffect, useMemo, useRef } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatDayCheckinTimeRange,
  minutesFromDateTime,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
import { computeWeekTimelineWindow, weekTimelineCanvasHeightPct } from "@/lib/attendancePunches";
import { cn } from "@/lib/utils";
import { DayCell } from "@/ui/DayTimeline";

function WeekDayDateBadge(props: {
  dayNum: string;
  isToday: boolean;
  isOffDay: boolean;
  hasOffShiftPunch?: boolean;
}) {
  const badge = (
    <div
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm tracking-tight",
        props.isToday &&
          props.isOffDay &&
          "bg-destructive/10 font-semibold text-destructive ring-2 ring-primary ring-offset-1 ring-offset-background",
        props.isToday &&
          !props.isOffDay &&
          "bg-primary font-semibold text-primary-foreground shadow-sm",
        !props.isToday &&
          props.isOffDay &&
          "bg-destructive/10 font-normal text-destructive ring-1 ring-inset ring-destructive/35",
        !props.isToday && !props.isOffDay && "font-semibold text-foreground"
      )}
    >
      {props.dayNum}
    </div>
  );

  const tip = props.isToday
    ? props.isOffDay
      ? props.hasOffShiftPunch
        ? "Today — day off, punches recorded"
        : "Today — day off"
      : "Today"
    : props.isOffDay
      ? props.hasOffShiftPunch
        ? "Off shift — punches recorded (OFF_SHIFT_PUNCH)"
        : "No shift scheduled"
      : null;

  if (!tip) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

function dayOffShiftPunchFlag(day?: Day): Flag | undefined {
  return (day?.flags ?? []).find((flag) => flag.flag_code === "OFF_SHIFT_PUNCH");
}

export type WeekViewProps = {
  weekDates: Date[];
  daysByDate: Map<string, Day>;
  alertsByDate: Map<string, DeviceAlert[]>;
  syncByDate: Map<string, DeviceSyncStatus[]>;
  onInspectDay: (date: string) => void;
  onInspectFlag: (date: string, flag: Flag) => void;
};

export function WeekView(props: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const weekWindow = useMemo(() => {
    const mins: number[] = [];
    for (const d of props.weekDates) {
      const key = format(d, "yyyy-MM-dd");
      const info = props.daysByDate.get(key);
      for (const c of info?.checkins ?? []) {
        const m = minutesFromDateTime(c.time);
        if (m != null) mins.push(m);
      }
      if (info?.first_in) {
        const m = minutesFromDateTime(info.first_in);
        if (m != null) mins.push(m);
      }
      if (info?.last_out) {
        const m = minutesFromDateTime(info.last_out);
        if (m != null) mins.push(m);
      }
      const shift = info?.shift;
      if (shift?.shift_assigned) {
        const start = parseTimeToMinutes(shift.start_time ?? null);
        const end = parseTimeToMinutes(shift.end_time ?? null);
        if (start != null) mins.push(start);
        if (end != null) mins.push(end);
        const lunchStart = parseTimeToMinutes(shift.lunch_start ?? null);
        const lunchEnd = parseTimeToMinutes(shift.lunch_end ?? null);
        if (lunchStart != null) mins.push(lunchStart);
        if (lunchEnd != null) mins.push(lunchEnd);
      }
    }
    return computeWeekTimelineWindow(mins);
  }, [props.daysByDate, props.weekDates]);

  const canvasHeightPct = weekTimelineCanvasHeightPct(weekWindow.spanMinutes);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [weekWindow.startMin, weekWindow.endMin]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="grid shrink-0 grid-cols-7 border-b border-border/60">
        {props.weekDates.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const info = props.daysByDate.get(key);
          const isToday = isSameDay(d, new Date());
          const holiday = info?.holiday ?? null;
          // Holiday wins: treat as off-day in UI even if a Shift Assignment exists.
          const isOffDay = holiday != null || info?.shift?.shift_assigned !== true;
          const isTodayOff = isToday && isOffDay && !info?.leave?.on_leave;
          const offShiftFlag = dayOffShiftPunchFlag(info);
          const timeRange = formatDayCheckinTimeRange(info);
          return (
            <div
              key={key}
              className={cn(
                "px-3 py-2",
                holiday ? "bg-amber-500/[0.06]" : isOffDay && "bg-destructive/[0.06]"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <div
                    className={cn(
                      "text-xs font-medium",
                      holiday
                        ? "text-amber-700/80 dark:text-amber-200/80"
                        : isOffDay
                          ? "text-destructive/60"
                          : "text-muted-foreground"
                    )}
                  >
                    {format(d, "EEE")}
                  </div>
                  <WeekDayDateBadge
                    dayNum={format(d, "d")}
                    isToday={isToday}
                    isOffDay={isOffDay}
                    hasOffShiftPunch={offShiftFlag != null}
                  />
                </div>
                {isToday ? (
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      isTodayOff ? "text-destructive/75" : "text-primary/80"
                    )}
                  >
                    Today
                  </span>
                ) : null}
              </div>

              {holiday ? (
                <div className="mt-0.5 truncate text-[10px] font-semibold text-amber-900/80 dark:text-amber-100/80">
                  Holiday
                </div>
              ) : null}

              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {timeRange ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate">{timeRange}</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Actual punches
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {info?.leave?.on_leave ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex max-w-full items-center truncate rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-sky-900 dark:text-sky-100">
                        Leave
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {info.leave.leave_type ? `On leave · ${info.leave.leave_type}` : "On leave"}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {offShiftFlag ? (
                  <button
                    type="button"
                    onClick={() => props.onInspectFlag(key, offShiftFlag)}
                    className="inline-flex max-w-full items-center rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive hover:bg-destructive/15"
                    title="Review off-shift punch flag"
                  >
                    OFF_SHIFT
                  </button>
                ) : null}
                {(props.alertsByDate.get(key) ?? []).length > 0 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-amber-500/50 bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                        !
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Device closeout pending
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        aria-label="Week attendance timeline"
      >
        <div className="grid grid-cols-7" style={{ height: `${canvasHeightPct}%` }}>
          {props.weekDates.map((d) => {
            const key = format(d, "yyyy-MM-dd");
            const info = props.daysByDate.get(key);
            const isToday = isSameDay(d, new Date());
            return (
              <DayCell
                key={key}
                date={d}
                outside={false}
                today={isToday}
                info={info}
                dense={false}
                timelineStartMin={weekWindow.startMin}
                timelineEndMin={weekWindow.endMin}
                deviceSync={props.syncByDate.get(key) ?? []}
                onInspectDay={() => props.onInspectDay(key)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
