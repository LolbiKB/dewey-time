import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { ErrorBoundary } from "@/components/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { MiniAppShell } from "@/miniapp/MiniAppShell";
import { MiniCrashScreen } from "@/miniapp/MiniCrashScreen";
import { initTelegramChrome, signalReady } from "@/miniapp/telegramChrome";
import "@/index.css";

// expand, match Telegram's light or dark theme, and stop a downward scroll
// from closing the app. Safe outside Telegram: every call is feature-detected,
// so a plain browser just renders the notice.
initTelegramChrome(window, document);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* The Mini App's own crash screen. The shared card below it is written
        for an HR user at a desk: English, and with the JavaScript error
        printed on it. Constructed HERE, at the boundary's own level, so it is
        outside the subtree that threw by construction. */}
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

// AFTER render is scheduled, on the next frame. `ready()` takes down
// Telegram's loading placeholder — the one BotFather lets you brand with an
// icon and per-theme colours — so calling it before anything has painted swaps
// a branded splash for a blank sheet. Deliberately not a component effect: a
// render that threw would never mount, and the placeholder would then sit on
// top of the ErrorBoundary's message forever.
signalReady(window);
