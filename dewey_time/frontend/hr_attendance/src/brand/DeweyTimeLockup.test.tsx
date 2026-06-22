import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DeweyTimeLockup } from "./DeweyTimeLockup";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("lockup pairs the clock dial mark with the Dewey Time wordtext", () => {
  const html = renderToStaticMarkup(<DeweyTimeLockup />);

  // the dial mark
  assert.match(html, /<svg/, "renders the dial svg");
  assert.match(html, /class="dw-ring"/, "includes the clock dial ring");

  // the wordtext (the visible text is the accessible name)
  assert.match(html, /Dewey/, "includes the Dewey wordtext");
  assert.match(html, /Time/, "includes the Time wordtext");

  // dial precedes the wordtext (icon then type)
  const dial = html.indexOf("<svg");
  const word = html.indexOf("Dewey");
  assert.ok(dial !== -1 && word !== -1 && dial < word, "dial mark sits before the wordtext");
});

test("lockup hover-redraws the dial — group + hover hook", () => {
  const html = renderToStaticMarkup(<DeweyTimeLockup />);
  assert.match(html, /class="group /, "lockup is a hover group");
  assert.match(html, /dw-hover-dial/, "dial carries the hover-redraw hook");
});

test("hover-redraw reuses the intro keyframes and is reduced-motion safe", () => {
  const css = readFileSync(resolve(PKG, "src/brand/base.css"), "utf8");
  assert.match(css, /:hover\s+\.dw-hover-dial[^{]*\{[^}]*dw-draw-ring/, "hover triggers the ring-draw");
  assert.match(css, /:hover\s+\.dw-hover-dial[^{]*\{[^}]*dw-sweep-min/, "hover triggers the minute-hand sweep");
  const reduceIdx = css.indexOf("prefers-reduced-motion");
  assert.ok(reduceIdx !== -1 && css.indexOf("dw-hover-dial", reduceIdx) !== -1, "hover-redraw off under reduced motion");
});
