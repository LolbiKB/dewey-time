import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ParsedRow } from "@/types/scheduleImport";
import { PreviewRow } from "@/ui/schedule-import/PreviewRow";

/**
 * The import preview's identity block, which is the one surface of the seven
 * with no Employee record behind it: a parsed spreadsheet line carries an ID
 * card and, once the backend has matched it, a name. Nothing here was covered
 * before — the row is rendered by no other suite — and what it does when the
 * match FAILS is the whole question, because that is when the two things the
 * shared block stacks collapse into one.
 */

/** A matched line: the upload's ID card, and the employee it resolved to. */
function parsedRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    row_number: 3,
    id_card: "ID-4471",
    email: "ada@example.com",
    employee: "HR-EMP-00001",
    employee_name: "Ada Lovelace",
    matched: true,
    am_from: "08:00",
    am_to: "12:00",
    pm_from: null,
    pm_to: null,
    day_off: { full_off: ["sunday"], afternoon_off: [] },
    week_pattern: null,
    schedule_shape: "morning_only",
    issues: [],
    importable: true,
    warnings: [],
    ...overrides,
  };
}

function render(row: ParsedRow): string {
  return renderToStaticMarkup(<PreviewRow row={row} selected={false} onToggle={() => {}} />);
}

/** How many times `text` appears in the markup as rendered content. */
function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

/**
 * The two lines the shared identity block draws, as text.
 *
 * Sliced off the `@container` text stack — the component's own — and cut at
 * the row's metadata line, because that line carries an em dash of its own for
 * an unstated work week and a `tabular-nums` span of its own for "Row 3". An
 * unscoped match would read either of those as part of the person.
 */
function identityLines(html: string): { name: string; facts: string } {
  const at = html.indexOf('class="@container');
  assert.notEqual(at, -1, "the row renders an identity block");
  const stack = html.slice(at, html.indexOf("<p ", at));
  const name = /font-semibold leading-tight">([^<]*)</.exec(stack);
  const facts = /class="tabular-nums">([^<]*)</.exec(stack);
  assert.ok(name && facts, "the block draws both of its lines");
  return { name: name[1], facts: facts[1] };
}

test("a matched row stacks the employee's name over the ID card it came from", () => {
  const html = render(parsedRow());
  assert.deepEqual(identityLines(html), { name: "Ada Lovelace", facts: "ID-4471" });
  assert.equal(count(html, "ID-4471"), 1, "the ID card is stated once, on line two");
});

test("an unmatched row headlines the ID card rather than an em dash", () => {
  // Nothing else on the line identifies it: the whole reason to show an
  // unmatched row is so the reader can see WHICH line of their spreadsheet
  // failed to match. Demoting the ID card to line two under a "—" would put
  // the only identifying thing in the quieter of the two slots.
  //
  // Line two is then empty, and deliberately so: it collapses to nothing
  // rather than leaving a blank line under the name, which is what a second
  // copy of the ID card would have been there to avoid.
  const html = render(parsedRow({ employee: null, employee_name: null, matched: false }));
  assert.deepEqual(identityLines(html), { name: "ID-4471", facts: "" });
  assert.equal(count(html, "ID-4471"), 1, "…and not a second time on the line below it");
});

test("a row with neither a name nor an ID card still reads as a row", () => {
  // A garbage line the parser kept. Its issues are the point of showing it, so
  // it must not render as a blank block with badges under it.
  const html = render(parsedRow({ id_card: "", employee: null, employee_name: null }));
  assert.deepEqual(identityLines(html), { name: "—", facts: "" });
  assert.match(html, /Row 3/, "and the line still says which spreadsheet row it is");
});

test("the preview never claims a Khmer name it was never sent", () => {
  // ParsedRow comes from a spreadsheet, not from an Employee record: there are
  // no Khmer columns in the parse contract to read one out of. The identity
  // block's required prop is what forces this surface to say so.
  assert.doesNotMatch(render(parsedRow()), /font-khmer/);
});
