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

  applyTheme(doc, themeFrom(w));

  const onThemeChanged = () => applyTheme(doc, themeFrom(w));
  app?.onEvent?.("themeChanged", onThemeChanged);
  return () => app?.offEvent?.("themeChanged", onThemeChanged);
}
