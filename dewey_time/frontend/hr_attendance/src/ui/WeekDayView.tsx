import type { Day, DeviceAlert, DeviceSyncStatus, Flag } from "@/types/calendar";
import { format, isSameDay } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { initialSelectedDate, stepDay, dayPipState, type PipState } from "@/lib/weekDayView";
import { useWeekTimelineWindow } from "@/hooks/useWeekTimelineWindow";
import { DayCell } from "@/ui/DayTimeline";
import { DayChips } from "@/ui/DayChips";

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
          const state = dayPipState(props.daysByDate.get(key), isToday);
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

      {/* Selected-day chips */}
      <div className="shrink-0 px-3">
        <DayChips
          day={selectedInfo}
          alerts={props.alertsByDate.get(selectedKey) ?? []}
          onInspectFlag={(flag) => props.onInspectFlag(selectedKey, flag)}
        />
      </div>

      {/* One full-width day timeline, shared axis */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div style={{ height: `${weekWindow.canvasHeightPct}%` }} className="[&>button]:border-0">
          <DayCell
            date={selectedDate}
            outside={false}
            today={isSameDay(selectedDate, new Date())}
            info={selectedInfo}
            dense={false}
            timelineStartMin={weekWindow.startMin}
            timelineEndMin={weekWindow.endMin}
            deviceSync={props.syncByDate.get(selectedKey) ?? []}
            onInspectDay={() => props.onInspectDay(selectedKey)}
          />
        </div>
      </div>
    </div>
  );
}
