/**
 * Making the Mini App behave like part of Telegram rather than a webview
 * someone embedded.
 *
 * Every call here is optional-chained on purpose, and for most of them that
 * is the whole story: `disableVerticalSwipes` (7.7) and `safeAreaInset` (8.0)
 * are genuinely absent on an older client, so a missing method means "not
 * supported" and the optional chain is the feature test.
 *
 * PRESENCE IS NOT SUPPORT FOR ALL OF THEM, and that distinction cost us the
 * remembered language. `telegram-web-app.js` installs `CloudStorage` on EVERY
 * client and throws `Error('WebAppMethodUnsupported')` from inside `getItem`
 * below Bot API 6.9 — the method is there, it just refuses. A presence check
 * is never false, so the guard never fired, the throw was swallowed by the
 * surrounding try/catch, and a Khmer reader on an old client had to switch the
 * app back on every launch with nothing to show why. Anything that THROWS
 * rather than vanishes is gated on `atLeast` below.
 */

export type ThemeName = "light" | "dark";

/** Telegram's own scheme, defaulting to light when it tells us nothing. */
export function themeFrom(w: Window): ThemeName {
  return w?.Telegram?.WebApp?.colorScheme === "dark" ? "dark" : "light";
}

/**
 * dewey-ui's dark palette is the `.dark` class variant (theme.css:22,108), so
 * matching Telegram's theme is a class toggle rather than a second stylesheet.
 *
 * Without this the app renders its light palette inside a dark Telegram — a
 * white sheet in an otherwise dark client, which is both jarring and the most
 * visible possible sign that something is not really part of the app.
 */
export function applyTheme(doc: Document, theme: ThemeName): void {
  doc.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * Telegram's theme colours, mapped onto the app's own tokens.
 *
 * The `.dark` toggle above gets the app into the right register; this makes it
 * the SAME app. Telegram users can run themes well away from stock black and
 * white, and dewey-ui's fixed greys inside one of those read as a webview
 * somebody embedded — which is exactly what Telegram's design guidelines ask
 * apps not to look like.
 *
 * Foreground tokens are mapped ALONGSIDE the backgrounds they sit on, never
 * alone. Taking `secondary_bg_color` for `--muted` while leaving
 * `--muted-foreground` at dewey-ui's grey is how a themed client ends up with
 * dark text on a dark panel — the pairs have to move together or not at all.
 *
 * Not mapped: `--chart-*`. Those hues exist to be distinguishable from each
 * other, and a theme has no opinion about them.
 */
const PALETTE_MAP: [string, string[]][] = [
  ["bg_color", ["--background", "--card", "--popover"]],
  ["text_color", [
    "--foreground", "--card-foreground", "--popover-foreground",
    "--secondary-foreground", "--accent-foreground",
  ]],
  ["hint_color", ["--muted-foreground"]],
  ["secondary_bg_color", ["--muted", "--secondary", "--accent"]],
  ["section_separator_color", ["--border", "--input"]],
  ["button_color", ["--primary", "--ring"]],
  ["button_text_color", ["--primary-foreground"]],
  ["destructive_text_color", ["--destructive"]],
];

/**
 * `#RRGGBB` only.
 *
 * These values arrive from the client and are written straight into a style
 * attribute, so anything that is not plainly a colour is dropped rather than
 * trusted. A malformed one would also silently invalidate the declaration and
 * leave that token at whatever it was, which is far harder to see than a
 * colour that simply did not change.
 */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Push Telegram's palette onto the document. Returns how many tokens moved. */
export function applyTelegramPalette(doc: Document, params: Record<string, unknown> | undefined): number {
  const root = doc?.documentElement;
  if (!root || !params) return 0;

  let applied = 0;
  for (const [key, tokens] of PALETTE_MAP) {
    const value = params[key];
    if (!isHexColor(value)) continue;
    for (const token of tokens) root.style.setProperty(token, value);
    applied += 1;
  }
  return applied;
}

export type Insets = { top: number; bottom: number; left: number; right: number };

const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

function edge(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * How much of each edge the app must keep clear, in CSS pixels.
 *
 * TELEGRAM REPORTS TWO INSETS AND THEY ADD UP. They are not two measurements
 * of the same thing:
 *
 *   `safeAreaInset` is the DEVICE's — the notch, the home indicator, the
 *   rounded corners. Measured from the edge of the screen.
 *
 *   `contentSafeAreaInset` is TELEGRAM's own chrome inside the Mini App —
 *   most visibly the header bar in fullscreen mode. Measured from inside the
 *   device's safe area, because Telegram already avoided the notch when it
 *   drew that bar.
 *
 * So in fullscreen on a notched phone the top is a 47px notch with a 56px
 * Telegram header BELOW it, and the content must start at 103px. This used to
 * take `Math.max` of the pair, which returns 56 and puts the first line of
 * the app underneath Telegram's own header — the exact overlap the docs warn
 * about ("ensure that the app's interface respects the safe area and content
 * safe area ... especially when using fullscreen mode").
 *
 * All four edges, not just top and bottom: a landscape phone puts the notch
 * on a side, and rounded corners clip a full-bleed row at both.
 *
 * Older clients report neither -- both arrived in Bot API 8.0 -- and zero is
 * the right answer there, which is what the app rendered before either
 * existed. Non-numeric or negative values are treated as absent rather than
 * trusted into a layout.
 */
export function safeAreaInsets(w: Window): Insets {
  const app = w?.Telegram?.WebApp;
  if (!app) return NO_INSETS;
  const device = app.safeAreaInset;
  const content = app.contentSafeAreaInset;
  return {
    top: edge(device?.top) + edge(content?.top),
    bottom: edge(device?.bottom) + edge(content?.bottom),
    left: edge(device?.left) + edge(content?.left),
    right: edge(device?.right) + edge(content?.right),
  };
}

/** A light tick when a tab changes, the way native Telegram UI behaves. */
export function tabHaptic(w: Window): void {
  w?.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
}

/**
 * Telegram's own back button, driven from React state.
 *
 * A drill-in needs a way back, and Telegram already has one in its header
 * where users look for it. Drawing our own arrow inside the sheet would be a
 * second back button on the same screen, in the wrong place, which is the
 * opposite of "mimic the UI components that already exist".
 *
 * Returns a teardown that both unhooks the handler AND hides the button.
 * Hiding matters: the button belongs to the client, so one left visible
 * outlives the screen that wanted it and strands the user on a control that
 * does nothing.
 */
export function bindBackButton(w: Window, visible: boolean, onBack: () => void): () => void {
  const button = w?.Telegram?.WebApp?.BackButton;
  if (!button) return () => {};

  if (!visible) {
    button.hide?.();
    return () => {};
  }

  button.onClick?.(onBack);
  button.show?.();
  return () => {
    button.offClick?.(onBack);
    button.hide?.();
  };
}

/**
 * Tell Telegram the app is worth showing — AFTER the first frame.
 *
 * `ready()` hides Telegram's loading placeholder, which BotFather lets you
 * brand with an icon and per-theme colours. Calling it at import time threw
 * that away and replaced it with a blank sheet: nothing had rendered yet.
 *
 * Scheduled on a frame rather than tied to a React effect on purpose. An
 * effect only fires if the tree mounts, so a render that threw would leave the
 * placeholder up forever with the ErrorBoundary's message hidden behind it —
 * the one moment the reader most needs to see the screen. A frame callback
 * fires either way.
 */
export function signalReady(w: Window): void {
  const fire = () => {
    const app = w?.Telegram?.WebApp;
    if (app?.ready) {
      app.ready();
      return;
    }
    postReadyWithoutSdk(w);
  };
  if (typeof w?.requestAnimationFrame === "function") w.requestAnimationFrame(fire);
  else fire();
}

/**
 * `web_app_ready`, said without the SDK.
 *
 * The SDK's whole implementation of `ready()` is one line —
 * `WebView.postEvent('web_app_ready')` — over a transport the CLIENT provides,
 * not the script. So when telegram-web-app.js never arrives we can still say
 * it, and it matters more there than anywhere else: `ready()` is what takes
 * Telegram's branded loading placeholder down, and without it the placeholder
 * sits on top of the very screen explaining why the app could not start.
 *
 * The three transports and the wire format are copied from the SDK's own
 * `postEvent`, `eventData: ""` included — it defaults to an empty string, not
 * an empty object, and a client that gets the wrong shape simply ignores it.
 * Every failure is swallowed: a placeholder we could not dismiss must not also
 * break the page underneath it.
 */
function postReadyWithoutSdk(w: Window): void {
  const anyW = w as unknown as Record<string, { postEvent?: unknown; notify?: unknown }>;
  try {
    const proxy = anyW?.TelegramWebviewProxy;
    if (typeof proxy?.postEvent === "function") {
      (proxy.postEvent as (t: string, d: string) => void)("web_app_ready", JSON.stringify(""));
      return;
    }
    const external = anyW?.external;
    if (external && typeof external.notify === "function") {
      (external.notify as (m: string) => void)(
        JSON.stringify({ eventType: "web_app_ready", eventData: "" }),
      );
      return;
    }
    if (w?.parent && w.parent !== w) {
      // "*" matches the SDK exactly. The event is fixed and carries nothing,
      // so a wide target costs nothing.
      w.parent.postMessage(JSON.stringify({ eventType: "web_app_ready", eventData: "" }), "*");
    }
  } catch {
    /* see above: never fatal */
  }
}

/**
 * Did TELEGRAM open this page, whether or not its SDK arrived?
 *
 * NOT ONE OF THESE SIGNALS COMES FROM THE SDK, which is the entire point.
 * `isInsideTelegram()` reads `Telegram.WebApp.initData`, so it answers "no" in
 * two situations that need opposite screens: a plain browser, and a Telegram
 * client whose telegram.org script never loaded. The second one was being told
 * to open the app from Telegram — which is where they already were, with no
 * way forward and nothing to retry.
 *
 * The signals, each read out of the SDK's own source rather than guessed:
 *   - the launch hash. Telegram writes `#tgWebAppData=…&tgWebAppVersion=…`
 *     onto the URL at launch, on every platform, BEFORE the script is even
 *     requested; the SDK only reads it and never rewrites it, so it survives a
 *     reload.
 *   - `TelegramWebviewProxy` / `external.notify`, injected by the native iOS,
 *     Android and Desktop clients. The SDK only reads these too.
 *   - being framed by one of Telegram's four web-client origins — the same
 *     list `www/hr-me.py` declares in its frame-ancestors header, which is the
 *     server half of this same fact.
 *
 * IT AUTHORISES NOTHING. It decides which of two sentences to show. The server
 * re-verifies the initData HMAC on every request, so a hash somebody pasted by
 * hand buys them a retry button and a slightly wrong message.
 */
const TELEGRAM_WEB_ORIGINS = [
  "https://web.telegram.org",
  "https://webk.telegram.org",
  "https://webz.telegram.org",
  "https://weba.telegram.org",
];

export function launchedFromTelegram(w: Window, doc: Document): boolean {
  try {
    if (/[#&?]tgWebApp[A-Za-z]+=/.test(String(w?.location?.hash ?? ""))) return true;
  } catch {
    /* an opaque origin can throw on location access */
  }

  const anyW = w as unknown as Record<string, unknown>;
  if (anyW?.TelegramWebviewProxy !== undefined) return true;
  if (anyW?.TelegramWebviewProxyProto !== undefined) return true;
  try {
    const external = anyW?.external as Record<string, unknown> | undefined;
    if (external && typeof external.notify === "function") return true;
  } catch {
    /* older desktop clients throw on property access */
  }

  try {
    const referrer = String(doc?.referrer ?? "");
    if (w?.parent && w.parent !== w) {
      return TELEGRAM_WEB_ORIGINS.some((origin) => referrer.startsWith(origin));
    }
  } catch {
    /* likewise */
  }
  return false;
}

/**
 * Is this client at least this Bot API version?
 *
 * The SDK's own comparison, when it has one. Falling back to `false` is the
 * safe answer: a client too old to answer the question is too old to have
 * whatever is being asked about.
 *
 * CloudStorage calls this, and it is the only honest way to ask about it: the
 * method is installed on every client and THROWS below 6.9 rather than being
 * absent, so the feature detection every other helper here uses reports
 * support that is not there. The rule: a method that vanishes is
 * optional-chained, a method that throws is gated here.
 */
export function atLeast(w: Window, version: string): boolean {
  return Boolean(w?.Telegram?.WebApp?.isVersionAtLeast?.(version));
}

/**
 * Refetch when the app comes back to the foreground.
 *
 * A Mini App is minimised rather than closed — it sits behind the chat and
 * comes back holding whatever it loaded. For an attendance app that is
 * actively wrong: the most common use is checking a punch that JUST happened,
 * and the reader would be looking at data from before it.
 *
 * `activated` is Bot API 8.0; `visibilitychange` covers everything older, and
 * both firing is harmless because the caller invalidates a query rather than
 * mutating anything.
 */
export function onResume(w: Window, doc: Document, handler: () => void): () => void {
  const app = w?.Telegram?.WebApp;
  const onVisible = () => {
    if (doc?.visibilityState === "visible") handler();
  };

  app?.onEvent?.("activated", handler);
  doc?.addEventListener?.("visibilitychange", onVisible);
  return () => {
    app?.offEvent?.("activated", handler);
    doc?.removeEventListener?.("visibilitychange", onVisible);
  };
}

/**
 * Is the Mini App the thing the user is looking at?
 *
 * NOT `document.visibilityState`. A Mini App is minimised rather than closed —
 * it drops behind the chat and keeps running — and the webview is not reliably
 * marked hidden when that happens. react-query's `refetchIntervalInBackground:
 * false` is built on exactly that signal, so a 60s poll set up to stop when
 * nobody is looking can instead run all afternoon against a sheet behind a
 * chat list, on an employee's mobile data.
 *
 * Bot API 8.0 added `isActive` and the `activated`/`deactivated` pair for this
 * precise gap. Older clients have neither; `true` is the right default there,
 * because that is the behaviour those clients already had and a poll that
 * never runs is worse than one that runs too often.
 *
 * `subscribe` returns a teardown, and reports the CURRENT value on
 * subscription rather than waiting for the next transition — the app can be
 * launched, minimised and resumed before React has finished mounting.
 */
export function isAppActive(w: Window): boolean {
  const app = w?.Telegram?.WebApp;
  if (!app) return true;
  return app.isActive === undefined ? true : Boolean(app.isActive);
}

export function onActiveChange(w: Window, handler: (active: boolean) => void): () => void {
  const app = w?.Telegram?.WebApp;
  const activated = () => handler(true);
  const deactivated = () => handler(false);
  app?.onEvent?.("activated", activated);
  app?.onEvent?.("deactivated", deactivated);
  return () => {
    app?.offEvent?.("activated", activated);
    app?.offEvent?.("deactivated", deactivated);
  };
}

/**
 * Telegram's per-user cloud storage, used to reopen on the tab you left.
 *
 * Not localStorage: a Mini App webview's storage is not guaranteed to survive
 * between launches, and CloudStorage follows the user to their other devices —
 * which is the behaviour someone expects from something that lives inside
 * their chat app.
 *
 * Every failure is swallowed to the fallback. Remembering a tab is a
 * courtesy, and a courtesy must never be able to stop the app opening.
 */
const TAB_KEY = "dewey_last_tab";
const LOCALE_KEY = "dewey_locale";

export function loadLastTab(w: Window, accept: (value: string) => boolean): Promise<string | null> {
  return cloudGet(w, TAB_KEY, accept);
}

export function saveLastTab(w: Window, tab: string): void {
  cloudSet(w, TAB_KEY, tab);
}

/**
 * The chosen language, remembered the same way and for a stronger reason: a
 * Khmer reader whose phone is set to English would otherwise have to switch
 * the app back on every single launch.
 */
export function loadLocale(w: Window, accept: (value: string) => boolean): Promise<string | null> {
  return cloudGet(w, LOCALE_KEY, accept);
}

export function saveLocale(w: Window, locale: string): void {
  cloudSet(w, LOCALE_KEY, locale);
}

/**
 * The same-origin copy.
 *
 * PREFIXED: /hr-me shares an origin with the HR SPA at /hr-attendance, so an
 * unprefixed "dewey_locale" would be a key in that app's namespace too. The
 * CloudStorage keys keep their existing names — Telegram allows only
 * [A-Za-z0-9_-] there, and renaming them would orphan every preference
 * already remembered.
 */
const LOCAL_PREFIX = "dewey_miniapp:";

/**
 * The local key, scoped to the Telegram account when we can name one.
 *
 * CloudStorage is per-USER; localStorage is per-ORIGIN. Mirroring one into the
 * other without this makes a shared phone hand the second account the first
 * account's language and last tab — nothing from anybody's record, but still
 * an answer about somebody else. The id comes from `initDataUnsafe`, which is
 * untrusted and correctly so: it picks a storage key, and the server decides
 * everything that matters.
 *
 * Unscoped when the SDK cannot name a user, which is exactly the pre-SDK first
 * paint. On a shared device that can show the previous reader's language for
 * one frame before CloudStorage answers — a far smaller thing than keeping it
 * for the whole session, which is what the unscoped key did.
 */
function localKey(w: Window, key: string): string | null {
  const id = w?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return typeof id === "number" ? `${LOCAL_PREFIX}${id}:${key}` : null;
}

function localGet(w: Window, key: string): string | null {
  try {
    const store = w?.localStorage;
    if (!store) return null;
    const scoped = localKey(w, key);
    // EITHER the account's own answer OR the device-wide one — never one
    // falling back to the other. A reader the SDK has named gets their own
    // value or nothing; falling through to the shared copy would hand them
    // the previous account's language, which is the whole thing the scoping
    // exists to stop.
    return store.getItem(scoped ?? LOCAL_PREFIX + key) ?? null;
  } catch {
    // Private mode, storage disabled, an embedded webview with site data off.
    return null;
  }
}

function localSet(w: Window, key: string, value: string): void {
  try {
    const store = w?.localStorage;
    if (!store) return;
    const scoped = localKey(w, key);
    if (scoped) store.setItem(scoped, value);
    // AND the shared key, which is the only one the first paint can read
    // before the SDK exists. It is the "last reader on this device" copy, and
    // the scoped one above overrules it the moment we know who is asking.
    store.setItem(LOCAL_PREFIX + key, value);
  } catch {
    /* as above — a courtesy that must never be fatal */
  }
}

/**
 * The remembered language, synchronously, for a screen that cannot await.
 *
 * `loadLocale` is a promise because CloudStorage is a callback API, and the
 * shell's first paint happens long before it settles. This is the local
 * mirror, readable during render, so a returning reader opens in their own
 * language instead of flashing English at them.
 */
export function localeHint(w: Window): string | null {
  return localGet(w, LOCALE_KEY);
}

function cloudGet(
  w: Window,
  key: string,
  accept: (value: string) => boolean,
): Promise<string | null> {
  const local = localGet(w, key);
  const fallback = local !== null && accept(local) ? local : null;
  return new Promise((resolve) => {
    const storage = w?.Telegram?.WebApp?.CloudStorage;
    // THE VERSION, NOT THE METHOD. CloudStorage is installed on every client
    // and throws WebAppMethodUnsupported from inside getItem below 6.9, so
    // `storage?.getItem` is never false and the guard it looked like never
    // guarded anything.
    if (!storage?.getItem || !atLeast(w, "6.9")) return resolve(fallback);
    try {
      storage.getItem(key, (err, value) => {
        if (!err && typeof value === "string" && accept(value)) {
          // Mirrored down, so the answer survives an offline launch.
          localSet(w, key, value);
          return resolve(value);
        }
        resolve(fallback);
      });
    } catch {
      resolve(fallback);
    }
  });
}

function cloudSet(w: Window, key: string, value: string): void {
  // Local ALWAYS, cloud when the client can. Local is the only copy that
  // survives a client that refuses the call, and it costs nothing.
  //
  // Precedence on the way back is the other way round: CloudStorage wins when
  // it answers, because it is the copy that follows the reader to another
  // device.
  localSet(w, key, value);
  const storage = w?.Telegram?.WebApp?.CloudStorage;
  if (!storage?.setItem || !atLeast(w, "6.9")) return;
  try {
    storage.setItem(key, value, () => {});
  } catch {
    // Deliberately silent: persistence here is a courtesy, and a courtesy
    // must never be able to stop the app working.
  }
}

// NO homeScreenStatus / addToHomeScreen. The shell's "add to your home
// screen" row was removed, and these had no other caller. Kept out rather
// than kept around: `checkHomeScreenStatus` frequently answers "unknown",
// which is what made the row re-offer itself to people who had already
// tapped it. Telegram's own SDK is two lines away if it is ever wanted back.

/** A heavier tick than a tab change, for opening something. */
export function openHaptic(w: Window): void {
  w?.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
}

/**
 * Subscribe to every event that can change the space we have to draw in.
 *
 * `viewportChanged` fires as the sheet is dragged and when the keyboard opens;
 * `safeAreaChanged` and `contentSafeAreaChanged` fire on rotation and when
 * Telegram's own chrome resizes. All three change the answer `bottomInset`,
 * `topInset` and the viewport height give, and none of them re-renders React
 * on its own — without this the insets are whatever they were at mount.
 */
export function onViewportChange(w: Window, handler: () => void): () => void {
  const app = w?.Telegram?.WebApp;
  const events = ["viewportChanged", "safeAreaChanged", "contentSafeAreaChanged"];
  for (const event of events) app?.onEvent?.(event, handler);
  return () => {
    for (const event of events) app?.offEvent?.(event, handler);
  };
}

/**
 * One-time setup on launch. Returns a teardown for the theme listener.
 *
 * disableVerticalSwipes is the one worth explaining: by default a downward
 * swipe closes the Mini App. Two of these three tabs are vertically
 * scrollable lists, so a scroll gesture that starts at the top of the list
 * closes the app instead of scrolling it — the single most irritating thing a
 * scroll-heavy Mini App can do.
 */
export function initTelegramChrome(w: Window, doc: Document): () => void {
  const app = w?.Telegram?.WebApp;

  // NO ready() HERE. It used to be this line, and it was the wrong moment.
  // `ready()` is what tears down Telegram's own loading placeholder, and this
  // function runs at module scope — before React has mounted, let alone
  // painted. So the placeholder came down onto an empty page and the employee
  // watched a blank sheet in the app's background colour until the first
  // render landed. See signalReady, called after the first frame.
  app?.expand?.();
  app?.disableVerticalSwipes?.();

  const paint = () => {
    applyTheme(doc, themeFrom(w));
    // AFTER the class toggle, never before: `applyTheme` swaps which block of
    // token defaults is in play, and these are per-element overrides that must
    // sit on top of whichever one won.
    applyTelegramPalette(doc, w?.Telegram?.WebApp?.themeParams);
  };
  paint();

  // The header and bottom bar are Telegram's chrome, not ours, and left unset
  // they keep the client's default while the sheet under them is the app's
  // background -- a seam exactly where the app meets the client.
  const bg = w?.Telegram?.WebApp?.themeParams?.bg_color;
  if (isHexColor(bg)) {
    app?.setHeaderColor?.(bg);
    app?.setBackgroundColor?.(bg);
    app?.setBottomBarColor?.(bg);
  }

  app?.onEvent?.("themeChanged", paint);
  return () => app?.offEvent?.("themeChanged", paint);
}
