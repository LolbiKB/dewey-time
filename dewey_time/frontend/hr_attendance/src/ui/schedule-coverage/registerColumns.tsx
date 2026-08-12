import type { ColumnDef, HeaderContext, SortDirection } from "@tanstack/react-table";

import { Badge, Button } from "@lolbikb/dewey-ui";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import { BIOMETRIC_LABELS, SCHEDULE_LABELS, type RegisterRow } from "@/lib/coverageRegister";

/**
 * Only a positive statement of absence is destructive. "Enrolled, not punching"
 * is neutral: they CAN clock in and simply have not, which is an attendance
 * question, not a coverage one — the same rule isNotReady applies.
 */
const BIOMETRIC_VARIANT: Record<NonNullable<RegisterRow["biometric"]>, "secondary" | "outline" | "destructive"> = {
  enrolled: "secondary",
  enrolled_not_punching: "outline",
  none: "destructive",
  still_enrolled: "destructive",
};

/**
 * What the header IS, and what pressing it will DO.
 *
 * Both halves, because neither carries the other. The arrow is `aria-hidden`
 * and dewey-ui's TableHead takes no `aria-sort` from a columnDef, so this name
 * is the ONLY place the current direction exists for a screen-reader user —
 * told just the next action, they cannot tell an ascending column from an
 * unsorted one, and on a register whose default order is severity "unsorted" is
 * a meaningful state rather than an absence.
 */
function sortActionLabel(
  label: string,
  current: SortDirection | false,
  next: SortDirection | false,
): string {
  const state = current === false ? "not sorted" : `sorted ${direction(current)}`;
  const action = next === false ? "clear the sort" : `sort ${direction(next)}`;
  return `${label}, ${state} — press to ${action}`;
}

function direction(sort: SortDirection): string {
  return sort === "desc" ? "descending" : "ascending";
}

/**
 * A column header that sorts.
 *
 * A real <button> carrying the column's own text, not a bare icon: the arrow
 * shows the current direction to a sighted reader and the accessible name
 * states both the current direction and the next action for everyone else, so
 * neither depends on the other.
 *
 * `getToggleSortingHandler()` rather than calling `column.toggleSorting()`
 * directly. The handler is the path that consults `getCanSort()`, which is
 * `(enableSorting ?? true) && (options.enableSorting ?? true) &&
 * !!column.accessorFn` (@tanstack/table-core RowSorting) — the reason the
 * sortable columns below carry an `accessorFn` at all. Calling toggleSorting()
 * to dodge that guard works, but leaves getCanSort() false while the header
 * sorts anyway, so any later header-state or a11y logic keyed off it is
 * silently wrong.
 */
function sortableHeader(label: string) {
  return function SortableHeader({ column }: HeaderContext<RegisterRow, unknown>) {
    const sorted = column.getIsSorted();
    const Arrow = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ArrowUpDownIcon;

    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 px-2 font-medium"
        onClick={column.getToggleSortingHandler()}
        aria-label={sortActionLabel(label, sorted, column.getNextSortingOrder())}
      >
        {label}
        <Arrow className="size-3.5 opacity-60" aria-hidden="true" />
      </Button>
    );
  };
}

/**
 * The sorting options every sortable column shares.
 *
 * `sortDescFirst: false` so the first press is always ascending, on numbers as
 * well as text. TanStack otherwise sniffs the direction from the FIRST row's
 * value, which means the cycle would depend on whichever employee happens to
 * sort first — and on this page the low end of Hrs/wk and Prints is where the
 * findings are, so ascending is the useful first press anyway.
 *
 * `enableMultiSort: false` because GenericDataTable reads only `sorting[0]`
 * and RegisterFilters carries a single sort. A shift-click would otherwise
 * append a second sort that the page then ignores — an affordance that looks
 * like it did nothing.
 */
const SORTABLE = { sortDescFirst: false, enableMultiSort: false } as const;

/**
 * Ids MUST match visibleColumnIds() — a mismatch hides a column permanently.
 *
 * The three sortable columns keep their explicit id and their custom cell and
 * add an `accessorFn`, which is what makes `column.getCanSort()` true. It does
 * NOT make the table sort locally: GenericDataTable sets `manualSorting`, so
 * TanStack only reports the intent through `onSortingChange` and
 * sortRegisterRows still does the ordering.
 *
 * Callers must memoize the result (e.g. `useMemo`): this allocates a new
 * array and new per-row closures on every call, and TanStack resets column
 * state whenever the `columns` reference changes.
 */
export function registerColumns(
  onOpen: (row: RegisterRow) => void,
  onAddSchedule: (row: RegisterRow) => void,
): ColumnDef<RegisterRow, unknown>[] {
  return [
    {
      id: "employee",
      ...SORTABLE,
      accessorFn: (row) => row.employee_name,
      header: sortableHeader("Employee"),
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.original.employee_name}</span>
          <span className="truncate text-xs text-muted-foreground">{row.original.id}</span>
        </span>
      ),
    },
    { id: "branch", header: "Branch", cell: ({ row }) => row.original.branch ?? "—" },
    { id: "department", header: "Dept", cell: ({ row }) => row.original.department ?? "—" },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.status ? (
          <Badge variant={row.original.status === "Left" ? "destructive" : "secondary"}>
            {row.original.status}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      id: "schedule",
      header: "Schedule",
      cell: ({ row }) => {
        if (row.original.schedule === null) return "—";
        return (
          <Badge variant={row.original.schedule === "missing" ? "outline" : "secondary"}>
            {SCHEDULE_LABELS[row.original.schedule]}
          </Badge>
        );
      },
    },
    {
      id: "weekly_minutes",
      ...SORTABLE,
      accessorFn: (row) => row.weekly_minutes,
      header: sortableHeader("Hrs/wk"),
      cell: ({ row }) => {
        const minutes = row.original.weekly_minutes;
        if (minutes === null) return "—";
        // formatScheduleDuration treats <= 0 as "nothing to show" and returns
        // "—" — right for that shared helper's other callers, wrong here: a
        // real 0-minute assigned schedule is itself a coverage problem and
        // must not read identically to a feed that never reported the fact
        // at all. Handled here rather than in the shared helper, which other
        // pages depend on for the null case.
        if (minutes === 0) return "0h";
        return formatScheduleDuration(minutes);
      },
    },
    {
      id: "biometric",
      header: "Biometric",
      cell: ({ row }) => {
        const value = row.original.biometric;
        if (value === null) return "—";
        const days = row.original.days_since_relieving;
        return (
          <span className="flex items-center gap-1.5">
            <Badge variant={BIOMETRIC_VARIANT[value]}>{BIOMETRIC_LABELS[value]}</Badge>
            {value === "still_enrolled" && days !== null ? (
              <span className="text-xs tabular-nums text-destructive">
                {days} {days === 1 ? "day" : "days"}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "fingerprint_count",
      ...SORTABLE,
      accessorFn: (row) => row.fingerprint_count,
      header: sortableHeader("Prints"),
      cell: ({ row }) =>
        row.original.fingerprint_count === null ? "—" : row.original.fingerprint_count,
    },
    {
      id: "action",
      header: "",
      // Empty unless the row has a problem. A button on every row is noise, and
      // it is what made the old Needs list read as a to-do list.
      //
      // Biometric problems are checked FIRST, matching severity()'s ordering
      // in coverageRegister.ts (still_enrolled/none outrank a missing
      // schedule). Coverage filters status:Active live while the enrollment
      // snapshot can lag by up to STALE_AFTER_MINUTES, so a row with BOTH
      // schedule:"missing" and biometric:"still_enrolled" is the ordinary
      // shape of a recent leaver, not an edge case — it is "the security
      // finding this page exists to show" (joinRegisterRows's doc comment).
      // That row must resolve to Open, the path to revocation, never to
      // "Add schedule", which would offer a shift to someone who has left.
      // If severity()'s ranking ever changes, this ordering needs to move
      // with it.
      cell: ({ row }) => {
        if (row.original.biometric === "none" || row.original.biometric === "still_enrolled") {
          return (
            <Button size="sm" variant="ghost" onClick={() => onOpen(row.original)}>
              Open
            </Button>
          );
        }
        if (row.original.schedule === "missing") {
          return (
            <Button size="sm" variant="outline" onClick={() => onAddSchedule(row.original)}>
              Add schedule
            </Button>
          );
        }
        return null;
      },
    },
  ];
}
