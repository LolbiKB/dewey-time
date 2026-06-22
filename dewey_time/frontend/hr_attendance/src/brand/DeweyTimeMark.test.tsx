import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DeweyTimeMark } from "./DeweyTimeMark";

test("renders the clock dial with token colors, decorative (aria-hidden)", () => {
  const html = renderToStaticMarkup(<DeweyTimeMark />);

  // the dial ring — now a <path> circle (r=32 arc) so the intro can dash-draw it
  assert.match(html, /class="dw-ring"/, "has the dial ring path");
  assert.match(html, /A32 32 0 0 1/, "ring keeps the favicon's r=32 circle geometry");
  // the centre pivot is still a small circle
  assert.match(html, /<circle[^>]*r="4.5"/, "has the centre pivot dot");
  // the orange leading pen-tip — invisible until a draw lights it up
  assert.match(html, /class="dw-pen"/, "has the pen-tip path");

  // colors ride the brand knob, not hardcoded hues (so the green retune cascades here too)
  assert.match(html, /var\(--brand-primary\)/, "ring/hour hand use --brand-primary");
  assert.match(html, /var\(--brand-accent\)/, "minute hand + pen use --brand-accent");
  assert.ok(!/#066031/i.test(html), "no hardcoded green hex");
  assert.ok(!/#c2410c/i.test(html), "no hardcoded orange hex");

  // decorative — the wordmark beside it already carries the accessible name
  assert.match(html, /aria-hidden/, "marked aria-hidden");
});
