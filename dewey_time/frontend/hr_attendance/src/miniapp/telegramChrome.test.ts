import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTelegramPalette,
  atLeast,
  launchedFromTelegram,
  loadLastTab,
  loadLocale,
  localeHint,
  saveLocale,
  onResume,
  openHaptic,
  saveLastTab,
  applyTheme,
  bindBackButton,
  safeAreaInsets,
  initTelegramChrome,
  isAppActive,
  isHexColor,
  onActiveChange,
  onViewportChange,
  signalReady,
  tabHaptic,
  themeFrom,
} from "@/miniapp/telegramChrome";
import { isLocale } from "@/miniapp/miniStrings";

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

test("init expands and stops a scroll from closing the app", () => {
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

  // No "ready" — it moved to signalReady, on the frame after the first paint.
  assert.deepEqual(calls, ["expand", "disableVerticalSwipes", "on:themeChanged"]);
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

test("none of the newer APIs throw on a client that cannot perform them", () => {
  // "cannot perform", not "does not have" — the title used to say the latter
  // and it is the false premise this file was built on. CloudStorage is
  // installed on every client and throws below Bot API 6.9; only the version
  // answers honestly.
  //
  // These span Bot API 6.9 to 8.0 and run on every launch. A factory-floor
  // phone on an old Telegram must degrade, not white-screen.
  const bare = {} as Window;
  const doc = { addEventListener() {}, removeEventListener() {} } as unknown as Document;
  assert.doesNotThrow(() => onResume(bare, doc, () => {})());
  assert.doesNotThrow(() => saveLastTab(bare, "week"));
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
  // isVersionAtLeast, because CloudStorage is now gated on the VERSION rather
  // than on the method's presence — the method is installed on every client
  // and throws below 6.9, so presence was never the question. A stub without
  // it is a client too old to use CloudStorage at all.
  const w = { Telegram: { WebApp: {
    isVersionAtLeast: () => true,
    CloudStorage: {
      getItem: (k: string, cb: (e: unknown, v?: string) => void) => cb(null, store[k]),
    },
  } } } as unknown as Window;
  const accept = (v: string) => v === "day" || v === "week" || v === "schedule";

  assert.equal(await loadLastTab(w, accept), "week");

  store.dewey_last_tab = "flags";
  assert.equal(await loadLastTab(w, accept), null, "an unknown tab is refused");
});

test("a CloudStorage failure opens the app anyway", async () => {
  // Remembering a tab is a courtesy, and a courtesy must never be able to
  // stop the app opening.
  const w = { Telegram: { WebApp: {
    isVersionAtLeast: () => true,
    CloudStorage: { getItem: (_k: string, cb: (e: unknown) => void) => cb(new Error("nope")) },
  } } } as unknown as Window;
  assert.equal(await loadLastTab(w, () => true), null);

  const throwing = { Telegram: { WebApp: {
    isVersionAtLeast: () => true,
    CloudStorage: { getItem: () => { throw new Error("boom"); } },
  } } } as unknown as Window;
  assert.equal(await loadLastTab(throwing, () => true), null);
});


// ---------------------------------------------------------------------------
// ready(), and the activity signal
// ---------------------------------------------------------------------------

test("ready() is deferred to a frame, not fired during import", () => {
  // It hides Telegram's loading placeholder. Called at module scope — where it
  // used to be — that happens before React has painted, so the branded splash
  // is replaced by a blank sheet in the app's background colour.
  const calls: string[] = [];
  let frame: (() => void) | null = null;
  const w = {
    requestAnimationFrame: (cb: () => void) => { frame = cb; return 1; },
    Telegram: { WebApp: { ready: () => calls.push("ready") } },
  } as unknown as Window;

  signalReady(w);
  assert.deepEqual(calls, [], "nothing may fire before the frame");
  frame!();
  assert.deepEqual(calls, ["ready"]);
});

test("ready() still fires where there are no frames to wait for", () => {
  // Telegram Desktop's webview, a test runner, anything without rAF. Never
  // calling ready() leaves the placeholder up forever, which is a white screen
  // rather than a slightly early one.
  const calls: string[] = [];
  const w = { Telegram: { WebApp: { ready: () => calls.push("ready") } } } as unknown as Window;
  signalReady(w);
  assert.deepEqual(calls, ["ready"]);
  assert.doesNotThrow(() => signalReady({} as Window));
});

test("a client too old to report activity is treated as active", () => {
  // isActive is Bot API 8.0. Reading `undefined` as "not active" would switch
  // the 60s poll off permanently on exactly the old phones this roster runs.
  assert.equal(isAppActive({} as Window), true);
  assert.equal(isAppActive({ Telegram: { WebApp: {} } } as unknown as Window), true);
});

test("activity follows Telegram's own pair of events", () => {
  // NOT document.visibilityState: a minimised Mini App drops behind the chat
  // and keeps running, and the webview is not reliably marked hidden. That is
  // the gap `activated`/`deactivated` were added in 8.0 to close.
  const handlers: Record<string, (() => void)[]> = {};
  const w = { Telegram: { WebApp: {
    isActive: false,
    onEvent: (e: string, h: () => void) => { (handlers[e] ??= []).push(h); },
    offEvent: (e: string, h: () => void) => {
      handlers[e] = (handlers[e] ?? []).filter((x) => x !== h);
    },
  } } } as unknown as Window;

  assert.equal(isAppActive(w), false, "a minimised app reports itself minimised");

  const seen: boolean[] = [];
  const stop = onActiveChange(w, (active) => seen.push(active));
  handlers.activated![0]!();
  handlers.deactivated![0]!();
  assert.deepEqual(seen, [true, false]);

  // Both unsubscribed, not just one. A stray `deactivated` outliving the
  // component would switch the poll off with nothing left to switch it back.
  stop();
  assert.equal((handlers.activated ?? []).length, 0);
  assert.equal((handlers.deactivated ?? []).length, 0);
});

test("initTelegramChrome does not call ready", () => {
  // It runs at module scope, before React mounts. This is the regression the
  // signalReady tests above only half-cover: putting ready() back here would
  // leave them all green while the blank sheet returns.
  const calls: string[] = [];
  const w = { Telegram: { WebApp: {
    ready: () => calls.push("ready"),
    expand: () => calls.push("expand"),
    disableVerticalSwipes: () => calls.push("swipes"),
  } } } as unknown as Window;
  const doc = { documentElement: { classList: { toggle() {} }, style: { setProperty() {} } } } as unknown as Document;

  initTelegramChrome(w, doc)();
  assert.ok(calls.includes("expand"), "the rest of the launch setup still runs");
  assert.ok(!calls.includes("ready"), "ready belongs after the first frame");
});

// ---------------------------------------------------------------------------
// Presence is not support: CloudStorage, and the copy that survives it
// ---------------------------------------------------------------------------

/** A localStorage that behaves, per test, so nothing leaks between them. */
function fakeStorage() {
  const rows: Record<string, string> = {};
  return {
    rows,
    api: {
      getItem: (k: string) => (k in rows ? rows[k]! : null),
      setItem: (k: string, v: string) => { rows[k] = v; },
    },
  };
}

test("an old client is refused CloudStorage by its VERSION, not by a method it has", () => {
  // THE DEFECT THIS FILE SHIPPED WITH. telegram-web-app.js installs
  // CloudStorage on every client and throws WebAppMethodUnsupported from
  // inside getItem below 6.9 — so `storage?.getItem` was never false, the
  // guard never guarded, the throw was swallowed, and the remembered language
  // silently never came back on exactly the old phones this app targets.
  const local = fakeStorage();
  let called = 0;
  const oldClient = {
    localStorage: local.api,
    Telegram: { WebApp: {
      // 6.8: present, and would throw if called.
      isVersionAtLeast: (v: string) => v <= "6.8",
      CloudStorage: {
        getItem: () => { called += 1; throw new Error("WebAppMethodUnsupported"); },
        setItem: () => { called += 1; throw new Error("WebAppMethodUnsupported"); },
      },
    } },
  } as unknown as Window;

  saveLocale(oldClient, "km");
  assert.equal(called, 0, "the method must not be called on a client that would throw");
  assert.equal(local.rows["dewey_miniapp:dewey_locale"], "km", "and the local copy is written");
});

test("the remembered language survives a client that cannot store it in the cloud", async () => {
  // The whole point of the local mirror: on an old client this used to be
  // unanswerable, so a Khmer reader whose phone is set to English switched the
  // app back on every single launch.
  const local = fakeStorage();
  const oldClient = {
    localStorage: local.api,
    Telegram: { WebApp: { isVersionAtLeast: () => false, CloudStorage: {
      getItem: () => { throw new Error("WebAppMethodUnsupported"); },
      setItem: () => { throw new Error("WebAppMethodUnsupported"); },
    } } },
  } as unknown as Window;

  saveLocale(oldClient, "km");
  assert.equal(await loadLocale(oldClient, isLocale), "km");
  assert.equal(localeHint(oldClient), "km", "and synchronously, for the first paint");
});

test("the cloud copy wins when it answers, because it is the one that travels", async () => {
  // A reader who switched to Khmer on their phone must see Khmer on their
  // tablet. Local is the fallback, never the authority.
  const local = fakeStorage();
  local.rows["dewey_miniapp:dewey_locale"] = "en";
  const w = {
    localStorage: local.api,
    Telegram: { WebApp: { isVersionAtLeast: () => true, CloudStorage: {
      getItem: (_k: string, cb: (e: unknown, v?: string) => void) => cb(null, "km"),
      setItem: () => {},
    } } },
  } as unknown as Window;

  assert.equal(await loadLocale(w, isLocale), "km");
  assert.equal(local.rows["dewey_miniapp:dewey_locale"], "km", "and is mirrored back down");
});

test("a client with neither store behaves exactly as it did before", async () => {
  // The degradation floor. localStorage throwing (private mode, site data
  // off) plus a client too old for CloudStorage must return null and let the
  // shell fall back to Telegram's reported language — which is today's
  // behaviour, so this change can only improve on it.
  const hostile = {
    get localStorage(): Storage { throw new Error("denied"); },
    Telegram: { WebApp: { isVersionAtLeast: () => false } },
  } as unknown as Window;
  assert.doesNotThrow(() => saveLocale(hostile, "km"));
  assert.equal(localeHint(hostile), null);
  assert.equal(await loadLocale(hostile, isLocale), null);
});

test("the local key is namespaced, because /hr-me shares an origin with the HR app", () => {
  const local = fakeStorage();
  const w = { localStorage: local.api } as unknown as Window;
  saveLocale(w, "km");
  assert.deepEqual(Object.keys(local.rows), ["dewey_miniapp:dewey_locale"]);
});

// ---------------------------------------------------------------------------
// Did Telegram open this page, when the SDK cannot be asked?
// ---------------------------------------------------------------------------

const NO_DOC = { referrer: "" } as unknown as Document;

test("the launch hash alone is enough, because Telegram writes it before the script loads", () => {
  // This is the case the SDK cannot answer: telegram-web-app.js reads
  // location.hash and never rewrites it, so the hash is there on every
  // platform BEFORE the script is requested — and still there if it 404s.
  const w = { location: { hash: "#tgWebAppData=user%3D%7B%7D&tgWebAppVersion=8.0" } } as unknown as Window;
  assert.equal(launchedFromTelegram(w, NO_DOC), true);
});

test("a native client is recognised by the proxy it injects", () => {
  // The commonest real case: iOS/Android/Desktop inject TelegramWebviewProxy
  // themselves. The SDK only READS it, which is why it survives the SDK.
  const proxied = { location: { hash: "" }, TelegramWebviewProxy: { postEvent() {} } } as unknown as Window;
  assert.equal(launchedFromTelegram(proxied, NO_DOC), true);

  const oldDesktop = { location: { hash: "" }, external: { notify() {} } } as unknown as Window;
  assert.equal(launchedFromTelegram(oldDesktop, NO_DOC), true);
});

test("a web client is recognised by the origin framing us", () => {
  const framed = { location: { hash: "" }, parent: {} } as unknown as Window;
  assert.equal(
    launchedFromTelegram(framed, { referrer: "https://webk.telegram.org/" } as unknown as Document),
    true,
    "the sibling origins count too -- webk serves Web K with no redirect at all",
  );
  assert.equal(
    launchedFromTelegram(framed, { referrer: "https://example.com/" } as unknown as Document),
    false,
    "and nobody else's frame does",
  );
});

test("a plain browser is not mistaken for Telegram", () => {
  // The inversion, and the reason this predicate is allowed to be generous:
  // it decides which of two sentences to show and authorises nothing. If it
  // said yes to everything, somebody in a browser would be offered a retry
  // that can never work.
  const browser = { location: { hash: "" } } as unknown as Window;
  assert.equal(launchedFromTelegram(browser, NO_DOC), false);
  assert.equal(launchedFromTelegram({} as Window, NO_DOC), false);
  const hashButNotOurs = { location: { hash: "#section=pay" } } as unknown as Window;
  assert.equal(launchedFromTelegram(hashButNotOurs, NO_DOC), false);
});

// ---------------------------------------------------------------------------
// ready(), without the script that normally says it
// ---------------------------------------------------------------------------

test("with no SDK, ready is spoken over the client's own transport", () => {
  // ready() is what takes Telegram's branded loading placeholder down. With no
  // SDK it was never said, so on the one screen that explains why the app
  // could not start, the placeholder sat on top of it.
  const sent: Array<[string, string]> = [];
  const w = {
    TelegramWebviewProxy: { postEvent: (t: string, d: string) => sent.push([t, d]) },
  } as unknown as Window;
  signalReady(w);
  // The argument shape is the half that rots silently: eventData is an empty
  // STRING in the SDK's own postEvent, not an empty object.
  assert.deepEqual(sent, [["web_app_ready", '""']]);
});

test("an iframe client gets the message form, and only when it is framed", () => {
  const posted: string[] = [];
  const framed = {
    parent: { postMessage: (m: string) => posted.push(m) },
  } as unknown as Window;
  signalReady(framed);
  assert.deepEqual(posted, ['{"eventType":"web_app_ready","eventData":""}']);

  const top = {} as unknown as Window;
  assert.doesNotThrow(() => signalReady(top), "a top-level page has nobody to tell");
});

test("the SDK is still preferred when it is there", () => {
  // The fallback must never double up: two ready signals is not harmful, but a
  // fallback that fires alongside the real one is a fallback nobody is testing.
  const calls: string[] = [];
  const w = {
    TelegramWebviewProxy: { postEvent: () => calls.push("shim") },
    Telegram: { WebApp: { ready: () => calls.push("sdk") } },
  } as unknown as Window;
  signalReady(w);
  assert.deepEqual(calls, ["sdk"]);
});
