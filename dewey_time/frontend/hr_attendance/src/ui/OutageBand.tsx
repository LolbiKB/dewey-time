/**
 * Device outages, lifted out of the judgment queue.
 *
 * These entries answer a different question from every other row in the queue:
 * not "was this absence acceptable" but "acknowledge that the machine was
 * down". There is no evidence to weigh — `flag_grouping.py` says as much ("A
 * device outage claims the whole day, before anything else looks at it") — so
 * ranking them against a person's four-hour gap forced a comparison with no
 * answer, and made a 147-row queue out of 3 decisions.
 *
 * NOT an `AttentionStrip`: that component turns its whole header row into a
 * `<summary>` when `detail` is present, so the two buttons here would toggle
 * the disclosure instead of firing. The amber tone classes are borrowed
 * verbatim from it so the band still reads as part of the notice family.
 */
import { useState } from "react";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DEVICE_HEALTH_LABEL,
  OUTAGE_CEILING_NOTE,
  outageBandHeadline,
  outageBandSubline,
  outageBranchDays,
  outageBranchSummary,
  outageExcuseLabel,
  outageReviewLabel,
} from "@/lib/flagQueueLabels";
import { outageWrite, type OutageGroup } from "@/lib/flagQueuePartition";
import { cn } from "@/lib/utils";

export type OutageBandProps = {
  outages: OutageGroup[];
  /** Keyed by `group_key`. Whole branches only — never individual people. */
  excludedBranches: ReadonlySet<string>;
  onToggleBranch: (groupKey: string) => void;
  onExcuse: (identities: string[]) => void;
  submitting?: boolean;
  defaultOpen?: boolean;
};

/** Every date any outage covers, ascending — the band's own range line. */
function spanOf(outages: OutageGroup[]): string[] {
  const dates = new Set<string>();
  for (const group of outages) for (const date of group.dates) dates.add(date);
  return [...dates].sort();
}

export function OutageBand(props: OutageBandProps) {
  // Collapsed by default. Thirteen branches expanded on arrival would displace
  // the queue exactly as the interleaved rows did. `defaultOpen` is a test seam:
  // renderToStaticMarkup cannot click, so the expanded assertions have no other
  // route to this state.
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  // Rendered only when there is an outage. On a healthy day the band is absent
  // entirely rather than present-and-empty, which is the whole reason this is a
  // band and not a nav item.
  if (props.outages.length === 0) return null;

  const all = outageWrite(props.outages, new Set<string>());
  const write = outageWrite(props.outages, props.excludedBranches);
  const nothingToWrite = write.identities.length === 0;

  return (
    <section
      aria-label="Device outages"
      className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] text-sm animate-in fade-in"
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <TriangleAlertIcon className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">
            {outageBandHeadline(props.outages.length, all.coveredEmployeeCount)}
          </div>
          <div className="text-xs text-muted-foreground">
            {outageBandSubline(spanOf(props.outages), all.identities.length)}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {outageReviewLabel(props.outages.length)}
          <ChevronRightIcon
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
        </Button>
        <Button
          size="sm"
          className="shrink-0"
          disabled={nothingToWrite || props.submitting}
          onClick={() => props.onExcuse(write.identities)}
        >
          {outageExcuseLabel(write.coveredEmployeeCount, write.identities.length, write.branchCount)}
        </Button>
      </div>

      {open ? (
        <div className="border-t border-amber-500/25 px-3 py-2">
          {/* Bounded on purpose. Thirteen branches is today's real count, and an
              unbounded list would push the queue below the fold — the exact
              failure this band exists to prevent. */}
          <ul className="max-h-[13rem] space-y-0.5 overflow-y-auto overscroll-contain">
            {props.outages.map((group) => {
              const included = !props.excludedBranches.has(group.group_key);
              const branch = group.branch ?? "Unknown branch";
              const size = outageWrite([group], new Set<string>());
              return (
                <li
                  key={group.group_key}
                  className={cn("flex items-center gap-2.5 py-1", !included && "opacity-50")}
                >
                  <Checkbox
                    checked={included}
                    onCheckedChange={() => props.onToggleBranch(group.group_key)}
                    aria-label={`Include ${branch}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {branch}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {outageBranchDays(group.day_count)}
                  </span>
                  <span className="w-40 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {outageBranchSummary(size.coveredEmployeeCount, size.identities.length)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 border-t border-amber-500/25 pt-2 text-[11px] text-muted-foreground">
            {OUTAGE_CEILING_NOTE}{" "}
            <a href="/hr-attendance" className="font-medium text-primary underline-offset-2 hover:underline">
              {DEVICE_HEALTH_LABEL}
            </a>
          </p>
        </div>
      ) : null}
    </section>
  );
}
