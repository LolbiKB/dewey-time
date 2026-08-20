/**
 * The day's totals, and the way into its flags.
 *
 * One row, in the flow, between the timeline and the tab bar. It carries the
 * two things the canvas cannot state — what the day added up to, and what it
 * was supposed to be — and it gives the flags pill somewhere to live that is
 * not a floating layer above the tab bar. See MiniFlagButton for what that
 * cost before.
 *
 * IT HIDES ITSELF when it has nothing: no figures and no flags means no row,
 * rather than a border and an em dash. On the shortest axis this app has, an
 * empty strip of chrome is the objection that removed the summary block and
 * the add-to-home-screen row both.
 */
import { MiniFlagButton } from "@/miniapp/MiniFlagButton";
import { useFormat, useT } from "@/miniapp/MiniLocale";
import { dayNumbers } from "@/miniapp/miniDay";
import type { Day } from "@/types/calendar";
import { showsFeedNotice } from "@/miniapp/miniDayMark";

export function MiniDayNumbers(props: {
  day: Day | undefined;
  date: Date;
  today: Date;
  now: Date;
  flagCount: number;
  onOpenFlags: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const numbers = dayNumbers(props.day, props.date, props.today, props.now);

  // Formatted first, then tested: fmt.worked returns null for a null figure
  // and "0m" for a zero one, and zero minutes worked is a fact worth printing
  // for somebody who clocked in a minute ago.
  const worked = fmt.worked(numbers.worked);
  const rostered = fmt.worked(numbers.rostered);
  if (!worked && !rostered && props.flagCount <= 0) return null;

  // A spoken sentence, because "8h 11m / 8h" read aloud is two durations and a
  // slash. The visible row stays compact; this is what is announced.
  //
  // Except when nothing was worked AND our own feed never delivered. The
  // rostered-only sentence is "Rostered 8h, nothing worked yet", which on a day
  // the Bridge went down is an accusation dressed as a reading — the employee
  // punched in and out normally and the machine never told us. Say whose
  // problem it actually is.
  // THE SAME PREDICATE AS THE VISIBLE BANNER below this row (showsFeedNotice)
  // — keyed on the bare boolean, the spoken sentence and the visible notice
  // disagreed on one screen: sighted and assistive-tech users got different
  // accounts of the same day.
  const uncertain = showsFeedNotice(props.day, props.date, props.now) && !worked;
  // A RECORD THAT DOES NOT ADD UP IS NOT AN EMPTY DAY, and the row already
  // knows the difference: it prints "—", which means "no figure", not "zero".
  // Only the spoken sentence collapsed the two. `worked` is null whenever the
  // punches produced no usable pair — a clock-in nobody closed, two arrivals
  // in a row, a punch whose device had no branch mapped — and every one of
  // those is somebody who WAS here, being told they worked nothing.
  //
  // Distinct from `uncertain` above, which is about OUR feed: this one is
  // about the punches themselves, and it applies whether or not the device
  // ever went quiet.
  const hasRecord = (props.day?.checkins?.length ?? 0) > 0;
  const spoken = uncertain
    ? t("feedUncertain")
    : worked && rostered
      ? t("dayAriaWorkedOfRostered").replace("{worked}", worked).replace("{rostered}", rostered)
      : worked
        ? t("dayAriaWorkedOnly").replace("{worked}", worked)
        : rostered
          ? hasRecord
            ? t("dayAriaRosteredNoTotal").replace("{rostered}", rostered)
            : t("dayAriaRosteredOnly").replace("{rostered}", rostered)
          : // No roster and no total: the clock-based cohort, whose day this
            // row was silent about entirely — a screen reader got nothing at
            // all on a day with punches and a flag on it.
            hasRecord
            ? t("dayAriaNoTotal")
            : null;

  return (
    // justify-between with an empty span as the left item when there are no
    // figures, so a lone pill still sits where a pill always sits.
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-1 pt-2">
      {spoken ? (
        <span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
          <span className="sr-only">{spoken}</span>
          {/* WRAPS, and never truncates. Measured at 320px in Khmer, live, with
              a two-digit hour — "១២ ម៉ោង ៥៧ នាទី គិតត្រឹមពេលនេះ / ៨ ម៉ោង" — a
              `truncate` here put the ellipsis on the WORKED FIGURE, which is
              the one number the row exists to show. The marker gives way to a
              second line instead, and only on the phones that need it. */}
          <span aria-hidden="true" className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="font-semibold text-foreground">{worked ?? "—"}</span>
            {/* Only while a run is open. On a closed day the total is final and
                "so far" would understate a finished figure. */}
            {numbers.live ? (
              <span className="font-normal text-muted-foreground">{t("daySoFar")}</span>
            ) : null}
            {rostered ? (
              <span className="text-muted-foreground">/ {rostered}</span>
            ) : null}
          </span>
        </span>
      ) : (
        <span />
      )}
      <MiniFlagButton count={props.flagCount} onOpen={props.onOpenFlags} />
    </div>
  );
}
