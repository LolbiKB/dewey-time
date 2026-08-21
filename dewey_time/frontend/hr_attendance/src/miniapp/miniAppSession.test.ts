import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { initDataFromTelegram, MISSING_INIT_DATA } from "@/miniapp/useMiniAppSession";
import { SDK_URL } from "@/miniapp/telegramSdk";

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
  //
  // `active` must be a CONJUNCT of the interval, not merely mentioned nearby.
  // A caller opt-out was added for the Profile tab's month range, and the
  // interval later became a function so it could also see the query's own
  // error — so this is no longer the bare ternary it once pinned. What must
  // survive: a caller cannot opt back IN while minimised, and `false` stays the
  // else branch rather than some smaller interval.
  const src = readFileSync(new URL("./useMiniAppSession.ts", import.meta.url), "utf8");
  const interval = /refetchInterval:[^;]*?\bactive\s*&&[^;]*?\?\s*60_000\s*:\s*false/.exec(src);
  assert.ok(interval, "the 60s poll must still be gated on `active` and fall back to false");
  assert.match(src, /isAppActive|onActiveChange/);

  // And never against a verdict. A 403 is not a blip: re-polling it every
  // minute is what this app did to a revoked link for as long as it was open.
  assert.match(src, /isPermanentRejection\(query\.state\.error\)/);
});

test("the SDK's version stamp survived the move out of the HTML", () => {
  // Without the ?NN stamp a phone keeps whatever telegram-web-app.js it cached
  // on its first visit. An older copy has no safeAreaInset and no `activated`
  // event, every feature guard reads that as "old client", and the app renders
  // with zero insets on a perfectly current Telegram.
  //
  // THIS TEST USED TO ASSERT THE OPPOSITE ARRANGEMENT — that the HTML carried
  // the script and that it preceded the module bundle — and it kept passing
  // after the tag was deleted, because the note left in its place QUOTES the
  // tag it removed. A guard that reads a file's prose is a guard that agrees
  // with whatever the file says about itself.
  const html = readFileSync(new URL("../../index.miniapp.html", import.meta.url), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(
    !/<script[^>]*telegram-web-app\.js/.test(html),
    "the SDK is loaded by the app now — the tag's execution order was the bug",
  );
  // The stamp moved with it, and telegramSdk.test.ts pins the URL's shape.
  assert.match(SDK_URL, /telegram-web-app\.js\?\d+$/);
});

test("the site clock is learned at FETCH time, never from cached query data", () => {
  // react-query hands back a cached payload instantly, so noting server_now in
  // a component would drag the clock backwards by the age of the cache — the
  // arithmetic for which is pinned in siteClock.test.ts. Anchoring at receipt
  // makes a ten-minute-old cache harmless.
  //
  // A source read: fetchCalendar is module-private and the honest alternative
  // is a fetch mock plus a query client, for one call.
  const src = readFileSync(new URL("./useMiniAppSession.ts", import.meta.url), "utf8");
  assert.match(src, /noteServerNow\(payload\?\.server_now\)/);
  // Inside fetchCalendar, above its return — not in a hook.
  assert.match(src, /noteServerNow\(payload\?\.server_now\);\s*\n\s*return payload;/);
  assert.ok(
    !/useEffect\([^)]*noteServerNow/.test(src),
    "reading it from query.data is the cache-age bug",
  );
});

test("every present-tense surface takes its clock from the site, not the device", () => {
  // The four that defaulted independently, plus the hook they all funnel
  // through. One missed call site is a screen that disagrees with the rest of
  // the app about what time it is — which is the state this whole change
  // exists to end.
  const read = (file: string) =>
    readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  for (const file of [
    "useMinuteTick.ts", "MiniCalendarSheet.tsx", "MyProfilePage.tsx", "MySchedulePage.tsx",
  ]) {
    assert.match(read(file), /siteNow\(\)/, `${file} must read the site clock`);
    assert.ok(
      !/new Date\(\)/.test(read(file)),
      `${file} still reads the device clock directly`,
    );
  }

  // The shell keeps one direct read — inside a callback, where subscribing
  // would churn its identity every minute — and no bare `new Date()`.
  const shell = read("MiniAppShell.tsx");
  assert.match(shell, /isSameDay\(date, siteNow\(\)\)/);
  assert.ok(!/new Date\(\)/.test(shell), "the shell must not read the device clock");
});

test("the queries that make no claim about the present are not polled", () => {
  // Four observers, each with its own 60s interval, on an employee's mobile
  // data. Only the Day tab's TODAY makes a live claim; the identity header,
  // the roster, the month grid and a drilled-in day are all answers that
  // changed hours ago, if at all. A resume invalidates them regardless.
  const read = (file: string) =>
    readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

  assert.match(read("MiniAppShell.tsx"), /useMiniAppCalendar\(todayKey, todayKey, \{ poll: false \}\)/);
  assert.match(read("MySchedulePage.tsx"), /\{ poll: false \}/);
  assert.match(read("MiniCalendarSheet.tsx"), /\{ enabled: props\.open, poll: false \}/);
  // The Day tab keeps its poll, but only for today.
  assert.match(read("MyDayPage.tsx"), /\{ poll: isSameDay\(date, today\) \}/);
});

test("the timeline is given the same ticking clock the row beside it uses", () => {
  // DayCell falls back to its own `new Date()` when `now` is absent, computed
  // once at mount — so the canvas's now-line froze where it was when the page
  // opened, beside a numbers row that ticks. Two clocks, one screen.
  const src = readFileSync(new URL("./MyDayPage.tsx", import.meta.url), "utf8");
  assert.match(src, /now=\{now\}/);
});
