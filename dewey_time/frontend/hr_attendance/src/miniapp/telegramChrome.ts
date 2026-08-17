/**
 * Making the Mini App behave like part of Telegram rather than a webview
 * someone embedded.
 *
 * Every call here is optional-chained on purpose. The SDK object exists on
 * every client, but individual methods appear at different Bot API versions
 * (disableVerticalSwipes 7.7, safeAreaInset 8.0), and an older client simply
 * does not have them. Feature-detecting each one costs nothing; calling them
 * unguarded would throw on the very devices most likely to be in use on a
 * factory floor.
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
  const fire = () => w?.Telegram?.WebApp?.ready?.();
  if (typeof w?.requestAnimationFrame === "function") w.requestAnimationFrame(fire);
  else fire();
}

/**
 * Is this client at least this Bot API version?
 *
 * The SDK's own comparison, when it has one. Falling back to `false` is the
 * safe answer: a client too old to answer the question is too old to have
 * whatever is being asked about.
 *
 * Nothing calls this. Kept because it is the correct way to ask the question
 * and the alternative — a caller inventing its own version parse — is the
 * mistake it exists to prevent. Every other helper here feature-detects the
 * method it needs instead, which is better still.
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

function cloudGet(
  w: Window,
  key: string,
  accept: (value: string) => boolean,
): Promise<string | null> {
  return new Promise((resolve) => {
    const storage = w?.Telegram?.WebApp?.CloudStorage;
    if (!storage?.getItem) return resolve(null);
    try {
      storage.getItem(key, (err, value) =>
        resolve(!err && typeof value === "string" && accept(value) ? value : null),
      );
    } catch {
      resolve(null);
    }
  });
}

function cloudSet(w: Window, key: string, value: string): void {
  try {
    w?.Telegram?.WebApp?.CloudStorage?.setItem?.(key, value, () => {});
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
