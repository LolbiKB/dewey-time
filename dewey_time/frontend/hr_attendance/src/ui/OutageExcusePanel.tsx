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
 * NOT a band any more. It was a bordered amber <section> pinned above the
 * queue on every load — thirteen branches of prose to surface one occasionally
 * used action. It is now the body of the toolbar's data-health popover, which
 * displaces no layout, and the chip that opens it is only rendered when
 * devices are actually down.
 */
import { TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DEVICE_HEALTH_LABEL,
  OUTAGE_BAND_LABEL,
  OUTAGE_CEILING_NOTE,
  OUTAGE_EXCUSING_LABEL,
  UNKNOWN_BRANCH_LABEL,
  outageBranchCheckboxLabel,
  outageBandHeadline,
  outageBandSubline,
  outageBranchDays,
  outageBranchSummary,
  outageExcuseLabel,
} from "@/lib/flagQueueLabels";
import {
  outageFlagCount,
  outageWrite,
  queuePeopleCount,
  type OutageGroup,
} from "@/lib/flagQueuePartition";
import { cn } from "@/lib/utils";

export type OutageExcusePanelProps = {
  outages: OutageGroup[];
  /** Keyed by `group_key`. Whole branches only — never individual people. */
  excludedBranches: ReadonlySet<string>;
  onToggleBranch: (groupKey: string) => void;
  onExcuse: (identities: string[]) => void;
  submitting?: boolean;
};

/** Every date any outage covers, ascending — the panel's own range line. */
function spanOf(outages: OutageGroup[]): string[] {
  const dates = new Set<string>();
  for (const group of outages) for (const date of group.dates) dates.add(date);
  return [...dates].sort();
}

export function OutageExcusePanel(props: OutageExcusePanelProps) {
  // Rendered only when there is an outage. On a healthy day the panel is absent
  // entirely rather than present-and-empty — and so is the chip that opens it.
  if (props.outages.length === 0) return null;

  // Only the filtered write is needed. The unfiltered pass this used to keep
  // fed the headline and subline, and both now read queuePeopleCount /
  // outageFlagCount instead — running groupPayload over every branch for a
  // discarded result is pure cost.
  const write = outageWrite(props.outages, props.excludedBranches);
  const nothingToWrite = write.identities.length === 0;

  return (
    <div aria-label={OUTAGE_BAND_LABEL}>
      <div className="flex items-start gap-2.5 border-b border-border px-3 py-2.5">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0">
          {/* queuePeopleCount, NOT coveredEmployeeCount. This parameter is
              "everyone the outage touched" and its docstring forbids the
              covered count by name: covered counts only members with an
              undecided flag, so it equals the button's number on load (making
              the word "affected" do nothing) and falls to "0 people affected"
              once the outage is excused — a false statement of history. */}
          <div className="text-sm font-medium text-foreground">
            {outageBandHeadline(props.outages.length, queuePeopleCount(props.outages))}
          </div>
          <div className="text-xs text-muted-foreground">
            {outageBandSubline(spanOf(props.outages), outageFlagCount(props.outages))}
          </div>
        </div>
      </div>

      {/* Bounded on purpose. Thirteen branches is today's real count, and an
          unbounded list would make the popover taller than the viewport. */}
      <ul className="max-h-[13rem] space-y-0.5 overflow-y-auto overscroll-contain px-3 py-2">
        {props.outages.map((group) => {
          const included = !props.excludedBranches.has(group.group_key);
          const branch = group.branch ?? UNKNOWN_BRANCH_LABEL;
          return (
            <li key={group.group_key}>
              {/* The whole row is the hit target. A bare size-4 checkbox is
                  16px, under WCAG 2.2 SC 2.5.8's 24px floor, and thirteen of
                  them in a scroller is the strongest mis-click surface here —
                  a missed toggle silently changes what the button below
                  writes, with no second confirmation inside this component. */}
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 hover:bg-muted",
                  !included && "opacity-50",
                )}
              >
                <Checkbox
                  checked={included}
                  onCheckedChange={() => props.onToggleBranch(group.group_key)}
                  aria-label={outageBranchCheckboxLabel(branch)}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {branch}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {outageBranchDays(group.day_count)}
                </span>
                <span className="w-40 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                  {outageBranchSummary(queuePeopleCount([group]), outageFlagCount([group]))}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
        <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {OUTAGE_CEILING_NOTE}{" "}
          {/* <Link>, not <a>: /hr-attendance is a client route (main.tsx:27),
              and a bare anchor forces a full document reload that throws away
              the queue's in-flight state. */}
          <Link
            to="/hr-attendance"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {DEVICE_HEALTH_LABEL}
          </Link>
        </p>
        <Button
          size="sm"
          className="shrink-0"
          disabled={nothingToWrite || props.submitting}
          onClick={() => props.onExcuse(write.identities)}
        >
          {props.submitting
            ? OUTAGE_EXCUSING_LABEL
            : outageExcuseLabel(
                write.coveredEmployeeCount,
                write.identities.length,
                write.branchCount,
              )}
        </Button>
      </div>
    </div>
  );
}
