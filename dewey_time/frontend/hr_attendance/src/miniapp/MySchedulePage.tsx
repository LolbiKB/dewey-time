import { format, isSameDay } from "date-fns";

import { cn } from "@/lib/utils";
import { plannedDaysFromSchedule, type PlannedDay } from "@/lib/plannedDays";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { formatMinuteOfDay } from "@/miniapp/miniDay";
import { weekForOffset, weekRangeLabel } from "@/miniapp/miniWeek";
import { WeekNav } from "@/miniapp/MiniWeekNav";
import { MiniErrorState, MiniState } from "@/miniapp/MiniState";
import { useFormat, useLocale, useT } from "@/miniapp/MiniLocale";
import { siteNow } from "@/miniapp/siteClock";

/** Rostered hours net of the unpaid lunch, which is what a day is actually worth. */
export function netRosteredMinutes(day: PlannedDay): number | null {
  if (!day.works || day.durationMin === undefined) return null;
  return day.durationMin;
}

/** Total net rostered minutes for the week. Null when nothing is rostered. */
export function weekRosteredMinutes(days: PlannedDay[]): number | null {
  const worked = days.filter((d) => d.works && !d.onLeave && d.durationMin);
  if (!worked.length) return null;
  return worked.reduce((sum, d) => sum + (d.durationMin ?? 0), 0);
}

/**
 * One rostered day.
 *
 * Three lines of information in two rows, because a shift is not just a span:
 * the hours you are due, when your break is, and what that day is worth net of
 * it. Before this the row showed a 24-hour span and a bare total, so an
 * employee could not tell whether "8h" already had lunch taken out — which is
 * the single most asked question about a roster.
 */
export function ScheduleRow(props: { day: PlannedDay; isToday: boolean; date?: Date }) {
  const { day, isToday } = props;
  const t = useT();
  const fmt = useFormat();
  const isKhmer = useLocale() === "km";
  const span = fmt.span(day.startMin, day.endMin);
  const lunch = fmt.span(day.lunchStartMin, day.lunchEndMin);
  // `day.label` and `day.sublabel` come out of the shared week builder as
  // "Mon" and "27", in English, because that builder also feeds the HR
  // console. Re-derived from the date here rather than translated, which
  // would mean mapping English abbreviations back to weekdays.
  const label = props.date ? fmt.date(props.date, "EEE") : day.label;
  const sublabel = props.date ? fmt.date(props.date, "d") : day.sublabel;

  return (
    <li
      className={cn(
        "flex items-start gap-2 px-3 py-2.5",
        isToday && "bg-primary/5",
      )}
    >
      {/* Same sizing rule as the Week row: the Khmer weekday abbreviation is
          one consonant, so a column sized for "Mon" wastes 30px of a row that
          needs it for the shift span. */}
      <span
        className={cn(
          "shrink-0 pt-0.5 text-xs font-medium",
          isKhmer ? "w-4" : "w-10",
          isToday ? "text-primary" : "text-foreground",
        )}
      >
        {label}
      </span>
      <span className="w-6 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
        {sublabel}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm tabular-nums",
            day.works && !day.onLeave ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {day.onLeave
            ? (day.leaveType ?? t("stateOnLeave"))
            : day.works
              ? (span ?? t("labelRostered"))
              : t("stateDayOff")}
        </p>
        {/* Only when there IS one. "Lunch —" on a four-hour Saturday shift
            reads as a break that was taken away. */}
        {day.works && !day.onLeave && lunch ? (
          <p className="truncate text-[11px] tabular-nums text-muted-foreground">
            {t("labelLunch")} {lunch}
          </p>
        ) : null}
      </div>

      <span className="shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground">
        {day.works && !day.onLeave
          ? fmt.worked(netRosteredMinutes(day)) ?? ""
          : ""}
      </span>
    </li>
  );
}

export function MySchedulePage(props: {
  today?: Date;
  offset?: number;
  onOffsetChange?: (next: number) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  // siteNow, not new Date(): this decides which week the roster opens on.
  const today = props.today ?? siteNow();
  const offset = props.offset ?? 0;
  const week = weekForOffset(today, offset);
  // NOT POLLED, and its sibling on the same tab already knew that: MyProfile's
  // month query passes { poll: false } with a note saying nothing on this page
  // makes a claim about the present. This one — mounted by that same page —
  // took the default and re-fetched a WEEK of roster every sixty seconds, on
  // an employee's mobile data, to maintain a schedule that changes when HR
  // publishes one. A resume invalidates the key.
  const query = useMiniAppCalendar(
    format(week[0]!, "yyyy-MM-dd"),
    format(week[6]!, "yyyy-MM-dd"),
    { poll: false },
  );

  // Extracted from the Week tab when the calendar sheet replaced it. It stays
  // a separate component rather than being inlined: the roster is the one
  // surface that pages FORWARD (forwardLimit false), and that argument is
  // easier to see at a call site than buried in a page body.
  //
  // No page padding on the wrappers below — MyProfilePage, this file's only
  // caller since Profile replaced the Schedule tab, supplies it. Keeping p-3
  // here would nest it inside Profile's own.
  const nav = (
    <WeekNav
      label={weekRangeLabel(week, fmt)}
      offset={offset}
      onOffsetChange={props.onOffsetChange ?? (() => {})}
      forwardLimit={false}
    />
  );

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {nav}
        <MiniState>{t("loadingSchedule")}</MiniState>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col gap-3">
        {nav}
        <MiniErrorState error={query.error} fallback="errorSchedule" />
      </div>
    );
  }

  const planned = plannedDaysFromSchedule(week, daysByDate(query.data));
  const total = fmt.worked(weekRosteredMinutes(planned));

  // PAST THE HORIZON IS NOT THE SAME AS NOTHING ROSTERED. `schedule_max_date`
  // is how far the wizard has actually published; beyond it there is no roster
  // to have, and "No shifts are assigned to you this week" is a statement about
  // the schedule that reads as a statement about the person. Workers plan
  // around not working, and the roster lands two days later.
  const horizon = query.data?.schedule_max_date;
  const beyondHorizon = Boolean(horizon) && week.every((day) => format(day, "yyyy-MM-dd") > horizon!);

  return (
    <div className="flex flex-col gap-3">
      {nav}

      {planned.every((d) => !d.works) ? (
        <MiniState>{t(beyondHorizon ? "rosterNotPublished" : "noShiftsThisWeek")}</MiniState>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {planned.map((day, index) => (
              <ScheduleRow
                key={day.key}
                day={day}
                date={week[index]!}
                isToday={isSameDay(week[index]!, today)}
              />
            ))}
          </ul>

          {/* Named "rostered", never "worked". This tab is the plan; the Week
              tab is what happened, and the two numbers differ on any real
              week. Saying which is which is the whole reason both exist. */}
          <div className="flex items-baseline justify-between px-1">
            <span className="text-xs text-muted-foreground">{t("rosteredThisWeek")}</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {total ?? "—"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Re-exported for the tests, which assert the 12h conversion at this seam. */
export { formatMinuteOfDay };
