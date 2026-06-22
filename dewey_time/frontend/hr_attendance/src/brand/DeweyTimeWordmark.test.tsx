import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DeweyTimeWordmark } from "./DeweyTimeWordmark";

test("renders a static two-weight wordtext — no hover-expand animation", () => {
  const html = renderToStaticMarkup(<DeweyTimeWordmark />);

  // both words fully present and static (not collapsed behind a hover)
  assert.match(html, /Dewey/, "lead word present");
  assert.match(html, /Time/, "second word present");

  // ADMS pattern: lead in foreground, second word recedes to muted
  assert.match(html, /text-foreground/, "lead word is foreground");
  assert.match(html, /text-muted-foreground/, "second word recedes to muted");

  // the DT expand machinery is gone
  assert.ok(!/group-hover:max-w/.test(html), "no hover max-width expand");
  assert.ok(!/transition-\[max-width/.test(html), "no max-width transition");

  // color lives in the dial, not the text — wordtext stays neutral
  assert.ok(!/var\(--brand-primary\)/.test(html), "no brand tint on the text");
  assert.ok(!/var\(--brand-accent\)/.test(html), "no accent tint on the text");
});
