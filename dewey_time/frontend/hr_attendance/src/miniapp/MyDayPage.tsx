/**
 * The Day tab: a date, and the timeline.
 *
 * THERE IS NO SUMMARY BLOCK. There was one, and it was removed deliberately
 * rather than lost: it restated the canvas below it. The punch blocks carry
 * "7:58AM" and "5:06PM" on their own faces and each run prints its own
 * duration, the rostered window is the dashed band, and lunch is the gap
 * between the two runs. Three lines of text above a picture that already says
 * it is three lines of text to read past.
 *
 * What the canvas does NOT say is recorded here and in this file's git
 * history, because it is the cost of this decision:
 *
 *   - the NET TOTAL. The canvas gives 4h 3m and 4h 8m; nobody adds those in
 *     their head. It now sits in the row beneath the canvas, beside the
 *     rostered figure it is read against; the calendar sheet still totals the
 *     month.
 *   - LEAVE. DayCell reads holiday and punches; it does not read `leave` at
 *     all, so a leave day draws as a dashed band or as "Day off". The status
 *     chip beside this heading names the leave type.
 *
 * Both are deliberate, both are the owner's call, and both are recoverable by
 * restoring DaySummary from history.
 */
import { useState } from "react";
import { format, isSameDay } from "date-fns";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DayCell } from "@/ui/DayTimeline";
import { HourGutter } from "@/ui/TimelineAxis";
import { resolveWeekTimelineWindow } from "@/lib/weekTimelineWindow";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { isLive, miniStatus, statusKey, type MiniStatus } from "@/miniapp/miniStatus";
import { MiniErrorState, MiniState } from "@/miniapp/MiniState";
import { MiniDayNumbers } from "@/miniapp/MiniDayNumbers";
import { MiniFlagsSheet } from "@/miniapp/MiniFlagsSheet";
import { flagCount } from "@/miniapp/miniFlags";
import { useFormat, useT } from "@/miniapp/MiniLocale";
import { useTimelineIntl } from "@/miniapp/miniTimelineIntl";
import { useMinuteTick } from "@/miniapp/useMinuteTick";
import { miniDayAccessibleName } from "@/miniapp/miniDayLabel";

/**
 * Where you are in the day, opposite the date.
 *
 * The header row had a date on the left and empty space on the right. This is
 * the one line worth putting there: not a restatement of the canvas below, but
 * the present tense the canvas cannot state — whether you are in, out, on
 * lunch, or have not started.
 *
 * It also puts a name on the day the canvas draws worst. DayCell reads holiday
 * and punches; it never reads `leave`, so a leave day is a blank dashed band
 * and reads exactly like a rostered morning nobody has arrived for.
 *
 * A live state gets colour and a dot. Nothing else does — a heartbeat beside
 * "Day off" would be a pulse on a day nobody is working.
 */
function StatusChip(props: { status: MiniStatus }) {
  const t = useT();
  const { status } = props;
  if (status.kind === "none") return null;

  const key = statusKey(status);
  // The data's own word wins where it has one: a leave type out of ERPNext is
  // a value this app does not own and must not translate.
  const label = (status.kind === "named" && status.text) || (key ? t(key) : null);
  if (!label) return null;

  const live = isLive(status);
  return (
    <span
      className={cn(
        // shrink-0 against a truncating heading: the date is the shorter of the
        // two and gives way first. max-w keeps a long branch name from taking
        // the row — measured in Khmer at 320px, where both fit.
        //
        // leading-normal, not leading-tight. Khmer stacks marks BELOW the
        // baseline (្ក, ុ, ូ), and a line box tightened for Latin clips them —
        // so "កំពុងធ្វើការ" lost the foot of its consonants. The row is a
        // single line and already shrink-0, so the extra leading costs nothing
        // horizontally.
        "flex max-w-[58%] shrink-0 items-center gap-1.5 text-[11px] leading-normal",
        live ? "font-medium text-primary" : "text-muted-foreground",
      )}
    >
      {live ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
      ) : null}
      <span className="truncate">
        {label}
        {/* Where the last punch was taken. The same fact the check-in
            notification already states ("Checked in 07:58 · DIS Iconic"), and
            on a roster where people move between sites it is half the answer
            to "am I in?". */}
        {status.kind === "in" && status.branch ? ` · ${status.branch}` : null}
      </span>
    </span>
  );
}

export function MyDayPage(props: {
  today?: Date;
  date?: Date;
  now?: Date;
  /** Opens the calendar sheet. Omitted in tests that render the page alone. */
  onPickDate?: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  // Above the loading/error early returns, where every hook in this file has to
  // sit — React counts them per render and those returns come before `info`.
  const timelineIntl = useTimelineIntl();
  const [flagsOpen, setFlagsOpen] = useState(false);
  // A TICKING CLOCK, not the render's. "So far" is derived from `now`, and a
  // poll that returns unchanged data does not re-render — so the live figure
  // froze at whatever it was when the page first drew and stayed there for
  // hours beside a pulsing dot claiming it was current. On a client too old for
  // the resume event, the DATE never rolled past midnight either.
  const tick = useMinuteTick();
  const today = props.today ?? tick;
  // Separate from `today` because they answer different questions: `today` is
  // which date counts as the current one, `now` is the time of day the status
  // is read against. A test needs to pin the second without moving the first.
  const now = props.now ?? tick;
  const date = props.date ?? today;
  const key = format(date, "yyyy-MM-dd");
  const query = useMiniAppCalendar(key, key);

  if (query.isLoading) return <MiniState>{t("loadingDay")}</MiniState>;
  if (query.isError) return <MiniErrorState error={query.error} fallback="errorDay" />;

  const byDate = daysByDate(query.data);
  const info = byDate.get(key);
  // The same window maths the HR week uses, over a single day: it keeps the
  // axis on whole hours and sized to the shift rather than to 00:00-24:00.
  // NOT `window`. It was, and it shadowed the global across this whole
  // component: a read below the declaration silently returned THIS object
  // instead of the browser's window, and a read above it threw "Cannot access
  // 'window' before initialization" and white-screened the app behind the
  // error boundary. Both were hit while designing the row below — the silent
  // one produced a layout that looked implemented and rendered in the wrong
  // place, and looked correct in review.
  const timelineWindow = resolveWeekTimelineWindow([date], byDate);

  return (
    // `h-full` and `min-h-0`, not a fixed pixel height: the sheet's height is
    // Telegram's to decide and it changes as the user drags it, so the
    // timeline has to take what is left after the heading rather than assume.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <header className="flex items-baseline justify-between gap-3 px-1">
        {/* THE HEADING IS THE DATE PICKER. A real button, not a click handler
            on the h1 — the latter is invisible to a keyboard and announces
            nothing.

            It is the heading rather than a separate icon because this row is
            the app's most contested horizontal space: measured in Khmer at
            320px the date already truncates and the chip is capped at 58%, so
            a third element takes room from one of the two. The date is also
            where people look for a date. */}
        <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
          <button
            type="button"
            onClick={() => props.onPickDate?.()}
            className="inline-flex max-w-full items-baseline gap-1 truncate rounded-md text-left transition-colors active:text-primary"
          >
            <span className="truncate">
              {isSameDay(date, today) ? t("tabToday") : fmt.date(date, "EEEE")}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {fmt.date(date, "d MMMM")}
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 self-center text-muted-foreground"
            />
            <span className="sr-only">{t("chooseDate")}</span>
          </button>
        </h1>
        <StatusChip status={miniStatus(info, date, now)} />
      </header>

      {/* `grid` with an explicit column, NOT a block. DayCell's root is a
          <button>, which is inline-level and collapses to a narrow sliver in a
          block wrapper — issue #71, documented at WeekDayView.tsx:143. The
          week grid never notices because its items stretch to fill their
          column; a single-column grid stretches it the same way, so the two
          surfaces cannot drift apart. The 3.5rem gutter is the hour axis,
          without which a lone timeline has no scale to read against.

          min-h-[16rem] is a floor, not a height: on a half-height sheet the
          flex share alone would squeeze the axis to a few unreadable hours,
          and the page scrolls rather than the timeline collapsing. */}
      <div className="grid min-h-[16rem] flex-1 grid-cols-[3.5rem_1fr] [&>button]:border-0">
        <HourGutter window={timelineWindow} formatHour={fmt.hour} />
        <DayCell
          date={date}
          outside={false}
          today={isSameDay(date, today)}
          info={info}
          timelineStartMin={timelineWindow.startMin}
          timelineEndMin={timelineWindow.endMin}
          intl={timelineIntl}
          // Their own employment type. Without it a Contract or Casual worker's
          // ordinary day drew in the dashed-salmon off-shift style with lunch in
          // destructive red, every day, for doing exactly what their contract
          // requires — while HR's screen showed the same day as solid work.
          isClockDay={query.data?.is_clock_based === true && !info?.shift?.shift_assigned}
          // The Mini App is not a verdict surface, and its payload carries no
          // grace minutes — so a lateness figure here would be computed against
          // the shift start with zero grace and stamp "+7m" on a morning the
          // engine forgave.
          showLateness={false}
          // A tooltip is the one affordance a phone does not have.
          labelBands
          accessibleName={miniDayAccessibleName(info, date, today, { t, fmt }, flagCount(info))}
          // No `onInspectDay`: the day sheet is HR's review surface and carries
          // flag evidence an employee must not see, so there is nothing to open.
          // Omitting it renders a section rather than a button that does nothing.
        />
      </div>

      <MiniDayNumbers
        day={info}
        date={date}
        today={today}
        now={now}
        flagCount={flagCount(info)}
        onOpenFlags={() => setFlagsOpen(true)}
      />
      {/* Whose gap it is. Without this a day our own device never delivered was
          pixel-identical to a no-show: the same amber mark, the same "— / 8h",
          on the phone of somebody who punched in and out perfectly well. */}
      {info?.feed_uncertain ? (
        <p role="status" className="shrink-0 px-1 text-xs leading-normal text-muted-foreground">
          {t("feedUncertain")}
        </p>
      ) : null}

      <MiniFlagsSheet open={flagsOpen} onOpenChange={setFlagsOpen} day={info} />
    </div>
  );
}
