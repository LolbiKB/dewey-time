import { format } from "date-fns";
import { PalmtreeIcon } from "lucide-react";

import {
  formatScheduleDuration,
  formatShiftTime12h,
  shortShiftTypeCode,
  type WeekDaySchedule,
} from "@/lib/weekSchedule";
import { cn } from "@/lib/utils";
import { AppTooltip } from "@/ui/AppTooltip";

export type WeekScheduleGanttProps = {
  week: WeekDaySchedule[];
  patternLabel?: string | null;
  summaryLine?: string;
  className?: string;
};

/** Portrait-oriented week schedule: one stacked day card per row (fits narrow side sheet). */
export function WeekScheduleGantt(props: WeekScheduleGanttProps) {
  const todayKey = format(new Date(), "yyyy-MM-dd");

  return (
    <section className={cn("space-y-4", props.className)} aria-label="Weekly expected schedule">
      {(props.patternLabel || props.summaryLine) && (
        <header className="space-y-2">
          {props.patternLabel ? (
            <p className="text-sm font-medium leading-snug text-foreground">{props.patternLabel}</p>
          ) : null}
          {props.summaryLine ? (
            <p className="text-xs text-muted-foreground">{props.summaryLine}</p>
          ) : null}
        </header>
      )}

      <ul className="space-y-2">
        {props.week.map((day) => (
          <DayScheduleCard key={day.date} day={day} isToday={day.date === todayKey} />
        ))}
      </ul>
    </section>
  );
}

function DayScheduleCard(props: { day: WeekDaySchedule; isToday: boolean }) {
  const { day } = props;

  return (
    <li
      className={cn(
        "flex gap-3 rounded-xl border border-border/50 bg-card/50 p-3 shadow-sm",
        props.isToday && "border-primary/35 bg-primary/[0.04] ring-1 ring-primary/20"
      )}
    >
      <DayRail day={day} isToday={props.isToday} />

      <div className="min-w-0 flex-1">
        {day.onLeave ? <LeaveBody day={day} /> : day.assigned ? <ShiftBody day={day} /> : <OffBody />}
      </div>
    </li>
  );
}

function DayRail(props: { day: WeekDaySchedule; isToday: boolean }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1">
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          props.isToday ? "text-primary" : "text-muted-foreground"
        )}
      >
        {props.day.weekday}
      </span>
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
          props.isToday && "bg-primary text-primary-foreground shadow-sm",
          !props.isToday && "bg-muted/40 text-foreground"
        )}
      >
        {props.day.dayNum}
      </span>
    </div>
  );
}

function ShiftBody(props: { day: WeekDaySchedule }) {
  const code = shortShiftTypeCode(props.day.shiftType);
  const startLabel =
    formatShiftTime12h(props.day.shift.start_time) ?? props.day.timeLabel?.split("–")[0]?.trim();
  const endLabel =
    formatShiftTime12h(props.day.shift.end_time) ??
    props.day.timeLabel?.split("–")[1]?.trim();

  return (
    <div className="flex gap-3">
      <VerticalShiftTrack day={props.day} startLabel={startLabel} endLabel={endLabel} />

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5">
        <div className="font-medium leading-tight text-foreground">{code}</div>
        {props.day.timeLabel ? (
          <div className="text-sm tabular-nums text-foreground/90">{props.day.timeLabel}</div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {props.day.lunchLabel ? <span>Lunch {props.day.lunchLabel}</span> : null}
          {props.day.durationMin != null && props.day.durationMin > 0 ? (
            <span className="font-medium text-muted-foreground">
              {formatScheduleDuration(props.day.durationMin)} net
            </span>
          ) : null}
          {props.day.shift.schedule_superseded ? (
            <AppTooltip
              content="Shift Assignment is Inactive in ERP; still shown for this past day"
              side="top"
            >
              <span>Superseded in ERP</span>
            </AppTooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VerticalShiftTrack(props: {
  day: WeekDaySchedule;
  startLabel?: string | null;
  endLabel?: string | null;
}) {
  const { day } = props;
  const hasWindow =
    day.startMin != null && day.endMin != null && day.endMin > day.startMin;

  if (!hasWindow) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-muted/30 text-[9px] text-muted-foreground">
        —
      </div>
    );
  }

  const lunchTop =
    day.lunchStartMin != null && day.lunchEndMin != null && day.lunchEndMin > day.lunchStartMin
      ? clampPct(((day.lunchStartMin - day.startMin!) / (day.endMin! - day.startMin!)) * 100)
      : null;
  const lunchHeight =
    lunchTop != null && day.lunchStartMin != null && day.lunchEndMin != null
      ? clampPct(((day.lunchEndMin - day.lunchStartMin) / (day.endMin! - day.startMin!)) * 100)
      : null;

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1">
      {props.startLabel ? (
        <span className="text-[9px] font-medium leading-none text-muted-foreground tabular-nums">
          {props.startLabel.replace(" AM", "a").replace(" PM", "p")}
        </span>
      ) : null}

      <div className="relative h-[4.5rem] w-3 overflow-hidden rounded-full bg-muted/40">
        <div className="absolute inset-0 rounded-full bg-primary/70 ring-1 ring-primary/25" />
        {lunchTop != null && lunchHeight != null ? (
          <div
            className="absolute inset-x-0 rounded-sm bg-background ring-1 ring-border/40"
            style={{ top: `${lunchTop}%`, height: `${Math.max(10, lunchHeight)}%` }}
          />
        ) : null}
      </div>

      {props.endLabel ? (
        <span className="text-[9px] font-medium leading-none text-muted-foreground tabular-nums">
          {props.endLabel.replace(" AM", "a").replace(" PM", "p")}
        </span>
      ) : null}
    </div>
  );
}

function LeaveBody(props: { day: WeekDaySchedule }) {
  return (
    <div className="flex min-h-[4.5rem] items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 ring-1 ring-border/50">
      <PalmtreeIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <div className="font-medium text-foreground">On leave</div>
        {props.day.leaveType ? (
          <div className="text-xs text-muted-foreground">{props.day.leaveType}</div>
        ) : null}
      </div>
    </div>
  );
}

function OffBody() {
  return (
    <div className="flex min-h-[4.5rem] items-center rounded-lg border border-dashed border-border/70 bg-muted/20 px-3">
      <span className="text-sm text-muted-foreground">Day off</span>
    </div>
  );
}

function clampPct(value: number) {
  return Math.min(100, Math.max(0, value));
}
