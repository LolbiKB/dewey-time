import { format } from "date-fns";
import { useMemo } from "react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  clamp,
  formatBranchLabel,
  formatCheckinTime,
  formatDurationMinutes,
  minutesFromDateTime,
  parseDateTimeLocal,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
import {
  classifyUnpairedPresentations,
  computeDayTimeWindow,
  deriveTimelineGaps,
  deriveUnpairedPunches,
  hasTimelineErrorPunches,
  shiftTimelinePolicyFromShift,
  type DeviceSyncStatus,
  type PunchPresentation,
} from "@/lib/attendancePunches";
import {
  detectObservedLunch,
  observedLunchMinuteRange,
  scheduledLunchMinuteRange,
} from "@/lib/lunchDetection";
import { deriveSegments } from "@/lib/segmentInspector";
import {
  clipScheduledBandToFuture,
  computeDaySpan,
  computeLateness,
  deriveMissingExpectedIntervals,
  deriveScheduledFutureIntervals,
  missingExpectedMaxEndMin,
} from "@/lib/shiftTimeline";
import { cn } from "@/lib/utils";
import type { Day, ObservedLunch, ShiftContext } from "@/types/calendar";

type Checkin = NonNullable<Day["checkins"]>[number];

/** Expected shift window (today: from current hour; future days: full shift). Hover for label. */
const scheduledBandClass =
  "border-2 border-dashed border-muted-foreground/80 bg-muted/50 dark:border-muted-foreground/65 dark:bg-muted/40";

const punchHelpers = {
  parseTime: parseDateTimeLocal,
  minutesFromDateTime,
  clamp,
};

export function DayCell(props: {
  date: Date;
  outside: boolean;
  today: boolean;
  info?: Day;
  dense: boolean;
  timelineStartMin?: number;
  timelineEndMin?: number;
  deviceSync?: DeviceSyncStatus[];
  onInspectDay: () => void;
}) {
  const checkins = props.info?.checkins ?? [];
  const dateKey = format(props.date, "yyyy-MM-dd");
  const shiftEndMin =
    props.info?.shift?.shift_assigned && props.info.shift.end_time
      ? parseTimeToMinutes(props.info.shift.end_time)
      : null;
  const hasErrorPunch = hasTimelineErrorPunches(
    checkins,
    { dateKey, shiftEndMin, deviceSync: props.deviceSync },
    punchHelpers
  );
  const holiday = props.info?.holiday ?? null;
  const shift = holiday ? { shift_assigned: false } : (props.info?.shift ?? { shift_assigned: false });

  return (
    <button
      type="button"
      onClick={props.onInspectDay}
      className={cn(
        "group relative min-h-0 border-b border-r border-border/60 p-3 pl-5 text-left outline-hidden transition-colors hover:bg-muted/20 focus:bg-muted/20 focus:ring-2 focus:ring-ring/40",
        props.dense ? "h-full" : "h-full",
        props.outside && "bg-muted/10 text-muted-foreground",
        props.today && "bg-primary/3 ring-1 ring-primary/20"
      )}
    >
      <div className={cn("grid h-full gap-2", props.dense ? "grid-rows-[20px_1fr]" : "grid-rows-[1fr]")}>
        {props.dense ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-4 w-1 rounded-full",
                  hasErrorPunch ? "bg-destructive" : "bg-muted/40"
                )}
                aria-hidden="true"
              />
              <div className="text-xs font-semibold">{format(props.date, "d")}</div>
            </div>
            <div className="opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-[11px] text-muted-foreground">Inspect</span>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 h-full">
          {holiday ? (
            <div
              className={cn(
                "relative rounded-xl bg-muted/25",
                props.dense ? "" : "min-h-0 h-full"
              )}
            >
              <div className="absolute inset-2">
                <HolidayBoard description={holiday.description} weeklyOff={holiday.weekly_off} />
              </div>
            </div>
          ) : (
            <DayDayTrack
              firstIn={props.info?.first_in ?? null}
              lastOut={props.info?.last_out ?? null}
              checkins={checkins}
              shift={shift}
              dateKey={dateKey}
              observedLunch={props.info?.observed_lunch ?? null}
              deviceSync={props.deviceSync}
              dense={props.dense}
              windowStartMin={props.timelineStartMin}
              windowEndMin={props.timelineEndMin}
            />
          )}
        </div>
      </div>
    </button>
  );
}

function HolidayBoard(props: { description: string; weeklyOff: boolean }) {
  const label = props.weeklyOff ? "Weekly off" : "Holiday";
  const text = (props.description || "").trim() || label

  // Show as multiple vertical “lines” using columns; keep it stable and non-wrapping in height.
  return (
    <div className="relative h-full rounded-xl border border-amber-500/20 bg-amber-500/5 p-2 shadow-sm">
      <div className="text-[15px] leading-snug text-amber-950/80 dark:text-amber-100/80 whitespace-normal break-words line-clamp-6">
        {text}
      </div>
    </div>
  );
}

function DayDayTrack(props: {
  firstIn: string | null;
  lastOut: string | null;
  checkins: Checkin[];
  shift: ShiftContext;
  dateKey: string;
  observedLunch: ObservedLunch | null;
  deviceSync?: DeviceSyncStatus[];
  dense: boolean;
  windowStartMin?: number;
  windowEndMin?: number;
}) {
  const color = "bg-emerald-600";
  const openSessionUncertainClass =
    "border border-dashed border-amber-500/50 bg-amber-500/20 dark:bg-amber-500/15";

  const span = computeDaySpan(props.firstIn, props.lastOut);
  const segments = deriveSegments(props.checkins);
  const shiftEndMin =
    props.shift?.shift_assigned && props.shift.end_time
      ? parseTimeToMinutes(props.shift.end_time)
      : null;
  const punchPresentations = useMemo(
    () =>
      classifyUnpairedPresentations(
        props.checkins ?? [],
        {
          dateKey: props.dateKey,
          shiftEndMin,
          deviceSync: props.deviceSync,
        },
        punchHelpers
      ),
    [props.checkins, props.dateKey, props.deviceSync, shiftEndMin]
  );
  const errorPresentations = useMemo(
    () => punchPresentations.filter((row) => row.kind !== "openSession"),
    [punchPresentations]
  );
  const openSessions = useMemo(
    () => punchPresentations.filter((row) => row.kind === "openSession"),
    [punchPresentations]
  );
  const unpairedForGaps = useMemo(
    () => deriveUnpairedPunches(props.checkins ?? [], parseDateTimeLocal),
    [props.checkins]
  );
  const shiftPolicy = useMemo(
    () => shiftTimelinePolicyFromShift(props.shift),
    [props.shift]
  );
  const observedLunchRange = useMemo(() => {
    const observed =
      props.observedLunch ??
      detectObservedLunch(props.checkins, props.shift, props.dateKey);
    return observedLunchMinuteRange(observed);
  }, [props.checkins, props.dateKey, props.observedLunch, props.shift]);
  const scheduledLunchRange = useMemo(
    () => scheduledLunchMinuteRange(props.shift),
    [props.shift]
  );
  const gaps = useMemo(
    () =>
      deriveTimelineGaps(segments, unpairedForGaps, minutesFromDateTime, {
        shiftPolicy,
        observedLunchRange,
        scheduledLunchRange,
      }),
    [observedLunchRange, scheduledLunchRange, segments, shiftPolicy, unpairedForGaps]
  );
  const awayIntervals = useMemo(
    () =>
      gaps
        .filter((gap) => gap.kind === "away")
        .map((gap) => ({ startMin: gap.startMin, endMin: gap.endMin })),
    [gaps]
  );
  const scheduledFuture = useMemo(
    () => deriveScheduledFutureIntervals(props.shift, props.dateKey),
    [props.dateKey, props.shift]
  );
  const missingExpected = useMemo(() => {
    const maxEndMin = missingExpectedMaxEndMin(props.dateKey);
    const openSessionIntervals = openSessions.flatMap((row) => {
      const intervals = [{ startMin: row.startMin, endMin: row.confirmedEndMin }];
      if (row.uncertainEndMin != null && row.uncertainEndMin > row.confirmedEndMin) {
        intervals.push({ startMin: row.confirmedEndMin, endMin: row.uncertainEndMin });
      }
      return intervals;
    });
    const excludeIntervals = [
      ...awayIntervals,
      ...openSessionIntervals,
      ...scheduledFuture.map((interval) => ({
        startMin: interval.startMin,
        endMin: interval.endMin,
      })),
    ];
    return deriveMissingExpectedIntervals(props.shift, segments, {
      maxEndMin,
      excludeIntervals,
    });
  }, [awayIntervals, openSessions, props.dateKey, props.shift, scheduledFuture, segments]);
  const lateness = computeLateness(props.shift, props.firstIn);

  const window = useMemo(() => {
    if (props.dense) return null;
    if (props.windowStartMin != null && props.windowEndMin != null) {
      const span = props.windowEndMin - props.windowStartMin;
      if (span > 0) {
        return {
          startMin: props.windowStartMin,
          endMin: props.windowEndMin,
          span,
        };
      }
    }
    return computeDayTimeWindow(props.checkins ?? [], minutesFromDateTime);
  }, [props.checkins, props.dense, props.windowEndMin, props.windowStartMin]);

  function pctFromMinute(min: number) {
    if (!window) return clamp((min / (24 * 60)) * 100, 0, 100);
    return clamp(((min - window.startMin) / window.span) * 100, 0, 100);
  }

  function pctFromMinuteDay(min: number) {
    return clamp((min / (24 * 60)) * 100, 0, 100);
  }

  function renderTimelineBand(
    key: string,
    interval: { startMin: number; endMin: number; minutes: number },
    className: string,
    label: string,
    useWeekWindow: boolean
  ) {
    const topPct = useWeekWindow
      ? pctFromMinute(interval.startMin)
      : pctFromMinuteDay(interval.startMin);
    const bottomPct = useWeekWindow
      ? pctFromMinute(interval.endMin)
      : pctFromMinuteDay(interval.endMin);
    const heightPct = Math.max(2, bottomPct - topPct);
    if (heightPct <= 0) return null;
    const topStyle = useWeekWindow ? `${topPct}%` : `calc(${topPct}% + 8px)`;
    const heightStyle = useWeekWindow ? `${heightPct}%` : `calc(${heightPct}% - 16px)`;
    return (
      <HoverCard key={key} openDelay={220} closeDelay={120}>
        <HoverCardTrigger asChild>
          <div
            className={cn("absolute inset-x-2 rounded-sm", className)}
            style={{ top: topStyle, height: heightStyle }}
          />
        </HoverCardTrigger>
        <HoverCardContent className="w-auto p-2">
          <div className="text-xs">
            {label} · {formatDurationMinutes(interval.minutes)}
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  function openSessionLabel(row: PunchPresentation) {
    const branchLabel = formatBranchLabel(row.branch);
    const since = formatCheckinTime(row.checkin.time);
    const parts = [`On site · since ${since}`, branchLabel].filter(Boolean);
    if (row.syncLagging) parts.push("sync pending");
    return parts.join(" · ");
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div
        className={cn("relative rounded-xl bg-muted/25", props.dense ? "" : "min-h-0 flex-1")}
        style={props.dense ? { height: 96 } : undefined}
      >
        <div
          className="absolute inset-y-2 w-px bg-border/60"
          style={{ left: "calc(50% - 0.5px)" }}
        />

        {errorPresentations.map((row, idx) => {
          const m = row.startMin;
          const topPct = pctFromMinute(m);
          const label =
            row.kind === "rogue"
              ? "Rogue punch"
              : "Unpaired punch";
          return (
            <Tooltip key={`${row.checkin.time}-${idx}`}>
              <TooltipTrigger asChild>
                <div
                  className="absolute inset-x-2 h-1 rounded-full bg-destructive shadow-sm"
                  style={{ top: `calc(${topPct}% - 2px)` }}
                />
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {label} · {format(parseDateTimeLocal(row.checkin.time), "h:mm a")}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {openSessions.map((row, idx) => {
          const confirmed = renderTimelineBand(
            `open-${idx}`,
            {
              startMin: row.startMin,
              endMin: row.confirmedEndMin,
              minutes: Math.max(0, row.confirmedEndMin - row.startMin),
            },
            cn(color, "shadow-sm ring-1 ring-foreground/10"),
            openSessionLabel(row),
            window != null
          );
          const uncertain =
            row.uncertainEndMin != null && row.uncertainEndMin > row.confirmedEndMin
              ? renderTimelineBand(
                  `open-uncertain-${idx}`,
                  {
                    startMin: row.confirmedEndMin,
                    endMin: row.uncertainEndMin,
                    minutes: row.uncertainEndMin - row.confirmedEndMin,
                  },
                  openSessionUncertainClass,
                  "Punches may still be in transit",
                  window != null
                )
              : null;
          return (
            <span key={`open-wrap-${idx}`} className="contents">
              {confirmed}
              {uncertain}
            </span>
          );
        })}

        {scheduledFuture.map((interval, idx) =>
          renderTimelineBand(
            `scheduled-${idx}`,
            interval,
            scheduledBandClass,
            "Scheduled",
            window != null
          )
        )}

        {props.dense && span && segments.length === 0 ? (
          <div
            className={cn("absolute left-1/2 w-[12px] -translate-x-1/2 rounded-sm", color)}
            style={{
              top: `calc(${span.topPct}% + 8px)`,
              height: `calc(${span.heightPct}% - 16px)`,
            }}
          />
        ) : null}

        {missingExpected.map((interval, idx) =>
          renderTimelineBand(
            `missing-${idx}`,
            interval,
            "border border-dashed border-destructive/75 bg-destructive/5",
            "Missing expected",
            window != null
          )
        )}

        {gaps.map((g, idx) => {
          const topPct = pctFromMinute(g.startMin);
          const endPct = pctFromMinute(g.endMin);
          const heightPct = endPct - topPct;
          if (heightPct <= 0) return null;
          const isLunch = g.kind === "lunch";
          const isObservedLunch = isLunch && g.source === "observed";
          const isScheduledLunch = isLunch && g.source === "scheduled";
          return (
            <HoverCard key={idx} openDelay={220} closeDelay={120}>
              <HoverCardTrigger asChild>
                <div
                  className={cn(
                    "absolute inset-x-2 rounded-sm border",
                    isObservedLunch
                      ? "border-sky-500/40 bg-sky-500/15"
                      : isScheduledLunch
                        ? "border-muted-foreground/45 bg-muted/35 dark:bg-muted/30"
                        : "border-destructive/40 bg-destructive/15"
                  )}
                  style={{
                    top: `${topPct}%`,
                    height: `${heightPct}%`,
                  }}
                />
              </HoverCardTrigger>
              <HoverCardContent className="w-auto p-2">
                <div className="text-xs">
                  {isLunch ? "Lunch" : "Away"} · {formatDurationMinutes(g.minutes)}
                  {isObservedLunch ? " · observed" : null}
                  {isScheduledLunch ? " · scheduled" : null}
                </div>
              </HoverCardContent>
            </HoverCard>
          );
        })}

        {segments.length === 0 ? null : (
          segments.slice(0, props.dense ? 3 : 6).map((s, idx) => {
            if (s.startMin == null || s.endMin == null) return null;
            const topPct = pctFromMinute(s.startMin);
            const endPct = pctFromMinute(s.endMin);
            const heightPct = endPct - topPct;
            if (heightPct <= 0) return null;
            const branchLabel = formatBranchLabel(s.branch);
            const startLabel = s.start?.time ? format(new Date(s.start.time), "h:mma") : "—";
            const endLabel = s.end?.time ? format(new Date(s.end.time), "h:mma") : "—";
            const compactTip = [
              `${startLabel}–${endLabel}`,
              s.minutes != null ? formatDurationMinutes(s.minutes) : null,
              branchLabel,
              lateness?.isLate && lateness.deltaMinutes != null
                ? `Late ${formatDurationMinutes(lateness.deltaMinutes, { signed: true })}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <HoverCard key={idx} openDelay={220} closeDelay={120}>
                <HoverCardTrigger asChild>
                  <div
                    className={cn(
                      "absolute inset-x-2 rounded-sm shadow-sm ring-1 ring-foreground/10",
                      color
                    )}
                    style={{
                      top: `${topPct}%`,
                      height: `${heightPct}%`,
                    }}
                  >
                    {!props.dense && heightPct >= 12 ? (
                      <div className="pointer-events-none absolute inset-0 px-2 pt-1.5 text-white/95">
                        <div className="absolute left-2 top-1.5 text-[11px] font-semibold leading-tight">
                          {startLabel}
                        </div>
                        {heightPct >= 18 ? (
                          <div className="absolute right-2 top-1.5 text-[10px] font-medium text-white/85">
                            {formatDurationMinutes(s.minutes)}
                          </div>
                        ) : null}
                        {heightPct >= 22 && lateness?.isLate && lateness.deltaMinutes != null ? (
                          <div className="absolute right-2 bottom-1.5 text-[10px] font-medium text-white/85">
                            {formatDurationMinutes(lateness.deltaMinutes, { signed: true })}
                          </div>
                        ) : null}
                        {heightPct >= 24 ? (
                          <div className="absolute left-2 right-2 top-[22px] truncate text-[10px] font-medium text-white/85">
                            {branchLabel ?? "—"}
                          </div>
                        ) : null}
                        <div className="absolute bottom-1.5 left-2 text-[11px] font-semibold leading-tight">
                          {endLabel}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </HoverCardTrigger>
                <HoverCardContent className="w-auto max-w-[320px] p-2">
                  <div className="text-xs">{compactTip || "Segment"}</div>
                </HoverCardContent>
              </HoverCard>
            );
          })
        )}
      </div>
    </div>
  );
}
