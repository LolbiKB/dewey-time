import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FrappeProvider } from "frappe-react-sdk";
import { Launcher } from "./Launcher";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FrappeProvider enableSocket={false}>
      <Launcher />
    </FrappeProvider>
  </StrictMode>
);
