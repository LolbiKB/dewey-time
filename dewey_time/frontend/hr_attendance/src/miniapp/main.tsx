import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { ErrorBoundary } from "@/components/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { MiniAppShell } from "@/miniapp/MiniAppShell";
import { initTelegramChrome } from "@/miniapp/telegramChrome";
import "@/index.css";

// ready/expand, match Telegram's light or dark theme, and stop a downward
// scroll from closing the app. Safe outside Telegram: every call is
// feature-detected, so a plain browser just renders the notice.
initTelegramChrome(window, document);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
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
