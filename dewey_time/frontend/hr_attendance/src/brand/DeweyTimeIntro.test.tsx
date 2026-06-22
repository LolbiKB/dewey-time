import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DeweyTimeIntro } from "./DeweyTimeIntro";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("intro overlay shows the self-drawing clock dial and the Dewey Time wordtext", () => {
  const html = renderToStaticMarkup(<DeweyTimeIntro />);
  assert.match(html, /fixed inset-0/, "renders a full-screen overlay");
  assert.match(html, /class="dw-ring"/, "shows the clock dial ring");
  assert.match(html, /dw-intro-dial/, "dial carries the draw animation hook");
  assert.match(html, /Dewey/, "wordtext: Dewey");
  assert.match(html, /Time/, "wordtext: Time");
});

test("intro is restrained — gated once-per-session, reduced-motion aware, skippable", () => {
  const src = readFileSync(resolve(PKG, "src/brand/DeweyTimeIntro.tsx"), "utf8");
  assert.match(src, /sessionStorage/, "plays once per browser session");
  assert.match(src, /prefers-reduced-motion/, "checks reduced motion");
  assert.match(src, /skip/, "has a skip path");
});

test("self-draw motion is defined and disabled under reduced motion", () => {
  const css = readFileSync(resolve(PKG, "src/brand/base.css"), "utf8");
  assert.match(css, /@keyframes dw-draw-ring/, "defines the ring-draw keyframe");
  assert.match(css, /@keyframes dw-sweep-min/, "defines the minute-hand sweep keyframe");
  assert.match(css, /\.dw-intro-dial\s+line/, "sweep scoped to the intro dial hands");
  const reduceIdx = css.indexOf("prefers-reduced-motion");
  assert.ok(reduceIdx !== -1 && css.indexOf("dw-intro", reduceIdx) !== -1, "intro disabled under reduced motion");
});

test("intro is mounted at the app root", () => {
  const main = readFileSync(resolve(PKG, "src/main.tsx"), "utf8");
  assert.match(main, /DeweyTimeIntro/, "main.tsx mounts the intro overlay");
});
