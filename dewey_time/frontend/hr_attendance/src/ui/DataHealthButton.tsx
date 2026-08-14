import { useState, type ReactNode } from "react";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { HealthCondition } from "@/lib/dataHealth";
import { cn } from "@/lib/utils";

/**
 * Everything a page knows about its own data health, behind one button in a
 * row that already exists.
 *
 * The point is the vertical cost: `/hr-flags` and `/hr-attendance` both put
 * `Section grow` (min-h-0 flex-1, flex-basis 0) under their chrome, so the
 * queue and the calendar are only ever handed positive free space and every
 * pixel above them is a pixel those regions never get. A chip at the height of
 * its neighbours costs nothing, and a popover displaces no layout at all.
 *
 * Knows nothing about flags or attendance — the caller supplies the body, so
 * one page hands it the outage panel and the other hands it sync detail.
 */
export function DataHealthButton(props: {
  conditions: HealthCondition[];
  /** Popover body. Composed by the caller; see the type's doc comment. */
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const [lead, ...rest] = props.conditions;
  // Absent, not present-and-empty. Hook order is unaffected: useState above
  // runs on every render regardless of which branch follows it.
  if (!lead) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 rounded-md border border-amber-500/25",
            "bg-amber-500/[0.06] px-2.5 text-sm text-foreground transition-colors",
            "hover:bg-amber-500/[0.12] focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-ring/50",
            props.className,
          )}
        >
          <TriangleAlertIcon className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
          {/* Two visible spellings and one invisible one. Below sm the label is
              the first thing to go, because the popover is one tap away — but
              `hidden` is display:none, which removes the full sentence from the
              accessibility tree too, and a button named "13" says nothing. The
              sr-only copy carries it at exactly the widths the visible one is
              gone. */}
          <span className="hidden sm:inline">{lead.summary}</span>
          <span className="tabular-nums sm:hidden" aria-hidden="true">
            {lead.short}
          </span>
          <span className="sr-only sm:hidden">{lead.summary}</span>
          {rest.length > 0 ? (
            <span className="border-l border-amber-500/25 pl-2 text-xs tabular-nums text-muted-foreground">
              +{rest.length}
            </span>
          ) : null}
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(30rem,calc(100vw-2rem))] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {props.children}
      </PopoverContent>
    </Popover>
  );
}
