/**
 * Pick a day, and see at a glance which days need looking at.
 *
 * REPLACES THE WEEK TAB. That tab answered "which day do I want?" seven days
 * at a time and spent a whole tab of permanent chrome doing it. A month grid
 * answers the same question at four times the density, from inside the tab the
 * reader is already on.
 *
 * It also picks up the one thing the Week tab carried that nothing else does —
 * a worked total — as a month figure rather than a weekly one. The month's
 * days are already fetched to draw the marks, so it costs nothing.
 *
 * The primitives are the shared ones. `Calendar` is dewey-ui's react-day-picker
 * wrapper, and `CalendarDayButton` is WRAPPED rather than replaced, so
 * selection, keyboard handling and disabled days stay the primitive's problem.
 * Not `ResponsiveModal`: it swaps to a centre Dialog above a width breakpoint,
 * and a Telegram Desktop Mini App is wide enough to trip it. This has to be a
 * bottom sheet everywhere.
 */
import { useMemo, useState } from "react";
import { addMonths, format, isSameDay, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { enUS, km } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MiniSheetClose } from "@/miniapp/MiniSheetClose";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { useDismissibleLayer } from "@/miniapp/miniBackStack";
import { useSafeAreaInsets } from "@/miniapp/useSafeAreaInsets";
import { dayFacts, totalWorkedMinutes } from "@/miniapp/miniDay";
import { dayMark, dayMarkLabel, type DayMark } from "@/miniapp/miniDayMark";
import type { StringKey } from "@/miniapp/miniStrings";
import { useFormat, useLocale, useT } from "@/miniapp/MiniLocale";

/**
 * How far back the grid pages: THREE MONTHS IN TOTAL, this one included.
 *
 * So in August it reaches June and no further. Two, not three, because
 * "three months back" reads both ways and the difference is a whole month —
 * and the wrong reading is the one that silently works.
 *
 * Far enough to cover the current and previous payroll periods, which is while
 * a missing punch is still worth disputing.
 */
export const MONTHS_BACK = 2;

export function earliestMonth(today: Date): Date {
  return startOfMonth(subMonths(today, MONTHS_BACK));
}

/** Never forward of this month: nothing is recorded in the future. */
export function latestMonth(today: Date): Date {
  return startOfMonth(today);
}

/**
 * The dot under a day number.
 *
 * `aria-hidden`, always. The words that carry it live in the button's own
 * accessible name — see the day button below — because a grid of forty
 * identical circles tells a screen-reader user nothing, and the circles are
 * the entire reason the grid exists.
 */
function Mark(props: { mark: DayMark }) {
  if (props.mark === "none") {
    // A spacer, not nothing. Without it the days that DO carry a mark are
    // taller than the ones that do not, and every row of the grid sits at a
    // slightly different height.
    return <span aria-hidden="true" className="block size-2" />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block size-2 rounded-full border-2",
        {
          // `current`, not a fixed grey: the selected day is a filled primary
          // pill, and a muted-foreground dot on it is grey on green. Inheriting
          // the button's own text colour keeps the mark legible in both states
          // without this component knowing which one it is in.
          complete: "border-current bg-current opacity-45",
          // AMBER FOR BOTH PROBLEM STATES, never `destructive`. Red is the
          // loudest colour in the palette and this surface has never spent it;
          // it reads as "you are in trouble" on a day HR may still forgive.
          //
          // HOLLOW versus SOLID, not two ring weights. Two weights of the same
          // 8px circle are indistinguishable at arm's length on a phone —
          // measured, in a screenshot, which is the only way that claim can be
          // made. Filled reads as heavier than outlined at any size.
          incomplete: "border-amber-500",
          missing: "border-amber-500 bg-amber-500",
          // GREY, NOT AMBER, and that is the whole point of the state. Amber
          // says "there is something about your day to look at"; this day's
          // gap is our device's, not theirs, and colouring it the same as a
          // no-show is the accusation this mark exists to stop. Filled rather
          // than hollow so it is not mistaken for `off` at arm's length.
          uncertain: "border-muted-foreground/55 bg-muted-foreground/25",
          off: "border-muted-foreground/35",
        }[props.mark],
      )}
    />
  );
}

export function MiniCalendarSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The day currently shown on the Day tab. */
  selected: Date;
  onSelect: (date: Date) => void;
  today?: Date;
  now?: Date;
}) {
  const t = useT();
  const fmt = useFormat();
  const locale = useLocale();
  const today = props.today ?? new Date();
  const now = props.now ?? today;
  const [month, setMonth] = useState(() => startOfMonth(props.selected));

  // The visible month only. A month grid shows at most 42 cells, inside the
  // API's 62-day cap, and the query key is the same shape the Day and Schedule
  // tabs use — so a month already fetched costs nothing to revisit.
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  // `enabled`, not empty date strings. The sheet is MOUNTED whether or not it
  // is open, and the empty range was still a live request — which the server
  // resolves to today — so a closed sheet fired a calendar build on launch and
  // again every sixty seconds, doubling every session's traffic for a surface
  // nobody had tapped.
  const query = useMiniAppCalendar(
    format(from, "yyyy-MM-dd"),
    format(to, "yyyy-MM-dd"),
    { enabled: props.open },
  );

  // Telegram's back button closes this before it touches the day underneath.
  useDismissibleLayer(props.open, () => props.onOpenChange(false));
  const insets = useSafeAreaInsets();

  const byDate = useMemo(() => daysByDate(query.data), [query.data]);
  // The label rides with the mark because it needs the DAY: an `incomplete`
  // dot has three possible wordings and only the day's own unmatched punches
  // say which one is honest (dayMarkLabel).
  const marks = useMemo(() => {
    const map = new Map<string, { mark: DayMark; label: StringKey | null }>();
    for (const [key, day] of byDate) {
      const date = new Date(`${key}T00:00:00`);
      const mark = dayMark(dayFacts(day, date, today), day, date, now);
      map.set(key, { mark, label: mark === "none" ? null : dayMarkLabel(mark, day) });
    }
    return map;
  }, [byDate, today, now]);

  // From the DAYS, not their facts: dayFacts reports null worked minutes on a
  // leave or holiday day, so totalling its output dropped exactly the hours a
  // worker came in for on a day they were paid a premium for.
  const monthTotal = useMemo(
    () => fmt.worked(totalWorkedMinutes([...byDate.values()])),
    [byDate, fmt],
  );

  // ONE EXPRESSION, TWO CONSUMERS: the caption the eye reads and the name the
  // grid announces. They were the same words written once, and the announced
  // half did not exist — react-day-picker names the grid itself, in English
  // with Latin digits, on a screen where every visible number is Khmer.
  const caption = (date: Date) =>
    `${fmt.date(date, "LLLL")} ${fmt.digits(String(date.getFullYear()))}`;

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="bottom"
        // Ours, not the design system's: its close button carries a hardcoded
        // English "Close" that no prop can translate. See MiniSheetClose.
        showCloseButton={false}
        // A dangling aria-describedby otherwise: Radix generates the id from
        // context whether or not a SheetDescription exists, so this sheet
        // pointed at an element that was never rendered. Undefined is the
        // primitive's own documented way to say "there is no description".
        aria-describedby={undefined}
        className="gap-0 rounded-t-xl px-2 pb-6"
        // ADDED to the floor, never chosen between: the sheet renders through a
        // portal outside the shell's padded container, so without this the
        // month total sits in the home-indicator swipe zone. The side edges
        // work the same way — a bare `insets.left` OVERRODE px-2 with 0px on
        // every device without a side inset, which is most of them.
        style={{
          paddingBottom: `calc(1.5rem + ${insets.bottom}px)`,
          paddingLeft: `calc(0.5rem + ${insets.left}px)`,
          paddingRight: `calc(0.5rem + ${insets.right}px)`,
        }}
      >
        <SheetHeader className="pb-0">
          <SheetTitle className="text-base">{t("chooseDate")}</SheetTitle>
        </SheetHeader>

        <Calendar
          mode="single"
          selected={props.selected}
          month={month}
          onMonthChange={setMonth}
          // The reader's own script, from the same date-fns locale the rest of
          // the app formats with — so the month name and the weekday headers
          // are Khmer without this file knowing a word of it.
          locale={locale === "km" ? km : enUS}
          // THE CAPTION IS THE ONE THING THE LOCALE DOES NOT FIX. date-fns's
          // `km` gives Khmer month names — សីហា — and then renders the year as
          // "2026", because date-fns emits Latin digits in every locale. So a
          // Khmer month grid whose every cell says ១៧ was captioned in Latin,
          // which is the exact leak miniIntl exists to close and which the
          // Khmer e2e guard forbids.
          //
          // Merged, not replaced: the wrapper spreads `formatters` over its
          // own, so this overrides the caption and leaves its month dropdown
          // alone. The same words are also the grid's accessible name now —
          // see `labelGrid` below, which is where the Latin year survived.
          formatters={{ formatCaption: caption }}
          // THE PRIMITIVE ALREADY SETS aria-label ON EVERY DAY — "Monday,
          // August 3rd, 2026". An aria-label beats name-from-content
          // unconditionally, so the visually-hidden span this file used to
          // rely on was never announced: the marks, which are the entire
          // reason this grid exists, were silent to a screen reader while the
          // source looked correct. A source-read test passed the whole time;
          // only dumping the rendered DOM showed it.
          //
          // So the words go through the primitive's own label API, where they
          // compose with the date instead of fighting it.
          labels={{
            labelDayButton: (date, modifiers) => {
              const base = fmt.date(date, "EEEE d MMMM");
              if (modifiers.hidden || modifiers.outside) return base;
              const label = marks.get(format(date, "yyyy-MM-dd"))?.label ?? null;
              return label === null ? base : `${base}, ${t(label)}`;
            },
            // The two arrows and the grid itself. Every one of these has a
            // default the primitive supplies as a bare English literal —
            // "Go to the Previous Month", and the caption again in Latin
            // digits — because react-day-picker reads labels off the LOCALE
            // object and a date-fns locale carries none. So the Khmer grid
            // this file works so hard on was paged by two English buttons and
            // announced itself as "August 2026".
            labelPrevious: () => t("previousMonth"),
            labelNext: () => t("nextMonth"),
            // And the <nav> holding them, whose default is "Navigation bar".
            labelNav: () => t("monthNavigation"),
            labelGrid: (date) => caption(date),
          }}
          weekStartsOn={1}
          // Nothing from the neighbouring months. They are disabled and
          // unmarked, so they are five greyed numbers of pure noise on the
          // row the eye lands on first.
          showOutsideDays={false}
          startMonth={earliestMonth(today)}
          endMonth={latestMonth(today)}
          disabled={{ after: today }}
          onSelect={(date) => date && props.onSelect(date)}
          className="w-full bg-transparent p-0 [&_[data-day]]:aspect-auto [&_[data-day]]:h-11"
          components={{
            DayButton: ({ day, modifiers, ...rest }) => {
              const key = format(day.date, "yyyy-MM-dd");
              const mark = marks.get(key)?.mark ?? "none";
              return (
                <CalendarDayButton day={day} modifiers={modifiers} {...rest}>
                  {/* The number in the reader's digits. react-day-picker
                      renders Latin ones and has no opinion about Khmer. */}
                  <span aria-hidden="true">{fmt.digits(String(day.date.getDate()))}</span>
                  <Mark mark={mark} />
                  {/* No visually-hidden span here. It was the obvious place to
                      put the words and it did nothing: react-day-picker sets
                      its own aria-label on this button, which wins over
                      content. The words live in `labels.labelDayButton`
                      above. */}
                </CalendarDayButton>
              );
            },
          }}
        />

        {/* Net of lunch, and said so — the same wording the roster total uses,
            because "142h" against a rostered month invites exactly one
            question and the answer is the word "net". */}
        {/* AN UNANSWERED MONTH IS NOT A CLEAN ONE. While the fetch was pending
            or failed, `byDate` was empty and this grid drew forty unmarked days
            under a dash — indistinguishable from a month with a perfect record,
            on the surface an employee opens to check exactly that. The grid
            above still renders (its numbers are real dates), but the claim
            underneath has to say which of the three it is. */}
        {query.isPending || query.isError ? (
          <div className="px-3 pt-2 text-xs text-muted-foreground" role="status">
            {query.isError ? t("errorMonth") : t("loadingMonth")}
          </div>
        ) : (
          <div className="flex items-baseline justify-between px-3 pt-2">
            <span className="text-xs text-muted-foreground">{t("workedInMonth")}</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {monthTotal ?? "—"}
            </span>
          </div>
        )}

        {/* LAST, because the design system appends its own close after
            children — anywhere else and this sheet's tab order changes. */}
        <MiniSheetClose />
      </SheetContent>
    </Sheet>
  );
}

/** Exported for the tests, which assert the paging bounds without a DOM. */
export { addMonths, isSameDay };
