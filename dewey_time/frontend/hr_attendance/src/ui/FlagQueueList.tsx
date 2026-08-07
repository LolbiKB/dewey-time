import { useMemo, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  SHOW_AS_GROUP_LABEL,
  crossReferenceLabel,
  groupHeadline,
  groupSubline,
  personSubline,
  tierLabel,
} from "@/lib/flagQueueLabels";
import { buildEmployeeFlagIndex, buildStrip, type Strip } from "@/lib/flagStrip";
import { cn } from "@/lib/utils";
import type { QueueEntry, QueuePerson, Tier } from "@/types/flags";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";
import { FlagStrip } from "@/ui/FlagStrip";

type GroupEntry = Extract<QueueEntry, { kind: "group" }>;

/**
 * Stable per-entry key. The page holds only this string as its selection, so a
 * refetch that returns fresh objects keeps the same row selected — object
 * identity is useless across a react-query refetch, and `Attendance Flag.name`
 * is not usable as an identifier anywhere in this feature (the engine rebuilds
 * those rows constantly).
 *
 * A person's key comes from the backend rather than being derived here: under
 * the per-flag invariant one employee can occupy two entries, and any key built
 * from employee (and date) alone would collide with itself — selecting the
 * outlier would select the pattern member instead.
 */
export function entryKey(entry: QueueEntry): string {
  return entry.kind === "group" ? `g:${entry.group_key}` : entry.entry_key;
}

export type FlagQueueListProps = {
  entries: QueueEntry[];
  /** The queried range. The strip's 14-day window is cut from its recent end. */
  range: { startDate: string; endDate: string };
  /** (branch, date) pairs with no device data — the strip's grey state. */
  outage: ReadonlySet<string>;
  selectedKey: string | null;
  /** Group the user sent to "decide one by one" — rendered as its member rows. */
  expandedGroupKey: string | null;
  onSelect: (key: string) => void;
  /** Puts the expanded group back together — the way out of "decide one by one". */
  onCollapseGroup?: () => void;
};

export function FlagQueueList(props: FlagQueueListProps) {
  // Built from the whole entry set, so a group member's strip shows the outlier
  // flag that put them in a second entry — see buildEmployeeFlagIndex.
  const flagsByEmployee = useMemo(() => buildEmployeeFlagIndex(props.entries), [props.entries]);

  // build_queue already ranks entries; this re-sort is defensive and *stable*
  // (V8's sort is), so the backend's tie-break order within one rank survives
  // untouched. Sorting here rather than trusting transport order is what keeps a
  // lone 3-hour gap above a 168-member routine group.
  const ordered = [...props.entries].sort((a, b) => b.rank - a.rank);

  const stripFor = (person: QueuePerson): Strip =>
    buildStrip({
      flags: flagsByEmployee.get(person.employee) ?? person.flags,
      branch: person.employee_branch,
      startDate: props.range.startDate,
      endDate: props.range.endDate,
      outage: props.outage,
    });

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
              strip={stripFor(member)}
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
            strip={stripFor(entry)}
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

/**
 * An avatar is decoration to a screen reader, and in a list it is worse than
 * that: `EmployeeAvatar`'s loading ring is a `role="status"` live region whose
 * delay timer starts at MOUNT rather than at fetch start, so forty rows would
 * queue forty "Loading" announcements — for a photo that is `alt=""` sitting
 * beside a name already rendered as text. Nothing in here tells a reader
 * anything the row does not already say in words, so it is hidden whole.
 *
 * The strip is the deliberate exception: it carries a fact — how many days of
 * this fortnight are flagged — that appears nowhere else in the row, so it keeps
 * its one summarising label.
 */
function DecorativeAvatars(props: { className: string; children: ReactNode }) {
  return (
    <span aria-hidden="true" className={props.className}>
      {props.children}
    </span>
  );
}

function PersonRow(props: {
  person: QueuePerson;
  strip: Strip;
  selected: boolean;
  onSelect: () => void;
}) {
  const { person } = props;
  // undecided_count, not flags.length: a partially decided person returns to the
  // queue headlined by their next unresolved flag, so the badge must count what
  // is still open. Counting all flags would keep showing "+2" on someone with one
  // thing left to do.
  const extra = Math.max(person.undecided_count - 1, 0);
  const crossReference = crossReferenceLabel(person);

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      {/* 40px is a floor, not a preference. At 20px an avatar is decoration —
          too small to recognise anyone — so if photos are to earn their space
          the row cannot be denser than this. */}
      {/* `contents` so the avatar itself stays the flex item — the wrapper is
          here for the accessibility tree, not for layout. */}
      <DecorativeAvatars className="contents">
        <EmployeeAvatar
          employee={{
            id: person.employee,
            label: person.employee_name,
            employee_name: person.employee_name,
            image: person.employee_image,
          }}
          fallbackId={person.employee}
          className="size-10"
        />
      </DecorativeAvatars>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">
            {person.employee_name}
          </span>
          {/* The safeguard, in every entry this person appears in: excusing the
              pattern group without knowing about their other row is the whole
              risk the per-flag invariant introduced. */}
          {crossReference ? (
            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
              {crossReference}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {personSubline(person)}
        </span>
      </span>
      {extra > 0 ? (
        <Badge variant="outline" className="shrink-0 rounded-md text-[11px] tabular-nums">
          +{extra}
        </Badge>
      ) : null}
      <FlagStrip strip={props.strip} />
    </RowButton>
  );
}

/** At most this many faces before the row would out-argue its own headline. */
const GROUP_AVATAR_LIMIT = 4;

function GroupRow(props: { entry: GroupEntry; selected: boolean; onSelect: () => void }) {
  const { entry } = props;
  const shown = entry.members.slice(0, GROUP_AVATAR_LIMIT);
  const hidden = entry.members.length - shown.length;

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {groupHeadline(entry)}
        </span>
        {/* Both of a pattern group's dimensions — "2 people · 6 mornings" —
            because reporting only the head count hides how much work is behind
            the row. */}
        <span className="block text-xs text-muted-foreground tabular-nums">
          {groupSubline(entry)}
        </span>
      </span>
      {/* Faces rather than a strip: a group has no single fortnight, and "who is
          in here?" is the question a group header has to answer without being
          expanded. Hidden from assistive tech as a cluster, because the sub-line
          above already answers it in words — exposed, the "+2" would read as a
          bare number appended to the headline. */}
      <DecorativeAvatars className="flex shrink-0 items-center -space-x-2">
        {shown.map((member) => (
          <EmployeeAvatar
            key={member.employee}
            employee={{
              id: member.employee,
              label: member.employee_name,
              employee_name: member.employee_name,
              image: member.employee_image,
            }}
            fallbackId={member.employee}
            className="size-7 ring-2 ring-background"
          />
        ))}
        {hidden > 0 ? (
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground ring-2 ring-background">
            +{hidden}
          </span>
        ) : null}
      </DecorativeAvatars>
    </RowButton>
  );
}
