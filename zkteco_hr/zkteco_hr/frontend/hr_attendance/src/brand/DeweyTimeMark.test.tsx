import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DeweyTimeMark } from "./DeweyTimeMark";

test("renders the clock dial with token colors, decorative (aria-hidden)", () => {
  const html = renderToStaticMarkup(<DeweyTimeMark />);

  // the dial ring — same geometry as the favicon SVG
  assert.match(html, /<circle[^>]*r="32"/, "has the dial ring (r=32)");

  // colors ride the brand knob, not hardcoded hues (so the green retune cascades here too)
  assert.match(html, /var\(--brand-primary\)/, "ring/hour hand use --brand-primary");
  assert.match(html, /var\(--brand-accent\)/, "minute hand uses --brand-accent");
  assert.ok(!/#066031/i.test(html), "no hardcoded green hex");
  assert.ok(!/#c2410c/i.test(html), "no hardcoded orange hex");

  // decorative — the wordmark beside it already carries the accessible name
  assert.match(html, /aria-hidden/, "marked aria-hidden");
});
