/**
 * A person's fortnight as a fixed-width array of cells.
 *
 * Nesting alone fixes the queue's volume problem and leaves the second one the
 * spec names: "five late mornings is a materially different situation from one,
 * and it is the thing HR most wants to know" — reported as the sentence "4 late
 * starts". A strip makes the difference a shape. Six consecutive mornings and
 * four scattered across a fortnight produce visibly different strips, and that
 * distinction is what decides whether a pattern is excused as a habit or
 * escalated as a problem.
 *
 * The window lives HERE and not in the API. `get_flag_queue` returns every flag
 * in the queried range, each with its own date; capping at 14 is a decision the
 * flag page makes when it renders, so a future employee-profile page can bucket
 * the same payload into 90 cells without an API change.
 *
 * Spec: docs/superpowers/specs/2026-08-07-flag-queue-row-design.md, "The strip".
 */
import { addDays, differenceInCalendarDays, format } from "date-fns";

import { parseDateKey } from "@/lib/attendanceTime";
import type { FlagOut, QueueEntry, Tier } from "@/types/flags";

/**
 * Fourteen is fitted, not round. The list pane is 22rem / 352px
 * (FlagQueuePage.tsx). After 18px padding, a 40px avatar and two 9px gaps, 276px
 * remains for text and strip; at 6px cells with 2.5px gaps a 14-cell strip is
 * 117px, leaving ~160px for the name and sub-line. Twenty-one cells would take
 * 176px and squeeze names into truncation.
 */
export const STRIP_MAX_CELLS = 14;

export type StripCellState = "flagged" | "clean" | "no-data";

export type StripCell = {
  date: string;
  state: StripCellState;
  /** The worst tier flagged that day; null for clean and no-data. */
  tier: Tier | null;
};

export type Strip = {
  cells: StripCell[];
  /** Days with at least one flag — not the flag count. */
  flaggedCount: number;
  /** Flags older than the window — the "+N earlier" marker. */
  earlierCount: number;
};

const TIER_ORDER: Record<Tier, number> = { routine: 0, review: 1, act: 2 };

/**
 * `attendanceTime` owns date-key PARSING (`parseDateKey`) but exports no
 * formatter, so this is the local inverse rather than a second parser. Keep it
 * private: a second exported date-key helper is how two modules start
 * normalising differently, and every failure that causes here is silent (a strip
 * of fourteen clean cells).
 */
function dateKeyOf(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

/**
 * `\u0000` rather than ":" or "|": a branch name is free text and either of
 * those could appear in one, which would silently grey the wrong person's day.
 */
export function outageKey(branch: string | null, date: string): string {
  return `${branch ?? ""}\u0000${date}`;
}

export function buildOutageSet(
  rows: { branch: string; date: string }[] | null | undefined
): ReadonlySet<string> {
  // Nullable on the way in because a caller may not have a payload yet, not
  // because a payload may lack the key — the cache prefix is versioned by
  // payload shape, so a response that exists always carries `outage_dates`.
  // An absent set greys nothing, which is the right answer for "not known yet".
  if (!rows) return new Set();
  return new Set(rows.map((row) => outageKey(row.branch, row.date)));
}

/**
 * Every flag an employee has across the WHOLE assembled entry set, not just the
 * entry being rendered.
 *
 * Sokheng sits inside "repeatedly late" for four LATE_START flags and also holds
 * a three-hour MISSING_TIME that puts him in a second entry; his strip inside
 * the group shows both, so the act-tier day appears as a tall cell among the
 * routine ones. That makes the cross-reference badge visible rather than merely
 * counted — the badge says "also 1 outlier", the strip shows what it is and
 * when.
 *
 * The strip is therefore NOT a preview of what a bulk decision would write. That
 * is a real tension and it resolves in favour of visibility: the failure mode the
 * badge exists to prevent is HR excusing the group and never seeing the absence,
 * and a strip that hid the outlier would reintroduce exactly that.
 */
export function buildEmployeeFlagIndex(entries: QueueEntry[]): Map<string, FlagOut[]> {
  const index = new Map<string, FlagOut[]>();
  for (const entry of entries) {
    const people = entry.kind === "group" ? entry.members : [entry];
    for (const person of people) {
      const existing = index.get(person.employee);
      if (existing) existing.push(...person.flags);
      else index.set(person.employee, [...person.flags]);
    }
  }
  return index;
}

export function buildStrip(args: {
  flags: FlagOut[];
  branch: string | null;
  startDate: string;
  endDate: string;
  outage: ReadonlySet<string>;
}): Strip {
  const end = parseDateKey(args.endDate);
  const requested = differenceInCalendarDays(end, parseDateKey(args.startDate)) + 1;
  // A range shorter than 14 days gives a shorter strip — seven days is seven
  // cells, not fourteen padded with blanks, because a padded cell would have to
  // mean something and there is nothing true for it to mean. Cell size is fixed;
  // only the count varies.
  const length = Math.max(1, Math.min(requested, STRIP_MAX_CELLS));
  const windowStart = addDays(end, -(length - 1));
  const windowStartKey = dateKeyOf(windowStart);

  const worstByDate = new Map<string, Tier>();
  let earlierCount = 0;
  for (const flag of args.flags) {
    if (flag.attendance_date < windowStartKey) {
      earlierCount += 1;
      continue;
    }
    // A flag dated after `args.endDate` would fall through both branches here —
    // counted in neither `earlierCount` nor a cell. That is unreachable today:
    // `get_flag_queue` filters flags to `[start, end]`, so the payload never
    // carries a flag past `endDate`.
    const current = worstByDate.get(flag.attendance_date);
    if (!current || TIER_ORDER[flag.tier] > TIER_ORDER[current]) {
      worstByDate.set(flag.attendance_date, flag.tier);
    }
  }

  const cells: StripCell[] = [];
  let flaggedCount = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const date = dateKeyOf(addDays(windowStart, offset));
    const tier = worstByDate.get(date);
    if (tier) {
      cells.push({ date, state: "flagged", tier });
      flaggedCount += 1;
      continue;
    }
    // Grey beats green, but a flag beats both: something WAS measured that day,
    // whatever the watermark says. Green means "no flag on this day" and nothing
    // more — it deliberately does not claim the person worked, because the queue
    // does not load shift assignments and cannot know.
    const noData = args.branch !== null && args.outage.has(outageKey(args.branch, date));
    cells.push({ date, state: noData ? "no-data" : "clean", tier: null });
  }

  return { cells, flaggedCount, earlierCount };
}
