import assert from "node:assert/strict";
import test from "node:test";

import {
  addToHomeScreen,
  applyTelegramPalette,
  atLeast,
  homeScreenStatus,
  loadLastTab,
  onResume,
  openHaptic,
  saveLastTab,
  applyTheme,
  bindBackButton,
  safeAreaInsets,
  initTelegramChrome,
  isHexColor,
  onViewportChange,
  tabHaptic,
  themeFrom,
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

test("the device inset and Telegram's own chrome ADD UP", () => {
  // They are not two measurements of the same edge. `safeAreaInset` is the
  // notch, measured from the screen; `contentSafeAreaInset` is Telegram's
  // header, measured from inside that. In fullscreen on a notched phone the
  // content starts below both.
  //
  // This took Math.max, which returns 56 for a 47px notch under a 56px
  // header and puts the app's first row underneath Telegram's own controls —
  // including the close button, in the same corner as the language toggle.
  const w = {
    Telegram: {
      WebApp: {
        safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 },
        contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 },
      },
    },
  } as never;
  const insets = safeAreaInsets(w);
  assert.equal(insets.top, 103, "the notch and the header stack");
  assert.equal(insets.bottom, 34);
});

test("all four edges are reported, not just top and bottom", () => {
  // A landscape phone puts the notch on a side, and rounded corners clip a
  // full-bleed row at both. Left and right were previously never read.
  const w = {
    Telegram: {
      WebApp: {
        safeAreaInset: { top: 0, bottom: 21, left: 47, right: 47 },
        contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
      },
    },
  } as never;
  const insets = safeAreaInsets(w);
  assert.equal(insets.left, 47);
  assert.equal(insets.right, 47);
});

test("an older client reports no insets, and zero is the right answer", () => {
  // Both arrived in Bot API 8.0. Zero is what the app rendered before either
  // existed, which is correct rather than merely safe.
  assert.deepEqual(safeAreaInsets({ Telegram: { WebApp: {} } } as never),
    { top: 0, bottom: 0, left: 0, right: 0 });
  assert.deepEqual(safeAreaInsets({} as never),
    { top: 0, bottom: 0, left: 0, right: 0 });
});

test("a nonsense inset is treated as absent rather than trusted", () => {
  // These values are written straight into a layout. A negative would pull
  // content back under the chrome it exists to clear.
  const w = {
    Telegram: {
      WebApp: {
        safeAreaInset: { top: -20, bottom: "34" as never, left: NaN, right: undefined },
        contentSafeAreaInset: { top: 10, bottom: 0, left: 0, right: 0 },
      },
    },
  } as never;
  assert.deepEqual(safeAreaInsets(w), { top: 10, bottom: 0, left: 0, right: 0 });
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

// ---------------------------------------------------------------------------
// Telegram's palette
// ---------------------------------------------------------------------------

function paletteDoc() {
  const set: Record<string, string> = {};
  return {
    doc: { documentElement: { style: { setProperty: (k: string, v: string) => { set[k] = v; } } } } as unknown as Document,
    set,
  };
}

test("a theme's colours reach the app's own tokens", () => {
  const { doc, set } = paletteDoc();
  const applied = applyTelegramPalette(doc, {
    bg_color: "#1a1a1a",
    text_color: "#ffffff",
    hint_color: "#8a8a8a",
    button_color: "#3390ec",
    button_text_color: "#ffffff",
  });
  assert.equal(applied, 5);
  assert.equal(set["--background"], "#1a1a1a");
  assert.equal(set["--foreground"], "#ffffff");
  assert.equal(set["--muted-foreground"], "#8a8a8a");
  assert.equal(set["--primary"], "#3390ec");
});

test("a background is mapped together with the text that sits on it", () => {
  // Taking secondary_bg_color for --muted while leaving --secondary-foreground
  // at dewey-ui's near-black is how a dark Telegram theme gets dark text on a
  // dark panel. The pairs move together or not at all.
  const { doc, set } = paletteDoc();
  applyTelegramPalette(doc, { text_color: "#ffffff", secondary_bg_color: "#232323" });
  assert.equal(set["--secondary"], "#232323");
  assert.equal(set["--secondary-foreground"], "#ffffff");
  assert.equal(set["--accent"], "#232323");
  assert.equal(set["--accent-foreground"], "#ffffff");
});

test("anything that is not a plain #RRGGBB is dropped, not written", () => {
  // These land in a style attribute. A malformed one also silently invalidates
  // the declaration, leaving the token at whatever it was — far harder to spot
  // than a colour that simply did not change.
  const { doc, set } = paletteDoc();
  const applied = applyTelegramPalette(doc, {
    bg_color: "red; background-image: url(x)",
    text_color: "#fff",
    hint_color: "rgb(1,2,3)",
    button_color: 42 as unknown as string,
  });
  assert.equal(applied, 0);
  assert.deepEqual(set, {});
});

test("a client that sends no theme params changes nothing", () => {
  const { doc, set } = paletteDoc();
  assert.equal(applyTelegramPalette(doc, undefined), 0);
  assert.deepEqual(set, {});
});

test("isHexColor accepts six hex digits and nothing else", () => {
  for (const good of ["#000000", "#FFFFFF", "#3390ec"]) assert.ok(isHexColor(good));
  for (const bad of ["#fff", "#12345g", "fff000", "", null, undefined, 0]) {
    assert.equal(isHexColor(bad), false, `${String(bad)} must be rejected`);
  }
});

// ---------------------------------------------------------------------------
// The back button
// ---------------------------------------------------------------------------

function fakeBackButton() {
  const calls: string[] = [];
  let handler: (() => void) | null = null;
  return {
    calls,
    fire: () => handler?.(),
    button: {
      show: () => calls.push("show"),
      hide: () => calls.push("hide"),
      onClick: (h: () => void) => { handler = h; calls.push("onClick"); },
      offClick: () => { handler = null; calls.push("offClick"); },
    },
  };
}

test("the back button is shown and wired while a day is open", () => {
  const back = fakeBackButton();
  let backed = 0;
  const w = { Telegram: { WebApp: { BackButton: back.button } } } as unknown as Window;

  const teardown = bindBackButton(w, true, () => { backed += 1; });
  assert.deepEqual(back.calls, ["onClick", "show"]);
  back.fire();
  assert.equal(backed, 1);

  // The teardown must HIDE as well as unhook. The button belongs to the
  // client, so one left visible outlives the screen that wanted it and
  // strands the user on a control that does nothing.
  teardown();
  assert.deepEqual(back.calls, ["onClick", "show", "offClick", "hide"]);
});

test("with nothing open the back button is hidden, not merely left alone", () => {
  const back = fakeBackButton();
  const w = { Telegram: { WebApp: { BackButton: back.button } } } as unknown as Window;
  bindBackButton(w, false, () => {});
  assert.deepEqual(back.calls, ["hide"]);
});

test("a client with no back button does not throw", () => {
  // Older clients have no BackButton at all, and this runs on every render.
  const teardown = bindBackButton({} as Window, true, () => {});
  teardown();
});

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

test("every event that can resize the sheet is subscribed, and all are released", () => {
  const on: string[] = [];
  const off: string[] = [];
  const w = {
    Telegram: { WebApp: {
      onEvent: (e: string) => on.push(e),
      offEvent: (e: string) => off.push(e),
    } },
  } as unknown as Window;

  const teardown = onViewportChange(w, () => {});
  assert.deepEqual(on, ["viewportChanged", "safeAreaChanged", "contentSafeAreaChanged"]);
  teardown();
  assert.deepEqual(off, on, "a listener left attached outlives the component");
});

// ---------------------------------------------------------------------------
// Deeper Telegram API use — all of it optional on older clients
// ---------------------------------------------------------------------------

test("none of the newer APIs throw on a client that has none of them", () => {
  // These span Bot API 6.9 to 8.0 and run on every launch. A factory-floor
  // phone on an old Telegram must degrade, not white-screen.
  const bare = {} as Window;
  const doc = { addEventListener() {}, removeEventListener() {} } as unknown as Document;
  assert.doesNotThrow(() => onResume(bare, doc, () => {})());
  assert.doesNotThrow(() => saveLastTab(bare, "week"));
  assert.doesNotThrow(() => addToHomeScreen(bare));
  assert.doesNotThrow(() => openHaptic(bare));
  assert.equal(atLeast(bare, "8.0"), false, "a client that cannot answer is too old");
});

test("a resume refetches, from Telegram's event and from visibility alike", async () => {
  // A Mini App is minimised rather than closed and comes back holding whatever
  // it loaded — for attendance that is actively wrong.
  let fired = 0;
  const handlers: Record<string, (() => void)[]> = {};
  const listeners: Record<string, (() => void)[]> = {};
  const w = { Telegram: { WebApp: {
    onEvent: (e: string, h: () => void) => { (handlers[e] ||= []).push(h); },
    offEvent: (e: string, h: () => void) => {
      handlers[e] = (handlers[e] || []).filter((x) => x !== h);
    },
  } } } as unknown as Window;
  const doc = {
    visibilityState: "visible",
    addEventListener: (e: string, h: () => void) => { (listeners[e] ||= []).push(h); },
    removeEventListener: (e: string, h: () => void) => {
      listeners[e] = (listeners[e] || []).filter((x) => x !== h);
    },
  } as unknown as Document;

  const teardown = onResume(w, doc, () => { fired += 1; });
  handlers["activated"]?.forEach((h) => h());
  assert.equal(fired, 1, "Telegram's own activated event");
  listeners["visibilitychange"]?.forEach((h) => h());
  assert.equal(fired, 2, "and the fallback for clients older than 8.0");

  teardown();
  assert.equal(handlers["activated"]?.length ?? 0, 0, "listener released");
  assert.equal(listeners["visibilitychange"]?.length ?? 0, 0, "listener released");
});

test("a hidden document does not count as a resume", () => {
  // visibilitychange fires on the way OUT too; refetching then is work nobody
  // is waiting for.
  let fired = 0;
  const listeners: Record<string, (() => void)[]> = {};
  const doc = {
    visibilityState: "hidden",
    addEventListener: (e: string, h: () => void) => { (listeners[e] ||= []).push(h); },
    removeEventListener: () => {},
  } as unknown as Document;
  onResume({} as Window, doc, () => { fired += 1; });
  listeners["visibilitychange"]?.forEach((h) => h());
  assert.equal(fired, 0);
});

test("a remembered tab is validated before it is trusted", async () => {
  // CloudStorage holds whatever was last written, including by an older build
  // with different tab names. It is data, not a promise.
  const store: Record<string, string> = { dewey_last_tab: "week" };
  const w = { Telegram: { WebApp: { CloudStorage: {
    getItem: (k: string, cb: (e: unknown, v?: string) => void) => cb(null, store[k]),
  } } } } as unknown as Window;
  const accept = (v: string) => v === "day" || v === "week" || v === "schedule";

  assert.equal(await loadLastTab(w, accept), "week");

  store.dewey_last_tab = "flags";
  assert.equal(await loadLastTab(w, accept), null, "an unknown tab is refused");
});

test("a CloudStorage failure opens the app anyway", async () => {
  // Remembering a tab is a courtesy, and a courtesy must never be able to
  // stop the app opening.
  const w = { Telegram: { WebApp: { CloudStorage: {
    getItem: (_k: string, cb: (e: unknown) => void) => cb(new Error("nope")),
  } } } } as unknown as Window;
  assert.equal(await loadLastTab(w, () => true), null);

  const throwing = { Telegram: { WebApp: { CloudStorage: {
    getItem: () => { throw new Error("boom"); },
  } } } } as unknown as Window;
  assert.equal(await loadLastTab(throwing, () => true), null);
});

test("the home-screen offer is only made where it can work", async () => {
  assert.equal(await homeScreenStatus({} as Window), "unsupported");

  const added = { Telegram: { WebApp: {
    checkHomeScreenStatus: (cb: (s: string) => void) => cb("added"),
  } } } as unknown as Window;
  assert.equal(await homeScreenStatus(added), "added");

  // An answer nobody recognises is treated as unsupported rather than
  // offered — drawing a button that cannot work is worse than not drawing it.
  const odd = { Telegram: { WebApp: {
    checkHomeScreenStatus: (cb: (s: string) => void) => cb("wat"),
  } } } as unknown as Window;
  assert.equal(await homeScreenStatus(odd), "unsupported");
});
