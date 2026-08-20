/**
 * The X on a Mini App bottom sheet, in the reader's own language.
 *
 * THE DESIGN SYSTEM ALREADY DRAWS ONE, and that is the problem. `SheetContent`
 * appends its own close button with a hardcoded `<span className="sr-only">
 * Close</span>` and no prop to translate it — so on both of this app's sheets,
 * the only visible way out announced itself in English to a Khmer reader. It
 * is not a fault in the design system: every other Dewey surface is English.
 *
 * So the sheets pass `showCloseButton={false}` and render this instead. It
 * reproduces the design system's own treatment exactly — ghost variant,
 * `icon-sm`, `absolute top-3 right-3` — because this is meant to be the same
 * button, not a different one; only its accessible name changes.
 *
 * A COMPONENT RATHER THAN TWO INLINE COPIES, for one non-obvious reason
 * besides duplication: `miniCalendarSheet.test.tsx` forbids `className=
 * "sr-only"` in that file, a guard that documents a real past bug (a hidden
 * span there was silently overridden by react-day-picker's own aria-label).
 * Inlining would fail that test, and the tempting repair would be to weaken a
 * guard that is still protecting something.
 *
 * RENDER IT LAST. The design system appends its close AFTER `children`, so
 * only a last child keeps the DOM and tab order the sheets already had.
 */
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import { useT } from "@/miniapp/MiniLocale";

export function MiniSheetClose() {
  const t = useT();
  return (
    <SheetClose asChild>
      {/* Absolutely positioned, so it takes no row in the sheet's flex column
          and the layout is byte-identical to the design system's. */}
      <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3">
        <XIcon aria-hidden="true" />
        <span className="sr-only">{t("closeSheet")}</span>
      </Button>
    </SheetClose>
  );
}
