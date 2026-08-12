import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { AlertDot } from "@/ui/schedule-coverage/AlertDot";
import { registerColumns } from "@/ui/schedule-coverage/registerColumns";
import { visibleColumnIds } from "@/lib/coverageRegister";
import type { RegisterRow } from "@/lib/coverageRegister";

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
