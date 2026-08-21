import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { ErrorBoundary } from "@/components/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { MiniAppShell } from "@/miniapp/MiniAppShell";
import { MiniCrashScreen } from "@/miniapp/MiniCrashScreen";
import { loadTelegramSdk } from "@/miniapp/telegramSdk";
import { initTelegramChrome, signalReady } from "@/miniapp/telegramChrome";
import "@/index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

/**
 * Bumped when the SDK arrives late, to force a REMOUNT rather than a
 * reconcile.
 *
 * A second `root.render` of the same tree updates the mounted shell in place:
 * no `useState` initialiser re-runs, no `[]`-dependency effect re-fires. So
 * the self-healed app kept the language and tab it had chosen when there was
 * no SDK to ask — measured, another account's device-wide preference among
 * them. Keying the boundary throws the subtree away and builds it again with
 * the answers the SDK can now give.
 */
let generation = 0;

function draw() {
  root.render(
    <React.StrictMode>
      {/* The Mini App's own crash screen. The shared card below it is written
          for an HR user at a desk: English, and with the JavaScript error
          printed on it. Constructed HERE, at the boundary's own level, so it
          is outside the subtree that threw by construction. */}
      <ErrorBoundary
        key={generation}
        fallback={(_error, reload) => <MiniCrashScreen onRetry={reload} />}
      >
        <QueryClientProvider client={queryClient}>
          {/* Required, not optional chrome: the planned-week columns render
              tooltips, and Radix throws "`Tooltip` must be used within
              `TooltipProvider`" without this — which took out the entire Week
              tab, not just the tooltip. The HR entry has always had it. */}
          <TooltipProvider>
            <MiniAppShell />
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

/**
 * NOTHING RENDERS UNTIL THE SDK QUESTION IS SETTLED, and the wait is bounded.
 *
 * The SDK used to be a `<script defer>` in the head. That kept the parser
 * moving but not the app: a deferred classic script and a module script share
 * one in-order execution list, so a telegram.org request that HUNG left
 * main.tsx fetched-but-never-run — no React, no boundary, no notice, nothing
 * to press. `loadTelegramSdk` puts a clock on it instead.
 *
 * Waiting rather than rendering-then-correcting is deliberate: until `ready()`
 * is called Telegram keeps its own branded placeholder up, which is a better
 * thing to be looking at than this app's light theme flashing to dark when the
 * SDK finally reports the client's colours.
 *
 * `initTelegramChrome` and `signalReady` both come after: the first has
 * nothing to read before the SDK exists, and the second is what takes the
 * placeholder down — so it must not fire until there is something behind it,
 * whether that is the app or the "didn't finish loading" screen.
 */
function start() {
  // BEFORE draw(), so the theme is on the document for the first paint rather
  // than flashing light at a dark client one frame later.
  initTelegramChrome(window, document);
  draw();
  // AFTER render is scheduled, on the next frame. Deliberately not a component
  // effect: a render that threw would never mount, and the placeholder would
  // then sit on top of the crash screen forever.
  signalReady(window);
}

void loadTelegramSdk(window, document, {
  // THE SAME START, not just a redraw. Redrawing alone left the self-healed
  // app half-configured: expand(), disableVerticalSwipes() and the theme are
  // all initTelegramChrome's, and skipping them means a light-themed app in a
  // dark client, swipe-to-close live, and the tab bar under the home
  // indicator — the exact things the wait above exists to prevent.
  onLate: () => {
    generation += 1;
    start();
  },
})
  .then(start)
  // A loader that somehow throws must not leave a blank page — which is the
  // one outcome this whole module exists to rule out. Not reachable today
  // (nothing in the executor can throw under this page's CSP), and cheap
  // enough to keep true anyway.
  .catch(() => start());
