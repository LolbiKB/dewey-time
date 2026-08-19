/**
 * Telegram's safe-area insets, as React state.
 *
 * Extracted from the shell because the BOTTOM SHEETS need them too and could
 * not reach them: both render through a portal, outside the shell's padded
 * container, so they were the only surfaces in the app sitting under the home
 * indicator. On a phone with a gesture bar that put roughly ten pixels of the
 * month total — the sheet's one number — inside the swipe zone, where a tap
 * dismisses the app instead.
 *
 * Held in state and refreshed on Telegram's own events rather than read once at
 * mount: read once, they are whatever they were before the sheet was dragged or
 * the device rotated, which is how chrome ends up back under the indicator
 * halfway through a session.
 */
import { useEffect, useState } from "react";

import { onViewportChange, safeAreaInsets } from "@/miniapp/telegramChrome";

export function useSafeAreaInsets() {
  const [insets, setInsets] = useState(() => safeAreaInsets(window));
  useEffect(() => {
    // Re-read on subscribe as well as on change: the viewport can settle before
    // this effect first runs, and the missed event would strand the old value.
    setInsets(safeAreaInsets(window));
    return onViewportChange(window, () => setInsets(safeAreaInsets(window)));
  }, []);
  return insets;
}
