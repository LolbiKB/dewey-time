import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FrappeProvider, useFrappeGetCall } from "frappe-react-sdk";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Skeleton } from "@lolbikb/dewey-ui";
import { Launcher } from "./Launcher";
import { AdminTiles } from "./AdminTiles";
import { LandingControl } from "./LandingControl";
import type { LauncherData } from "./types";
import "./index.css";

const METHOD = "dewey_time.attendance_engine.launcher.get_launcher";

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useFrappeGetCall<{ message: LauncherData }>(METHOD, undefined, METHOD);
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-64 space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }
  if (!data?.message?.user?.can_manage_tiles) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FrappeProvider enableSocket={false}>
      <BrowserRouter>
        <Routes>
          <Route path="/home" element={<Launcher />} />
          <Route path="/home/admin" element={<AdminGuard><AdminTiles /></AdminGuard>} />
          <Route path="/home/admin/landing" element={<AdminGuard><LandingControl /></AdminGuard>} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter>
    </FrappeProvider>
  </StrictMode>
);
