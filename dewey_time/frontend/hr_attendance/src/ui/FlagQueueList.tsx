import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { SHOW_AS_GROUP_LABEL, groupHeadline, personHeadline, tierLabel } from "@/lib/flagQueueLabels";
import { cn } from "@/lib/utils";
import type { QueueEntry, QueuePerson, Tier } from "@/types/flags";

type GroupEntry = Extract<QueueEntry, { kind: "group" }>;

/**
 * Stable per-entry key. The page holds only this string as its selection, so a
 * refetch that returns fresh objects keeps the same row selected — object
 * identity is useless across a react-query refetch, and `Attendance Flag.name`
 * is not usable as an identifier anywhere in this feature (the engine rebuilds
 * those rows constantly).
 */
export function entryKey(entry: QueueEntry): string {
  return entry.kind === "group"
    ? `g:${entry.group_key}`
    : `p:${entry.employee}:${entry.attendance_date}`;
}

export type FlagQueueListProps = {
  entries: QueueEntry[];
  selectedKey: string | null;
  /** Group the user sent to "decide one by one" — rendered as its member rows. */
  expandedGroupKey: string | null;
  onSelect: (key: string) => void;
  /** Puts the expanded group back together — the way out of "decide one by one". */
  onCollapseGroup?: () => void;
};

export function FlagQueueList(props: FlagQueueListProps) {
  // build_queue already ranks entries; this re-sort is defensive and *stable*
  // (V8's sort is), so the backend's tie-break order within one rank survives
  // untouched. Sorting here rather than trusting transport order is what keeps a
  // lone 3-hour gap above a 168-member routine group.
  const ordered = [...props.entries].sort((a, b) => b.rank - a.rank);

  if (ordered.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        Nothing to triage in this range.
      </p>
    );
  }

  const rows: { key: string; tier: Tier; element: ReactNode }[] = [];

  for (const entry of ordered) {
    if (entry.kind === "group" && entry.group_key === props.expandedGroupKey) {
      // "Decide one by one": the group turned out not to be uniform, so its
      // members take its place as ordinary person rows, under the same keys they
      // would have had if the backend had never grouped them. The caption row
      // below is the way back — without it, expanding a group is a one-way door
      // out of bulk review with no affordance but a page reload.
      rows.push({
        key: `x:${entry.group_key}`,
        tier: entry.tier,
        element: (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {groupHeadline(entry)}
            </span>
            {props.onCollapseGroup ? (
              <button
                type="button"
                onClick={props.onCollapseGroup}
                className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                {SHOW_AS_GROUP_LABEL}
              </button>
            ) : null}
          </div>
        ),
      });

      for (const member of entry.members) {
        const key = entryKey({ kind: "person", ...member });
        rows.push({
          key,
          tier: member.tier,
          element: (
            <PersonRow
              person={member}
              selected={props.selectedKey === key}
              onSelect={() => props.onSelect(key)}
            />
          ),
        });
      }
      continue;
    }

    const key = entryKey(entry);
    rows.push({
      key,
      tier: entry.tier,
      element:
        entry.kind === "group" ? (
          <GroupRow
            entry={entry}
            selected={props.selectedKey === key}
            onSelect={() => props.onSelect(key)}
          />
        ) : (
          <PersonRow
            person={entry}
            selected={props.selectedKey === key}
            onSelect={() => props.onSelect(key)}
          />
        ),
    });
  }

  // Tier is derived from rank, so a rank-descending list already produces
  // contiguous tier runs — the heading only has to appear where the tier turns
  // over. That gives "Act / Review / Routine" section headers without bucketing
  // the list and losing the interleaving.
  let lastTier: Tier | null = null;

  return (
    <div className="space-y-1 pb-4">
      {rows.map((row) => {
        const heading = row.tier !== lastTier ? row.tier : null;
        lastTier = row.tier;
        return (
          <div key={row.key}>
            {heading ? (
              <h3 className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {tierLabel(heading)}
              </h3>
            ) : null}
            {row.element}
          </div>
        );
      })}
    </div>
  );
}

function RowButton(props: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
        props.selected
          ? "border-primary/30 bg-primary/5"
          : "border-transparent hover:border-border/60 hover:bg-muted/40",
      )}
    >
      {props.children}
    </button>
  );
}

function PersonRow(props: { person: QueuePerson; selected: boolean; onSelect: () => void }) {
  const { person } = props;
  // undecided_count, not flags.length: a partially decided person returns to the
  // queue headlined by their next unresolved flag, so the badge must count what
  // is still open. Counting all flags would keep showing "+2" on someone with one
  // thing left to do.
  const extra = Math.max(person.undecided_count - 1, 0);

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {person.employee_name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {personHeadline(person)}
        </span>
      </span>
      {extra > 0 ? (
        <Badge variant="outline" className="shrink-0 rounded-md text-[11px] tabular-nums">
          +{extra}
        </Badge>
      ) : null}
    </RowButton>
  );
}

function GroupRow(props: { entry: GroupEntry; selected: boolean; onSelect: () => void }) {
  const { entry } = props;
  const count = entry.members.length;

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {groupHeadline(entry)}
        </span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {count} {count === 1 ? "person" : "people"}
        </span>
      </span>
    </RowButton>
  );
}
