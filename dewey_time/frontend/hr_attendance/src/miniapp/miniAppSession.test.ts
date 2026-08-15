import assert from "node:assert/strict";
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
