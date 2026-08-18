/**
 * How many things on this day are worth a look.
 *
 * IN NORMAL FLOW. It was `position: fixed` at a hand-computed offset above the
 * tab bar, and the offset omitted the safe-area inset — measured in a browser
 * at 390x560 with a 34px inset, the pill's bottom edge sat 35px BELOW the
 * nav's top edge, straight across the tab labels. At zero inset it cleared by
 * nothing at all, so the placement never had clearance on any device.
 *
 * The lesson is not "the number was wrong". A fixed element cannot be laid out
 * against a sibling it cannot measure, so every viewport, keyboard and inset
 * change is another chance for the two to disagree. `MiniDayNumbers` places
 * this in the flow instead, where the browser does the arithmetic.
 *
 * HIDDEN AT ZERO. The calendar mark already says a day is clean, and a
 * permanent "0 to check" is chrome on the shortest axis this app has — the same
 * objection that removed the add-to-home-screen row.
 */
import { TriangleAlertIcon } from "lucide-react";

import { useFormat, useT } from "@/miniapp/MiniLocale";

export function MiniFlagButton(props: { count: number; onOpen: () => void }) {
  const t = useT();
  const fmt = useFormat();
  if (props.count <= 0) return null;
  return (
    // The visible text is the accessible name. A plain button takes its name
    // from content, so no aria-label is needed — unlike the calendar's day
    // buttons, which needed one only because react-day-picker sets its own and
    // an aria-label beats content unconditionally.
    <button
      type="button"
      onClick={props.onOpen}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[13px] font-semibold text-foreground shadow-sm transition-colors active:bg-muted"
    >
      <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-amber-500" />
      {/* Digits in the reader's own script. Khmer numerals are the whole reason
          fmt.digits exists, and a Latin "2" beside Khmer words is the exact
          leak the e2e guard forbids. */}
      <span>{t("flagsToCheck").replace("{n}", fmt.digits(String(props.count)))}</span>
    </button>
  );
}
