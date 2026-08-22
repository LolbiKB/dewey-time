/**
 * Fetching Telegram's SDK ourselves, with a clock on it.
 *
 * IT USED TO BE A `<script defer>` IN THE HEAD, and the tag's own comment
 * argued that `defer` had solved the third-party-CDN-on-the-critical-path
 * problem. It solved half of it. `defer` unblocks the PARSER, so <body> is
 * parsed and #root exists — but a deferred classic script and a non-async
 * module script share ONE "execute when parsing has finished" list, in
 * document order. So while the request for telegram.org hangs, main.tsx is
 * fetched and never executed: no React, no error boundary, no notice. Measured
 * against the deployed bundle, an employee on a flaky link sat in front of
 * that for as long as the socket stayed open — which is the exact failure the
 * "the app didn't finish loading" screen was written for, and the one shape
 * where it could never appear.
 *
 * A request that FAILS was always fine: it settles, the list moves on, the app
 * renders. Only a hang — open socket, no response, no reset, which is what a
 * captive portal or a dying cell does — produced nothing at all.
 *
 * So the app loads the SDK itself and decides when to stop waiting. Nothing
 * renders before that decision: until we call `ready()` Telegram is still
 * showing its own branded placeholder, which is a far better thing to be
 * looking at than our light-themed shell flashing dark when the theme
 * arrives.
 */

/**
 * `?63` is the SDK's own version stamp, and it is the cache key.
 *
 * Without it a phone that loaded this app once keeps whatever copy of
 * telegram-web-app.js it cached then — and an older copy simply does not
 * define the newer surface. `safeAreaInset`, `contentSafeAreaInset` and the
 * `activated` event are all Bot API 8.0; on a stale SDK they are `undefined`,
 * every guard in telegramChrome.ts reads that as "old client", and the app
 * quietly renders with zero insets on a phone whose Telegram is current.
 * Telegram ships the number in their own snippet for this reason. Bump it
 * when they do.
 */
export const SDK_URL = "https://telegram.org/js/telegram-web-app.js?63";

/**
 * How long a hung request is allowed to hold the app back.
 *
 * Long enough that a slow connection still gets the real app — the file is
 * ~116KB — and short enough that somebody staring at a placeholder gets an
 * explanation while they still care. A late arrival is not wasted either: see
 * `onLate`, which redraws into the real app if the script turns up after we
 * have given up on it.
 */
export const SDK_TIMEOUT_MS = 6000;

export type LoadSdkOptions = {
  timeoutMs?: number;
  /** Called if the script lands AFTER the timeout, so a slow link self-heals. */
  onLate?: () => void;
};

/**
 * Resolves once the SDK is there, has failed, or has taken too long.
 *
 * `true` means `window.Telegram.WebApp` exists and can be read. It never
 * rejects and never hangs: every path is settled by the timer at the latest.
 */
export function loadTelegramSdk(
  w: Window,
  doc: Document,
  opts: LoadSdkOptions = {},
): Promise<boolean> {
  const present = () => Boolean((w as Window).Telegram?.WebApp);
  // Already there: a client that injects it, or a test that stubbed it. No
  // request, no wait.
  if (present()) return Promise.resolve(true);
  if (!doc?.createElement || !doc?.head) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => settle(present()), opts.timeoutMs ?? SDK_TIMEOUT_MS);

    const script = doc.createElement("script");
    script.src = SDK_URL;
    // `async`, and it is safe here in a way it never was as a tag in the head:
    // nothing reads window.Telegram until this promise settles, so there is no
    // ordering to preserve.
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      if (settled) {
        // It arrived after we gave up. The app is showing "didn't finish
        // loading"; redraw it into the real thing rather than making somebody
        // press a button for an app that is now perfectly able to start.
        if (present()) opts.onLate?.();
        return;
      }
      settle(present());
    };
    script.onerror = () => {
      clearTimeout(timer);
      settle(false);
    };
    doc.head.appendChild(script);
  });
}
