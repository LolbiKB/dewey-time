/**
 * What the engine noticed about this day, and where HR has got to with it.
 *
 * READ-ONLY. The Attendance Flag doctype already carries employee_note,
 * employee_attachment and a status of EXPLAINED, and the HR console already
 * tells reviewers to expect explanations (flagDetails.ts:137) — for something
 * no employee can currently do. Wiring that up is deliberately out of scope: it
 * would be this app's first write endpoint and deserves its own design.
 *
 * `Sheet`, not `ResponsiveModal`: the latter swaps to a centre Dialog above a
 * width breakpoint and a Telegram Desktop Mini App is wide enough to trip it.
 * This has to be a bottom sheet everywhere.
 */
import { TriangleAlertIcon } from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { flagStatusKey, flagText, visibleFlags } from "@/miniapp/miniFlags";
import { useT } from "@/miniapp/MiniLocale";
import type { Day } from "@/types/calendar";

export function MiniFlagsSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Day | undefined;
}) {
  const t = useT();
  const flags = visibleFlags(props.day);

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="bottom" className="gap-0 rounded-t-xl px-4 pb-8">
        <SheetHeader className="px-0 pb-2">
          <SheetTitle className="text-base">{t("flagsSheetTitle")}</SheetTitle>
        </SheetHeader>

        {/* The pill is hidden at zero, so this is only reachable when a sheet
            left open outlives its last flag across a refetch. A line rather
            than a collapse: an empty sheet reads as a broken one. */}
        {flags.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("flagsNone")}</p>
        ) : (
          <ul className="flex flex-col gap-4 py-1">
            {flags.map((flag, i) => {
              const text = flagText(flag);
              if (!text) return null;
              return (
                // Index in the key because the narrowed flag carries no id —
                // `name` is HR-only and deliberately not sent. The list is
                // re-rendered whole on every refetch, so there is no identity
                // to preserve across one.
                <li key={`${flag.flag_code}-${i}`} className="flex gap-3">
                  <TriangleAlertIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-amber-500"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {t(text.title)}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                      {t(text.body)}
                    </p>
                    <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">
                      {t(flagStatusKey(flag))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
