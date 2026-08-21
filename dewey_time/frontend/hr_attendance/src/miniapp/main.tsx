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

function draw() {
  root.render(
    <React.StrictMode>
      {/* The Mini App's own crash screen. The shared card below it is written
          for an HR user at a desk: English, and with the JavaScript error
          printed on it. Constructed HERE, at the boundary's own level, so it
          is outside the subtree that threw by construction. */}
      <ErrorBoundary fallback={(_error, reload) => <MiniCrashScreen onRetry={reload} />}>
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
void loadTelegramSdk(window, document, { onLate: draw }).then(() => {
  initTelegramChrome(window, document);
  draw();
  // AFTER render is scheduled, on the next frame. Deliberately not a component
  // effect: a render that threw would never mount, and the placeholder would
  // then sit on top of the crash screen forever.
  signalReady(window);
});
