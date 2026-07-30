import type { Day, DeviceAlert, DeviceSyncStatus, Flag } from "@/types/calendar";
import { format, isSameDay } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { clockDayMinutes, formatClockDayTotal, isClockDay } from "@/lib/clockDay";
import { deriveSegments } from "@/lib/segmentInspector";
import { cn } from "@/lib/utils";
import { initialSelectedDate, stepDay, dayPipState, type PipState } from "@/lib/weekDayView";
import { useWeekTimelineWindow } from "@/hooks/useWeekTimelineWindow";
import { DayCell } from "@/ui/DayTimeline";
import { DayChips } from "@/ui/DayChips";
import { HourGutter } from "@/ui/TimelineAxis";

const PIP_TONE: Record<PipState, string> = {
  today: "bg-primary text-primary-foreground",
  holiday: "bg-muted text-brand-accent",
  off: "bg-destructive/10 text-destructive",
  flagged: "bg-destructive/15 text-destructive ring-1 ring-destructive/40",
  normal: "bg-muted/50 text-muted-foreground",
};

export type WeekDayViewProps = {
  weekDates: Date[];
  daysByDate: Map<string, Day>;
  alertsByDate: Map<string, DeviceAlert[]>;
  syncByDate: Map<string, DeviceSyncStatus[]>;
  isClockBased?: boolean;
  employeeBranch?: string | null;
  onInspectDay: (date: string) => void;
  onInspectFlag: (date: string, flag: Flag) => void;
};

export function WeekDayView(props: WeekDayViewProps) {
  const weekWindow = useWeekTimelineWindow(props.weekDates, props.daysByDate);
  const [selectedKey, setSelectedKey] = useState(() =>
    initialSelectedDate(props.weekDates, new Date()),
  );

  // New week (prev/next/jump) → reseed to today-or-first.
  const weekKey = format(props.weekDates[0]!, "yyyy-MM-dd");
  useEffect(() => {
    setSelectedKey(initialSelectedDate(props.weekDates, new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);

  const selectedDate =
    props.weekDates.find((d) => format(d, "yyyy-MM-dd") === selectedKey) ?? props.weekDates[0]!;
  const selectedInfo = props.daysByDate.get(selectedKey);
  const atFirst = selectedKey === format(props.weekDates[0]!, "yyyy-MM-dd");
  const atLast = selectedKey === format(props.weekDates[6]!, "yyyy-MM-dd");

  // Net worked hours — the headline figure of a clock day. Same computation as
  // the desktop week grid, so the two surfaces cannot report different totals.
  const clockTotal = isClockDay(props.isClockBased, selectedInfo)
    ? formatClockDayTotal(
        clockDayMinutes(
          deriveSegments(selectedInfo?.checkins ?? []),
          selectedInfo?.gross_minutes ?? null,
        ),
      )
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
      {/* Day switcher */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          disabled={atFirst}
          onClick={() => setSelectedKey((k) => stepDay(props.weekDates, k, -1))}
          aria-label="Previous day"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>

        <div className="min-w-0 flex-1 text-center text-sm font-semibold tracking-tight">
          {format(selectedDate, "EEE d")}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          disabled={atLast}
          onClick={() => setSelectedKey((k) => stepDay(props.weekDates, k, 1))}
          aria-label="Next day"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      {/* Pip strip */}
      <div className="flex shrink-0 items-center justify-between gap-1 px-3 py-2">
        {props.weekDates.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const isToday = isSameDay(d, new Date());
          const state = dayPipState(props.daysByDate.get(key), isToday, props.isClockBased);
          const active = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              data-pip={state}
              onClick={() => setSelectedKey(key)}
              aria-label={format(d, "EEEE d")}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-9 flex-1 flex-col items-center justify-center rounded-lg text-[10px] font-semibold tabular-nums transition-colors",
                PIP_TONE[state],
                active && "ring-2 ring-primary ring-offset-1 ring-offset-background",
              )}
            >
              <span className="opacity-70">{format(d, "EEEEE")}</span>
              <span>{format(d, "d")}</span>
            </button>
          );
        })}
      </div>

      {/* Selected-day chips + clock-day total */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3">
        <DayChips
          day={selectedInfo}
          alerts={props.alertsByDate.get(selectedKey) ?? []}
          isClockDay={isClockDay(props.isClockBased, selectedInfo)}
          onInspectFlag={(flag) => props.onInspectFlag(selectedKey, flag)}
        />
        {clockTotal ? (
          <span className="text-xs font-semibold tabular-nums text-foreground">{clockTotal}</span>
        ) : null}
      </div>

      {/* One full-width day timeline, shared axis */}
      {/* No vertical scroll — see resolveWeekTimelineWindow: the axis is scaled to fit. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* `grid`, not a plain block, and that is load-bearing: DayCell's root is
            a <button>, which is inline-level and therefore shrinks to its content
            width. WeekView never notices because it renders DayCell into
            `grid-cols-[repeat(7,minmax(8rem,1fr))]`, where grid items stretch to
            fill their column. Rendered into a block wrapper the same button
            collapsed to a narrow sliver on phones (issue #71). A single-column
            grid stretches it by the same mechanism the week grid uses, so the two
            surfaces cannot drift apart. */}
        <div className="grid h-full grid-cols-[3.5rem_1fr] [&>button]:border-0">
          <HourGutter window={weekWindow} />
          <DayCell
            date={selectedDate}
            outside={false}
            today={isSameDay(selectedDate, new Date())}
            info={selectedInfo}
            timelineStartMin={weekWindow.startMin}
            timelineEndMin={weekWindow.endMin}
            deviceSync={props.syncByDate.get(selectedKey) ?? []}
            isClockDay={isClockDay(props.isClockBased, selectedInfo)}
            employeeBranch={props.employeeBranch}
            onInspectDay={() => props.onInspectDay(selectedKey)}
          />
        </div>
      </div>
    </div>
  );
}
