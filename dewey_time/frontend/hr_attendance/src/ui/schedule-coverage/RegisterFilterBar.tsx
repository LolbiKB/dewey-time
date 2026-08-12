import { ListFilterIcon } from "lucide-react";
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
  BIOMETRIC_LABELS,
  registerFacets,
  SCHEDULE_LABELS,
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
];

const BIOMETRIC_OPTIONS: { value: NonNullable<RegisterFilters["biometric"]>; label: string }[] = [
  { value: "enrolled", label: BIOMETRIC_LABELS.enrolled },
  { value: "enrolled_not_punching", label: BIOMETRIC_LABELS.enrolled_not_punching },
  { value: "none", label: BIOMETRIC_LABELS.none },
  { value: "still_enrolled", label: BIOMETRIC_LABELS.still_enrolled },
];

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

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {/* No options means no control. An empty menu is a dead affordance, and
          on this page an empty one would also be a claim: that the roster has
          branches, and none of them matched. */}
      {facets.branch.length > 0 ? (
        <FacetFilter
          label="Branch"
          options={facets.branch}
          selected={filters.branch ?? []}
          onChange={(branch) => onFiltersChange({ ...filters, branch })}
        />
      ) : null}

      {facets.department.length > 0 ? (
        <FacetFilter
          label="Department"
          options={facets.department}
          selected={filters.department ?? []}
          onChange={(department) => onFiltersChange({ ...filters, department })}
        />
      ) : null}

      {feeds.biometric ? (
        <SingleFacet
          label="Status"
          anyLabel="Any status"
          value={filters.status}
          options={STATUS_OPTIONS}
          onChange={(status) => onFiltersChange({ ...filters, status })}
        />
      ) : null}

      {feeds.schedule ? (
        <SingleFacet
          label="Schedule"
          anyLabel="Any schedule"
          value={filters.schedule}
          options={SCHEDULE_OPTIONS}
          onChange={(schedule) => onFiltersChange({ ...filters, schedule })}
        />
      ) : null}

      {feeds.biometric ? (
        <SingleFacet
          label="Biometric"
          anyLabel="Any biometric state"
          value={filters.biometric}
          options={BIOMETRIC_OPTIONS}
          onChange={(biometric) => onFiltersChange({ ...filters, biometric })}
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
      {/* No aria-label: it would REPLACE the trigger's text as the accessible
          name, and that text is the current value. The label is inside the
          value instead, so the name is complete either way. */}
      <SelectTrigger size="sm" className="h-8 w-auto gap-1.5">
        {/* Explicit children. Radix fills SelectValue from the mounted
            SelectItem, which lives in a portal, so with children omitted the
            trigger renders blank until the list has been opened once. */}
        <SelectValue>
          {props.label}: {selected?.label ?? "Any"}
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
