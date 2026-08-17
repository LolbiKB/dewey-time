/**
 * Page between weeks — the Schedule tab's navigator.
 *
 * Lived in MyWeekPage until the calendar sheet replaced that tab. The roster
 * is published a week at a time and this is its only way to reach another one,
 * so it moved rather than went.
 */
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { canGoForward } from "@/miniapp/miniWeek";
import { useT } from "@/miniapp/MiniLocale";

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
