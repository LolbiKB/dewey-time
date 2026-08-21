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
  // `active` must gate the WHOLE body, not merely be mentioned near it. This
  // has grown twice — a caller opt-out for the Profile tab, then a retry for a
  // query that has never answered — so it is a guard clause now rather than
  // the conjunct this once pinned. What must survive both rewrites: nothing a
  // caller passes can opt back IN while the app is minimised or against a
  // verdict, and `false` stays the alternative rather than a smaller interval.
  const src = readFileSync(new URL("./useMiniAppSession.ts", import.meta.url), "utf8");
  const body = /refetchInterval: \(query\) => \{([\s\S]*?)\n    \},/.exec(src)?.[1] ?? "";
  assert.ok(body, "refetchInterval must still be a function of the query");
  // Both gates in one statement, ahead of everything a caller can influence.
  // A 403 is not a blip: re-polling it every minute is what this app did to a
  // revoked link for as long as it was open.
  assert.match(body, /^\s*if \(!active \|\| isPermanentRejection\(query\.state\.error\)\) return false;/);
  assert.match(body, /\?\s*60_000\s*:\s*false/, "one interval, and false as the alternative");
  assert.equal((body.match(/60_000/g) ?? []).length, 1, "no second, smaller interval");
  assert.match(src, /isAppActive|onActiveChange/);
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
  // EXACTLY ONE, which is the assertion that survives a rewrite. The guard
  // here was a negative regex naming `useEffect`, and it could not fire: the
  // one string it matched does not typecheck, while every form somebody would
  // actually write slipped past it. What matters is not the syntax of a second
  // reader but that there is no second reader — a call anywhere else in this
  // file necessarily reads react-query's cached payload rather than the
  // response, which is the cache-age bug spelled out above.
  const calls = src.match(/noteServerNow\(/g) ?? [];
  assert.equal(calls.length, 1, "the clock is noted once, at receipt, and nowhere else");
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
  // COMMENTS STRIPPED. Each of these files argues in prose about the option it
  // passes, so the literal being asserted appears twice — once as the code and
  // once as the sentence explaining it. Read raw, the roster's assertion was
  // satisfied by MySchedulePage's own comment: deleting the argument left the
  // week polling every sixty seconds with the test still green.
  const read = (file: string) =>
    readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  assert.match(read("MiniAppShell.tsx"), /useMiniAppCalendar\(todayKey, todayKey, \{ poll: false \}\)/);
  assert.match(read("MySchedulePage.tsx"), /useMiniAppCalendar\([\s\S]*?\{ poll: false \}/);
  assert.match(read("MiniCalendarSheet.tsx"), /\{ enabled: props\.open, poll: false \}/);
  // The Day tab keeps its poll, but only for today.
  assert.match(read("MyDayPage.tsx"), /\{ poll: isSameDay\(date, today\) \}/);
});

test("the timeline is given the same ticking clock the row beside it uses", () => {
  // DayCell falls back to its own `new Date()` when `now` is absent, computed
  // once at mount — so the canvas's now-line froze where it was when the page
  // opened, beside a numbers row that ticks. Two clocks, one screen.
  //
  // THE ELEMENT FIRST, then the prop. `/now=\{now\}/` over the whole file was
  // already true before the fix — MiniDayNumbers, further down and untouched,
  // has carried that exact prop for months — so the guard passed on main and
  // could not have failed if somebody dropped it from DayCell tomorrow. A lazy
  // `[\s\S]*?` between the two does not help either: it walks straight past
  // DayCell's own `/>` into the next element. Cutting the element out is what
  // makes the assertion about the element.
  const src = readFileSync(new URL("./MyDayPage.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const dayCell = /<DayCell\b[\s\S]*?\/>/.exec(src)?.[0] ?? "";
  assert.ok(dayCell, "MyDayPage must render a DayCell");
  assert.match(dayCell, /now=\{now\}/, "the timeline needs the ticking clock, not its own");
});
