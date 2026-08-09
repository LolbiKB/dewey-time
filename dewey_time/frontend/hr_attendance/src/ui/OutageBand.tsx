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
  outageReviewLabel,
} from "@/lib/flagQueueLabels";
import {
  outageFlagCount,
  outageWrite,
  queuePeopleCount,
  type OutageGroup,
} from "@/lib/flagQueuePartition";
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

  // Only the filtered write is needed. The unfiltered pass this used to keep
  // fed the headline and subline, and both now read queuePeopleCount /
  // outageFlagCount instead — running groupPayload over every branch for a
  // discarded result is pure cost.
  const write = outageWrite(props.outages, props.excludedBranches);
  const nothingToWrite = write.identities.length === 0;

  return (
    <section
      aria-label={OUTAGE_BAND_LABEL}
      className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] text-sm animate-in fade-in"
    >
      {/* The header row WRAPS, and that is what keeps the queue on screen.
          This band is a flex item in the page's column and `Section grow` below
          it is `min-h-0 flex-1 overflow-hidden` — flex-basis 0 — so the queue is
          only ever handed positive free space, and every pixel this row takes is
          a pixel the queue never gets. Unwrapped, the two shrink-0,
          whitespace-nowrap buttons took the whole row at 412px and left the
          headline a sliver to wrap in: the band grew to 474px and the queue was
          allotted exactly 0. Wrapped, it is 134px and the queue gets 292px.

          Below sm the headline block takes a full line of its own and the
          buttons drop beneath it; from sm up `basis-0` reproduces the previous
          single-row layout exactly. The icon rides in a nested row with the
          headline rather than beside it, because a basis-full sibling cannot
          share a flex line and the triangle would be stranded on a line by
          itself. */}
      <div className="flex flex-wrap items-center gap-2.5 px-3 py-2">
        <div className="flex min-w-0 flex-1 basis-full items-start gap-2.5 sm:basis-0">
          <TriangleAlertIcon
            className="mt-0.5 size-4 shrink-0 text-amber-600"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {/* queuePeopleCount, NOT coveredEmployeeCount. This parameter is
                  "everyone the outage touched" and its docstring forbids the
                  covered count by name: covered counts only members with an
                  undecided flag, so it equals the button's number on load (making
                  the word "affected" do nothing) and falls to "0 people affected"
                  once the outage is excused — a false statement of history. */}
              {outageBandHeadline(props.outages.length, queuePeopleCount(props.outages))}
            </div>
            <div className="text-xs text-muted-foreground">
              {outageBandSubline(spanOf(props.outages), outageFlagCount(props.outages))}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          // aria-expanded only. aria-controls must reference an element that
          // EXISTS, and this panel is conditionally rendered — pointing at an
          // absent id is what automated a11y audits flag, and it buys nothing
          // over aria-expanded, which already announces the state. Keeping the
          // panel permanently mounted just to satisfy the attribute would put
          // thirteen branch rows in the accessibility tree at all times.
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
          {props.submitting
            ? OUTAGE_EXCUSING_LABEL
            : outageExcuseLabel(
                write.coveredEmployeeCount,
                write.identities.length,
                write.branchCount,
              )}
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
              const branch = group.branch ?? UNKNOWN_BRANCH_LABEL;
              return (
                <li key={group.group_key}>
                  {/* The whole row is the hit target. A bare size-4 checkbox is
                      16px, under WCAG 2.2 SC 2.5.8's 24px floor, and thirteen of
                      them in a scroller is the strongest mis-click surface here
                      — a missed toggle silently changes what the button above
                      writes, with no second confirmation inside this component. */}
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 hover:bg-amber-500/10",
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
          <p className="mt-2 border-t border-amber-500/25 pt-2 text-[11px] text-muted-foreground">
            {OUTAGE_CEILING_NOTE}{" "}
            {/* <Link>, not <a>: /hr-attendance is a client route (main.tsx:27),
                and a bare anchor forces a full document reload that throws away
                the queue's in-flight state. HrAppShell.test.tsx pins this same
                rule after the identical mistake was removed there. It still
                renders href="/hr-attendance", so the assertion is unchanged —
                but the test now needs a MemoryRouter wrapper, because <Link>
                throws outside a router. */}
            <Link to="/hr-attendance" className="font-medium text-primary underline-offset-2 hover:underline">
              {DEVICE_HEALTH_LABEL}
            </Link>
          </p>
        </div>
      ) : null}
    </section>
  );
}
