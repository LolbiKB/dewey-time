import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MiniTabBar, OutsideTelegramNotice } from "@/miniapp/MiniAppShell";

test("outside Telegram the app explains itself instead of erroring", () => {
  const html = renderToStaticMarkup(<OutsideTelegramNotice />);
  assert.match(html, /Telegram/);
});

test("the shell offers exactly the three employee views", () => {
  // Not the HR console with things hidden — a different surface that happens
  // to share components. An HR tab appearing here is a scope failure, not a
  // styling one.
  const html = renderToStaticMarkup(<MiniTabBar active="day" onSelect={() => {}} />);
  for (const label of ["Today", "Week", "Schedule"]) {
    assert.match(html, new RegExp(label));
  }
  for (const forbidden of ["Flags", "Coverage", "Import", "Biometric"]) {
    assert.doesNotMatch(html, new RegExp(forbidden));
  }
});

test("the active tab is marked for assistive tech, not only coloured", () => {
  const html = renderToStaticMarkup(<MiniTabBar active="week" onSelect={() => {}} />);
  assert.match(html, /aria-current="page"[^>]*>|aria-current="page"/);
});
