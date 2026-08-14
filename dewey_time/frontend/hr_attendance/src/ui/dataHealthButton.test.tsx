import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { HealthCondition } from "@/lib/dataHealth";
import { DataHealthButton } from "@/ui/DataHealthButton";

const OUTAGE: HealthCondition = { key: "outage", summary: "13 branches offline", short: "13" };
const CLOSEOUT: HealthCondition = {
  key: "closeout",
  summary: "2 device closeouts pending",
  short: "2",
};

function render(conditions: HealthCondition[]): string {
  return renderToStaticMarkup(
    <DataHealthButton conditions={conditions}>
      <p>detail</p>
    </DataHealthButton>,
  );
}

test("no conditions renders nothing — not an empty chip", () => {
  // The toolbar on a healthy day must look exactly as it did before this
  // component existed. An empty chip is a permanent fixture in a row that has
  // no space to spare.
  assert.equal(render([]), "");
});

test("the leading condition is the label", () => {
  const html = render([OUTAGE]);
  assert.match(html, /13 branches offline/);
});

test("the rest become a count, not a second label", () => {
  const html = render([OUTAGE, CLOSEOUT]);
  assert.match(html, /\+1/);
  // The second condition's own words stay in the popover, which this render
  // cannot reach — what matters here is that they do NOT reach the row.
  assert.doesNotMatch(html, /device closeouts pending/);
});

test("a lone condition gets no +0", () => {
  assert.doesNotMatch(render([OUTAGE]), /\+0/);
});

test("the short form is present for narrow rows, and the full one for readers", () => {
  // Below sm the visible label is the bare count; the full sentence stays in
  // the accessibility tree via sr-only so the button is never named "13".
  const html = render([OUTAGE]);
  assert.match(html, /sm:hidden/, "expected a narrow-viewport variant");
  assert.match(html, /sr-only/, "expected the full summary to survive for screen readers");
});

test("the trigger is a real button", () => {
  // It opens a popover and must be reachable by keyboard. A div with onClick
  // is not, and Radix's asChild will happily wrap whatever it is given.
  assert.match(render([OUTAGE]), /<button/);
});
