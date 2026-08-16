import { addDays, format, isSameDay, startOfWeek } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { dayFacts, formatTotalWorked, type DayFacts } from "@/miniapp/miniDay";
import { MiniState } from "@/miniapp/MiniState";
import { useT } from "@/miniapp/MiniLocale";

/** Monday-first, matching the HR week view. */
export function weekDatesFor(today: Date): Date[] {
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * How the week header reads: "6 – 12 Oct", or "29 Sep – 5 Oct" across a month.
 *
 * The month is repeated only when the week actually straddles two, because on
 * a 390px phone every character in this header competes with the two arrow
 * buttons beside it.
 */
export function weekRangeLabel(week: Date[]): string {
  const first = week[0]!;
  const last = week[6]!;
  const sameMonth = first.getMonth() === last.getMonth();
  return sameMonth
    ? `${format(first, "d")} – ${format(last, "d MMM")}`
    : `${format(first, "d MMM")} – ${format(last, "d MMM")}`;
}

/**
 * Which week is on screen, relative to the one containing today.
 *
 * An OFFSET rather than a stored date, so "this week" cannot drift: a Date in
 * state would still point at last Monday after midnight on Sunday, and the
 * header would quietly disagree with what "Today" shows on the next tab.
 */
export function weekForOffset(today: Date, offset: number): Date[] {
  return weekDatesFor(addDays(startOfWeek(today, { weekStartsOn: 1 }), offset * 7));
}

/** Never past the current week: there is nothing recorded in the future. */
export function canGoForward(offset: number): boolean {
  return offset < 0;
}

export function WeekNav(props: {
  label: string;
  offset: number;
  onOffsetChange: (next: number) => void;
  /**
   * Whether forward is capped at the current week. True for attendance, which
   * has not happened yet; FALSE for the roster, which is published ahead and
   * is the thing an employee most wants to look forward at.
   */
  forwardLimit?: boolean;
}) {
  const t = useT();
  const forward = props.forwardLimit === false ? true : canGoForward(props.offset);
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        aria-label={t("previousWeek")}
        onClick={() => props.onOffsetChange(props.offset - 1)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
      >
        <ChevronLeftIcon className="size-5" aria-hidden="true" />
      </button>

      <div className="min-w-0 text-center">
        <p className="truncate text-base font-semibold text-foreground">{props.label}</p>
        {props.offset !== 0 ? (
          <button
            type="button"
            onClick={() => props.onOffsetChange(0)}
            className="text-[11px] font-medium text-primary"
          >
            {t("backToThisWeek")}
          </button>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t("thisWeek")}</p>
        )}
      </div>

      {/* Disabled rather than hidden: a control that vanishes moves the header
          under the user's thumb between weeks. */}
      <button
        type="button"
        aria-label={t("nextWeek")}
        disabled={!forward}
        onClick={() => props.onOffsetChange(props.offset + 1)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronRightIcon className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** The row's right-hand value: worked time, or nothing when none is known. */
function rowValue(facts: DayFacts): string | null {
  return facts.worked;
}

export function WeekRow(props: {
  date: Date;
  facts: DayFacts;
  isToday: boolean;
  onOpen: (date: Date) => void;
}) {
  const { date, facts, isToday } = props;
  const t = useT();
  // The data's own name for the day when it has one (a leave type out of
  // ERPNext), otherwise this app's word for the state, in the reader's
  // language. Never a translation of a value ERPNext owns.
  const label = facts.range ?? facts.noteText ?? (facts.noteKey ? t(facts.noteKey) : null);
  return (
    <li>
      {/* A real button spanning the row. The row is the affordance — tapping a
          day opens it — and a <li> with an onClick is invisible to a keyboard
          and to a screen reader. The accessible name carries the whole row,
          because "Tuesday" alone tells a screen-reader user nothing about
          which of the seven they are on. */}
      <button
        type="button"
        onClick={() => props.onOpen(date)}
        aria-label={`${format(date, "EEEE d MMMM")}: ${facts.range ?? facts.note ?? "no record"}`}
        className={cn(
          "flex w-full items-baseline gap-3 px-3 py-3 text-left transition-colors active:bg-muted",
          isToday && "bg-primary/5",
        )}
      >
        <span
          className={cn(
            "w-10 shrink-0 text-xs font-medium",
            isToday ? "text-primary" : "text-foreground",
          )}
        >
          {format(date, "EEE")}
        </span>
        <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
          {format(date, "d")}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm tabular-nums",
            facts.range ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {rowValue(facts) ?? ""}
        </span>
      </button>
    </li>
  );
}

export function MyWeekPage(props: {
  today?: Date;
  offset?: number;
  onOffsetChange?: (next: number) => void;
  onOpenDay?: (date: Date) => void;
}) {
  const t = useT();
  const today = props.today ?? new Date();
  const offset = props.offset ?? 0;
  const week = weekForOffset(today, offset);
  const query = useMiniAppCalendar(
    format(week[0]!, "yyyy-MM-dd"),
    format(week[6]!, "yyyy-MM-dd"),
  );

  const nav = (
    <WeekNav
      label={weekRangeLabel(week)}
      offset={offset}
      onOffsetChange={props.onOffsetChange ?? (() => {})}
    />
  );

  // The nav stays put through both. Withholding it while the week loads means
  // the arrows jump away under a thumb that is paging through weeks — the one
  // moment they are being pressed repeatedly.
  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {nav}
        <MiniState>{t("loadingWeek")}</MiniState>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {nav}
        <MiniState>{t("errorWeek")}</MiniState>
      </div>
    );
  }

  const byDate = daysByDate(query.data);
  const facts = week.map((date) => dayFacts(byDate.get(format(date, "yyyy-MM-dd")), date, today));
  const total = formatTotalWorked(facts);

  return (
    <div className="flex flex-col gap-3 p-3">
      {nav}

      {/* A list, not the HR week canvas. Seven timeline columns need ~8rem
          each to keep their headers readable, which is 56rem against a 390px
          phone -- two and a half days visible and five off-screen. A vertical
          list shows the whole week at once, which is the question this tab
          answers. */}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {week.map((date, index) => (
          <WeekRow
            key={format(date, "yyyy-MM-dd")}
            date={date}
            facts={facts[index]!}
            isToday={isSameDay(date, today)}
            onOpen={props.onOpenDay ?? (() => {})}
          />
        ))}
      </ul>

      {/* Net of lunch, and said so. "39h 10m" against a 40-hour roster invites
          exactly one question, and the answer is the word "net". */}
      <div className="flex items-baseline justify-between px-1">
        <span className="text-xs text-muted-foreground">{t("workedThisWeek")}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{total ?? "—"}</span>
      </div>
    </div>
  );
}
