import { format, isSameDay } from "date-fns";

import { cn } from "@/lib/utils";
import { DayCell } from "@/ui/DayTimeline";
import { HourGutter } from "@/ui/TimelineAxis";
import { resolveWeekTimelineWindow } from "@/lib/weekTimelineWindow";
import { daysByDate, useMiniAppCalendar } from "@/miniapp/useMiniAppSession";
import { dayFacts, type DayFacts } from "@/miniapp/miniDay";
import { MiniState } from "@/miniapp/MiniState";
import { useT } from "@/miniapp/MiniLocale";

/**
 * One labelled number. Three of these are the whole summary.
 *
 * The label is always rendered, even when the value is missing, because the
 * absence is itself the answer — a day with an In and no Out is mid-shift, and
 * a strip that dropped the empty cell would silently re-flow into something
 * that looks complete.
 */
function Stat(props: { label: string; value: string | null; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </span>
      <span
        className={cn(
          "truncate text-sm tabular-nums",
          props.value === null && "text-muted-foreground",
          props.accent ? "font-semibold text-foreground" : "text-foreground",
        )}
      >
        {props.value ?? "—"}
      </span>
    </div>
  );
}

/** The tone's own wording and colour, in one place so the two cannot disagree. */
const TONE_STYLE: Record<DayFacts["tone"], string> = {
  worked: "bg-primary/10 text-primary",
  leave: "bg-muted text-muted-foreground",
  holiday: "bg-muted text-muted-foreground",
  off: "bg-muted text-muted-foreground",
  scheduled: "bg-muted text-muted-foreground",
  nothing: "bg-muted text-muted-foreground",
};

export function DaySummary(props: { facts: DayFacts }) {
  const { facts } = props;
  const t = useT();
  const state = facts.tone === "worked"
    ? t("stateWorked")
    : facts.noteText ?? (facts.noteKey ? t(facts.noteKey) : "—");
  return (
    <section
      aria-label={t("summary")}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            TONE_STYLE[facts.tone],
          )}
        >
          {state}
        </span>
        {facts.shift ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {t("labelRostered")} {facts.shift}
          </span>
        ) : null}
      </div>

      {/* The break, where there is one. Without it "Worked 8h 11m" against a
          9-hour roster looks like an hour unaccounted for, when it is lunch —
          the most common reason someone reads this screen at all. */}
      {facts.lunch ? (
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {t("labelLunch")} {facts.lunch}
          <span className="ml-1">· {t("lunchNotCounted")}</span>
        </p>
      ) : null}
      {/* Only for a day with punches. On a rest day three em dashes under three
          headings is a form nobody filled in, where the badge above has
          already given the complete answer. */}
      {facts.tone === "worked" ? (
        <div className="flex gap-3">
          <Stat label={t("labelIn")} value={facts.firstIn} />
          <Stat label={t("labelOut")} value={facts.lastOut} />
          <Stat label={t("labelWorked")} value={facts.worked} accent />
        </div>
      ) : null}
    </section>
  );
}

export function MyDayPage(props: { today?: Date; date?: Date }) {
  const t = useT();
  const today = props.today ?? new Date();
  const date = props.date ?? today;
  const key = format(date, "yyyy-MM-dd");
  const query = useMiniAppCalendar(key, key);

  if (query.isLoading) return <MiniState>{t("loadingDay")}</MiniState>;
  if (query.isError) return <MiniState>{t("errorDay")}</MiniState>;

  const byDate = daysByDate(query.data);
  const info = byDate.get(key);
  const facts = dayFacts(info, date, today);
  // The same window maths the HR week uses, over a single day: it keeps the
  // axis on whole hours and sized to the shift rather than to 00:00-24:00.
  const window = resolveWeekTimelineWindow([date], byDate);

  return (
    // `h-full` and `min-h-0`, not a fixed pixel height: the sheet's height is
    // Telegram's to decide and it changes as the user drags it, so the
    // timeline has to take what is left after the summary rather than assume.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold text-foreground">
          {isSameDay(date, today) ? t("tabToday") : format(date, "EEEE")}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {format(date, "d MMMM")}
          </span>
        </h1>
      </header>

      <DaySummary facts={facts} />

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
        <HourGutter window={window} />
        <DayCell
          date={date}
          outside={false}
          today={isSameDay(date, today)}
          info={info}
          timelineStartMin={window.startMin}
          timelineEndMin={window.endMin}
          // No inspector in the Mini App: the day sheet is HR's review
          // surface and carries flag evidence an employee must not see.
          onInspectDay={() => {}}
        />
      </div>
    </div>
  );
}
