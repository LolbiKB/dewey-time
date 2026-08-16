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

/**
 * Bottom inset for the tab bar, in CSS pixels.
 *
 * Two insets, and both matter: `safeAreaInset` is the device's (the home
 * indicator on a notched phone) and `contentSafeAreaInset` is Telegram's own
 * chrome. Taking the larger keeps the tab bar clear of whichever intrudes
 * further. Older clients report neither, and 0 is the right answer there.
 */
export function bottomInset(w: Window): number {
  const app = w?.Telegram?.WebApp;
  return Math.max(app?.safeAreaInset?.bottom ?? 0, app?.contentSafeAreaInset?.bottom ?? 0);
}

/** Top inset, same reasoning as bottomInset. */
export function topInset(w: Window): number {
  const app = w?.Telegram?.WebApp;
  return Math.max(app?.safeAreaInset?.top ?? 0, app?.contentSafeAreaInset?.top ?? 0);
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

  app?.ready?.();
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
