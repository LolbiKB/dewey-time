import { useEffect, useState } from "react";
import { ListFilterIcon, SearchIcon } from "lucide-react";
import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lolbikb/dewey-ui";

import {
  applyFilterChange,
  BIOMETRIC_FILTER_LABELS,
  registerFacets,
  SCHEDULE_LABELS,
  TELEGRAM_LABELS,
  type FeedHealth,
  type RegisterFilters,
  type RegisterRow,
} from "@/lib/coverageRegister";

/**
 * Radix rejects an empty-string item value, so "no filter" needs a sentinel
 * that no real value can collide with. The three single-select facets are all
 * closed enums and none of them contains this.
 */
const ANY = "__any__";

const STATUS_OPTIONS: { value: NonNullable<RegisterFilters["status"]>; label: string }[] = [
  { value: "Active", label: "Active" },
  { value: "Left", label: "Left" },
];

const SCHEDULE_OPTIONS: { value: NonNullable<RegisterFilters["schedule"]>; label: string }[] = [
  { value: "assigned", label: SCHEDULE_LABELS.assigned },
  { value: "missing", label: SCHEDULE_LABELS.missing },
  // The two states the register could not previously name. "Type not set" is
  // the working list for chasing campuses; "Clock-based" is how you check that
  // the rotating teachers were classified rather than merely added.
  { value: "unclassified", label: SCHEDULE_LABELS.unclassified },
  { value: "clock", label: SCHEDULE_LABELS.clock },
];

/**
 * "Only one finger" last: the four buckets keep the enum's order, and the one
 * predicate option — the re-enrollment drive's worklist, since the cell shows
 * fragility but a colour cannot be narrowed to — reads as the addition it is.
 */
const BIOMETRIC_OPTIONS: { value: NonNullable<RegisterFilters["biometric"]>; label: string }[] = [
  { value: "enrolled", label: BIOMETRIC_FILTER_LABELS.enrolled },
  { value: "enrolled_not_punching", label: BIOMETRIC_FILTER_LABELS.enrolled_not_punching },
  { value: "none", label: BIOMETRIC_FILTER_LABELS.none },
  { value: "still_enrolled", label: BIOMETRIC_FILTER_LABELS.still_enrolled },
  { value: "single_finger", label: BIOMETRIC_FILTER_LABELS.single_finger },
];

/**
 * "Not linked" first. Every other facet on this bar lists its options in the
 * enum's own order, but this one exists to find work, and the work is the
 * unlinked — at rollout that is most of the roster, and it is the option a
 * reader opening this menu is looking for.
 */
const TELEGRAM_OPTIONS: { value: NonNullable<RegisterFilters["telegram"]>; label: string }[] = [
  { value: "none", label: TELEGRAM_LABELS.none },
  { value: "id_on_file", label: TELEGRAM_LABELS.id_on_file },
  { value: "linked", label: TELEGRAM_LABELS.linked },
];

/**
 * How the register's search box reads, wherever it is rendered.
 *
 * Shared with `GenericDataTable`'s `config.searchPlaceholder`, because below
 * the breakpoint the bar renders its own box in place of the primitive's and
 * the two must read — and be NAMED — identically. A reader who learned the
 * control on a laptop must find the same one on a phone, and one e2e locator
 * has to match both or the wide branch stops being measured.
 *
 * It carries the roster total, which is where that number went when the page
 * header was dropped: this is the one place on the page that can hold it at no
 * cost in vertical space, and it is worth holding — searching a roster of 503
 * is a different act from searching one of 14.
 *
 * DERIVED from the unfiltered rows, never hardcoded, and SILENT at zero. "Search
 * 0 employees…" is a rendered non-fact: during a load, and after a failure that
 * left the page with nothing, the roster size is not zero, it is unknown. At
 * zero this falls back to the wording that claims nothing — which is what the
 * box said before it counted anything.
 *
 * It names the Khmer name because the box searches it — `employeeSearchHaystack`
 * carries it and the register filters on it — and an undiscoverable search field
 * is one nobody types into. This is the only affordance saying so: the column
 * shows a Khmer name only past 200px of stack, so on a phone the reader cannot
 * even infer it from what is on screen.
 */
export function registerSearchPlaceholder(rosterSize: number): string {
  if (rosterSize <= 0) return "Search by name, Khmer name, or employee ID…";
  return `Search ${rosterSize} ${rosterSize === 1 ? "employee" : "employees"} by name, Khmer name, or ID…`;
}

/** What the box waits before it narrows the table. dewey-ui's own toolbar uses the same. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The register's own search box.
 *
 * Rendered only when the bar is told to — see `showSearch`. It writes
 * `filters.search`, the SAME field `GenericDataTable`'s box writes, so the two
 * are one control that changes place rather than two states that can disagree.
 *
 * Its own component, not inlined into the bar, because it is the only thing
 * here that holds hooks and the bar must not: the bar is CALLED as a plain
 * function by the write-path tests below, which is the only way a suite with
 * no jsdom can reach its `onFiltersChange` handlers. As an element in the tree
 * the bar builds, this runs no hooks until something renders it.
 *
 * The local buffer is re-seeded whenever `value` changes, so it is a DELAY on
 * the shared field rather than a second copy of it: every other control here
 * spreads `filters`, and one that cleared the search would otherwise leave
 * stale text sitting in the box.
 */
export function RegisterSearchInput(props: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  const { value, onChange } = props;
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);

  return (
    // `basis-full` so it takes a row of its own in the wrapping bar: it is the
    // widest control here, and the facet chips flow underneath it.
    <div className="relative basis-full">
      <SearchIcon
        className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      {/* An explicit name as well as the placeholder: a placeholder is the
          accessible name only by fallback, and it is gone the moment anything
          is typed. */}
      <Input
        className="h-8 w-full pl-8"
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </div>
  );
}

export type RegisterFilterBarProps = {
  /**
   * The UNFILTERED roster — the hook's rows, suppressed but not narrowed.
   *
   * Facet options come from here, never from the filtered rows. Deriving them
   * from what is on screen would leave the chosen branch as the only surviving
   * option the instant it was picked; with a facet of one value it would leave
   * no option at all and the control would disappear, trapping the reader
   * inside a filter they could no longer see or clear.
   */
  rows: RegisterRow[];
  feeds: FeedHealth;
  filters: RegisterFilters;
  onFiltersChange: (next: RegisterFilters) => void;
  /**
   * Take the search box in, because the toolbar outside cannot hold it.
   *
   * dewey-ui's toolbar row does not wrap and its search input is a fixed
   * `w-64`, so below 768px that input is drawn straight over this bar's Status
   * facet and its Columns dropdown leaves the screen — measured at 375 and
   * 412, and invisible to a scrollWidth check because `Section grow` clips it.
   * This bar DOES wrap, so at those widths the page hides the primitive's box
   * and hands the search here instead. At 768 and above everything measured
   * clean where it already was, so nothing moves.
   */
  showSearch?: boolean;
};

/**
 * The register's facets, for GenericDataTable's `toolbarLeading` slot.
 *
 * A facet whose feed is down is REMOVED, exactly as its column is: `status`
 * and `biometric` are biometric-feed facts and `schedule` is a schedule-feed
 * one. Offering a filter over data the page is hiding is the same defect as
 * showing the column — it invites the reader to narrow by a fact that has been
 * blanked on every row, and returns nobody.
 *
 * `status` has no default, deliberately. Defaulting to Active would hide every
 * leaver still holding a template — the security finding this page exists for —
 * while the alert beside it went on counting them.
 *
 * HOLDS NO HOOKS, on purpose — see the note on `facets` below.
 */
export function RegisterFilterBar({
  rows,
  feeds,
  filters,
  onFiltersChange,
  showSearch = false,
}: RegisterFilterBarProps) {
  // Derived on every render rather than memoised.
  //
  // With no hooks anywhere in this component it can be CALLED as a plain
  // function, which is the only way a suite with no jsdom can reach the
  // `onFiltersChange` handlers below: renderToStaticMarkup drops function props
  // from its HTML, so every one of them was previously a line no test could
  // execute — including the spread that keeps the reader's search and sort
  // alive when they pick a branch. AlertDot is called the same way for the same
  // reason. The memo was buying one sort over a few-hundred-row roster on a
  // component that re-renders on every keystroke in the search box anyway.
  const facets = registerFacets(rows);

  // Every control below NARROWS the list, so every one of them starts again at
  // page 1 — see applyFilterChange. Bound once here rather than repeated at six
  // call sites, where the seventh control added would be the one that forgot.
  // A plain closure, not useCallback: this component holds no hooks on purpose
  // (see `facets` above), and the handlers it builds are re-read on every call.
  const change = (next: Partial<RegisterFilters>) =>
    onFiltersChange(applyFilterChange(filters, next));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {showSearch ? (
        <RegisterSearchInput
          value={filters.search ?? ""}
          // The roster, not the filtered rows — `rows` is already the
          // unfiltered set, and the count must not move as the reader types.
          placeholder={registerSearchPlaceholder(rows.length)}
          onChange={(search) => change({ search })}
        />
      ) : null}

      {/* No options means no control. An empty menu is a dead affordance, and
          on this page an empty one would also be a claim: that the roster has
          branches, and none of them matched. */}
      {facets.branch.length > 0 ? (
        <FacetFilter
          label="Branch"
          options={facets.branch}
          selected={filters.branch ?? []}
          onChange={(branch) => change({ branch })}
        />
      ) : null}

      {facets.department.length > 0 ? (
        <FacetFilter
          label="Department"
          options={facets.department}
          selected={filters.department ?? []}
          onChange={(department) => change({ department })}
        />
      ) : null}

      {feeds.biometric ? (
        <SingleFacet
          label="Status"
          anyLabel="Any status"
          value={filters.status}
          options={STATUS_OPTIONS}
          onChange={(status) => change({ status })}
        />
      ) : null}

      {feeds.schedule ? (
        <SingleFacet
          label="Schedule"
          anyLabel="Any schedule"
          value={filters.schedule}
          options={SCHEDULE_OPTIONS}
          onChange={(schedule) => change({ schedule })}
        />
      ) : null}

      {feeds.biometric ? (
        <SingleFacet
          label="Biometric"
          anyLabel="Any biometric state"
          value={filters.biometric}
          options={BIOMETRIC_OPTIONS}
          onChange={(biometric) => change({ biometric })}
        />
      ) : null}

      {/* Gated on the SCHEDULE feed, not the biometric one: the coverage
          endpoint resolves the Telegram state, the bridge knows nothing about
          it. Same gate as the Schedule facet above, for the same reason. */}
      {feeds.schedule ? (
        <SingleFacet
          label="Telegram"
          anyLabel="Any Telegram state"
          value={filters.telegram}
          options={TELEGRAM_OPTIONS}
          onChange={(telegram) => change({ telegram })}
        />
      ) : null}
    </div>
  );
}

/**
 * Add or remove one value from a facet selection.
 *
 * Deselecting the last value returns `[]`, and `[]` is "no filter" — never
 * "match nothing". filterRegisterRows guards on `filters.branch?.length` for
 * exactly this: a facet that could be emptied into a state matching nobody
 * would read as the table having broken.
 */
export function toggleFacetValue(selected: string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((current) => current !== value)
    : [...selected, value];
}

/** The trigger's accessible name: what it filters, how much it offers, what is on. */
function facetTriggerLabel(label: string, options: string[], selected: string[]): string {
  const count = `${options.length} ${options.length === 1 ? "option" : "options"}`;
  const on = selected.length ? `, ${selected.length} selected: ${selected.join(", ")}` : "";
  return `${label} filter, ${count}${on}`;
}

/**
 * The option rows inside a facet's popover.
 *
 * Exported, and kept as its own component, because Radix renders
 * `PopoverContent` inside a Portal whose container is only resolved after
 * mount — so on the server it renders to nothing and NOTHING inside the
 * popover reaches the markup this suite asserts on. Rendering these directly
 * inside a bare `<Command>` is the escape hatch EmployeePicker's exported
 * `EmployeeOption` already uses for the same reason.
 */
export function FacetOptions(props: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <CommandGroup>
      {props.options.map((option) => {
        const checked = props.selected.includes(option);
        return (
          <CommandItem
            key={option}
            value={option}
            // dewey-ui's CommandItem carries its own tick, shown by
            // `data-checked`. A Checkbox inside the row would be a second
            // control for one piece of state, nested inside an option — and
            // the tick is a shape, so the state is never carried by colour.
            data-checked={checked}
            // The tick is decorative; this is what says "selected" aloud.
            aria-label={checked ? `${option}, selected` : option}
            onSelect={() => props.onToggle(option)}
          >
            <span className="truncate">{option}</span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

/**
 * Branch and Department: many values, any number of them at once.
 *
 * Exported and hook-free for the same reason as the bar itself. Everything this
 * builds below the trigger lives inside `PopoverContent`, which Radix puts in a
 * portal whose container is resolved in a layout effect — so it server-renders
 * to null and neither the option rows nor the clear row reaches the markup.
 * Called as a plain function it hands back the tree it built, handlers and all.
 *
 * The Popover is uncontrolled: the `open` state it used to hold was only ever
 * fed back to the Popover unchanged, which is exactly what Radix does on its
 * own.
 */
export function FacetFilter(props: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-dashed"
          aria-label={facetTriggerLabel(props.label, props.options, props.selected)}
        >
          <ListFilterIcon className="size-3.5 opacity-60" aria-hidden="true" />
          {props.label}
          {props.selected.length > 0 ? (
            <Badge variant="secondary" className="rounded-sm px-1 font-normal tabular-nums">
              {props.selected.length}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${props.label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No {props.label.toLowerCase()} matches.</CommandEmpty>
            <FacetOptions
              options={props.options}
              selected={props.selected}
              onToggle={(value) => props.onChange(toggleFacetValue(props.selected, value))}
            />
          </CommandList>
          {props.selected.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem value={`clear ${props.label}`} onSelect={() => props.onChange([])}>
                  Clear {props.label.toLowerCase()} filter
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Status, Schedule and Biometric: a closed enum, one value or none.
 *
 * Exported and hook-free so a test can reach `onValueChange` — the mapping that
 * turns the sentinel back into "no filter" is the only thing standing between
 * this control and a state it can never leave, and it sits on a function prop
 * that renderToStaticMarkup drops.
 */
export function SingleFacet<T extends string>(props: {
  label: string;
  /** How the "no filter" row reads in the open list, where the label is out of sight. */
  anyLabel: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (next: T | undefined) => void;
}) {
  const selected = props.options.find((option) => option.value === props.value);

  return (
    <Select
      value={props.value ?? ANY}
      // Anything that is not one of the options — the sentinel included — is
      // "no filter", which is how this control clears.
      onValueChange={(next) =>
        props.onChange(props.options.find((option) => option.value === next)?.value)
      }
    >
      {/* An aria-label IS required here, and this comment used to say the
          opposite — that the trigger's own "Status: Any" text was name enough.
          It is not. Radix renders this trigger as `role="combobox"`, which is
          nameFrom:author: its contents contribute NOTHING to the accessible
          name, so without this the control had no name at all and three of the
          register's filters announced as bare comboboxes. The current value
          travels in the name too, so replacing the visible text costs
          nothing. */}
      <SelectTrigger
        size="sm"
        className="h-8 w-auto gap-1.5"
        aria-label={`${props.label} filter, ${selected?.label ?? "Any"}`}
      >
        {/* Explicit children. Radix fills SelectValue from the mounted
            SelectItem, which lives in a portal, so with children omitted the
            trigger renders blank until the list has been opened once.

            ": Any" is dropped when nothing is chosen. It is the resting state
            of every one of these, so it was four repetitions of "this filter
            is doing nothing" — and it cost the row it was written on: measured
            at 1280, the four ": Any" suffixes are ~140px, and adding a sixth
            facet (Telegram) pushed Export CSV onto a second toolbar line,
            taking the last employee below the fold. This page dropped its own
            PageHeader to buy that line back; spending it on the word "Any" is
            not the trade it made.

            A CHOSEN value still shows, because that one is load-bearing — a
            reader must be able to see what they have narrowed to without
            opening the menu. The accessible name is unchanged either way and
            still carries the state, per the note above. */}
        <SelectValue>
          {selected ? `${props.label}: ${selected.label}` : props.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{props.anyLabel}</SelectItem>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
