/**
 * How many things on this day are worth a look.
 *
 * BOTTOM-LEFT, floating. Measured against the real app at 390x520: this costs
 * zero timeline height, while Telegram's native SecondaryButton — the
 * alternative considered — took the canvas from 330px to 256px, 22% of the
 * drawn day. Left rather than right because the hour gutter is the only column
 * of that canvas with nothing at stake; the right side is where punch blocks
 * print their own times and durations on their faces.
 *
 * HIDDEN AT ZERO. The calendar mark already says a day is clean, and a
 * permanent "0 to check" is chrome on the shortest axis this app has — the same
 * objection that removed the add-to-home-screen row.
 */
import { TriangleAlertIcon } from "lucide-react";

import { useFormat, useT } from "@/miniapp/MiniLocale";

export function MiniFlagButton(props: {
  count: number;
  onOpen: () => void;
  /** Distance from the bottom of the viewport, in px — the tab bar to clear. */
  lift: number;
}) {
  const t = useT();
  const fmt = useFormat();
  if (props.count <= 0) return null;
  return (
    // Fixed rather than absolute: the Day page scrolls and this must not scroll
    // with it.
    //
    // The visible text is the accessible name. A plain button takes its name
    // from content, so no aria-label is needed — unlike the calendar's day
    // buttons, which needed one only because react-day-picker sets its own and
    // an aria-label beats content unconditionally.
    <button
      type="button"
      onClick={props.onOpen}
      style={{ bottom: props.lift }}
      className="fixed left-3.5 z-40 flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-2 text-[13px] font-semibold text-foreground shadow-lg transition-colors active:bg-muted"
    >
      <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-amber-500" />
      {/* Digits in the reader's own script. Khmer numerals are the whole reason
          fmt.digits exists, and a Latin "2" beside Khmer words is the exact
          leak the e2e guard forbids. */}
      <span>{t("flagsToCheck").replace("{n}", fmt.digits(String(props.count)))}</span>
    </button>
  );
}
