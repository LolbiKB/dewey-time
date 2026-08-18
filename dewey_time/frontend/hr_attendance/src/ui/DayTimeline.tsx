import { format } from "date-fns";
import { useMemo } from "react";

import { AppTooltip } from "@/ui/AppTooltip";
import { HourGrid } from "@/ui/TimelineAxis";
import {
  clamp,
  formatBranchLabel,
  formatCheckinTime,
  formatDurationMinutes,
  isOffSiteSegment,
  minutesFromDateTime,
  minutesSinceMidnight,
  parseDateTimeLocal,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
import {
  classifyUnpairedPresentations,
  computeDayTimeWindow,
  deriveTimelineGaps,
  deriveUnpairedPunches,
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
  computeLateness,
  deriveMissingExpectedIntervals,
  deriveScheduledFutureIntervals,
  missingExpectedMaxEndMin,
} from "@/lib/shiftTimeline";
import { dayCellAccessibleName } from "@/lib/dayCellLabel";
import { cn } from "@/lib/utils";
import type { Day, ObservedLunch, ShiftContext } from "@/types/calendar";

type Checkin = NonNullable<Day["checkins"]>[number];

/** Expected shift window (today: from the current minute; future days: full shift). Hover for label. */
const scheduledBandClass =
  "border-2 border-dashed border-muted-foreground/80 bg-muted/50";

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
  timelineStartMin?: number;
  timelineEndMin?: number;
  deviceSync?: DeviceSyncStatus[];
  isClockDay?: boolean;
  employeeBranch?: string | null;
  now?: Date;
  onInspectDay: () => void;
}) {
  const checkins = props.info?.checkins ?? [];
  const dateKey = format(props.date, "yyyy-MM-dd");
  const holiday = props.info?.holiday ?? null;
  const shift = holiday ? { shift_assigned: false } : (props.info?.shift ?? { shift_assigned: false });

  return (
    <button
      type="button"
      onClick={props.onInspectDay}
      // The column's entire contents are aria-hidden (grid lines, now-line) or
      // described only by hover tooltips, so without this every day in the week
      // announces as a bare "button" — including a scheduled day with zero
      // punches, which is the one HR most needs to notice.
      aria-label={dayCellAccessibleName(props.date, props.info)}
      // A whole day column is one button, so the global press-scale (see
      // brand/base.css) would shrink a ~500px-tall surface on every tap. Opt out
      // and press with colour, matching the hover/focus tint already used here.
      data-press="none"
      className={cn(
        "group relative min-h-0 border-b border-r border-border/60 p-3 pl-5 text-left outline-hidden transition-colors hover:bg-muted/20 focus:bg-muted/20 active:bg-muted/30 focus:ring-2 focus:ring-ring/40",
        "h-full",
        props.outside && "bg-muted/10 text-muted-foreground",
        props.today && "bg-primary/3 ring-1 ring-primary/20"
      )}
    >
      <div className="grid h-full gap-2 grid-rows-[1fr]">
        <div className="min-h-0 h-full">
          {holiday ? (
            <div className="relative rounded-xl bg-muted/25 min-h-0 h-full">
              <div className="absolute inset-2">
                <HolidayBoard description={holiday.description} weeklyOff={holiday.weekly_off} />
              </div>
            </div>
          ) : (
            <DayDayTrack
              firstIn={props.info?.first_in ?? null}
              checkins={checkins}
              shift={shift}
              dateKey={dateKey}
              observedLunch={props.info?.observed_lunch ?? null}
              deviceSync={props.deviceSync}
              isClockDay={props.isClockDay}
              employeeBranch={props.employeeBranch}
              windowStartMin={props.timelineStartMin}
              windowEndMin={props.timelineEndMin}
              today={props.today}
              now={props.now}
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
    <div className="relative h-full rounded-xl border border-border bg-muted/25 p-2 shadow-sm">
      <div className="text-[15px] leading-snug text-brand-accent whitespace-normal break-words line-clamp-6">
        {text}
      </div>
    </div>
  );
}

function DayDayTrack(props: {
  firstIn: string | null;
  checkins: Checkin[];
  shift: ShiftContext;
  dateKey: string;
  observedLunch: ObservedLunch | null;
  deviceSync?: DeviceSyncStatus[];
  isClockDay?: boolean;
  employeeBranch?: string | null;
  windowStartMin?: number;
  windowEndMin?: number;
  today?: boolean;
  now?: Date;
}) {
  const onShift = props.shift?.shift_assigned === true;
  /**
   * Tone only — never a claim that a shift exists. A clock day has no schedule,
   * so its punches are ordinary worked time and must not read as an exception.
   * Everything that judges the employee against a schedule keeps using `onShift`.
   */
  const workedTone = onShift || props.isClockDay === true;
  const color = workedTone ? "bg-primary" : "bg-brand-accent/80";
  const offShiftSegmentClass = workedTone
    ? cn(color, "shadow-sm ring-1 ring-foreground/10")
    : "border border-dashed border-brand-accent/50 bg-brand-accent/25 shadow-sm ring-1 ring-brand-accent/20";
  const openSessionUncertainClass =
    "border border-dashed border-brand-accent/50 bg-brand-accent/15";
  /**
   * A clock day carries no obligation to be present — the engine deliberately emits
   * no MISSING_TIME for it — so an unpaid break is neutral, not an unaccounted absence.
   */
  const awayGapClass =
    props.isClockDay === true
      ? "border-muted-foreground/40 bg-muted/40"
      : "border-destructive/40 bg-destructive/15";

  /**
   * ONE definition of "now" for this canvas.
   *
   * The now-line, the red missing-expected dash and the grey scheduled dash
   * all read it. They used to disagree: the line honoured `props.now` while
   * both dashes called `new Date()` internally and ignored the prop entirely,
   * so the canvas could not be rendered at a pinned time — and the dashes
   * additionally rounded down to the hour (see `presentBoundaryMin`).
   *
   * Memoised so the default stays one stable Date rather than a fresh one on
   * every render, which would invalidate every memo below it.
   */
  const now = useMemo(() => props.now ?? new Date(), [props.now]);
  const nowMin = minutesSinceMidnight(now);

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
          shiftAssigned: props.shift?.shift_assigned === true,
          now,
        },
        punchHelpers
      ),
    [now, props.checkins, props.dateKey, props.deviceSync, props.shift?.shift_assigned, shiftEndMin]
  );
  const errorPresentations = useMemo(
    () => punchPresentations.filter((row) => row.kind === "rogue" || row.kind === "unpairedError"),
    [punchPresentations]
  );
  const offShiftPresentations = useMemo(
    () => punchPresentations.filter((row) => row.kind === "offShiftPunch"),
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
    () => deriveScheduledFutureIntervals(props.shift, props.dateKey, now),
    [now, props.dateKey, props.shift]
  );
  const missingExpected = useMemo(() => {
    const maxEndMin = missingExpectedMaxEndMin(props.dateKey, now);
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
  }, [awayIntervals, now, openSessions, props.dateKey, props.shift, scheduledFuture, segments]);
  const lateness = computeLateness(props.shift, props.firstIn);

  const window = useMemo(() => {
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
  }, [props.checkins, props.windowEndMin, props.windowStartMin]);

  function pctFromMinute(min: number) {
    if (!window) return clamp((min / (24 * 60)) * 100, 0, 100);
    return clamp(((min - window.startMin) / window.span) * 100, 0, 100);
  }

  function renderTimelineBand(
    key: string,
    interval: { startMin: number; endMin: number; minutes: number },
    className: string,
    label: string
  ) {
    const topPct = pctFromMinute(interval.startMin);
    const bottomPct = pctFromMinute(interval.endMin);
    const heightPct = bottomPct - topPct;
    if (heightPct <= 0) return null;
    return (
      <AppTooltip
        key={key}
        side="right"
        content={`${label} · ${formatDurationMinutes(interval.minutes)}`}
      >
        <div
          className={cn("absolute inset-x-2 rounded-sm", className)}
          style={{ top: `${topPct}%`, height: `${heightPct}%`, minHeight: 3 }}
        />
      </AppTooltip>
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
      <div className="relative rounded-xl bg-muted/25 min-h-0 flex-1">
        <HourGrid window={window} />
        {/* Explicit bounds check, not a consequence of the pct maths: pctFromMinute
            clamps to [0,100], so omitting this renders a plausible line pinned to an
            edge — a confident 07:00 reading at 03:00 — instead of nothing. */}
        {props.today && window && nowMin >= window.startMin && nowMin <= window.endMin ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-10"
            style={{ top: `${pctFromMinute(nowMin)}%` }}
            aria-hidden="true"
          >
            <div className="absolute -left-0.5 -top-[3px] size-1.5 rounded-full bg-destructive" />
            <div className="h-px bg-destructive/70" />
          </div>
        ) : null}
        {!onShift && props.checkins.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-3">
            <span className="text-xs text-muted-foreground">Day off</span>
          </div>
        ) : null}

        {errorPresentations.map((row, idx) => {
          const m = row.startMin;
          const topPct = pctFromMinute(m);
          const label =
            row.kind === "rogue"
              ? "Rogue punch"
              : "Unpaired punch";
          return (
            <AppTooltip
              key={`${row.checkin.time}-${idx}`}
              side="right"
              content={`${label} · ${format(parseDateTimeLocal(row.checkin.time), "h:mm a")}`}
            >
              <div
                className="absolute inset-x-2 h-1 rounded-full bg-destructive shadow-sm"
                style={{ top: `calc(${topPct}% - 2px)` }}
              />
            </AppTooltip>
          );
        })}

        {offShiftPresentations.map((row, idx) => {
          const m = row.startMin;
          const topPct = pctFromMinute(m);
          return (
            <AppTooltip
              key={`off-${row.checkin.time}-${idx}`}
              side="right"
              content={`Off-shift punch · ${format(parseDateTimeLocal(row.checkin.time), "h:mm a")}`}
            >
              <div
                className="absolute inset-x-2 h-1 rounded-full border border-brand-accent/60 bg-brand-accent/40 shadow-sm"
                style={{ top: `calc(${topPct}% - 2px)` }}
              />
            </AppTooltip>
          );
        })}

        {openSessions.map((row, idx) => {
          if (row.confirmedEndMin <= row.startMin) {
            // No time has accrued to draw as a band — e.g. an unpaired punch
            // after shift end, capped to zero length by `capEnd`. openSession
            // is the only presentation kind with no other fallback marker, so
            // dropping this silently (as the zero-height guard in
            // renderTimelineBand would) makes a real punch vanish. Reuse the
            // off-shift tick: this is an informational point, not a worked
            // span, so it gets the same visual treatment.
            const topPct = pctFromMinute(row.startMin);
            return (
              <AppTooltip key={`open-tick-${idx}`} side="right" content={openSessionLabel(row)}>
                <div
                  className="absolute inset-x-2 h-1 rounded-full border border-brand-accent/60 bg-brand-accent/40 shadow-sm"
                  style={{ top: `calc(${topPct}% - 2px)` }}
                />
              </AppTooltip>
            );
          }
          const confirmed = renderTimelineBand(
            `open-${idx}`,
            {
              startMin: row.startMin,
              endMin: row.confirmedEndMin,
              minutes: Math.max(0, row.confirmedEndMin - row.startMin),
            },
            cn(color, "shadow-sm ring-1 ring-foreground/10"),
            openSessionLabel(row)
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
                  "Punches may still be in transit"
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
            "Scheduled"
          )
        )}

        {missingExpected.map((interval, idx) =>
          renderTimelineBand(
            `missing-${idx}`,
            interval,
            "border border-dashed border-destructive/75 bg-destructive/5",
            "Missing expected"
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
            <AppTooltip
              key={idx}
              side="right"
              content={
                <>
                  {isLunch ? "Lunch" : "Away"} · {formatDurationMinutes(g.minutes)}
                  {isObservedLunch ? " · observed" : null}
                  {isScheduledLunch ? " · scheduled" : null}
                </>
              }
            >
              <div
                className={cn(
                  "absolute inset-x-2 rounded-sm border",
                  isObservedLunch
                    ? "border-muted-foreground/40 bg-muted/40"
                    : isScheduledLunch
                      ? "border-muted-foreground/45 bg-muted/35"
                      : awayGapClass
                )}
                style={{
                  top: `${topPct}%`,
                  height: `${heightPct}%`,
                }}
              />
            </AppTooltip>
          );
        })}

        {segments.length === 0 ? null : (
          segments.map((s, idx) => {
            if (s.startMin == null || s.endMin == null) return null;
            const topPct = pctFromMinute(s.startMin);
            const endPct = pctFromMinute(s.endMin);
            const heightPct = endPct - topPct;
            if (heightPct <= 0) return null;
            const branchLabel = formatBranchLabel(s.branch);
            // Only worked (green) segments carry it: an off-shift day is already
            // salmon with dashed red borders, and stacking a second signal there
            // makes the louder one harder to read.
            const offSite = workedTone && isOffSiteSegment(s.branch, props.employeeBranch);
            const startLabel = s.start?.time ? format(new Date(s.start.time), "h:mma") : "—";
            const endLabel = s.end?.time ? format(new Date(s.end.time), "h:mma") : "—";
            const compactTip = [
              `${startLabel}–${endLabel}`,
              s.minutes != null ? formatDurationMinutes(s.minutes) : null,
              branchLabel,
              // Lateness is derived from the day's FIRST punch, so it belongs to
              // the first segment only. Stamped on every segment it read as
              // "late again after lunch", which is not a thing the engine
              // measures.
              idx === 0 && lateness?.isLate && lateness.deltaMinutes != null
                ? `Late ${formatDurationMinutes(lateness.deltaMinutes, { signed: true })}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <AppTooltip key={idx} side="right" content={compactTip || "Segment"}>
                <div
                  className={cn(
                    "absolute inset-x-2 rounded-sm",
                    workedTone
                      ? cn(color, "shadow-sm ring-1 ring-foreground/10")
                      : offShiftSegmentClass,
                    offSite && "seg-offsite"
                  )}
                  style={{
                    top: `${topPct}%`,
                    height: `${heightPct}%`,
                  }}
                >
                  {heightPct >= 12 ? (
                    <div className="pointer-events-none absolute inset-0 px-2 pt-1.5 text-white/95">
                      <div className="absolute left-2 top-1.5 text-[11px] font-semibold leading-tight">
                        {startLabel}
                      </div>
                      {heightPct >= 18 ? (
                        <div className="absolute right-2 top-1.5 text-[10px] font-medium text-white/85">
                          {formatDurationMinutes(s.minutes)}
                        </div>
                      ) : null}
                      {idx === 0 &&
                      heightPct >= 22 &&
                      lateness?.isLate &&
                      lateness.deltaMinutes != null ? (
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
              </AppTooltip>
            );
          })
        )}
      </div>
    </div>
  );
}
