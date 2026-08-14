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

test("no conditions renders no chip — nothing visible, and nothing in the flow", () => {
  // The toolbar on a healthy day must look exactly as it did before this
  // component existed. An empty chip is a permanent fixture in a row that has
  // no space to spare.
  //
  // Not `=== ""` any more: the live region below is always mounted, and it has
  // to be, or a condition arriving mid-session is announced to nobody. It is
  // sr-only — position:absolute, zero measured pixels, out of flex flow — so
  // the visible guarantee is unchanged and this asserts that directly.
  const html = render([]);
  assert.doesNotMatch(html, /<button/, "no chip");
  assert.doesNotMatch(html, /amber/, "and none of its chrome");
  assert.equal(html.replace(/<span class="sr-only"[^>]*><\/span>/, ""), "", "nothing else at all");
});

test("the conditions are announced, and the live region outlives them", () => {
  // Both AttentionStrips this replaces carried role="status", so a sync going
  // stale mid-session announced itself. A live region only announces a CHANGE,
  // so one that mounts together with the chip announces nothing — it has to be
  // there while the page is still healthy.
  assert.match(render([]), /role="status"/, "present before there is anything to say");
  assert.match(render([OUTAGE]), /role="status"[^>]*>13 branches offline/);
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
