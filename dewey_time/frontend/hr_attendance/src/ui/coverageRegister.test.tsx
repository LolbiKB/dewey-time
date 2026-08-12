import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

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
 * built CellContext) so every column's `cell` renders exactly as the app will
 * call it — no `as any`/`as unknown as` stand-in for the parts of CellContext
 * the columns don't use.
 */
function renderCells(
  row: RegisterRow,
  onOpen: (row: RegisterRow) => void = noop,
  onAddSchedule: (row: RegisterRow) => void = noop,
): Record<string, string> {
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
            {tableRow.getVisibleCells().map((cell) => (
              <td key={cell.id} data-col={cell.column.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    );
  }
  const html = renderToStaticMarkup(<Harness />);
  const out: Record<string, string> = {};
  for (const match of html.matchAll(/<td data-col="([^"]+)">(.*?)<\/td>/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

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

test("clear and problem states differ in more than colour", () => {
  const problem = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 3, knowable: true, label: "3 need attention" }}
              active={false} onToggle={noop} />,
  );
  const clear = renderToStaticMarkup(
    <AlertDot alert={{ tone: "clear", count: 0, knowable: true, label: "All 241 ready" }}
              active={false} onToggle={noop} />,
  );
  assert.match(problem, /data-tone="problem"/);
  assert.match(clear, /data-tone="clear"/);
  // Filled vs hollow is a shape difference, not a hue difference.
  assert.notEqual(
    /border-2/.test(problem),
    /border-2/.test(clear),
    "the clear state must be a ring, not just a green disc",
  );
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

test("every column id is one visibleColumnIds knows about", () => {
  // A typo here silently makes a column permanently invisible.
  const ids = registerColumns(noop, noop).map((c) => c.id);
  const known = visibleColumnIds({ schedule: true, biometric: true });
  for (const id of ids) assert.ok(known.includes(id!), `unknown column id: ${id}`);
  for (const id of known) assert.ok(ids.includes(id), `visibleColumnIds names a column that does not exist: ${id}`);
});

test("enrolled-not-punching renders neutral, not destructive", () => {
  // They CAN clock in and simply have not — an attendance question, not a
  // coverage one. Rendering it destructive would flag someone for nothing.
  const cells = renderCells({ ...BASE_ROW, biometric: "enrolled_not_punching" });
  assert.match(cells.biometric, /data-variant="outline"/);
  assert.doesNotMatch(cells.biometric, /data-variant="destructive"/);
});

test("the action column stays empty for enrolled-not-punching", () => {
  // A button here is what made the old Needs list read as a to-do list for
  // something that is not actually a coverage problem.
  const cells = renderCells({ ...BASE_ROW, biometric: "enrolled_not_punching", schedule: "assigned" });
  assert.doesNotMatch(cells.action, /data-slot="button"/);
});

test("the action column offers Open for a still-enrolled leaver", () => {
  const cells = renderCells({ ...BASE_ROW, biometric: "still_enrolled", schedule: "assigned" });
  assert.match(cells.action, /data-slot="button"/);
  assert.match(cells.action, />Open</);
});

test("a null branch, department, weekly_minutes, and fingerprint_count render as an em dash, never a plausible default", () => {
  const cells = renderCells({
    ...BASE_ROW,
    branch: null,
    department: null,
    weekly_minutes: null,
    fingerprint_count: null,
  });
  assert.equal(cells.branch, "—");
  assert.equal(cells.department, "—");
  assert.equal(cells.weekly_minutes, "—");
  assert.equal(cells.fingerprint_count, "—");
  // Guard the specific failure modes the brief calls out: a null count must
  // never become "0", and a null string field must never become "".
  assert.notEqual(cells.fingerprint_count, "0");
  assert.notEqual(cells.branch, "");
});

test("a null schedule and null biometric render as an em dash, not a badge", () => {
  const cells = renderCells({ ...BASE_ROW, schedule: null, biometric: null });
  assert.equal(cells.schedule, "—");
  assert.equal(cells.biometric, "—");
});

test("a missing schedule offers Add schedule, not Open", () => {
  const cells = renderCells({ ...BASE_ROW, schedule: "missing" });
  assert.match(cells.action, /data-slot="button"/);
  assert.match(cells.action, />Add schedule</);
});

test("a fully ready row has no action button at all", () => {
  const cells = renderCells({ ...BASE_ROW, schedule: "assigned", biometric: "enrolled" });
  assert.doesNotMatch(cells.action, /data-slot="button"/);
});
