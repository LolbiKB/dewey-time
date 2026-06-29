import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { App } from "./ui/App";
import { HrAppShell } from "./ui/HrAppShell";
import { WeeklySchedulePage } from "./ui/WeeklySchedulePage";
import { ScheduleImportPage } from "./ui/schedule-import/ScheduleImportPage";
import { ScheduleCoveragePage } from "./ui/schedule-coverage/ScheduleCoveragePage";
import { DeweyTimeIntro } from "./brand/DeweyTimeIntro";
import "./index.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { FrappeProvider } from "frappe-react-sdk";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FrappeProvider enableSocket={false}>
      <TooltipProvider>
        <DeweyTimeIntro />
        <BrowserRouter>
          <Routes>
            <Route element={<HrAppShell />}>
              <Route path="/hr-attendance" element={<App />} />
              <Route path="/hr-schedule" element={<WeeklySchedulePage />} />
              <Route path="/hr-schedule/import" element={<ScheduleImportPage />} />
              <Route path="/hr-schedule/coverage" element={<ScheduleCoveragePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/hr-attendance" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </FrappeProvider>
  </React.StrictMode>
);

// Register the service worker — PROD only (no SW in the Vite dev server) and
// non-fatal (the app works without it). Scoped to /hr-attendance even though the
// worker is served from the origin root; narrowing a scope never needs the
// Service-Worker-Allowed header.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/hr-attendance-sw.js", { scope: "/hr-attendance", updateViaCache: "none" })
      .catch(() => {});
  });
}
