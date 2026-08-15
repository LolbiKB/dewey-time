import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTheme,
  bottomInset,
  initTelegramChrome,
  tabHaptic,
  themeFrom,
  topInset,
} from "@/miniapp/telegramChrome";

function fakeDoc() {
  const classes = new Set<string>();
  return {
    documentElement: {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
        has: (name: string) => classes.has(name),
      },
    },
    _has: (name: string) => classes.has(name),
  } as never as Document & { _has: (n: string) => boolean };
}

test("the theme follows Telegram, defaulting to light when it says nothing", () => {
  assert.equal(themeFrom({ Telegram: { WebApp: { colorScheme: "dark" } } } as never), "dark");
  assert.equal(themeFrom({ Telegram: { WebApp: { colorScheme: "light" } } } as never), "light");
  assert.equal(themeFrom({ Telegram: { WebApp: {} } } as never), "light");
  assert.equal(themeFrom({} as never), "light");
});

test("dark mode is the .dark class dewey-ui already ships", () => {
  const doc = fakeDoc();
  applyTheme(doc, "dark");
  assert.equal(doc._has("dark"), true);
  applyTheme(doc, "light");
  assert.equal(doc._has("dark"), false);
});

test("insets take the larger of the device's and Telegram's own chrome", () => {
  // Both exist and they measure different things; whichever intrudes further
  // is the one the tab bar has to clear.
  const w = {
    Telegram: {
      WebApp: {
        safeAreaInset: { top: 59, bottom: 34, left: 0, right: 0 },
        contentSafeAreaInset: { top: 0, bottom: 12, left: 0, right: 0 },
      },
    },
  } as never;
  assert.equal(bottomInset(w), 34);
  assert.equal(topInset(w), 59);
});

test("a client too old to report insets contributes zero, not NaN", () => {
  // safeAreaInset arrived in Bot API 8.0. An older client has no such
  // property, and `undefined` reaching a CSS length would break the layout it
  // was meant to protect.
  assert.equal(bottomInset({ Telegram: { WebApp: {} } } as never), 0);
  assert.equal(bottomInset({} as never), 0);
});

test("every chrome call is feature-detected, so an old client cannot crash", () => {
  // The methods here span Bot API 6.0 to 8.0. On a client missing all of
  // them this must be a no-op, not a TypeError that white-screens the app.
  const doc = fakeDoc();
  assert.doesNotThrow(() => initTelegramChrome({ Telegram: { WebApp: {} } } as never, doc));
  assert.doesNotThrow(() => initTelegramChrome({} as never, doc));
  assert.doesNotThrow(() => tabHaptic({} as never));
});

test("init readies, expands, and stops a scroll from closing the app", () => {
  const calls: string[] = [];
  const w = {
    Telegram: {
      WebApp: {
        colorScheme: "dark",
        ready: () => calls.push("ready"),
        expand: () => calls.push("expand"),
        // Two of the three tabs are scrollable lists; without this a scroll
        // that starts at the top closes the app instead of scrolling it.
        disableVerticalSwipes: () => calls.push("disableVerticalSwipes"),
        onEvent: (e: string) => calls.push(`on:${e}`),
        offEvent: (e: string) => calls.push(`off:${e}`),
      },
    },
  } as never;
  const doc = fakeDoc();
  const teardown = initTelegramChrome(w, doc);

  assert.deepEqual(calls, ["ready", "expand", "disableVerticalSwipes", "on:themeChanged"]);
  assert.equal(doc._has("dark"), true, "theme applied on launch, not only on change");
  teardown();
  assert.equal(calls.at(-1), "off:themeChanged", "listener is removable");
});
