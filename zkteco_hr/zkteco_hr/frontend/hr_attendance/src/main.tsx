import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import "./index.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FrappeProvider } from "frappe-react-sdk";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FrappeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </FrappeProvider>
  </React.StrictMode>
);

