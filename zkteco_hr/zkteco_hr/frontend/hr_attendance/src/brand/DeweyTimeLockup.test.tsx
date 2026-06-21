import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DeweyTimeLockup } from "./DeweyTimeLockup";

test("lockup pairs the clock dial mark with the Dewey Time wordmark", () => {
  const html = renderToStaticMarkup(<DeweyTimeLockup />);

  // the dial mark
  assert.match(html, /<svg/, "renders the dial svg");
  assert.match(html, /<circle[^>]*r="32"/, "includes the clock dial ring");

  // the wordmark (carries the accessible name)
  assert.match(html, /aria-label="Dewey Time"/, "includes the Dewey Time wordmark");

  // dial precedes the wordmark text (icon then type)
  const dial = html.indexOf("<svg");
  const word = html.indexOf('aria-label="Dewey Time"');
  assert.ok(dial !== -1 && word !== -1 && dial < word, "dial mark sits before the wordmark");
});
