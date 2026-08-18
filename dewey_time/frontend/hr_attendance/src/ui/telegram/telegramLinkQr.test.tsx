import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TelegramLinkQr } from "@/ui/telegram/TelegramLinkQr";

const URL_A = "https://t.me/dewey_time_bot?start=Xk3_9pQ-rT7wLmZ2aB4cD6eF8gH0iJkL";
const URL_B = "https://t.me/dewey_time_bot?start=ZZZZ9pQ-rT7wLmZ2aB4cD6eF8gH0iJkL";

test("the code is drawn as inline SVG, not fetched from anywhere", () => {
  // The encoded value IS the credential. A hosted QR service would hand every
  // issued link to a third party, and it would look identical on screen.
  const html = renderToStaticMarkup(<TelegramLinkQr url={URL_A} />);
  assert.match(html, /<svg/);
  // Anything that would make the browser go and FETCH the code. Not a bare
  // /https?:/ match — the svg element carries its own
  // xmlns="http://www.w3.org/2000/svg" and would fail that for no reason.
  assert.doesNotMatch(html, /<img|\ssrc=|xlink:href=/);
});

test("the url is actually encoded, not merely accepted", () => {
  // Guards the failure that renders perfectly: a value left unwired draws a
  // valid QR of the wrong thing, and nobody can read a QR by eye.
  const a = renderToStaticMarkup(<TelegramLinkQr url={URL_A} />);
  const b = renderToStaticMarkup(<TelegramLinkQr url={URL_B} />);
  assert.notEqual(a, b);
});

test("the code stays dark-on-white regardless of theme", () => {
  // An inverted QR fails to scan on many phone cameras, and the failure reads
  // as "the code doesn't work" rather than as a theming bug.
  const html = renderToStaticMarkup(<TelegramLinkQr url={URL_A} />);
  assert.match(html, /fill="#ffffff"/i);
  assert.match(html, /fill="#000000"/i);
});

test("the quiet zone is present, or half the scanners refuse it", () => {
  // The QR spec requires 4 modules of clear margin. Without it the code still
  // LOOKS right and fails to scan against a busy background.
  const html = renderToStaticMarkup(<TelegramLinkQr url={URL_A} />);
  const viewBox = /viewBox="0 0 (\d+) \1"/.exec(html);
  assert.ok(viewBox, "square viewBox");
  // Version 1 is 21 modules; +8 for the margin is the smallest legal result.
  assert.ok(Number(viewBox[1]) >= 29, `viewBox ${viewBox[1]} leaves no quiet zone`);
});
