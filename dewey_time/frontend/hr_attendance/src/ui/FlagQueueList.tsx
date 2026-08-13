import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { khmerName } from "@/lib/employeeCard";
import {
  SHOW_AS_GROUP_LABEL,
  crossReferenceLabel,
  groupHeadline,
  groupSubline,
  hiddenMemberLabel,
  personSubline,
  stripAriaLabel,
  tierLabel,
} from "@/lib/flagQueueLabels";
import { buildEmployeeFlagIndex, buildStrip, type Strip } from "@/lib/flagStrip";
import { cn } from "@/lib/utils";
import type { QueueEntry, QueuePerson, Tier } from "@/types/flags";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";
import { EmployeeIdentity } from "@/ui/EmployeeIdentity";
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
  /**
   * Row to move focus to once, after the parent has replaced the list under it
   * — a decided row unmounts, and without this focus falls to <body>.
   */
  focusKey?: string | null;
  /** Cleared by the parent once the focus has been taken. */
  onFocusHandled?: () => void;
};

export function FlagQueueList(props: FlagQueueListProps) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  /** The selectable row keys in rendered order, written on commit below. */
  const orderedKeysRef = useRef<string[]>([]);

  // Runs after commit, so the replacement row is mounted and its ref registered.
  // Guarded by onFocusHandled rather than a local "done" flag: the parent owns
  // the request, so it also owns clearing it, and a re-render cannot re-steal
  // focus from wherever the user has since moved.
  const { focusKey, onFocusHandled } = props;
  useEffect(() => {
    if (!focusKey) return;
    rowRefs.current.get(focusKey)?.focus();
    onFocusHandled?.();
  }, [focusKey, onFocusHandled]);

  /** Arrow / Home / End move focus between rows without selecting; Enter and
   *  Space still activate, because every row is a real <button>.
   *
   *  Order comes from `orderedKeysRef` — the keys in the order this render
   *  produced them — not from the ref Map's insertion order. The Map only
   *  happens to be in DOM order because `registerRow` gets a fresh identity
   *  every render, so React detaches and reattaches every ref in tree order;
   *  memoise a row and that accident stops holding, silently, with no test to
   *  notice. The rendered order is the thing actually being asserted. */
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLUListElement>) => {
    // Cmd+ArrowDown is "scroll to end" on macOS, Alt+Arrow is word/history
    // navigation — none of these are ours to take.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const keys = orderedKeysRef.current.filter((key) => rowRefs.current.has(key));
    if (keys.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = keys.findIndex((key) => rowRefs.current.get(key) === active);

    let next: number | null = null;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : Math.min(current + 1, keys.length - 1);
    else if (event.key === "ArrowUp") next = current < 0 ? 0 : Math.max(current - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = keys.length - 1;
    if (next === null) return;

    event.preventDefault(); // ArrowDown would otherwise scroll the pane away
    rowRefs.current.get(keys[next])?.focus();
  }, []);

  // Built from the whole entry set, so a group member's strip shows the outlier
  // flag that put them in a second entry — see buildEmployeeFlagIndex.
  const flagsByEmployee = useMemo(() => buildEmployeeFlagIndex(props.entries), [props.entries]);

  // A strip is ~14 date-fns format/addDays calls, and this list is ~40 rows. The
  // parent re-renders on every keystroke in the decision note, so building them
  // inline rebuilt six hundred of them per character. Memoised on the same
  // inputs as the index — entries (which arrive through the index's identity,
  // itself memoised on them), range, outage set — because those are the only
  // things buildStrip reads.
  //
  // Lazy rather than a prebuilt map: a collapsed group renders faces, not
  // strips, so eagerly building one per member would do a 168-member routine
  // group's work for a row that shows four avatars. Keyed by employee, which is
  // what buildStrip's inputs reduce to — the flags come from the index and the
  // branch is a property of the Employee, so two entries for one person yield
  // the same strip.
  const stripFor = useMemo(() => {
    const cache = new Map<string, Strip>();
    return (person: QueuePerson): Strip => {
      const cached = cache.get(person.employee);
      if (cached) return cached;
      const strip = buildStrip({
        flags: flagsByEmployee.get(person.employee) ?? person.flags,
        branch: person.employee_branch,
        startDate: props.range.startDate,
        endDate: props.range.endDate,
        outage: props.outage,
      });
      cache.set(person.employee, strip);
      return strip;
    };
  }, [flagsByEmployee, props.outage, props.range.endDate, props.range.startDate]);

  // build_queue already ranks entries; this re-sort is defensive and *stable*
  // (V8's sort is), so the backend's tie-break order within one rank survives
  // untouched. Sorting here rather than trusting transport order is what keeps a
  // lone 3-hour gap above a 168-member routine group.
  const ordered = [...props.entries].sort((a, b) => b.rank - a.rank);

  // Exactly one row sits in the tab order (`activeKey`); the arrows move between
  // them. Before this the list had no keyboard model at all — no onKeyDown, no
  // tabIndex, no ref anywhere in the feature — so reaching the decision panel
  // meant Tab-ing through every row above it, up to 252 of them.
  //
  // The selected row is the natural anchor; with nothing selected the first row
  // is, so a fresh page has one reachable entry point rather than none.
  const orderedKeys = ordered.map((entry) =>
    entry.kind === "group" && entry.group_key === props.expandedGroupKey
      ? entry.members.map((member) => entryKey({ kind: "person", ...member }))
      : [entryKey(entry)],
  ).flat();
  const activeKey =
    props.selectedKey && orderedKeys.includes(props.selectedKey)
      ? props.selectedKey
      : (orderedKeys[0] ?? null);

  // Committed, not assigned during render: a concurrent render that React
  // abandons must not leave the arrow-key order describing a tree that was
  // never mounted. This runs after the DOM is in place and before paint, which
  // is also after every ref callback has fired.
  useLayoutEffect(() => {
    orderedKeysRef.current = orderedKeys;
  });

  if (ordered.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        Nothing to triage in this range.
      </p>
    );
  }

  const rows: { key: string; tier: Tier; element: ReactNode; selectable: boolean }[] = [];

  const registerRow = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) rowRefs.current.set(key, node);
    else rowRefs.current.delete(key);
  };

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
        selectable: false,
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
          selectable: true,
          element: (
            <PersonRow
              person={member}
              strip={stripFor(member)}
              selected={props.selectedKey === key}
              onSelect={() => props.onSelect(key)}
              focusable={key === activeKey}
              buttonRef={registerRow(key)}
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
      selectable: true,
      element:
        entry.kind === "group" ? (
          <GroupRow
            entry={entry}
            selected={props.selectedKey === key}
            onSelect={() => props.onSelect(key)}
            focusable={key === activeKey}
            buttonRef={registerRow(key)}
          />
        ) : (
          <PersonRow
            person={entry}
            strip={stripFor(entry)}
            selected={props.selectedKey === key}
            onSelect={() => props.onSelect(key)}
            focusable={key === activeKey}
            buttonRef={registerRow(key)}
          />
        ),
    });
  }

  // Tier is derived from rank, so a rank-descending list already produces
  // contiguous tier runs — the heading only has to appear where the tier turns
  // over. That gives "Act / Review / Routine" section headers without bucketing
  // the list and losing the interleaving.
  let lastTier: Tier | null = null;

  // A real list, so a screen reader can say "item 5 of 147" — the one fact that
  // tells someone whether this queue is a five-minute job or an afternoon. It was
  // a bare <div> of <div>s, which announces 147 unrelated buttons and no length.
  const total = rows.filter((row) => row.selectable).length;
  let position = 0;

  return (
    <ul
      className="space-y-1 pb-4"
      aria-label="Flag queue"
      onKeyDown={handleKeyDown}
    >
      {rows.map((row) => {
        const heading = row.tier !== lastTier ? row.tier : null;
        lastTier = row.tier;
        if (row.selectable) position += 1;
        return (
          <li
            key={row.key}
            // The "show as group" caption is not one of the set's items. Left as
            // a bare listitem it would be counted by assistive tech (4 items)
            // while the authored aria-setsize said 3 — ARIA wants the metadata
            // all-or-none across a set, so the caption leaves the set entirely.
            role={row.selectable ? undefined : "presentation"}
            aria-setsize={row.selectable ? total : undefined}
            aria-posinset={row.selectable ? position : undefined}
          >
            {heading ? (
              // sticky: tiers are contiguous runs, so three markers govern
              // ~21 screens of scroll — without this, row 80 gives no clue
              // whether you are still in Act.
              <h3 className="sticky top-0 z-10 -mx-1 bg-background/95 px-3 pb-1.5 pt-4 text-xs font-semibold uppercase tracking-wider text-foreground backdrop-blur-sm">
                {tierLabel(heading)}
              </h3>
            ) : null}
            {row.element}
          </li>
        );
      })}
    </ul>
  );
}

function RowButton(props: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  /**
   * The row spoken aloud. Required, not optional: every row's text lives in
   * nested <span>s, and the avatar cluster beside it is aria-hidden, so without
   * this a screen reader announces 252 buttons with no names at all.
   */
  label: string;
  /**
   * Roving tabindex — exactly one row is in the tab order, and the arrow keys
   * move between them. Without it, reaching the decision panel means pressing
   * Tab past every row above it, up to 252 times.
   */
  focusable: boolean;
  buttonRef?: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      ref={props.buttonRef}
      aria-label={props.label}
      // aria-current, not aria-pressed: this is single-select navigation, not an
      // independent on/off toggle. aria-pressed made 251 rows announce
      // "not pressed" and described a semantic the component does not have.
      aria-current={props.selected ? "true" : undefined}
      tabIndex={props.focusable ? 0 : -1}
      onClick={props.onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
        // Keyboard focus has to be visible now that it can move without a click.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
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
function DecorativeAvatars(props: { className?: string; children: ReactNode }) {
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
  focusable: boolean;
  buttonRef?: (node: HTMLButtonElement | null) => void;
}) {
  const { person } = props;
  // undecided_count, not flags.length: a partially decided person returns to the
  // queue headlined by their next unresolved flag, so the badge must count what
  // is still open. Counting all flags would keep showing "+2" on someone with one
  // thing left to do.
  const extra = Math.max(person.undecided_count - 1, 0);
  const crossReference = crossReferenceLabel(person);
  // The finding, which personSubline itself allows to be empty for a code it
  // has no wording for. Declared as a tail fact only when there is one: an
  // empty fact renders as a separator with nothing after it.
  const subline = personSubline(person);
  // Composed once and spent twice — on the line and in the spoken label — so
  // the two cannot come to name the person differently.
  const khmer = khmerName(person.custom_khmer_last_name, person.custom_khmer_first_name);

  return (
    <RowButton
      selected={props.selected}
      onSelect={props.onSelect}
      focusable={props.focusable}
      buttonRef={props.buttonRef}
      // Name, Khmer name, finding, how many more flags, then the fortnight the
      // strip draws. The strip and the avatar are aria-hidden decoration;
      // without this the row's entire content is invisible to a screen reader.
      // The Khmer name rides directly behind the English one so a screen reader
      // hears the pair a sighted reader sees on line one.
      label={[
        person.employee_name,
        khmer,
        crossReference,
        subline,
        extra > 0 ? `${extra} more ${extra === 1 ? "flag" : "flags"}` : null,
        stripAriaLabel(props.strip),
      ]
        .filter(Boolean)
        .join(". ")}
    >
      {/* flex-[3_1_0%] against the badge's flex-[1_1_0%]: when the line
          overflows, both give way and the person keeps roughly three quarters
          of what is left — the face included, now that it sits inside the
          identity block. The badge used to be shrink-0, which made the name the
          only shrinkable item on the row — so a 112px line spent 85px on "also
          1 elsewhere" and rendered the person as "B…". Whatever else a triage
          row loses, it cannot lose whose row it is.

          `0%` rather than the `auto` these two carried before. A flex base of
          `auto` is the item's own content width, and the identity block is a
          query container, whose content contributes NOTHING to that — so the
          name's share collapsed to the 40px face while the badge, still sized
          by its text, grew. Measured at 375: the name had 89px before, 59px
          under `auto`, and 92px on a real 3:1 split of the line.

          The wrapper carries the native tooltip a truncated name needs:
          EmployeeIdentity takes no `title`, and scoping it here rather than to
          the whole line stops a hover over the badge naming the person. */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 flex-[3_1_0%]" title={person.employee_name}>
          <EmployeeIdentity
            englishName={person.employee_name}
            employeeId={person.employee}
            khmerName={khmer}
            // 40px is a floor, not a preference. At 20px an avatar is
            // decoration — too small to recognise anyone — so if photos are to
            // earn their space the row cannot be denser than this.
            //
            // `contents` so the avatar itself stays the flex item — the wrapper
            // is here for the accessibility tree, not for layout.
            avatar={
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
            }
            // The finding is this row's one caller fact, so it follows the
            // employee id on line two rather than taking a line of its own.
            tail={subline ? [{ label: subline }] : []}
          />
        </span>
        {/* The safeguard, in every entry this person appears in: excusing the
            pattern group without knowing about their other row is the whole
            risk the per-flag invariant introduced. */}
        {crossReference ? (
          <span className="min-w-0 flex-[1_1_0%] truncate text-[11px] font-normal text-muted-foreground">
            {crossReference}
          </span>
        ) : null}
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

function GroupRow(props: {
  entry: GroupEntry;
  selected: boolean;
  onSelect: () => void;
  focusable: boolean;
  buttonRef?: (node: HTMLButtonElement | null) => void;
}) {
  const { entry } = props;
  const shown = entry.members.slice(0, GROUP_AVATAR_LIMIT);
  const hidden = hiddenMemberLabel(entry.members.length - shown.length);

  return (
    <RowButton
      selected={props.selected}
      onSelect={props.onSelect}
      focusable={props.focusable}
      buttonRef={props.buttonRef}
      // The faces beside this are aria-hidden (they restate the sub-line), so
      // the headline and its two dimensions are the whole spoken row.
      label={`${groupHeadline(entry)}. ${groupSubline(entry)}`}
    >
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
      <DecorativeAvatars>
        {/* shadcn's AvatarGroup / AvatarGroupCount rather than a hand-rolled
            flex row and a hand-rolled counter pill.

            Its default overlap is -space-x-2, which is overridden here: at
            size-7 that covers 8px of a 28px face — 29% — and a two-letter
            initial pair is centred, so the covered band eats its second glyph.
            Fine for photographs, wrong for the fallback, and the fallback is
            what renders for every employee with no photo on file and for every
            face still in flight. -space-x-1 keeps the overlapped look and
            leaves 24px of each circle visible, which clears the pair.

            EmployeeAvatar stays the child rather than shadcn's Avatar: it
            carries the loading-phase work that makes an avatar never flash
            empty, half-painted, or broken. */}
        <AvatarGroup className="shrink-0 items-center -space-x-1">
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
              className="size-7"
            />
          ))}
          {hidden ? (
            <AvatarGroupCount className="size-7 text-[10px] font-semibold tabular-nums">
              {hidden}
            </AvatarGroupCount>
          ) : null}
        </AvatarGroup>
      </DecorativeAvatars>
    </RowButton>
  );
}
