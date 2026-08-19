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

export const TICK_MS = 60_000;

export function useMinuteTick(): Date {
  const [now, setNow] = useState(() => new Date());
  const [active, setActive] = useState(() => isAppActive(window));

  useEffect(() => {
    setActive(isAppActive(window));
    return onActiveChange(window, setActive);
  }, []);

  useEffect(() => {
    if (!active) return;
    // Catch up immediately on resume: the figure is stale by however long the
    // app was away, and waiting a further minute to correct it is the defect
    // this hook exists to fix, just shorter.
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  return now;
}
