import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { ErrorBoundary } from "@/components/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { MiniAppShell } from "@/miniapp/MiniAppShell";
import "@/index.css";

// Tell Telegram the webview is ready and let it take the full sheet. Optional
// chaining throughout: the page is also openable as a plain URL, where it
// renders the outside-Telegram notice rather than throwing on a missing SDK.
window.Telegram?.WebApp?.ready?.();
window.Telegram?.WebApp?.expand?.();

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
