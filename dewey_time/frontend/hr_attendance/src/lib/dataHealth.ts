import { formatDurationMinutes } from "@/lib/attendanceTime";

/**
 * One thing that is wrong with the data behind a page, right now.
 *
 * Everything reaching this type is amber by construction — "something is wrong
 * right now" IS the entry criterion, so there is no `tone` field to grade it
 * with afterwards. Facts that are merely true about the data do not become
 * conditions: the flag queue's cap is rendered at the end of the list where it
 * is finally relevant, and the orphaned-decision counts are not rendered at
 * all.
 *
 * `detail` is deliberately absent. A ReactNode field would drag JSX into
 * src/lib and make these builders untestable as plain data; DataHealthButton's
 * caller composes the popover body instead.
 */
export type HealthCondition = {
  /** Stable React key and test handle. */
  key: string;
  /** Terse form — the chip's label when this condition leads. */
  summary: string;
  /** Shorter still, for viewports below sm. Usually a bare count. */
  short: string;
};

/** Local rather than imported from flagQueueLabels: that module is
 *  flag-specific, and this one serves the attendance page too. Three lines
 *  beats a dependency that points the wrong way. */
function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * The leading unit of an age — "22h" from "22h 3m", "3d" from "3d 4h".
 *
 * Built by taking formatDurationMinutes apart rather than re-deriving
 * days/hours/minutes, so the two can never disagree about a boundary.
 */
function coarseAge(minutes: number): string {
  // The `??` satisfies noUncheckedIndexedAccess and nothing else: split always
  // returns at least one element, and the genuine degenerate input (null, NaN)
  // is already handled a level down — formatDurationMinutes returns "—" for it,
  // which arrives here as a string, never as undefined.
  return formatDurationMinutes(minutes).split(" ")[0] ?? "—";
}

function closeoutCondition(count: number): HealthCondition {
  return {
    key: "closeout",
    summary: `${plural(count, "device closeout", "device closeouts")} pending`,
    short: count.toLocaleString("en-US"),
  };
}

/** `/hr-flags`. Outages lead — they are the only condition with an action
 *  behind them, so they are the one worth spending the chip's label on. */
export function flagQueueHealth(input: {
  outageBranches: number;
  closeoutAlerts: number;
}): HealthCondition[] {
  const conditions: HealthCondition[] = [];
  if (input.outageBranches > 0) {
    conditions.push({
      key: "outage",
      summary: `${plural(input.outageBranches, "branch", "branches")} offline`,
      short: input.outageBranches.toLocaleString("en-US"),
    });
  }
  if (input.closeoutAlerts > 0) conditions.push(closeoutCondition(input.closeoutAlerts));
  return conditions;
}

/** `/hr-attendance`. `staleSyncMinutes` is null when there is no staleness to
 *  report — NOT 0, which is a real age the caller has already judged stale. */
export function attendanceHealth(input: {
  staleSyncMinutes: number | null;
  closeoutAlerts: number;
}): HealthCondition[] {
  const conditions: HealthCondition[] = [];
  if (input.staleSyncMinutes != null) {
    conditions.push({
      key: "stale-sync",
      summary: `Last sync ${formatDurationMinutes(input.staleSyncMinutes)} ago`,
      short: coarseAge(input.staleSyncMinutes),
    });
  }
  if (input.closeoutAlerts > 0) conditions.push(closeoutCondition(input.closeoutAlerts));
  return conditions;
}
