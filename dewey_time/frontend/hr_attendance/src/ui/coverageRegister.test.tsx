import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Command, CommandList } from "@lolbikb/dewey-ui";
import { getCoreRowModel, useReactTable, type SortingState } from "@tanstack/react-table";

import { AlertDot } from "@/ui/schedule-coverage/AlertDot";
import { registerColumns } from "@/ui/schedule-coverage/registerColumns";
import {
  paginateRegisterRows,
  REGISTER_PAGE_SIZE,
  visibleColumnIds,
} from "@/lib/coverageRegister";
import type {
  FeedHealth,
  RegisterAlert,
  RegisterFilters,
  RegisterRow,
} from "@/lib/coverageRegister";
import { toRegisterCsv } from "@/lib/registerCsv";
import {
  CoverageRegisterView,
  feedNotice,
  INITIAL_REGISTER_FILTERS,
  mergeTableFilters,
  registerFiltersFromTable,
  registerTableFilters,
  toggleReadiness,
  type CoverageRegisterViewProps,
} from "@/ui/schedule-coverage/CoverageRegisterPage";
import {
  RegisterExportButton,
  type RegisterExportButtonProps,
} from "@/ui/schedule-coverage/RegisterExportButton";
import {
  FacetFilter,
  FacetOptions,
  registerSearchPlaceholder,
  RegisterFilterBar,
  SingleFacet,
  toggleFacetValue,
  type RegisterFilterBarProps,
} from "@/ui/schedule-coverage/RegisterFilterBar";

const noop = () => {};

const BASE_ROW: RegisterRow = {
  id: "EMP-0001",
  employee_name: "Amara Okafor",
  branch: "Lagos",
  department: "Ops",
  status: "Active",
  schedule: "assigned",
  weekly_minutes: 2400,
  biometric: "enrolled",
  fingerprint_count: 2,
  days_since_relieving: null,
  // Both feeds know this employee — the ordinary row.
  sources: { schedule: true, biometric: true },
};

/**
 * Renders one row through the REAL @tanstack/react-table runtime (not a hand
 * built CellContext) so every column's `cell` renders exactly as the app
 * will call it — no `as any`/`as unknown as` stand-in for the parts of
 * CellContext the columns don't use.
 *
 * Returns both the per-column rendered HTML (for text/class assertions) and
 * the raw, un-rendered React element each `cell` function returned (for
 * introspecting props like `onClick` — a function prop that `renderToStatic-
 * Markup` drops from its HTML output entirely, so it cannot be checked from
 * `html` alone). The element comes from calling `columnDef.cell` directly
 * with the table's own `cell.getContext()` — the same context flexRender
 * would pass it — not a hand-built stand-in.
 */
function renderRow(
  row: RegisterRow,
  onOpen: (row: RegisterRow) => void = noop,
  onAddSchedule: (row: RegisterRow) => void = noop,
): { html: Record<string, string>; elements: Record<string, ReactNode> } {
  const elements: Record<string, ReactNode> = {};
  function Harness() {
    const table = useReactTable({
      data: [row],
      columns: registerColumns(onOpen, onAddSchedule),
      getCoreRowModel: getCoreRowModel(),
    });
    const tableRow = table.getRowModel().rows[0];
    return (
      <table>
        <tbody>
          <tr>
            {tableRow.getVisibleCells().map((cell) => {
              const def = cell.column.columnDef;
              const rendered = typeof def.cell === "function" ? def.cell(cell.getContext()) : def.cell;
              elements[cell.column.id] = rendered;
              return (
                <td key={cell.id} data-col={cell.column.id}>
                  {rendered}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    );
  }
  const fullHtml = renderToStaticMarkup(<Harness />);
  const html: Record<string, string> = {};
  for (const match of fullHtml.matchAll(/<td data-col="([^"]+)">(.*?)<\/td>/g)) {
    html[match[1]] = match[2];
  }
  return { html, elements };
}

/** Narrows a rendered node to its `onClick`, without an `as any`/`as unknown as` cast. */
function onClickOf(node: ReactNode): (() => void) | undefined {
  if (!isValidElement<{ onClick?: () => void }>(node)) return undefined;
  return node.props.onClick;
}

/** The same, for a handler that takes the event — a sort header's does. */
function onSortClickOf(node: ReactNode): ((event: unknown) => void) | undefined {
  if (!isValidElement<{ onClick?: (event: unknown) => void }>(node)) return undefined;
  return node.props.onClick;
}

/**
 * The props of the first node in an UNRENDERED element tree that match.
 *
 * The escape hatch for everything Radix takes out of reach. `PopoverContent`
 * and `SelectContent` resolve their portal container in a layout effect, so on
 * the server they render to null and nothing inside a facet's menu appears in
 * the markup at all; and `renderToStaticMarkup` drops function props even from
 * what it does render, so every `onFiltersChange`, `onSelect` and
 * `onValueChange` on this page was a line no test could execute.
 *
 * The filter bar and its facets hold no hooks, so calling one as a plain
 * function — the same trick the AlertDot test uses — hands back the exact tree
 * it built, and this walks it for the node under test.
 */
function findProps<P extends object>(
  node: ReactNode,
  matches: (props: P) => boolean,
): P | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps<P>(child, matches);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<P & { children?: ReactNode }>(node)) return null;
  if (matches(node.props)) return node.props;
  return findProps<P>(node.props.children, matches);
}

/**
 * Renders one column HEADER through the real table runtime, configured the way
 * GenericDataTable configures it — `manualSorting`, with the sorting supplied
 * as controlled state — and reports what the table would emit if the header
 * were pressed.
 *
 * `sorting` is keyed by COLUMN ID, because that is what GenericDataTable puts
 * there: `sorting: filters.sort ? [{ id: filters.sort, ... }] : []`.
 */
function renderHeader(columnId: string, sorting: SortingState = []) {
  let emitted: SortingState | null = null;
  let onClick: ((event: unknown) => void) | undefined;
  let canSort = false;

  function Harness() {
    const table = useReactTable({
      data: [BASE_ROW],
      columns: registerColumns(noop, noop),
      getCoreRowModel: getCoreRowModel(),
      manualSorting: true,
      state: { sorting },
      onSortingChange: (updater) => {
        emitted = typeof updater === "function" ? updater(sorting) : updater;
      },
    });
    const header = table.getHeaderGroups()[0].headers.find((h) => h.column.id === columnId);
    assert.ok(header, `no such column: ${columnId}`);
    canSort = header.column.getCanSort();
    const def = header.column.columnDef;
    const node = typeof def.header === "function" ? def.header(header.getContext()) : def.header;
    onClick = onSortClickOf(node);
    return (
      <table>
        <thead>
          <tr>
            <th>{node}</th>
          </tr>
        </thead>
      </table>
    );
  }

  const html = renderToStaticMarkup(<Harness />);
  return {
    html,
    canSort,
    /** Presses the header and returns the sorting the table reported, if any. */
    press(): SortingState | null {
      onClick?.({});
      return emitted;
    },
  };
}

// ---------------------------------------------------------------------------
// AlertDot
// ---------------------------------------------------------------------------

test("the dot carries its count and words in the accessible name", () => {
  // "Minimal via colour" cannot be colour alone: red/green is the most common
  // colour blindness, and a hue tells a screen reader nothing.
  const html = renderToStaticMarkup(
    <AlertDot
      alert={{ tone: "problem", count: 8, knowable: true, label: "8 need attention — show them" }}
      active={false}
      onToggle={noop}
    />,
  );
  assert.match(html, /aria-label="8 need attention — show them"/);
});

test("dropping the accessible name is not silently OK", () => {
  // Pins that the label MUST be the aria-label, not merely present somewhere —
  // a dot with a `title` but no `aria-label` would pass a looser "contains the
  // count" check while still being invisible to a screen reader.
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 8, knowable: true, label: "8 need attention" }}
              active={false} onToggle={noop} />,
  );
  const button = html.match(/<button[^>]*>/)?.[0] ?? "";
  assert.match(button, /aria-label="[^"]+"/, "the button must carry an aria-label");
});

test("the clear state is a hollow ring — not a filled disc of any kind", () => {
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "clear", count: 0, knowable: true, label: "All 241 ready" }}
              active={false} onToggle={noop} />,
  );
  // Direction, not difference: a swap that gives `clear` the filled look
  // must fail this, not merely "differ from problem" (which a swap also
  // satisfies).
  assert.match(html, /border-2/, "clear must be a ring");
  assert.doesNotMatch(html, /bg-destructive/, "clear must not carry the problem fill");
  assert.doesNotMatch(html, /bg-brand-accent/, "clear must not carry the degraded fill");
  assert.doesNotMatch(html, /ring-offset-2/, "clear must not carry degraded's concentric ring");
});

test("the problem state is a filled disc with a halo — no ring, no border", () => {
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 3, knowable: true, label: "3 need attention" }}
              active={false} onToggle={noop} />,
  );
  assert.match(html, /bg-destructive/, "problem must be filled");
  assert.doesNotMatch(html, /border-2/, "problem must not carry clear's ring");
  assert.doesNotMatch(html, /ring-offset-2/, "problem must not carry degraded's concentric ring");
});

test("the degraded state is a filled disc PLUS its own concentric ring — a third, distinct shape", () => {
  // Colour never carries meaning alone: with only two shapes (filled disc /
  // hollow ring) for three states, `problem` and `degraded` would be
  // distinguished by hue alone — exactly what the rule forbids, and the one
  // case (a feed down, count only partial) where under-noticing costs most.
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "degraded", count: 5, knowable: false, label: "5 need attention · biometrics unavailable" }}
              active={false} onToggle={noop} />,
  );
  assert.match(html, /bg-brand-accent/, "degraded must be filled");
  assert.match(html, /ring-offset-2/, "degraded must carry its own concentric ring, separate from problem's plain disc");
  assert.doesNotMatch(html, /border-2/, "degraded must not carry clear's hollow-ring look");
  // The ring is what makes degraded a distinct SHAPE; the halo is what keeps
  // it as loud as problem. Dropping the halo would leave the state that says
  // "this count is partial" quieter than the one that says "here are the
  // problems" — under-noticing, in the case where it costs most. Tailwind
  // composes shadow-* and ring-* into one box-shadow via separate custom
  // properties, so both survive; this pins that they are both emitted.
  assert.match(html, /shadow-\[0_0_0_3px\]/, "degraded must keep problem's halo, not just the ring");
});

test("the clear state still renders — absence is not a signal", () => {
  const clear = renderToStaticMarkup(
    <AlertDot alert={{ tone: "clear", count: 0, knowable: true, label: "All 241 ready" }}
              active={false} onToggle={noop} />,
  );
  assert.match(clear, /<button/);
  assert.match(clear, /data-tone="clear"/);
  assert.match(clear, /aria-label="All 241 ready"/);
});

test("aria-pressed follows the active prop in both directions", () => {
  const pressed = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active onToggle={noop} />,
  );
  const unpressed = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active={false} onToggle={noop} />,
  );
  assert.match(pressed, /aria-pressed="true"/);
  assert.match(unpressed, /aria-pressed="false"/);
});

test("active adds its own visible ring, not just the aria-pressed attribute", () => {
  // aria-pressed alone is enough for assistive tech, but a sighted mouse/
  // touch user toggling the dot needs a visual confirmation too.
  const active = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active onToggle={noop} />,
  );
  const inactive = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active={false} onToggle={noop} />,
  );
  assert.match(active, /ring-offset-1/, "the active state must carry its own ring");
  assert.doesNotMatch(inactive, /ring-offset-1/, "an inactive dot must not carry the active ring");
});

test("the dot's onClick is wired directly to onToggle, not dropped or copied", () => {
  let calls = 0;
  const onToggle = () => {
    calls += 1;
  };
  // AlertDot uses no hooks, so it can be called directly as a plain
  // function to get back the exact element it constructs.
  const element = AlertDot({
    alert: { tone: "problem", count: 1, knowable: true, label: "1 needs attention" },
    active: false,
    onToggle,
  });
  assert.equal(onClickOf(element), onToggle, "the button's onClick must be the exact onToggle reference");
  onClickOf(element)?.();
  assert.equal(calls, 1);
});

test("the hit area is a padded button around a same-size 12px dot", () => {
  // WCAG 2.5.8's 24x24 CSS px minimum target size: the visual dot alone is
  // 12px, so the interactive <button> needs its own padding rather than
  // being exactly the dot's size.
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active={false} onToggle={noop} />,
  );
  const button = html.match(/<button[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(button, /size-3\b/, "the button itself must not be sized down to the dot's 12px box");
  assert.match(button, /class="[^"]*\bp-\d/, "the button needs its own padding beyond the dot");
  const span = html.match(/<span[^>]*>/)?.[0] ?? "";
  assert.match(span, /aria-hidden="true"/, "the visual dot is decorative — the button already carries the label");
  assert.match(span, /size-3\b/, "the visual dot itself stays 12px");
});

// ---------------------------------------------------------------------------
// registerColumns — id contract
// ---------------------------------------------------------------------------

test("every column id is one visibleColumnIds knows about", () => {
  // A typo here silently makes a column permanently invisible.
  const ids = registerColumns(noop, noop).map((c) => c.id);
  const known = visibleColumnIds({ schedule: true, biometric: true });
  for (const id of ids) assert.ok(known.includes(id!), `unknown column id: ${id}`);
  for (const id of known) assert.ok(ids.includes(id), `visibleColumnIds names a column that does not exist: ${id}`);
});

// ---------------------------------------------------------------------------
// registerColumns — sortable headers
// ---------------------------------------------------------------------------

const SORTABLE_IDS = ["employee", "weekly_minutes", "fingerprint_count"];
const DISPLAY_IDS = ["branch", "department", "status", "schedule", "biometric", "action"];

/**
 * The arrow glyphs, matched to the end of the lucide class name. Without the
 * trailing space `lucide-arrow-up` also matches inside `lucide-arrow-up-down`,
 * so the neutral glyph would read as "ascending".
 */
const ARROW = {
  none: /lucide-arrow-up-down /,
  ascending: /lucide-arrow-up /,
  descending: /lucide-arrow-down /,
};

test("exactly the three sort-only columns can sort", () => {
  // getCanSort() is `(enableSorting ?? true) && (options.enableSorting ?? true)
  // && !!column.accessorFn`, so a sortable column that loses its accessorFn
  // keeps its header button and silently stops doing anything —
  // getToggleSortingHandler() returns a handler that checks canSort and
  // returns. Nothing about the markup would give that away.
  for (const id of SORTABLE_IDS) {
    assert.equal(renderHeader(id).canSort, true, `${id} must be sortable`);
  }
  for (const id of DISPLAY_IDS) {
    assert.equal(renderHeader(id).canSort, false, `${id} must not be sortable`);
  }
});

test("a sortable header is a real button carrying the column's own words", () => {
  // Not a bare glyph: the arrow shows the direction to a sighted reader and
  // the accessible name states the next action for everyone else, so neither
  // one is carrying the meaning alone.
  const { html } = renderHeader("employee");
  assert.match(html, /<button/);
  assert.match(html, />Employee</, "the column's label must still be readable text");
  assert.match(html, /aria-label="Employee, not sorted — press to sort ascending"/);
  assert.match(html, /aria-hidden="true"/, "the arrow is decorative");
});

test("the accessible name says which way the column is sorted NOW, not only what a press will do", () => {
  // The arrow is aria-hidden and dewey-ui's TableHead takes no aria-sort from a
  // columnDef, so this name is the only place the current direction exists at
  // all. Told just the next action, a screen-reader user hearing "press to sort
  // descending" cannot tell an ascending column from an unsorted one — and on a
  // register whose default order is severity, "unsorted" is a meaningful state
  // rather than an absence.
  const unsorted = renderHeader("weekly_minutes").html;
  const ascending = renderHeader("weekly_minutes", [{ id: "weekly_minutes", desc: false }]).html;
  const descending = renderHeader("weekly_minutes", [{ id: "weekly_minutes", desc: true }]).html;

  assert.match(unsorted, /aria-label="Hrs\/wk, not sorted — press to sort ascending"/);
  assert.match(ascending, /aria-label="Hrs\/wk, sorted ascending — press to sort descending"/);
  assert.match(descending, /aria-label="Hrs\/wk, sorted descending — press to clear the sort"/);
});

test("a display column's header is plain text, with nothing to press", () => {
  for (const id of DISPLAY_IDS) {
    assert.doesNotMatch(renderHeader(id).html, /<button/, `${id} must not offer a sort`);
  }
});

test("pressing Hrs/wk asks for its own column, ascending first", () => {
  // ascending first on purpose (sortDescFirst: false): the low end of Hrs/wk
  // and Prints is where the findings are, and TanStack would otherwise pick a
  // direction by sniffing the first row's value.
  assert.deepEqual(renderHeader("weekly_minutes").press(), [
    { id: "weekly_minutes", desc: false },
  ]);
  assert.deepEqual(renderHeader("fingerprint_count").press(), [
    { id: "fingerprint_count", desc: false },
  ]);
  assert.deepEqual(renderHeader("employee").press(), [{ id: "employee", desc: false }]);
});

test("a second press reverses it, and a third clears it", () => {
  const ascending = renderHeader("weekly_minutes", [{ id: "weekly_minutes", desc: false }]);
  assert.match(ascending.html, /press to sort descending"/);
  assert.match(ascending.html, ARROW.ascending, "an ascending column shows which way it went");
  assert.deepEqual(ascending.press(), [{ id: "weekly_minutes", desc: true }]);

  const descending = renderHeader("weekly_minutes", [{ id: "weekly_minutes", desc: true }]);
  assert.match(descending.html, /press to clear the sort"/);
  assert.match(descending.html, ARROW.descending);
  assert.deepEqual(
    descending.press(),
    [],
    "the reader must be able to get back to the default order, which is where severity ranking lives",
  );
});

test("an unsorted header says so, and shows neither direction", () => {
  const html = renderHeader("weekly_minutes").html;
  assert.match(html, ARROW.none, "the neutral glyph, not one of the two directions");
  assert.doesNotMatch(html, ARROW.ascending);
  assert.doesNotMatch(html, ARROW.descending);
});

test("the table keys its header state by COLUMN ID — which is why the page translates", () => {
  // The defect columnIdForSort exists to prevent, pinned against the real
  // runtime rather than argued from the source. Put this module's own sort
  // vocabulary into the table's state, as storing `filters.sort` unchanged
  // would, and the column the reader just sorted reads as unsorted: no
  // direction, the same first direction on every press, and no way to clear.
  const wrong = renderHeader("weekly_minutes", [{ id: "hours", desc: true }]);
  assert.match(wrong.html, /aria-label="Hrs\/wk, not sorted — press to sort ascending"/);
  assert.deepEqual(wrong.press(), [{ id: "weekly_minutes", desc: false }]);

  const right = renderHeader("weekly_minutes", [{ id: "weekly_minutes", desc: true }]);
  assert.match(right.html, /aria-label="Hrs\/wk, sorted descending — press to clear the sort"/);
});

// ---------------------------------------------------------------------------
// registerColumns — cell content
// ---------------------------------------------------------------------------

test("the biometric column shows the right label and variant for each of the four buckets", () => {
  const cases: { biometric: NonNullable<RegisterRow["biometric"]>; label: string; variant: string }[] = [
    { biometric: "enrolled", label: "Enrolled", variant: "secondary" },
    { biometric: "enrolled_not_punching", label: "Enrolled, not punching", variant: "outline" },
    { biometric: "none", label: "No fingerprint", variant: "destructive" },
    { biometric: "still_enrolled", label: "Still enrolled", variant: "destructive" },
  ];
  for (const { biometric, label, variant } of cases) {
    const { html } = renderRow({ ...BASE_ROW, biometric });
    assert.match(html.biometric, new RegExp(`>${label}<`), `${biometric} must show "${label}"`);
    assert.match(html.biometric, new RegExp(`data-variant="${variant}"`), `${biometric} must use the ${variant} variant`);
  }
});

test("a still-enrolled leaver's day count is singular at 1 and plural otherwise", () => {
  const singular = renderRow({ ...BASE_ROW, biometric: "still_enrolled", days_since_relieving: 1 }).html.biometric;
  const plural = renderRow({ ...BASE_ROW, biometric: "still_enrolled", days_since_relieving: 42 }).html.biometric;
  assert.match(singular, />1 day</);
  assert.doesNotMatch(singular, />1 days</);
  assert.match(plural, />42 days</);
});

test("the schedule column shows Assigned/secondary vs Missing/outline", () => {
  const assigned = renderRow({ ...BASE_ROW, schedule: "assigned" }).html.schedule;
  const missing = renderRow({ ...BASE_ROW, schedule: "missing" }).html.schedule;
  assert.match(assigned, />Assigned</);
  assert.match(assigned, /data-variant="secondary"/);
  assert.match(missing, />Missing</);
  assert.match(missing, /data-variant="outline"/);
});

test("the status column shows Active/secondary vs Left/destructive, and blanks when unknown", () => {
  const active = renderRow({ ...BASE_ROW, status: "Active" }).html.status;
  const left = renderRow({ ...BASE_ROW, status: "Left" }).html.status;
  const unknown = renderRow({ ...BASE_ROW, status: null }).html.status;
  assert.match(active, />Active</);
  assert.match(active, /data-variant="secondary"/);
  assert.match(left, />Left</);
  assert.match(left, /data-variant="destructive"/);
  assert.equal(unknown, "—");
});

test("the employee cell shows the name and id, not the branch", () => {
  const { html } = renderRow(BASE_ROW);
  assert.match(html.employee, />Amara Okafor</);
  assert.match(html.employee, />EMP-0001</);
  assert.doesNotMatch(html.employee, />Lagos</, "the employee cell must not render the branch");
});

test("weekly_minutes renders the formatted duration, 0h for a real zero, and an em dash only when unknown", () => {
  const formatted = renderRow({ ...BASE_ROW, weekly_minutes: 130 }).html.weekly_minutes;
  const zero = renderRow({ ...BASE_ROW, weekly_minutes: 0 }).html.weekly_minutes;
  const unknown = renderRow({ ...BASE_ROW, weekly_minutes: null }).html.weekly_minutes;
  // Pins that the column calls formatScheduleDuration rather than rendering
  // the raw minute count.
  assert.equal(formatted, "2h 10m");
  // A real 0-minute assigned schedule is itself a coverage problem and must
  // not read the same as a feed that never reported the fact at all —
  // formatScheduleDuration alone collapses both to "—".
  assert.equal(zero, "0h");
  assert.equal(unknown, "—");
});

test("a null branch, department, and fingerprint_count render as an em dash, never a plausible default", () => {
  const { html } = renderRow({
    ...BASE_ROW,
    branch: null,
    department: null,
    fingerprint_count: null,
  });
  assert.equal(html.branch, "—");
  assert.equal(html.department, "—");
  assert.equal(html.fingerprint_count, "—");
});

test("a null schedule and null biometric render as an em dash, not a badge", () => {
  const { html } = renderRow({ ...BASE_ROW, schedule: null, biometric: null });
  assert.equal(html.schedule, "—");
  assert.equal(html.biometric, "—");
});

// ---------------------------------------------------------------------------
// registerColumns — the action column
// ---------------------------------------------------------------------------

test("a row with both problems gets Open, not Add schedule — the leaver case this page exists for", () => {
  // Coverage filters status:Active live while the enrollment snapshot can lag
  // by up to STALE_AFTER_MINUTES, so schedule:"missing" AND
  // biometric:"still_enrolled" on the same row is the ordinary shape of a
  // recent leaver, not an edge case. severity() in coverageRegister.ts ranks
  // still_enrolled worst (0) and puts this row first when filtered to
  // not-ready — the action column's priority must agree, or the one row the
  // register exists to surface offers to schedule a shift for someone who
  // has left instead of the path to revoke their access.
  const { html } = renderRow({
    ...BASE_ROW,
    schedule: "missing",
    biometric: "still_enrolled",
    days_since_relieving: 42,
  });
  assert.match(html.action, />Open</);
  assert.doesNotMatch(html.action, />Add schedule</);
});

test("Add schedule is wired to onAddSchedule, and never fires onOpen", () => {
  const opened: RegisterRow[] = [];
  const scheduled: RegisterRow[] = [];
  const row = { ...BASE_ROW, schedule: "missing" as const, biometric: "enrolled" as const };
  const { elements } = renderRow(
    row,
    (r) => opened.push(r),
    (r) => scheduled.push(r),
  );
  const onClick = onClickOf(elements.action);
  assert.ok(onClick, "the action cell must render a clickable button");
  onClick();
  assert.deepEqual(scheduled, [row]);
  assert.deepEqual(opened, [], "Add schedule must not also fire onOpen");
});

test("Open is wired to onOpen, and never fires onAddSchedule", () => {
  const opened: RegisterRow[] = [];
  const scheduled: RegisterRow[] = [];
  const row = { ...BASE_ROW, schedule: "assigned" as const, biometric: "still_enrolled" as const };
  const { elements } = renderRow(
    row,
    (r) => opened.push(r),
    (r) => scheduled.push(r),
  );
  const onClick = onClickOf(elements.action);
  assert.ok(onClick, "the action cell must render a clickable button");
  onClick();
  assert.deepEqual(opened, [row]);
  assert.deepEqual(scheduled, [], "Open must not also fire onAddSchedule");
});

test("the action column stays empty for enrolled-not-punching", () => {
  // A button here is what made the old Needs list read as a to-do list for
  // something that is not actually a coverage problem.
  const { html } = renderRow({ ...BASE_ROW, biometric: "enrolled_not_punching", schedule: "assigned" });
  assert.doesNotMatch(html.action, /data-slot="button"/);
});

test("a fully ready row has no action button at all", () => {
  const { html } = renderRow({ ...BASE_ROW, schedule: "assigned", biometric: "enrolled" });
  assert.doesNotMatch(html.action, /data-slot="button"/);
});

// ---------------------------------------------------------------------------
// CoverageRegisterPage — the source contract
//
// These read the file rather than render it. The page half owns the router and
// react-query wiring, and this suite has no jsdom, so what it DELEGATES is the
// only thing checkable from outside. Everything the page actually renders is
// exercised for real against CoverageRegisterView further down.
// ---------------------------------------------------------------------------

const pageSource = readFileSync(
  new URL("./schedule-coverage/CoverageRegisterPage.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

test("the page uses dewey-ui Page chrome like every other routed page", () => {
  // The old biometrics page was the only routed page without it, which is why
  // the shared nav shifted 16px between tabs (Page is px-5 sm:px-8, that page
  // hand-rolled px-4). <Page> is what the parity guard in chromeMigration.test
  // and the geometry measured by e2e/page-insets.spec.ts both rest on, so it
  // stays even though the header above it is gone.
  assert.ok(pageSource.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(!/className="[^"]*\bpx-4\b/.test(pageSource), "no hand-rolled page inset");
});

test("the register has a heading, and it costs no vertical space", () => {
  // PageHeader went because a title block above the table was a whole row of
  // height to restate the tab the reader arrived through. The HEADING is a
  // different thing: screen-reader users navigate by heading, and a route with
  // none cannot answer "where am I". `sr-only` is zero pixels, so both hold.
  //
  // Rendered, not grepped, because the class is what makes this free — an <h1>
  // that lost `sr-only` would put the 40px straight back.
  const html = renderView();
  assert.match(html, /<h1 class="sr-only">Coverage<\/h1>/);
  assert.ok(
    !pageSource.includes("<PageHeader"),
    "the header block is what this round removed; only the heading survives",
  );
});

test("the page gates on hrStaff like its siblings", () => {
  assert.ok(pageSource.includes("hrStaff"));
  assert.ok(pageSource.includes("Navigate"));
  // Direction, not just presence. Deleting the guard while leaving the outlet
  // context destructured — which is what removing the gate actually looks like
  // in a diff — keeps both strings above in the file, so on their own they
  // cannot fail for the mutation they exist to catch.
  assert.match(
    pageSource,
    /if \(!hrStaff\)[\s\S]{0,120}<Navigate to="\/hr-attendance" replace \/>/,
    "a non-HR visitor must be redirected, not merely have their role read",
  );
});

test("the page holds no ROW derivation of its own", () => {
  // All logic lives in lib/ as pure tested functions. A second site would drift.
  // Assert delegation rather than banning `.filter(` outright: the page
  // legitimately filters the COLUMN list by visibility. What must never appear
  // is row derivation.
  assert.ok(pageSource.includes("filterRegisterRows"), "rows come from filterRegisterRows");
  assert.ok(pageSource.includes("sortRegisterRows"), "rows come from sortRegisterRows");
  assert.ok(!pageSource.includes("rows.filter("), "row filtering belongs in filterRegisterRows");
  assert.ok(!pageSource.includes(".sort("), "sorting belongs in sortRegisterRows");
  assert.ok(!pageSource.includes("localeCompare"), "name ordering belongs in sortRegisterRows");
  assert.ok(!pageSource.includes("isNotReady"), "readiness belongs in coverageRegister.ts");
});

test("the page renders the hook's rows, never a join of its own", () => {
  // useCoverageRegister hands back rows that are joined AND suppressed, in that
  // order (composeRegister owns it). A page that reached for joinRegisterRows
  // itself would render facts a downed-or-stale feed cannot vouch for, in the
  // very columns suppression exists to blank — and the alert count beside them
  // would then describe a different set of rows than the table does.
  assert.ok(!pageSource.includes("joinRegisterRows"), "the join belongs to the hook");
  assert.ok(!pageSource.includes("suppressUnusableFacts"), "suppression belongs to the hook");
  assert.ok(!pageSource.includes("composeRegister"), "composition belongs to the hook");
  assert.ok(pageSource.includes("useCoverageRegister"), "the page's rows come from the hook");
});

test("the retired biometrics route redirects into the register", () => {
  // The page it pointed at is deleted by this change; a link or bookmark to it
  // must land on the register rather than on the catch-all.
  assert.match(
    mainSource,
    /path="\/hr-schedule\/coverage\/biometrics"[\s\S]{0,120}<Navigate to="\/hr-schedule\/coverage" replace \/>/,
    "/hr-schedule/coverage/biometrics must redirect to /hr-schedule/coverage",
  );
  assert.ok(
    !mainSource.includes("BiometricEnrollmentPage"),
    "the deleted page must not still be routed",
  );
  assert.ok(
    !mainSource.includes("ScheduleCoveragePage"),
    "the deleted page must not still be routed",
  );
});

// ---------------------------------------------------------------------------
// CoverageRegisterView — rendered for real
// ---------------------------------------------------------------------------

const HEALTHY_FEEDS: FeedHealth = { schedule: true, biometric: true };

const CLEAR_ALERT: RegisterAlert = {
  tone: "clear", count: 0, knowable: true, label: "All 1 ready",
};

/** What both queries look like before either has answered — see feedHealth. */
const PENDING_ALERT: RegisterAlert = {
  tone: "degraded", count: 0, knowable: false,
  label: "0 need attention · schedules and biometrics unavailable",
};

/**
 * The accessible name of the register's search box — which is where the roster
 * total lives now that the page header is gone.
 *
 * There is exactly one box at any width (the bar's below 768, the primitive's
 * above), and both are named from `registerSearchPlaceholder`, so this reads
 * whichever one is on screen.
 */
function searchBoxName(html: string): string | null {
  return html.match(/(?:aria-label|placeholder)="(Search[^"]*)"/)?.[1] ?? null;
}

function renderView(over: Partial<CoverageRegisterViewProps> = {}): string {
  return renderToStaticMarkup(
    <CoverageRegisterView
      rows={[BASE_ROW]}
      feeds={HEALTHY_FEEDS}
      alert={CLEAR_ALERT}
      truncated={false}
      isLoading={false}
      bothFailed={false}
      filters={{}}
      onFiltersChange={noop}
      onRetry={noop}
      onOpen={noop}
      onAddSchedule={noop}
      {...over}
    />,
  );
}

test("an ordinary page load does not flash an outage", () => {
  // While either query is pending BOTH payloads are undefined, so feedHealth
  // reads {schedule:false, biometric:false} and the alert is `degraded`
  // — every single load would otherwise open on a red-adjacent dot reading
  // "schedules and biometrics unavailable" plus a feed-down banner, for the
  // second or so before the data lands. Nothing is wrong yet; nothing may say
  // so yet.
  // `rows: []` is not a convenience — it is what a pending load actually
  // holds, since composeRegister joins two undefined payloads into nothing.
  const html = renderView({
    isLoading: true,
    rows: [],
    feeds: { schedule: false, biometric: false },
    alert: PENDING_ALERT,
  });
  assert.doesNotMatch(html, /data-tone=/, "no alert dot until the feeds have answered");
  assert.doesNotMatch(html, /unavailable/, "no outage banner until the feeds have answered");
  assert.doesNotMatch(html, /roster is partial/);
  // Same rule in the search box, which is where the roster total went when the
  // header was dropped. Nobody has answered yet, so the size is UNKNOWN, not
  // zero — "Search 0 employees…" would state as a count the one thing the page
  // does not have.
  assert.equal(
    searchBoxName(html),
    "Search by name or employee ID…",
    "the box must claim no roster size it does not have",
  );
  assert.doesNotMatch(html, /Search 0 employees/);
  // Direction: the gate must be on `isLoading`, not on the page as a whole.
  assert.match(html, /Loading data/, "the table still reports that it is loading");
});

test("the search box names the roster size, and says employee once at one", () => {
  // Where "Coverage · N employees" went. It costs no vertical space here, and
  // it is derived from the UNFILTERED rows — see the facet test below for the
  // same rule on the facet options.
  assert.equal(searchBoxName(renderView({ rows: [BASE_ROW] })), "Search 1 employee by name or ID…");
  assert.equal(
    searchBoxName(renderView({ rows: [BASE_ROW, { ...BASE_ROW, id: "EMP-0002" }] })),
    "Search 2 employees by name or ID…",
  );
});

test("the roster count in the search box does not follow the filters down", () => {
  // Derived from `rows`, not from what survived the filter. A count that
  // shrank as the reader typed would be describing the result, not the roster,
  // and the search box is the only place the roster size is stated at all now.
  const two = [BASE_ROW, { ...BASE_ROW, id: "STUCK", employee_name: "Ada Stuck", schedule: "missing" as const }];
  assert.equal(
    searchBoxName(renderView({ rows: two, filters: { readiness: "not-ready" } })),
    "Search 2 employees by name or ID…",
  );
});

test("the placeholder is the same wording on both sides of the breakpoint", () => {
  // Two owners, one control: below 768 the bar renders the box and the
  // primitive's is hidden. A reader who learned it on a laptop has to find the
  // same name on a phone, and one e2e locator has to match both.
  const wide = renderView({ rows: [BASE_ROW] });
  const narrow = renderView({ rows: [BASE_ROW], narrow: true });
  assert.equal(searchBoxName(wide), "Search 1 employee by name or ID…");
  assert.equal(searchBoxName(narrow), searchBoxName(wide));
});

test("the alert dot leads the toolbar once the feeds have answered", () => {
  const html = renderView();
  assert.match(html, /data-tone="clear"/, "the dot must render when not loading");
  assert.match(html, /aria-label="All 1 ready"/);
  assert.match(html, /aria-pressed="false"/, "nothing is filtered yet");

  // AHEAD of the facets. It left PageHeader's actions with the header, and the
  // toolbar is where an alarm that doubles as a filter belongs — but it has to
  // be the first thing there, not buried after five facet chips.
  const dotAt = html.indexOf('data-tone="clear"');
  const branchAt = html.indexOf("Branch filter");
  assert.notEqual(branchAt, -1, "expected the facets beside it");
  assert.ok(dotAt < branchAt, "the dot must come before the facets, not after them");

  // And inside the toolbar rather than loose above the table: the toolbar is
  // what holds the export button, so the dot must precede that too and sit
  // above the table's own header row.
  assert.ok(dotAt < html.indexOf('aria-label="Export'), "the dot is toolbar-leading, not an action");
  assert.ok(dotAt < html.indexOf("<table"), "and the toolbar sits above the table");

  // The dot doubles as the not-ready filter's control, so it has to show that
  // the filter is on — and `active` is the view's wiring, not AlertDot's.
  const filtered = renderView({ filters: { readiness: "not-ready" } });
  assert.match(filtered, /aria-pressed="true"/, "a filtered register shows a pressed dot");
});

test("pressing the alert dot toggles the not-ready filter, keeping every other filter", () => {
  assert.deepEqual(toggleReadiness({}), { readiness: "not-ready", page: 1 }, "off -> on");
  assert.deepEqual(
    toggleReadiness({ readiness: "not-ready" }),
    { readiness: undefined, page: 1 },
    "on -> off, so the dot is a toggle rather than a one-way trip",
  );
  // A toggle that reset the reader's search or branch facets would read as the
  // dot clearing their work.
  assert.deepEqual(
    toggleReadiness({ search: "ada", branch: ["DIU"], sort: "hours" }),
    { search: "ada", branch: ["DIU"], sort: "hours", readiness: "not-ready", page: 1 },
  );
});

test("the dot narrows a 503-row roster, so it puts the reader back on page 1", () => {
  // Filtering to the four findings while sitting on page 8 would otherwise
  // clamp the reader onto the LAST page of them — the register's whole
  // headline act, delivered from the wrong end.
  assert.equal(toggleReadiness({ page: 8 }).page, 1);
  assert.equal(toggleReadiness({ readiness: "not-ready", page: 8 }).page, 1, "and coming back too");
  assert.equal(toggleReadiness({ page: 8, limit: 10 }).limit, 10, "the page SIZE is a preference, and survives");
});

test("a downed biometric feed says so, and takes its columns with it", () => {
  const html = renderView({ feeds: { schedule: true, biometric: false } });
  assert.match(html, /Biometric feed unavailable/, "the outage must be named");
  // Columns are REMOVED, never blanked: an empty Biometric column reads as a
  // whole roster who cannot clock in.
  assert.doesNotMatch(html, />Biometric</, "the Biometric column must be gone, not empty");
  assert.doesNotMatch(html, />Prints</, "the Prints column must be gone, not empty");
  assert.doesNotMatch(html, />Status</, "Status is a biometric-feed fact and must go with it");
  // The schedule half is unaffected — that is the claim the banner makes.
  assert.match(html, />Schedule</, "the schedule columns must survive a biometric outage");
  assert.match(html, />Hrs\/wk</);
});

test("a healthy pair of feeds shows every column", () => {
  // Without this the test above passes just as well against a table that never
  // renders any column at all.
  const html = renderView();
  for (const header of ["Employee", "Branch", "Dept", "Status", "Schedule", "Hrs/wk", "Biometric", "Prints"]) {
    assert.ok(html.includes(`>${header}<`), `expected the ${header} column`);
  }
  assert.doesNotMatch(html, /Biometric feed unavailable/, "no outage banner on a healthy load");
});

test("a downed SCHEDULE feed says so too, and takes its columns with it", () => {
  // The asymmetry this closes: only the biometric outage had a notice, so a
  // coverage-service error — the likelier of the two — made Schedule and
  // Hrs/wk vanish with the reason living only in the alert dot's accessible
  // name, which a sighted reader never hears.
  const html = renderView({ feeds: { schedule: false, biometric: true } });
  assert.match(html, /Schedule feed unavailable/, "the outage must be named on screen");
  assert.doesNotMatch(html, />Schedule</, "the Schedule column must be gone, not empty");
  assert.doesNotMatch(html, />Hrs\/wk</, "the Hrs/wk column must be gone, not empty");
  // The biometric half is unaffected — that is the claim this banner makes.
  assert.match(html, />Biometric</, "the biometric columns must survive a schedule outage");
  assert.match(html, />Prints</);
});

test("with both feeds down the notice names both, and promises nothing about either", () => {
  // registerAlert's label already names every down feed for the same reason:
  // naming one asserts by omission that the other half is fine. A per-feed
  // strip would have stacked two banners here, each closing with a promise the
  // other one denies.
  const html = renderView({ feeds: { schedule: false, biometric: false } });
  assert.match(html, /Schedule and biometric feeds are both unavailable/);
  assert.doesNotMatch(html, /is unaffected/, "neither half may be called fine here");
  // And exactly one strip, not two.
  assert.equal(html.split("are both unavailable").length - 1, 1);
});

test("the feed notice covers all four combinations, including saying nothing", () => {
  // Reached directly as well as through the render, because the both-down
  // wording is the one a reader only ever sees on the worst day.
  assert.equal(feedNotice({ schedule: true, biometric: true }), null);
  assert.match(feedNotice({ schedule: true, biometric: false }) ?? "", /^Biometric feed unavailable/);
  assert.match(feedNotice({ schedule: false, biometric: true }) ?? "", /^Schedule feed unavailable/);
  assert.match(
    feedNotice({ schedule: false, biometric: false }) ?? "",
    /^Schedule and biometric feeds are both unavailable/,
  );
  // No roster size anywhere in the copy. It used to read "not 241 people
  // losing their fingerprints" — a number frozen at whatever the roster was
  // the day it was written, and unverifiable against a page whose feed is down.
  for (const feeds of [{ schedule: true, biometric: false }, { schedule: false, biometric: true }]) {
    assert.doesNotMatch(feedNotice(feeds) ?? "", /\d/, "no count may be hardcoded into the copy");
  }
});

test("a failed load counts nobody, rather than counting nobody aloud", () => {
  // `answered` is true once both queries have SETTLED — failing counts as
  // settling — so a count derived from `rows.length` reads 0 here just as it
  // does mid-load, and 0 is not the roster size, it is the absence of one.
  // The FailureBlock replaces the whole table, toolbar and all, so there is no
  // search box to say it in either; this pins that nothing else invents it.
  const failed = renderView({ bothFailed: true, rows: [] });
  assert.doesNotMatch(failed, /0 employees/);
  assert.equal(searchBoxName(failed), null, "the failure replaces the table, search box and all");
  assert.match(failed, /Coverage didn’t load/, "the failure itself must still be reported");

  // The two states either side of it still speak.
  assert.equal(searchBoxName(renderView({ isLoading: true, rows: [] })), "Search by name or employee ID…");
  assert.equal(searchBoxName(renderView()), "Search 1 employee by name or ID…");
});

test("a partial roster says so", () => {
  const html = renderView({ truncated: true });
  assert.match(html, /roster is partial/);
});

test("the truncated notice waits for the feeds, and stands down on a total failure", () => {
  // Both halves of this gate were previously unreachable: the only assertion
  // that a truncation notice was ABSENT ran against the default
  // `truncated: false`, where no gate has to do anything for it to hold. Each
  // case here sets `truncated: true` so the gate itself is what is under test.
  const loading = renderView({ truncated: true, isLoading: true, rows: [] });
  assert.doesNotMatch(
    loading,
    /roster is partial/,
    "nothing is known about the roster's completeness until the feeds answer",
  );

  // Same rule as the biometric strip: notice.tsx forbids reporting one failure
  // as both a banner and a replaced region, and "some employees are not shown"
  // is a strange way to describe a page that loaded nobody at all.
  const failed = renderView({ truncated: true, bothFailed: true, rows: [] });
  assert.doesNotMatch(failed, /roster is partial/, "one failure, reported once");
  assert.match(failed, /Coverage didn’t load/, "the failure itself must still be reported");
});

test("when both feeds fail the table is replaced, not banner-stacked", () => {
  // notice.tsx's own rule: a page that shows both a banner and a replaced
  // region reports one failure twice. The biometric strip also ends with
  // "Schedule coverage is unaffected", which is flatly false here.
  const html = renderView({
    bothFailed: true,
    isLoading: false,
    rows: [],
    feeds: { schedule: false, biometric: false },
  });
  assert.match(html, /Coverage didn’t load/, "the failure must replace the region");
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /Biometric feed unavailable/, "one failure, reported once");
  assert.doesNotMatch(html, /Search by name/, "the table must be gone, not sitting under a banner");
});

test("the footer counts this page out of everything the filters admit", () => {
  // GenericDataTable's footer reads `Showing {data.length} of {meta?.total || 0}`
  // and its pager reads "Loading..." whenever `meta` is absent — so omitting
  // `meta` ships a permanent "Showing 241 of 0 employees" under a full table.
  // Zero is a rendered non-fact, which is the one thing this page may not do.
  //
  // The second number is the FILTERED count, not the roster: it has to be the
  // size of the set the first number is a page of, or the two do not describe
  // the same thing. The roster total lives in the search box now.
  const ready = { ...BASE_ROW, id: "READY", employee_name: "Bea Ready" };
  const notReady: RegisterRow = {
    ...BASE_ROW, id: "STUCK", employee_name: "Ada Stuck", schedule: "missing",
  };
  const html = renderView({
    rows: [ready, notReady],
    filters: { readiness: "not-ready" },
  });
  assert.match(html, /Showing 1 of 1 employees/, "one row on screen, one row matching");
  assert.doesNotMatch(html, /of 0 employees/);
  assert.doesNotMatch(html, /Loading\.\.\./, "the pager must not be stuck reporting a load");
  assert.match(html, /Page 1 of 1/);
});

// ---------------------------------------------------------------------------
// CoverageRegisterView — pagination, wired
// ---------------------------------------------------------------------------

/** `n` rows, names in order, so what reached the table can be named. */
function manyRows(n: number): RegisterRow[] {
  return Array.from({ length: n }, (_, i) => ({
    ...BASE_ROW,
    id: `E${String(i + 1).padStart(3, "0")}`,
    employee_name: `Person ${String(i + 1).padStart(3, "0")}`,
  }));
}

/** Which of `names` actually reached the rendered table body. */
function rendered(html: string, names: string[]): string[] {
  const body = html.slice(html.indexOf("<tbody"));
  return names.filter((name) => body.includes(name));
}

test("the table is handed one page, not every filtered row", () => {
  // GenericDataTable never slices `data` — whatever it is handed is what it
  // draws. Before this the view passed all 503 rows and a hardcoded one-page
  // meta, so the roster rendered into a single scrolling frame under a pager
  // that read "Page 1 of 1" with every button dead.
  const rows = manyRows(5);
  const html = renderView({ rows, filters: { limit: 2 } });

  assert.deepEqual(
    rendered(html, rows.map((r) => r.employee_name)),
    ["Person 001", "Person 002"],
    "the first page only",
  );
  assert.match(html, /Showing 2 of 5 employees/);
  assert.match(html, /Page 1 of 3/);
});

test("page 2 is the second slice, and the pager says so", () => {
  const rows = manyRows(5);
  const html = renderView({ rows, filters: { limit: 2, page: 2 } });
  assert.deepEqual(
    rendered(html, rows.map((r) => r.employee_name)),
    ["Person 003", "Person 004"],
  );
  assert.match(html, /Page 2 of 3/);
});

test("a page past the end lands on the last page, not on an empty table", () => {
  // Reachable without any filter change: a refetch can shrink the roster under
  // a reader already on page 8, and so can the bridge going stale mid-session,
  // because suppressUnusableFacts then drops every row it was the sole witness
  // to. Unclamped, the slice starts past the end and the register renders
  // blank under a pager still claiming page 8.
  const rows = manyRows(3);
  const html = renderView({ rows, filters: { limit: 2, page: 8 } });
  assert.deepEqual(rendered(html, rows.map((r) => r.employee_name)), ["Person 003"]);
  assert.match(html, /Page 2 of 2/, "the pager reports where the reader actually landed");
  assert.doesNotMatch(html, /Page 8/);
});

test("the default page size is what the reader gets, and the size control is offered", () => {
  // `hidePageSize` was set for "fixed-page-size APIs". Real paging is exactly
  // what stops this being one, and on a 503-employee roster the size control is
  // the reader's own answer to how much they want at once.
  const html = renderView({ rows: manyRows(REGISTER_PAGE_SIZE + 5) });
  assert.match(html, /Showing 50 of 55 employees/);
  assert.match(html, /Rows per page/, "the size control must be on screen");
  assert.match(html, /Page 1 of 2/);
});

test("below the breakpoint the size control goes, and the pager stays", () => {
  // dewey-ui's FOOTER row does not wrap either — the same defect as its
  // toolbar, one row down. Measured at 375: "Rows per page" plus its `w-16`
  // select pushed the document 49px past the viewport, which is a page that
  // scrolls sideways rather than a control that is merely cramped.
  //
  // Only the size CHOICE waits for a wider screen. The count and the pager are
  // how the reader knows where they are, and they stay at every width.
  const rows = manyRows(REGISTER_PAGE_SIZE + 5);
  const narrow = renderView({ rows, narrow: true });
  assert.doesNotMatch(narrow, /Rows per page/, "the footer has no room for it at 375");
  assert.match(narrow, /Showing 50 of 55 employees/, "the count stays");
  assert.match(narrow, /Page 1 of 2/, "and so does the pager");
});

test("the export writes every filtered row, not the page in view", () => {
  // A reader who narrowed to 55 problem rows and exported from page 1 must get
  // all 55. A file holding one page of a filtered set is indistinguishable
  // from one holding the whole set, once it has been mailed to somebody — and
  // the count in the button's name is built from the same array the file is.
  const html = renderView({ rows: manyRows(55) });
  assert.match(html, /Showing 50 of 55 employees/, "the table is paged");
  assert.match(
    html,
    /aria-label="Export 55 employees as CSV"/,
    "the export is not",
  );
});

test("below the breakpoint the search box moves into the wrapping bar and the column toggle goes", () => {
  // dewey-ui's toolbar row does not wrap and its search input is a fixed
  // `w-64`, so at 375 and 412 it was measured drawn straight over the Status
  // facet, with the Columns dropdown ~57px off the right of the screen.
  // `Section grow` is overflow-hidden, so none of that moved the page and no
  // scrollWidth check could see it — see coverage-register.spec.ts.
  //
  // Both branches are asserted here, and both from markup: the e2e can only
  // measure the phone, and a gate that turned the desktop toolbar off too
  // would still look right at 375.
  const placeholder = registerSearchPlaceholder(1);

  const wide = renderView();
  assert.match(wide, />Columns/, "the desktop toolbar keeps dewey-ui's column toggle");
  assert.ok(
    !wide.includes(`aria-label="${placeholder}"`),
    "and dewey-ui's own search box, which is not the one the bar renders",
  );
  assert.ok(wide.includes(`placeholder="${placeholder}"`), "the primitive's box");

  const narrow = renderView({ narrow: true });
  assert.doesNotMatch(narrow, />Columns/, "which columns exist here is feed health's call, not a reader's");
  assert.ok(
    narrow.includes(`aria-label="${placeholder}"`),
    "the register renders its own box, inside the bar that wraps",
  );
  // ONE box, not two: the handoff has to remove the primitive's, or the phone
  // gets two controls writing one field.
  assert.equal(
    narrow.split(`placeholder="${placeholder}"`).length - 1,
    1,
    "exactly one search box at any width",
  );
});

/** Which of two names the rendered table puts first. */
function orderOf(html: string, first: string, second: string): [number, number] {
  const a = html.indexOf(first);
  const b = html.indexOf(second);
  assert.ok(a !== -1, `expected ${first} in the table`);
  assert.ok(b !== -1, `expected ${second} in the table`);
  return [a, b];
}

test("the view filters and sorts through lib, so the not-ready filter reaches the table", () => {
  // The rows the table receives must be filterRegisterRows + sortRegisterRows
  // of what came in, not the raw list — otherwise clicking the alert dot
  // changes the header and leaves the table showing everybody.
  const ready = { ...BASE_ROW, id: "READY", employee_name: "Bea Ready" };
  const notReady: RegisterRow = {
    ...BASE_ROW, id: "STUCK", employee_name: "Ada Stuck", schedule: "missing",
  };
  const unfiltered = renderView({ rows: [ready, notReady] });
  assert.match(unfiltered, /Bea Ready/);
  assert.match(unfiltered, /Ada Stuck/);

  const filtered = renderView({ rows: [ready, notReady], filters: { readiness: "not-ready" } });
  assert.match(filtered, /Ada Stuck/, "the not-ready row stays");
  assert.doesNotMatch(filtered, /Bea Ready/, "the ready row must be filtered out");
});

test("the view SORTS as well as filters — default order is by name, not input order", () => {
  // Membership alone cannot tell sortRegisterRows from a bare
  // filterRegisterRows: with both rows passing the filter, dropping the sort
  // leaves exactly the same two rows in the HTML and only their ORDER moves.
  // Input order is deliberately the reverse of name order, so the assertion
  // fails the moment the sort call goes.
  const zoe = { ...BASE_ROW, id: "Z", employee_name: "Zoe Last" };
  const ana = { ...BASE_ROW, id: "A", employee_name: "Ana First" };
  const [zoeAt, anaAt] = orderOf(renderView({ rows: [zoe, ana] }), "Zoe Last", "Ana First");
  assert.ok(anaAt < zoeAt, "the default order is alphabetical by name, not the order the feed sent");
});

test("severity order reaches the table, not just the alert count", () => {
  // While filtered to not-ready and with no explicit sort, sortRegisterRows
  // ranks worst first: a leaver still holding a template outranks a merely
  // missing schedule. Input order is again reversed, and name order would ALSO
  // put "Ana" first — so the fixture is chosen so that severity and
  // alphabetical disagree, and only severity produces this result.
  const missingSchedule: RegisterRow = {
    ...BASE_ROW, id: "SCHED", employee_name: "Ana Schedule", schedule: "missing",
  };
  const leaver: RegisterRow = {
    ...BASE_ROW, id: "LEAVER", employee_name: "Zoe Leaver",
    biometric: "still_enrolled", status: "Left", days_since_relieving: 42,
  };
  const html = renderView({
    rows: [missingSchedule, leaver],
    filters: { readiness: "not-ready" },
  });
  const [leaverAt, schedAt] = orderOf(html, "Zoe Leaver", "Ana Schedule");
  assert.ok(
    leaverAt < schedAt,
    "the leaver still holding a template must sort above a missing schedule, and alphabetically would not",
  );
});

// ---------------------------------------------------------------------------
// RegisterFilterBar
//
// Only the TRIGGERS reach this markup. Radix renders Popover/Select content
// inside a Portal whose container is resolved in a layout effect, so on the
// server it renders to nothing and everything inside a facet's menu is
// dropped. The option rows are therefore exported and exercised on their own,
// the way EmployeePicker's `EmployeeOption` already is, and the derivation
// itself is pinned on `registerFacets` in coverageRegister.test.ts.
// ---------------------------------------------------------------------------

const TWO_BRANCHES: RegisterRow[] = [
  { ...BASE_ROW, id: "E1", branch: "DIU", department: "Finance" },
  { ...BASE_ROW, id: "E2", employee_name: "Bea Second", branch: "ACES", department: "Finance" },
];

function renderBar(over: Partial<RegisterFilterBarProps> = {}): string {
  return renderToStaticMarkup(
    <RegisterFilterBar
      rows={TWO_BRANCHES}
      feeds={HEALTHY_FEEDS}
      filters={{}}
      onFiltersChange={noop}
      {...over}
    />,
  );
}

/** The accessible name of the facet trigger whose name begins with `label`. */
function facetName(html: string, label: string): string | null {
  return html.match(new RegExp(`aria-label="(${label} filter[^"]*)"`))?.[1] ?? null;
}

/** The single-select triggers render "Label: value" as their whole content. */
function selectValue(html: string, label: string): string | null {
  return html.match(new RegExp(`data-slot="select-value"[^>]*>${label}: ([^<]*)<`))?.[1] ?? null;
}

test("each single select says what it filters, not only what it is set to", () => {
  // Radix renders these as `role="combobox"`, which is nameFrom:author — the
  // "Status: Left" a sighted reader sees contributes NOTHING to the accessible
  // name. Without an explicit label all three announced as bare comboboxes,
  // and the aria snapshot in coverage-register.spec.ts is what caught it. The
  // value travels in the name too, so nothing is lost by naming them.
  const html = renderBar({ filters: { status: "Left" } });
  assert.equal(facetName(html, "Status"), "Status filter, Left");
  assert.equal(facetName(html, "Schedule"), "Schedule filter, Any");
  assert.equal(facetName(html, "Biometric"), "Biometric filter, Any");
});

test("the bar holds no search box unless it is asked to", () => {
  assert.ok(
    !renderBar().includes("Search "),
    "above the breakpoint the search box belongs to GenericDataTable's toolbar",
  );
  // TWO_BRANCHES, so the count in the name is the bar's own reading of the
  // roster it was handed rather than a constant it could have hardcoded.
  const narrow = renderBar({ showSearch: true });
  assert.ok(
    narrow.includes(`aria-label="${registerSearchPlaceholder(2)}"`),
    "a placeholder alone is a name only by fallback, and vanishes once anything is typed",
  );
});

test("the search placeholder counts the roster, is silent when there is none, and says employee once at one", () => {
  assert.equal(registerSearchPlaceholder(503), "Search 503 employees by name or ID…");
  assert.equal(registerSearchPlaceholder(1), "Search 1 employee by name or ID…");
  // Zero is not a roster size, it is the absence of one — during a load, and
  // after a failure that left the page holding nothing. A box reading "Search 0
  // employees…" states as a count the very thing the page does not know.
  assert.equal(registerSearchPlaceholder(0), "Search by name or employee ID…");
  assert.doesNotMatch(registerSearchPlaceholder(0), /\d/, "no count may survive into the silent form");
});

test("the bar offers every facet the two feeds can speak to", () => {
  const html = renderBar();
  assert.ok(facetName(html, "Branch"), "expected a Branch facet");
  assert.ok(facetName(html, "Department"), "expected a Department facet");
  assert.equal(selectValue(html, "Status"), "Any");
  assert.equal(selectValue(html, "Schedule"), "Any");
  assert.equal(selectValue(html, "Biometric"), "Any");
});

test("a downed biometric feed takes Status and Biometric with it", () => {
  // The same rule as their columns. Offering a filter over a fact the page has
  // blanked on every row invites the reader to narrow to nobody, and reads as
  // the roster having no leavers rather than the bridge having gone quiet.
  const html = renderBar({ feeds: { schedule: true, biometric: false } });
  assert.equal(selectValue(html, "Status"), null, "Status is a biometric-feed fact");
  assert.equal(selectValue(html, "Biometric"), null);
  assert.equal(selectValue(html, "Schedule"), "Any", "the schedule half is unaffected");
  assert.ok(facetName(html, "Branch"), "branch comes from either feed and survives");
});

test("a downed schedule feed takes only the Schedule facet", () => {
  const html = renderBar({ feeds: { schedule: false, biometric: true } });
  assert.equal(selectValue(html, "Schedule"), null);
  assert.equal(selectValue(html, "Status"), "Any");
  assert.equal(selectValue(html, "Biometric"), "Any");
});

test("with both feeds down only the facets neither feed owns remain", () => {
  const html = renderBar({ feeds: { schedule: false, biometric: false } });
  for (const label of ["Status", "Schedule", "Biometric"]) {
    assert.equal(selectValue(html, label), null, `${label} must be gone`);
  }
  assert.ok(facetName(html, "Branch"));
  assert.ok(facetName(html, "Department"));
});

test("the bar opens with no status chosen", () => {
  // A Global Constraint. Defaulting to Active hides every leaver still holding
  // a template while the alert dot beside it goes on counting them, so the
  // reader is shown a number they cannot reach.
  assert.equal(selectValue(renderBar(), "Status"), "Any");
});

test("each single select shows the value it was given, in the column's own words", () => {
  assert.equal(selectValue(renderBar({ filters: { status: "Left" } }), "Status"), "Left");
  assert.equal(selectValue(renderBar({ filters: { schedule: "missing" } }), "Schedule"), "Missing");
  assert.equal(
    selectValue(renderBar({ filters: { biometric: "none" } }), "Biometric"),
    "No fingerprint",
    "the filter must read the same as the badge it selects",
  );
  assert.equal(
    selectValue(renderBar({ filters: { biometric: "enrolled_not_punching" } }), "Biometric"),
    "Enrolled, not punching",
  );
});

test("a facet with no options in the data does not render at all", () => {
  // The test a hardcoded option list fails. Nothing in this roster has a
  // branch, so there is no branch to offer — a list written into the source
  // would put branches here that filter to nobody, every time.
  const html = renderBar({ rows: [{ ...BASE_ROW, branch: null, department: "Finance" }] });
  assert.equal(facetName(html, "Branch"), null, "no branch fact, so no branch facet");
  assert.ok(facetName(html, "Department"), "the facet that does have data still renders");
});

test("the facet trigger counts the options it holds and names what is selected", () => {
  assert.equal(facetName(renderBar(), "Branch"), "Branch filter, 2 options");
  assert.equal(
    facetName(renderBar({ filters: { branch: ["DIU"] } }), "Branch"),
    "Branch filter, 2 options, 1 selected: DIU",
  );
  assert.equal(
    facetName(renderBar({ filters: { branch: ["ACES", "DIU"] } }), "Branch"),
    "Branch filter, 2 options, 2 selected: ACES, DIU",
  );
  // Singular, so a one-option facet does not read as "1 options".
  assert.equal(facetName(renderBar(), "Department"), "Department filter, 1 option");
});

test("an empty selection is no filter, and shows no count badge", () => {
  const html = renderBar({ filters: { branch: [] } });
  assert.equal(facetName(html, "Branch"), "Branch filter, 2 options");
  assert.doesNotMatch(html, /data-slot="badge"/, "nothing is selected, so nothing is counted");
});

test("the facet option rows are exactly the options handed to them", () => {
  // Rendered inside a bare <Command>, because inside the popover they would be
  // portalled away. Two options, one selected, so a row that ignored `selected`
  // and a row that hardcoded its own list both fail.
  const html = renderToStaticMarkup(
    <Command>
      <CommandList>
        <FacetOptions options={["ACES", "DIU"]} selected={["DIU"]} onToggle={noop} />
      </CommandList>
    </Command>,
  );
  assert.match(html, />ACES</);
  assert.match(html, />DIU</);
  assert.doesNotMatch(html, />PM</, "an option nothing asked for must not appear");
  // The tick is a shape and it is decorative, so the state is said aloud too —
  // colour never carries meaning alone.
  assert.match(html, /data-checked="true" aria-label="DIU, selected"/);
  assert.match(html, /data-checked="false" aria-label="ACES"/);
});

test("toggling a facet value adds it, removes it, and empties to no filter", () => {
  assert.deepEqual(toggleFacetValue([], "DIU"), ["DIU"]);
  assert.deepEqual(toggleFacetValue(["DIU"], "ACES"), ["DIU", "ACES"]);
  assert.deepEqual(toggleFacetValue(["DIU", "ACES"], "DIU"), ["ACES"]);
  // The last one off is "no branch filter", never "match nothing" —
  // filterRegisterRows guards on `?.length` for exactly this.
  assert.deepEqual(toggleFacetValue(["DIU"], "DIU"), []);
});

test("toggling does not mutate the selection it was given", () => {
  const selected = ["DIU"];
  toggleFacetValue(selected, "ACES");
  toggleFacetValue(selected, "DIU");
  assert.deepEqual(selected, ["DIU"]);
});

// ---------------------------------------------------------------------------
// RegisterFilterBar — the write path
//
// Everything below reaches handlers rather than markup. RegisterFilterBar,
// FacetFilter and SingleFacet all hold no hooks, so each can be called as a
// plain function and asked what it wired up — see findProps at the top.
// ---------------------------------------------------------------------------

/** The bar as the unrendered tree it builds, handlers and all. */
function buildBar(over: Partial<RegisterFilterBarProps> = {}) {
  return RegisterFilterBar({
    rows: TWO_BRANCHES,
    feeds: HEALTHY_FEEDS,
    filters: {},
    onFiltersChange: noop,
    ...over,
  });
}

/** Works one of the bar's controls and returns every filter object it emitted. */
function changeFacet<T>(label: string, next: T, filters: RegisterFilters = {}): RegisterFilters[] {
  const emitted: RegisterFilters[] = [];
  const control = findProps<{ label?: string; onChange?: (value: T) => void }>(
    buildBar({ filters, onFiltersChange: (value) => emitted.push(value) }),
    (props) => props.label === label,
  );
  const onChange = control?.onChange;
  assert.ok(onChange, `the bar has no ${label} control to work`);
  onChange(next);
  return emitted;
}

test("every facet writes its own field and leaves the reader's other filters alone", () => {
  // `onFiltersChange({ branch })` in place of `{ ...filters, branch }` wipes the
  // search, the readiness toggle and the sort the instant someone picks a
  // branch — the same regression toggleReadiness's test guards against, one
  // control over. It would also read as the facet having cleared their work.
  // Cross-wiring is caught here too: a Branch control writing `department`
  // moves this.
  const held: RegisterFilters = {
    search: "ada",
    readiness: "not-ready",
    sort: "hours",
    order: "desc",
  };
  assert.deepEqual(changeFacet("Branch", ["DIU"], held), [{ ...held, branch: ["DIU"], page: 1 }]);
  assert.deepEqual(changeFacet("Department", ["Finance"], held), [
    { ...held, department: ["Finance"], page: 1 },
  ]);
  assert.deepEqual(changeFacet("Status", "Left", held), [{ ...held, status: "Left", page: 1 }]);
  assert.deepEqual(changeFacet("Schedule", "missing", held), [
    { ...held, schedule: "missing", page: 1 },
  ]);
  assert.deepEqual(changeFacet("Biometric", "none", held), [
    { ...held, biometric: "none", page: 1 },
  ]);
});

test("every facet puts the reader back on page 1, and keeps the page size", () => {
  // Narrowing 503 rows to 3 while sitting on page 8 leaves page 8 not existing.
  // paginateRegisterRows clamps rather than rendering an empty table, but a
  // clamp is a rescue: the reader asked for one branch and would land on the
  // last page of it.
  const held: RegisterFilters = { page: 8, limit: 10 };
  for (const [label, value] of [
    ["Branch", ["DIU"]],
    ["Department", ["Finance"]],
    ["Status", "Left"],
    ["Schedule", "missing"],
    ["Biometric", "none"],
  ] as const) {
    const [emitted] = changeFacet(label, value, held);
    assert.equal(emitted.page, 1, `the ${label} facet must start again at page 1`);
    assert.equal(emitted.limit, 10, `the ${label} facet must not resize the page`);
  }
});

test("the bar's own search box narrows too, so it resets the page as the facets do", () => {
  // The phone's search box is the bar's, not the primitive's — the primitive
  // stamps `page: 1` on its own search and this one has to match it, or the
  // same keystroke behaves differently either side of 768px.
  const emitted: RegisterFilters[] = [];
  const onChange = findProps<{ placeholder?: string; onChange?: (next: string) => void }>(
    buildBar({
      showSearch: true,
      filters: { page: 8 },
      onFiltersChange: (value) => emitted.push(value),
    }),
    (props) => typeof props.placeholder === "string" && props.placeholder.startsWith("Search"),
  )?.onChange;
  assert.ok(onChange, "the bar must render a search box when asked to");

  onChange("ada");
  assert.deepEqual(emitted, [{ search: "ada", page: 1 }]);
});

test("clearing a facet through the bar leaves the rest of the filters standing", () => {
  // The other half of "clearing works": the bar has to carry an emptied facet
  // out as no filter without taking anything else with it.
  const held: RegisterFilters = { search: "ada", status: "Left", branch: ["DIU"] };
  assert.deepEqual(changeFacet<RegisterFilters["status"]>("Status", undefined, held), [
    { search: "ada", status: undefined, branch: ["DIU"], page: 1 },
  ]);
  assert.deepEqual(changeFacet<string[]>("Branch", [], held), [
    { search: "ada", status: "Left", branch: [], page: 1 },
  ]);
});

/** The value the "no filter" row will hand back, read off the row that carries it. */
function anyValueOf(select: ReactNode, anyLabel: string): string {
  const item = findProps<{ value?: string; children?: ReactNode }>(
    select,
    (props) => props.children === anyLabel,
  );
  const value = item?.value;
  assert.ok(value, `expected a "${anyLabel}" row carrying a value`);
  return value;
}

test("choosing the “any” row clears the filter instead of storing the sentinel", () => {
  // Radix rejects an empty-string item value, so "no filter" has to travel as a
  // sentinel. Stored verbatim it becomes a truthy `filters.status` that
  // filterRegisterRows matches nobody against: the table empties, and choosing
  // "Any status" again re-stores it, so the control can never clear.
  //
  // The sentinel is read off the row itself rather than written into this test,
  // so the row's value and the mapping that undoes it cannot drift apart.
  const chosen: (string | undefined)[] = [];
  const select = SingleFacet<NonNullable<RegisterFilters["status"]>>({
    label: "Status",
    anyLabel: "Any status",
    value: "Left",
    options: [
      { value: "Active", label: "Active" },
      { value: "Left", label: "Left" },
    ],
    onChange: (next) => chosen.push(next),
  });
  const onValueChange = findProps<{ onValueChange?: (next: string) => void }>(
    select,
    (props) => typeof props.onValueChange === "function",
  )?.onValueChange;
  assert.ok(onValueChange, "the select must report what was chosen");

  onValueChange(anyValueOf(select, "Any status"));
  onValueChange("Active");
  assert.deepEqual(
    chosen,
    [undefined, "Active"],
    "the sentinel clears the filter; a real option is passed through",
  );
});

/** One multi-select facet, built as the tree it would portal away. */
function buildFacet(selected: string[], onChange: (next: string[]) => void) {
  return FacetFilter({ label: "Branch", options: ["ACES", "DIU"], selected, onChange });
}

/** The handler on the facet menu's clear row — the only `onSelect` in its tree. */
function clearRowOf(facet: ReactNode): (() => void) | undefined {
  return findProps<{ onSelect?: () => void }>(
    facet,
    (props) => typeof props.onSelect === "function",
  )?.onSelect;
}

test("the clear row empties the facet to no filter", () => {
  // `[]` is "no filter", never "match nothing" — filterRegisterRows guards on
  // `?.length` for exactly this. The row is inside PopoverContent, so it has
  // never once appeared in this suite's rendered markup.
  const emitted: string[][] = [];
  const onSelect = clearRowOf(buildFacet(["DIU"], (next) => emitted.push(next)));
  assert.ok(onSelect, "a facet with a selection must offer a way to clear it");
  onSelect();
  assert.deepEqual(emitted, [[]]);
});

test("a facet with nothing selected offers no clear row", () => {
  // Direction: a clear row that is always present satisfies the test above just
  // as well, while adding a dead option to every unused facet on the bar.
  assert.equal(clearRowOf(buildFacet([], noop)), undefined);
});

test("ticking an option hands the facet back the toggled selection", () => {
  // The join between the option rows and toggleFacetValue, which until now were
  // tested on either side of a link nothing crossed.
  const emitted: string[][] = [];
  const onToggle = findProps<{ onToggle?: (value: string) => void }>(
    buildFacet(["DIU"], (next) => emitted.push(next)),
    (props) => typeof props.onToggle === "function",
  )?.onToggle;
  assert.ok(onToggle, "the option list must report what was ticked");
  onToggle("ACES");
  onToggle("DIU");
  assert.deepEqual(emitted, [["DIU", "ACES"], []], "one adds; the other takes the last one off");
});

// ---------------------------------------------------------------------------
// The table's sort, translated at the boundary
// ---------------------------------------------------------------------------

test("a pressed header becomes this module's own sort key", () => {
  assert.deepEqual(registerFiltersFromTable({ sort: "weekly_minutes", order: "desc" }), {
    sort: "hours",
    order: "desc",
  });
  assert.deepEqual(registerFiltersFromTable({ sort: "employee", order: "asc" }), {
    sort: "name",
    order: "asc",
  });
});

test("the rest of the reader's filters survive a sort", () => {
  // GenericDataTable hands back the whole filter object with `sort` replaced.
  // Dropping the others here would clear a search and a branch selection the
  // moment someone pressed a column header.
  assert.deepEqual(
    registerFiltersFromTable({
      search: "ada",
      branch: ["DIU"],
      readiness: "not-ready",
      sort: "fingerprint_count",
      order: "asc",
    }),
    { search: "ada", branch: ["DIU"], readiness: "not-ready", sort: "prints", order: "asc" },
  );
});

test("clearing the sort clears the order with it", () => {
  // A third press removes the sort entirely; an order left behind would be a
  // half-instruction, and any `sort` value at all suppresses severity ranking.
  assert.deepEqual(registerFiltersFromTable({ search: "ada", order: "desc" }), { search: "ada" });
});

test("a column id nothing sorts by leaves the register unsorted", () => {
  // Not stored raw. sortRegisterRows would not recognise it, so the table
  // would look unsorted while severity ranking — gated on `!filters.sort` —
  // had quietly been switched off underneath it.
  assert.deepEqual(registerFiltersFromTable({ sort: "branch", order: "desc" }), {});
  assert.deepEqual(registerFiltersFromTable({ sort: "hours", order: "asc" }), {});
});

/** The meta a one-page register produces, for the boundary tests below. */
const ONE_PAGE = paginateRegisterRows([BASE_ROW], {}).meta;

test("the table is never told the search the bar owns", () => {
  // GenericDataTable keeps its own debounced copy of `filters.search`, seeded
  // once at mount, and an effect writes that copy back through
  // onFiltersChange whenever the two differ — with `hideSearch` set it has
  // rendered no input that could ever move the copy, so it is frozen at "".
  // Told the bar's search it answers ~300ms later with that empty string, and
  // the phone's search box undoes itself between keystrokes. Caught in a
  // browser: the box typed fine and the table never narrowed.
  assert.equal(registerTableFilters({ search: "ada" }, true, ONE_PAGE).search, "");
  assert.equal(
    registerTableFilters({}, true, ONE_PAGE).search,
    "",
    "blanked to \"\", never omitted — its copy is `filters.search || \"\"`, so undefined is the one value that does NOT match and would trigger the write-back",
  );
  assert.equal(
    registerTableFilters({ search: "ada" }, false, ONE_PAGE).search,
    "ada",
    "above the breakpoint the primitive's own box is the real one",
  );
  // And the sort translation is unaffected either way.
  assert.equal(registerTableFilters({ sort: "hours" }, true, ONE_PAGE).sort, "weekly_minutes");
  assert.equal(registerTableFilters({ sort: "hours" }, false, ONE_PAGE).sort, "weekly_minutes");
});

test("the table is told the page it is actually on, not the one the reader last asked for", () => {
  // The pager does its arithmetic on what it is HANDED — `page: (filters.page
  // || 1) - 1` — not on `meta.page`. Pass a stale 8 straight through against a
  // set that now makes two pages and "‹" writes 7, then 6, then 5: three
  // presses that visibly do nothing, which is the "pagination is broken"
  // complaint that started this round wearing a different hat.
  //
  // Reachable even though every filter change resets to page 1: a refetch can
  // shrink the roster under a reader already on page 8, and so can the bridge
  // going stale mid-session, since suppressUnusableFacts then drops every row
  // that feed was the only witness to.
  const stale: RegisterFilters = { page: 8, limit: 2 };
  const { meta } = paginateRegisterRows(manyRows(3), stale);

  const table = registerTableFilters(stale, false, meta);
  assert.equal(table.page, 2, "the clamped page, so the arrows step from where the reader is");
  assert.equal(table.limit, 2);
  // The pager's own next/prev arithmetic, run on what it was given: from the
  // clamped page, one press back is a page that exists.
  assert.equal((table.page ?? 1) - 1, 1);
});

test("the table is told the page SIZE in force, so its control cannot disagree with the slice", () => {
  // "Rows per page" reads `filters.limit || 10`. With `limit` unset the control
  // would say 10 beside a table showing REGISTER_PAGE_SIZE rows — the same
  // class of defect as a footer reading "of 0". The default is resolved by
  // paginateRegisterRows and handed back through the meta.
  const { meta } = paginateRegisterRows(manyRows(3), {});
  assert.equal(registerTableFilters({}, false, meta).limit, REGISTER_PAGE_SIZE);
});

test("a column press keeps the search the reader typed on a phone", () => {
  // What comes back from the table is the blank it was handed, so the real
  // search has to be carried over from what the register held — otherwise
  // pressing any column header wipes it.
  const pressed = { search: "", status: "Left" as const, sort: "employee", order: "asc" as const };

  assert.deepEqual(mergeTableFilters({ search: "ada", status: "Left" }, pressed, true), {
    status: "Left",
    search: "ada",
    sort: "name",
    order: "asc",
  });
  assert.deepEqual(
    mergeTableFilters({ status: "Left" }, pressed, true),
    { status: "Left", sort: "name", order: "asc" },
    "with no search held, none is invented",
  );
  assert.deepEqual(
    mergeTableFilters({ search: "ada" }, { ...pressed, search: "typed here" }, false),
    { status: "Left", search: "typed here", sort: "name", order: "asc" },
    "above the breakpoint the table's box is authoritative and passes straight through",
  );
});

test("the register opens with nothing filtered and nothing sorted", () => {
  // `status` above all: defaulting it to Active hides every leaver still
  // enrolled while the alert keeps counting them. `sort` matters too, since
  // severity ranking only runs while it is unset.
  assert.deepEqual(INITIAL_REGISTER_FILTERS, {});
});

test("the page seeds its filter state from that constant, not a literal of its own", () => {
  // Without this the constant could be correct and unused. There is no jsdom
  // here, so a component's useState cannot be read any other way.
  assert.match(
    pageSource,
    /useState<RegisterFilters>\(INITIAL_REGISTER_FILTERS\)/,
    "the initial filters must be the exported constant",
  );
});

// ---------------------------------------------------------------------------
// CoverageRegisterView — the toolbar
// ---------------------------------------------------------------------------

test("the facets are derived from the whole roster, never from the filtered rows", () => {
  // The trap. Derive the options from `data` and choosing a branch leaves that
  // branch as the only option — or, at one value, no options and no control —
  // so the reader is shut inside a filter they can no longer see or clear.
  const unfiltered = renderView({ rows: TWO_BRANCHES });
  assert.equal(facetName(unfiltered, "Branch"), "Branch filter, 2 options");

  const filtered = renderView({ rows: TWO_BRANCHES, filters: { branch: ["DIU"] } });
  assert.equal(
    facetName(filtered, "Branch"),
    "Branch filter, 2 options, 1 selected: DIU",
    "narrowing to one branch must not narrow the branch facet",
  );

  // A search narrows the table to one row; the facets must not follow it down.
  const searched = renderView({ rows: TWO_BRANCHES, filters: { search: "Bea" } });
  assert.equal(facetName(searched, "Branch"), "Branch filter, 2 options");
});

test("a pending load offers no export, and has no roster to derive facets from", () => {
  // Two different mechanisms, deliberately. The export is GATED on the feeds
  // having answered — ungated it would offer a file built from an unanswered
  // roster and count it aloud as "0 employees". The bar needs no gate: it
  // derives every control from the rows and drops any facet with no options,
  // and a pending load holds none.
  const html = renderView({
    isLoading: true,
    rows: [],
    feeds: { schedule: false, biometric: false },
    alert: PENDING_ALERT,
  });
  assert.equal(facetName(html, "Branch"), null, "no facets until there is a roster to derive them from");
  assert.doesNotMatch(html, /aria-label="Export/, "nothing to export until the feeds answer");
});

test("the export offers exactly the rows on screen, not the whole roster", () => {
  // The count in the name is built from the same array the file is, so a
  // wiring change that exported everything moves this with it.
  const ready = { ...BASE_ROW, id: "READY", employee_name: "Bea Ready" };
  const notReady: RegisterRow = {
    ...BASE_ROW, id: "STUCK", employee_name: "Ada Stuck", schedule: "missing",
  };
  assert.match(
    renderView({ rows: [ready, notReady] }),
    /aria-label="Export 2 employees as CSV"/,
  );
  assert.match(
    renderView({ rows: [ready, notReady], filters: { readiness: "not-ready" } }),
    /aria-label="Export 1 employee as CSV"/,
    "a filtered register exports the filtered rows, and says how many",
  );
});

/** The export button's opening tag, for attribute assertions. */
function exportButton(html: string): string {
  return html.match(/<button[^>]*aria-label="Export[^"]*"[^>]*>/)?.[0] ?? "";
}

test("the export is disabled on a partial roster, and says why", () => {
  // A CSV that quietly omits part of the workforce looks complete, and a
  // spreadsheet carries no banner to say otherwise. A control that is merely
  // dead, with no reason given, is its own defect.
  const button = exportButton(renderView({ truncated: true }));
  assert.match(button, /\sdisabled=""/, "a partial roster must not be exportable");
  assert.match(
    button,
    /aria-label="Export CSV — unavailable while the roster is partial[^"]*"/,
    "the reason must be in the accessible name, not only in a tooltip",
  );

  const usable = exportButton(renderView({ truncated: false }));
  assert.ok(usable, "expected an export button on a complete roster");
  assert.doesNotMatch(usable, /\sdisabled=""/, "a complete roster must be exportable");
});

// ---------------------------------------------------------------------------
// RegisterExportButton — what pressing it actually writes
//
// The button holds no hooks, so it can be called directly and its onClick
// invoked. `download` is the seam for the one browser-only line: without it,
// the call that decides the file's contents could not be reached at all.
// ---------------------------------------------------------------------------

/** Presses the export button and returns the files it wrote. */
function pressExport(over: Partial<RegisterExportButtonProps> = {}): string[] {
  const written: string[] = [];
  const element = RegisterExportButton({
    rows: [BASE_ROW],
    feeds: HEALTHY_FEEDS,
    truncated: false,
    download: (csv) => written.push(csv),
    ...over,
  });
  const onClick = onClickOf(element);
  assert.ok(onClick, "the export must be a real button with a handler");
  onClick();
  return written;
}

test("pressing Export writes the rows the button was handed, and only those", () => {
  // The line that decides WHAT is exported. The row count in the accessible
  // name is a proxy for the props, not for this call: an export rewired to a
  // different array keeps the count and changes the file, and the file is the
  // thing that gets mailed to somebody.
  const ada = { ...BASE_ROW, id: "STUCK", employee_name: "Ada Stuck" };
  const written = pressExport({ rows: [ada] });
  assert.equal(written.length, 1, "one press, one file");
  assert.equal(written[0], toRegisterCsv([ada], HEALTHY_FEEDS));
  assert.match(written[0], /Ada Stuck/);
  assert.doesNotMatch(written[0], /Amara Okafor/, "no row the button was not given");
});

test("the file follows the feeds, so a suppressed column does not travel in it", () => {
  // Exporting a column the page refuses to show writes a fact the reader was
  // denied into a file that outlives the outage.
  const written = pressExport({ feeds: { schedule: true, biometric: false } });
  assert.doesNotMatch(written[0], /Biometric/, "a hidden column must be gone from the file too");
  assert.match(written[0], /Schedule/, "the schedule half is unaffected");
});
