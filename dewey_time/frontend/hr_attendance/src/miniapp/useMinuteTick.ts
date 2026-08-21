/**
 * A clock that actually moves.
 *
 * The Day tab's "so far" figure is derived from `now` at render time, and the
 * 60-second poll re-renders nothing when the data comes back unchanged — which
 * is the common case, because nobody punches every minute. So "0h 5m so far"
 * sat frozen beside a pulsing live dot for as long as the app was open, and on
 * a Telegram client too old for the resume event the DATE never rolled over
 * midnight either: the app kept calling yesterday "Today".
 *
 * Paused while the app is not on screen. A Mini App is minimised rather than
 * closed and keeps running behind the chat, so an unconditional interval is a
 * timer firing all afternoon against a screen nobody is looking at — the same
 * reason the query poll is gated on `isAppActive`.
 */
import { useEffect, useState } from "react";

import { isAppActive, onActiveChange } from "@/miniapp/telegramChrome";
import { siteNow, subscribeSiteClock } from "@/miniapp/siteClock";

export const TICK_MS = 60_000;

export function useMinuteTick(): Date {
  // `siteNow`, never `new Date()`. This hook is the near-choke point for every
  // present-tense claim on the two tabs, and until the server said otherwise
  // all of them were the DEVICE's opinion of the time — see siteClock.ts for
  // what that cost somebody whose phone was an hour out.
  const [now, setNow] = useState(() => siteNow());
  const [active, setActive] = useState(() => isAppActive(window));

  useEffect(() => {
    setActive(isAppActive(window));
    return onActiveChange(window, setActive);
  }, []);

  // Repaint the moment the offset is learned, rather than at the next tick.
  // The first screen after launch is the one somebody opened to check whether
  // their punch registered; drawing it from the device's wrong clock for up to
  // a minute is the same defect as never correcting it, just shorter.
  useEffect(() => subscribeSiteClock(() => setNow(siteNow())), []);

  useEffect(() => {
    if (!active) return;
    // Catch up immediately on resume: the figure is stale by however long the
    // app was away, and waiting a further minute to correct it is the defect
    // this hook exists to fix, just shorter.
    setNow(siteNow());
    const id = setInterval(() => setNow(siteNow()), TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  return now;
}
