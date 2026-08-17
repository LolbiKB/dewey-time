import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { initDataFromTelegram, MISSING_INIT_DATA } from "@/miniapp/useMiniAppSession";

test("initData is read from the Telegram SDK, never from the URL", () => {
  // A URL-supplied value would be attacker-controllable: anyone could paste a
  // captured launch into a browser. Only the SDK's copy is read.
  const w = { Telegram: { WebApp: { initData: "auth_date=1&hash=abc" } } } as never;
  assert.equal(initDataFromTelegram(w), "auth_date=1&hash=abc");
});

test("a page opened outside Telegram reports it rather than calling the API", () => {
  // Opening /hr-me in a plain browser must say so, not fire an
  // unauthenticated request and render a permission error.
  assert.equal(initDataFromTelegram({} as never), MISSING_INIT_DATA);
  assert.equal(initDataFromTelegram({ Telegram: {} } as never), MISSING_INIT_DATA);
  assert.equal(initDataFromTelegram({ Telegram: { WebApp: {} } } as never), MISSING_INIT_DATA);
});

test("an empty initData counts as outside Telegram", () => {
  // Telegram sets initData to "" when a page is opened from a context it does
  // not consider a Mini App launch. Treating "" as present would fire a
  // request that can only 403.
  const w = { Telegram: { WebApp: { initData: "" } } } as never;
  assert.equal(initDataFromTelegram(w), MISSING_INIT_DATA);
});

test("the poll is gated on Telegram's activity, not on document visibility", () => {
  // A minimised Mini App drops behind the chat and keeps running; the webview
  // is not reliably marked hidden, so react-query's
  // `refetchIntervalInBackground: false` default does not stop the 60s poll.
  // Left to it this runs all afternoon on an employee's mobile data.
  //
  // Source read rather than a rendered query: this suite has no react-query
  // harness, so the option object is only inspectable here.
  const src = readFileSync(new URL("./useMiniAppSession.ts", import.meta.url), "utf8");
  assert.match(src, /refetchInterval:\s*active \? 60_000 : false/);
  assert.match(src, /isAppActive|onActiveChange/);
});

test("the Mini App HTML pins the SDK's version, and loads it before the bundle", () => {
  // Without the ?NN stamp a phone keeps whatever telegram-web-app.js it cached
  // on its first visit. An older copy has no safeAreaInset and no `activated`
  // event, every feature guard reads that as "old client", and the app renders
  // with zero insets on a perfectly current Telegram.
  const html = readFileSync(new URL("../../index.miniapp.html", import.meta.url), "utf8");
  const sdk = html.indexOf("telegram-web-app.js?");
  assert.ok(sdk > 0, "the SDK script must carry a version stamp");

  // Order still matters: deferred classic scripts and module scripts both run
  // after parsing, in document order, so the SDK must appear first or
  // window.Telegram is undefined when main.tsx reads it.
  const bundle = html.indexOf("<script type=\"module\"");
  if (bundle > 0) assert.ok(sdk < bundle, "the SDK must precede the app bundle");
});
