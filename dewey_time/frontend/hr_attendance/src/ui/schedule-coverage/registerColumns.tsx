import type { ColumnDef, HeaderContext, SortDirection } from "@tanstack/react-table";

import { Badge, Button } from "@lolbikb/dewey-ui";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  FingerprintIcon,
  LinkIcon,
  ScanFaceIcon,
  SendIcon,
} from "lucide-react";

import { AppTooltip } from "@/ui/AppTooltip";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import {
  accountedFingers,
  BIOMETRIC_LABELS,
  isFragileEnrollment,
  SCHEDULE_LABELS,
  TELEGRAM_LABELS,
  type RegisterRow,
} from "@/lib/coverageRegister";
import { fingerLabel } from "@/lib/fingerLabels";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";
import { EmployeeIdentity } from "@/ui/EmployeeIdentity";
import type { CalendarEmployee } from "@/types/calendar";

/**
 * The tooltip's lines, and the trigger's accessible name.
 *
 * ONE derivation for both, so what a screen reader hears is what a hover
 * shows. The finger names obey `accountedFingers` — names only when they
 * account for every template, else the bare count — and the fragility line
 * explains the amber rather than leaving colour to carry meaning alone.
 */
function biometricFacts(row: RegisterRow): string[] {
  const count = row.fingerprint_count ?? 0;
  const fingers = accountedFingers(row);
  return [
    fingers
      ? fingers.map(fingerLabel).join(", ")
      : `${count} fingerprint${count === 1 ? "" : "s"}`,
    ...(isFragileEnrollment(row) ? ["Only one finger — a cut means no punching"] : []),
    ...(row.face === true ? ["Face template on device"] : []),
  ];
}

/**
 * Only "Not linked" is drawn as a gap to close. "ID on file" is `outline` —
 * neutral, the same weight ENROLLED_NOT_PUNCHING gets — because that employee
 * is further along than the badge's neighbours and reads as a smaller job.
 * Neither is `destructive`: an unlinked employee is still tracked by their
 * device and schedule, so nothing here is a coverage failure.
 */
const TELEGRAM_VARIANT: Record<NonNullable<RegisterRow["telegram"]>, "secondary" | "outline"> = {
  linked: "secondary",
  id_on_file: "outline",
  none: "outline",
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
 *
 * `by` names what the column orders on, for the one column where that is not
 * its own label: "Biometric" sorts by fingerprint count, which is a surprise
 * worth stating rather than leaving the reader to infer from the result. It is
 * said exactly ONCE — in the state half when the column is already sorted, and
 * in the action half when it is not, because the unsorted state is where the
 * reader most needs to know what a press will do and is also the state the
 * register opens in. Repeating it in both halves reads as two different sorts.
 */
function sortActionLabel(
  label: string,
  current: SortDirection | false,
  next: SortDirection | false,
  by?: string,
): string {
  const on = by ? ` by ${by}` : "";
  const state = current === false ? "not sorted" : `sorted${on} ${direction(current)}`;
  const action =
    next === false ? "clear the sort" : `sort${current === false ? on : ""} ${direction(next)}`;
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
function sortableHeader(label: string, by?: string) {
  return function SortableHeader({ column }: HeaderContext<RegisterRow, unknown>) {
    const sorted = column.getIsSorted();
    const Arrow = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ArrowUpDownIcon;

    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 px-2 font-medium"
        onClick={column.getToggleSortingHandler()}
        aria-label={sortActionLabel(label, sorted, column.getNextSortingOrder(), by)}
      >
        {label}
        <Arrow className="size-3.5 opacity-60" aria-hidden="true" />
      </Button>
    );
  };
}

/**
 * A register row as `EmployeeAvatar` needs to see it.
 *
 * A real `CalendarEmployee`, built from what the row actually holds — not a
 * cast. The avatar's contract is that type, and every field it reads is one
 * this row can honestly supply: `employee_name` is the name it draws initials
 * from, `image` is the photo, and `label` is only ever a FALLBACK inside
 * `employeeDisplayName` for the case where `employee_name` is empty — which
 * `joinRegisterRows` already rules out by seeding `employee_name || id`.
 *
 * The same literal FlagQueueList builds for the same component.
 */
function avatarEmployee(row: RegisterRow): CalendarEmployee {
  return {
    id: row.id,
    label: row.employee_name,
    employee_name: row.employee_name,
    image: row.image,
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
  onManageTelegram: (row: RegisterRow) => void,
): ColumnDef<RegisterRow, unknown>[] {
  return [
    {
      id: "employee",
      ...SORTABLE,
      accessorFn: (row) => row.employee_name,
      header: sortableHeader("Employee"),
      cell: ({ row }) => (
        <EmployeeIdentity
          // The floor the query container took away, and this column cannot do
          // without: `container-type: inline-size` computes the block's min-
          // and max-content contributions AS IF IT HAD NO CONTENTS, and this
          // table is auto-layout — dewey-ui renders a bare `w-full` <table> and
          // reads no TanStack `size`, so a column with no intrinsic width is
          // sized by its header. Measured: the cell fell from 361px to 193px at
          // a 1280 content area, and at 375 every name in the fixture clipped
          // to 39px of text.
          //
          // TWO floors, because this cell has two jobs at two sizes.
          //
          // 185 = 36px avatar + 10px gap + 139px of text: the narrow floor,
          // deliberately UNDER the 200px at which EmployeeIdentity switches the
          // Khmer name on. The recorded trade is that the register shows no
          // Khmer name at 375 or at 1280, where the cell has no room for it.
          //
          // 246 = the same avatar and gap + 200px of text, from 1330 up. The
          // Khmer name used to arrive there on its own: a floor is not a cap,
          // an auto-layout table hands the surplus out, and past 1330 the
          // surplus carried the stack over 200 by itself. That crossing was
          // EMERGENT, and it silently depended on the column count — the
          // Telegram column pushed it from 1330 to ~1520, which is effectively
          // the 1536 e2e/employee-identity.spec.ts exists to rule out.
          //
          // So it is bought explicitly now, at the width it already happened
          // at. A plain 246 floor was measured first and overshot: it forced
          // the Khmer name on at 375 too, breaking the narrow half of the
          // trade above. The breakpoint is what keeps both.
          //
          // Tailwind v4 can sort an arbitrary `min-[]` variant BEFORE a named
          // breakpoint, which turns a correct-looking class string into a
          // measured no-op — so this pair was measured, not reasoned about:
          // 139px of stack at 375 and 768, 158px at 1280 (no Khmer), 221px at
          // 1330 (Khmer). e2e/employee-identity.spec.ts pins all of it, which
          // is how the Telegram column's effect surfaced in the first place.
          className="min-w-[185px] min-[1330px]:min-w-[246px]"
          englishName={row.original.employee_name}
          employeeId={row.original.id}
          // Already composed at the join by joinRegisterRows, family name
          // first — not recomposed from the two raw fields here, which is how
          // one surface starts naming a different person than the others.
          khmerName={row.original.khmer_name}
          // The avatar keeps its aria-hidden `contents` wrapper: the cell says
          // everything the photo does in words, the photo is alt="", and
          // EmployeeAvatar's loading ring is a role="status" live region whose
          // timer starts at mount — a page of rows would queue a page of
          // "Loading" announcements for decoration.
          avatar={
            <span aria-hidden="true" className="contents">
              {/* size-9 is exactly the two text lines beside it (20px + 16px),
                  so the photo spans the cell without making the row taller —
                  TableCell's py-2 is doing the rest. */}
              <EmployeeAvatar
                employee={avatarEmployee(row.original)}
                fallbackId={row.original.id}
                className="size-9"
              />
            </span>
          }
          // No tail. Branch, Dept and Status are the register's own columns.
          nameClassName="font-medium"
          // `data-slot`, this codebase's stable-hook convention (dewey-ui marks
          // its own parts the same way), because the avatar's initials are
          // TEXT: the cell's first line is "NV", not "Nora Vance", so the e2e
          // cannot read the name by counting lines. A hook survives the cell
          // gaining another layer; a line index does not.
          nameSlot="employee-name"
        />
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
      // The registration and its evidence in ONE column, and the evidence IS
      // the ordinary state: an enrolled row draws no badge at all — a
      // fingerprint glyph with the count (amber when a single template), a
      // face glyph when one exists — so badges survive only for the two
      // states that need attention and any colour here means "look here".
      // ENROLLED_NOT_PUNCHING renders like ENROLLED on purpose: it is punch
      // behaviour, not registration, and its distinction lives on in the
      // filter and the CSV (the retired Punches-30d column's zero/non-zero
      // constraint), just not as a badge out-shouting the real findings.
      //
      // The CSV still carries the count as a field of its own: a spreadsheet
      // has no width pressure and wants a number it can total, which is why
      // CSV_FIELDS is keyed off feed health rather than off this column list.
      id: "biometric",
      ...SORTABLE,
      // Sorts by the COUNT, which is where the retired Prints column's sort
      // went. Named in the header's accessible name, because a column labelled
      // "Biometric" ordering by print count is otherwise a surprise.
      accessorFn: (row) => row.fingerprint_count,
      header: sortableHeader("Biometric", "fingerprint count"),
      cell: ({ row }) => {
        const value = row.original.biometric;
        if (value === null) return "—";
        if (value === "none" || value === "still_enrolled") {
          const days = row.original.days_since_relieving;
          return (
            <span className="flex items-center gap-1.5">
              <Badge variant="destructive">{BIOMETRIC_LABELS[value]}</Badge>
              {/* No count beside either badge. "Not enrolled" IS the zero, and
                  a still-enrolled leaver's remedy is revocation — the days are
                  the finding, the template count is noise beside them. */}
              {value === "still_enrolled" && days !== null ? (
                <span className="text-xs tabular-nums text-destructive">
                  {days} {days === 1 ? "day" : "days"}
                </span>
              ) : null}
            </span>
          );
        }
        const fragile = isFragileEnrollment(row.original);
        const facts = biometricFacts(row.original);
        return (
          <AppTooltip
            // ONE wrapper element, not an array of children: dewey-ui's
            // TooltipContent is an inline-flex ROW (items-center, no
            // flex-col), so bare siblings become side-by-side flex COLUMNS
            // each wrapping mid-phrase — `block` on a flex item is a no-op.
            // Measured in Chromium before the wrapper: two facts at the same
            // y, 60px and 230px wide. The e2e pins the stacking by geometry,
            // because no string-match test can see it.
            content={
              <span className="flex flex-col gap-0.5">
                {facts.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            }
            side="bottom"
          >
            {/* Focusable, because a tooltip a keyboard cannot open is detail a
                keyboard user cannot reach; the aria-label carries the same
                facts for readers the tooltip never opens for. `w-fit` so the
                hover target is the evidence, not the whole cell width. */}
            <span
              tabIndex={0}
              className="flex w-fit items-center gap-2.5"
              aria-label={facts.join(". ")}
            >
              <span
                className={`flex items-center gap-1 ${fragile ? "text-amber-700" : "text-muted-foreground"}`}
              >
                {/* A zero count still renders "0" here: with no badge in this
                    branch the number is the cell's only claim, and the
                    face-only enrollee (is_registered with no fingerprints) is
                    exactly who it happens for. The old no-zero rule guarded a
                    "0" arguing with a badge; there is no badge left to argue
                    with. */}
                <FingerprintIcon
                  className={`size-3.5 ${fragile ? "text-amber-600" : "opacity-70"}`}
                  aria-hidden="true"
                />
                <span className={`text-xs tabular-nums ${fragile ? "font-semibold" : ""}`}>
                  {row.original.fingerprint_count ?? 0}
                </span>
              </span>
              {row.original.face === true ? (
                <ScanFaceIcon
                  className="size-3.5 text-muted-foreground opacity-70"
                  aria-hidden="true"
                />
              ) : null}
            </span>
          </AppTooltip>
        );
      },
    },
    {
      // The state and its remedy in ONE cell, the same fusion the biometric
      // column uses for its print count — and here it is also what keeps this
      // out of the `action` column, which can only ever show one button. That
      // column ranks a biometric problem above a missing schedule, so putting
      // "Issue link" there would make it unreachable for exactly the people
      // who have another problem too. The rollout must not be blocked by an
      // unrelated finding on the same row.
      id: "telegram",
      header: "Telegram",
      cell: ({ row }) => {
        const value = row.original.telegram;
        if (value === null) return "—";
        return (
          <span className="flex items-center gap-1.5">
            <Badge variant={TELEGRAM_VARIANT[value]}>{TELEGRAM_LABELS[value]}</Badge>
            {/* Drawn for EVERY known state, "linked" included: that row is
                where Unlink lives, and unlink -> re-issue is the changed-phone
                flow. It used to draw nothing there because the only action was
                issuing, which would have rebound the record to whoever opened
                the new link.

                Pressing this mints nothing — it opens a dialog. The old
                one-click issue put a live credential on screen from a stray
                click, with no confirmation anywhere.

                Icon-only, and that is a width decision with a measurement
                behind it. As a text button this cell was 195px — as wide as
                Biometric — and the table had no slack to give it: the Employee
                column was already pinned at its 185px floor, so the 39px this
                column took came straight out of the name stack and pushed the
                Khmer name's 200px threshold from a 1330 viewport to well past
                1340. Khmer names on an ordinary laptop is a deliberate,
                measured behaviour (see the Employee cell's own note); a
                Telegram column is not worth spending it. */}
            <AppTooltip content="Manage Telegram" side="bottom">
              <Button
                size="sm"
                variant="ghost"
                className="size-7 shrink-0 p-0"
                onClick={() => onManageTelegram(row.original)}
                // Named per row. A page of buttons all called "Manage
                // Telegram" gives a screen-reader user nothing to choose
                // between, and what is being chosen is whose credential gets
                // minted or destroyed.
                aria-label={`Manage Telegram for ${row.original.employee_name}`}
              >
                {value === "linked" ? (
                  <LinkIcon className="size-3.5" aria-hidden="true" />
                ) : (
                  <SendIcon className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </AppTooltip>
          </span>
        );
      },
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
