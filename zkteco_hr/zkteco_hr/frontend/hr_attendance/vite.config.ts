import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import proxyOptions from "./proxyOptions";

// Doppio-style: build into public/hr_attendance/, served at /assets/zkteco_hr/hr_attendance/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "serve" ? "/" : "/assets/zkteco_hr/hr_attendance/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server:
    command === "serve"
      ? {
          port: 8080,
          host: true,
          proxy: proxyOptions,
        }
      : undefined,
  build: {
    outDir: path.resolve(__dirname, "../../public/hr_attendance"),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2015",
    rollupOptions: {
      output: {
        // Stable names so Desk page can load the same bundle without parsing index.html.
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? "";
          if (name.endsWith(".css")) return "assets/index.css";
          return "assets/[name][extname]";
        },
      },
    },
  },
}));
